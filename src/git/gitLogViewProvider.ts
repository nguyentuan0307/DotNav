import * as path from 'path';
import * as vscode from 'vscode';
import { GitLogFilter } from './gitPanelModels';
import { GitRepositoryService } from './gitRepositoryService';
import { revisionUri } from './gitRevisionProvider';
import { GitMutationRunner } from './gitMutationRunner';
import { GitMutationRequest } from './gitPanelModels';
import { GitReadChannel, GitRequestCoordinator, GitRequestIdentity } from './gitPanelCoordinator';

interface WebviewMessage { type: string; root?: string; hash?: string; hashes?: string[]; path?: string; ref?: string; action?: string; kind?: string; operation?: string; parent?: number; offset?: number; x?: number; y?: number; generation?: number; filter?: GitLogFilter; }

export class GitLogViewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  static readonly viewId = 'dotnetSolutionNavigator.gitLog';
  private view?: vscode.WebviewView;
  private root?: string;
  private readonly disposables: vscode.Disposable[] = [];
  private readonly mutations: GitMutationRunner;
  private readonly requests = new GitRequestCoordinator();
  private readonly readCancellations = new Map<GitReadChannel, vscode.CancellationTokenSource>();
  private autoFetchTimer?: NodeJS.Timeout;
  private externalRefreshTimer?: NodeJS.Timeout;
  private gitWatcher?: vscode.FileSystemWatcher;
  private lastInternalMutationAt = 0;

  constructor(private readonly service: GitRepositoryService, private readonly extensionUri: vscode.Uri) {
    this.mutations = new GitMutationRunner(service);
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = { enableScripts: true, localResourceRoots: [this.extensionUri] };
    view.webview.html = renderHtml(view.webview);
    this.disposables.push(view.webview.onDidReceiveMessage(message => this.handle(message)));
    this.configureAutoFetch();
    this.configureGitWatcher();
  }

  async refresh(): Promise<void> {
    if (!this.view) return;
    const repositories = await this.service.discoverRepositories();
    if (!this.root || !repositories.includes(this.root)) this.root = repositories[0];
    if (!this.root) return this.post({ type: 'state', repositories });
    this.cancelReads();
    this.requests.invalidate(this.root);
    const read = this.beginRead('refresh', this.root);
    const [repository, log, uncommitted] = await Promise.all([
      this.service.snapshot(this.root, read.source.token), this.service.log(this.root, 0, 200, {}, read.source.token), this.service.workingTreeFiles(this.root, read.source.token)
    ]);
    if (this.requests.isCurrent('refresh', read.identity, this.root)) {
      this.post({ type: 'state', repositories, repository, log, uncommitted, generation: read.identity.generation, identity: read.identity });
    }
    this.finishRead('refresh', read.source);
  }

  dispose(): void {
    if (this.autoFetchTimer) clearInterval(this.autoFetchTimer);
    if (this.externalRefreshTimer) clearTimeout(this.externalRefreshTimer);
    this.gitWatcher?.dispose();
    this.disposables.splice(0).forEach(item => item.dispose());
    this.cancelReads();
  }

  configureAutoFetch(): void {
    if (this.autoFetchTimer) clearInterval(this.autoFetchTimer);
    const config = vscode.workspace.getConfiguration('dotnetSolutionNavigator.gitLog');
    if (!config.get<boolean>('autoFetch', true)) return;
    const minutes = config.get<number>('autoFetchMinutes', 20);
    this.autoFetchTimer = setInterval(() => {
      if (this.root && this.view?.visible && !this.mutations.isBusy(this.root)) this.runMutation({ action: 'fetch' }).catch(console.error);
    }, Math.max(1, minutes) * 60_000);
  }

  private configureGitWatcher(): void {
    if (this.gitWatcher) return;
    this.gitWatcher = vscode.workspace.createFileSystemWatcher('**/.git/{HEAD,index,refs/**,MERGE_HEAD,REBASE_HEAD,CHERRY_PICK_HEAD,REVERT_HEAD}');
    const schedule = () => this.scheduleExternalRefresh();
    this.gitWatcher.onDidCreate(schedule);
    this.gitWatcher.onDidChange(schedule);
    this.gitWatcher.onDidDelete(schedule);
  }

  private scheduleExternalRefresh(): void {
    if (this.externalRefreshTimer) clearTimeout(this.externalRefreshTimer);
    this.externalRefreshTimer = setTimeout(() => {
      this.externalRefreshTimer = undefined;
      if (!this.root || !this.view?.visible || this.mutations.isBusy(this.root) || Date.now() - this.lastInternalMutationAt < 1200) return;
      this.service.invalidateCaches(this.root);
      this.refresh().catch(error => { if (!(error instanceof vscode.CancellationError)) console.error(error); });
    }, 350);
  }

  private async handle(message: WebviewMessage): Promise<void> {
    try {
      if (message.type === 'ready' || message.type === 'refresh') return await this.refresh();
      if (message.type === 'selectRepo' && message.root) { this.cancelReads(); this.root = message.root; return await this.refresh(); }
      if (!this.root) return;
      if (message.type === 'loadLog') {
        const channel = `log:${message.offset ?? 0}`;
        const read = this.beginRead(channel, this.root, message.generation);
        try {
          const log = await this.service.log(this.root, message.offset ?? 0, 200, message.filter ?? {}, read.source.token);
          if (this.requests.isCurrent(channel, read.identity, this.root)) this.post({ type: 'log', log, identity: read.identity });
        } finally { this.finishRead(channel, read.source); }
        return;
      }
      if (message.type === 'detail' && message.hash) {
        const read = this.beginRead('detail', this.root, message.generation);
        try {
          const detail = await this.service.commitDetail(this.root, message.hash, message.parent, read.source.token);
          if (this.requests.isCurrent('detail', read.identity, this.root)) this.post({ type: 'detail', detail, identity: read.identity });
        } finally { this.finishRead('detail', read.source); }
        return;
      }
      if (message.type === 'diff' && message.hash && message.path) return await this.openDiff(message.hash, message.path, message.parent);
      if (message.type === 'workingDiff' && message.path) return await vscode.commands.executeCommand('git.openChange', vscode.Uri.file(path.join(this.root, message.path)));
      if (message.type === 'openFile' && message.path) {
        await vscode.window.showTextDocument(vscode.Uri.file(path.join(this.root, message.path)));
        return;
      }
      if (message.type === 'copy' && message.hash) return await vscode.env.clipboard.writeText(message.hash);
      if (message.type === 'openConflict' && message.path) return await this.openConflict(message.path);
      if (message.type === 'compare' && message.hashes?.length === 2) {
        const files = await this.service.filesBetween(this.root, message.hashes[0], message.hashes[1]);
        return this.post({ type: 'compareFiles', files, from: message.hashes[0], to: message.hashes[1] });
      }
      if (message.type === 'mutate' && message.action) {
        if (message.action === 'continue') {
          const unresolved = (await this.service.workingTreeFiles(this.root)).filter(file => file.conflict);
          if (unresolved.length) throw new Error(`Resolve these files before continuing: ${unresolved.map(file => file.path).join(', ')}`);
        }
        const request = await this.prepareMutation(message);
        if (request) await this.runMutation(request);
      }
      if (message.type === 'context') {
        this.post({ type: 'contextMenu', actions: contextActions(message.kind), context: message });
      }
      if (message.type === 'contextAction' && message.action) await this.executeContextAction(message);
    } catch (error) {
      if (error instanceof vscode.CancellationError) return;
      const text = error instanceof Error ? error.message : String(error);
      this.post({ type: 'error', message: text });
      if (message.action === 'push' && /rejected|non-fast-forward/i.test(text)) {
        const recovery = await vscode.window.showErrorMessage(text, 'Update Project');
        if (recovery === 'Update Project') {
          const request = await this.prepareMutation({ type: 'mutate', action: 'update' });
          if (request) await this.runMutation(request);
        }
      } else {
        vscode.window.showErrorMessage(text);
      }
    }
  }

  private beginRead(channel: GitReadChannel, root: string, generation?: number): { identity: GitRequestIdentity; source: vscode.CancellationTokenSource } {
    this.readCancellations.get(channel)?.cancel();
    this.readCancellations.get(channel)?.dispose();
    const source = new vscode.CancellationTokenSource();
    this.readCancellations.set(channel, source);
    return { identity: this.requests.begin(channel, root, generation), source };
  }

  private finishRead(channel: GitReadChannel, source: vscode.CancellationTokenSource): void {
    if (this.readCancellations.get(channel) !== source) return;
    this.readCancellations.delete(channel);
    source.dispose();
  }

  private cancelReads(): void {
    for (const source of this.readCancellations.values()) { source.cancel(); source.dispose(); }
    this.readCancellations.clear();
  }

  private async runMutation(request: GitMutationRequest): Promise<void> {
    if (!this.root) return;
    const root = this.root;
    this.cancelReads();
    this.requests.invalidate(root);
    this.post({ type: 'busy', busy: true, action: request.action, repositoryId: root });
    try { if (await this.mutations.run(root, request) && this.root === root) await this.refresh(); }
    finally { this.lastInternalMutationAt = Date.now(); this.post({ type: 'busy', busy: false, repositoryId: root }); }
  }

  private async executeContextAction(message: WebviewMessage): Promise<void> {
    const action = message.action!;
    if (action === 'copy') {
      await vscode.env.clipboard.writeText(message.path ?? message.ref ?? message.hash ?? '');
      return;
    }
    if (action === 'diff' && message.hash && message.path) return await this.openDiff(message.hash, message.path, message.parent);
    if (action === 'openRevision' && message.hash && message.path) {
      await vscode.window.showTextDocument(revisionUri(this.root!, message.hash, message.path), { preview: true });
      return;
    }
    if (action === 'openFile' && message.path) {
      await vscode.window.showTextDocument(vscode.Uri.file(path.join(this.root!, message.path)));
      return;
    }
    if (action === 'workingFileDiff' && message.path) {
      await vscode.commands.executeCommand('git.openChange', vscode.Uri.file(path.join(this.root!, message.path)));
      return;
    }
    if (action === 'fileHistory' && message.path) {
      await vscode.window.showTextDocument(vscode.Uri.file(path.join(this.root!, message.path)));
      await vscode.commands.executeCommand('timeline.focus');
      return;
    }
    if (action === 'compare' && message.hashes?.length === 2) {
      const files = await this.service.filesBetween(this.root!, message.hashes[0], message.hashes[1]);
      this.post({ type: 'compareFiles', files, from: message.hashes[0], to: message.hashes[1] });
      return;
    }
    if (action === 'compareCurrent' && message.ref) {
      const [onlyCurrent, onlySelected, files] = await Promise.all([
        this.service.commitsInRange(this.root!, `${message.ref}..HEAD`),
        this.service.commitsInRange(this.root!, `HEAD..${message.ref}`),
        this.service.filesBetween(this.root!, 'HEAD', message.ref)
      ]);
      this.post({ type: 'compareFiles', files, from: 'HEAD', to: message.ref, onlyCurrent, onlySelected });
      return;
    }
    if (action === 'workingDiff' && message.ref) {
      this.post({ type: 'compareFiles', files: await this.service.filesAgainstWorkingTree(this.root!, message.ref), from: message.ref, to: 'working tree' });
      return;
    }
    if (action === 'stashDiff' && message.ref) {
      this.post({ type: 'compareFiles', files: await this.service.stashFiles(this.root!, message.ref), from: `${message.ref}^`, to: message.ref });
      return;
    }
    if (action === 'openWeb' && message.hash) {
      const url = await this.service.remoteWebUrl(this.root!, message.hash);
      if (!url) throw new Error('The origin remote is not a supported GitHub or GitLab URL.');
      await vscode.env.openExternal(vscode.Uri.parse(url));
      return;
    }
    if (action === 'showRepository' && message.hash) {
      const file = await vscode.window.showQuickPick(await this.service.repositoryFiles(this.root!, message.hash), {
        title: `Repository at ${message.hash.slice(0, 8)}`, placeHolder: 'Select a file to open read-only'
      });
      if (file) await vscode.window.showTextDocument(revisionUri(this.root!, message.hash, file), { preview: true });
      return;
    }
    if (action === 'copyShort' && message.hash) return await vscode.env.clipboard.writeText(message.hash.slice(0, 8));
    if (action === 'copyMessage' && message.hash) {
      const detail = await this.service.commitDetail(this.root!, message.hash);
      return await vscode.env.clipboard.writeText(detail.message);
    }
    const request = await this.prepareMutation({ ...message, type: 'mutate', action });
    if (request) await this.runMutation(request);
  }

  private async prepareMutation(message: WebviewMessage): Promise<GitMutationRequest | undefined> {
    const action = message.action!;
    if (action === 'stash') {
      const value = await vscode.window.showInputBox({ title: 'Stash Changes', prompt: 'Stash message', value: `WIP on ${new Date().toLocaleString()}` });
      return value === undefined ? undefined : { action, options: { message: value, includeUntracked: true } };
    }
    if (action === 'createBranch') {
      const name = await vscode.window.showInputBox({ title: 'New Branch', prompt: 'Branch name', validateInput: validateRefName });
      return name ? { action, ref: message.ref, options: { name, checkout: true } } : undefined;
    }
    if (action === 'renameBranch') {
      const name = await vscode.window.showInputBox({ title: `Rename ${message.ref}`, prompt: 'New branch name', value: message.ref, validateInput: validateRefName });
      return name ? { action, ref: message.ref, options: { name } } : undefined;
    }
    if (action === 'checkoutUpdate') {
      const strategy = await vscode.window.showQuickPick([{ label: 'Merge', rebase: false }, { label: 'Rebase', rebase: true }], { title: `Checkout and Update ${message.ref}` });
      return strategy ? { action, ref: message.ref, options: { rebase: strategy.rebase, remote: message.kind === 'remote' } } : undefined;
    }
    if (action === 'update') {
      const strategy = await vscode.window.showQuickPick([
        { label: 'Merge', value: 'merge' }, { label: 'Rebase', value: 'rebase' },
        { label: 'Reset to Remote Branch', description: 'Discards local commits and changes', value: 'reset' }
      ], { title: 'Update Project Strategy' });
      if (!strategy) return undefined;
      if (strategy.value === 'reset') {
        const confirmed = await vscode.window.showWarningMessage(
          'Reset to Remote Branch permanently discards local commits and working tree changes.',
          { modal: true }, 'Reset to Remote Branch');
        if (!confirmed) return undefined;
      }
      return { action, options: { strategy: strategy.value } };
    }
    if (action === 'push') {
      const snapshot = await this.service.snapshot(this.root!);
      const outgoing = snapshot.upstream ? await this.service.commitsInRange(this.root!, `${snapshot.upstream}..HEAD`, 50) : [];
      const forceLease = await vscode.window.showQuickPick([
        { label: 'Push', value: false, description: `${snapshot.upstream ?? 'Configured upstream'} · ${outgoing.length} outgoing commit(s)`, detail: outgoing.slice(0, 5).map(commit => `${commit.shortHash} ${commit.subject}`).join('\n') },
        { label: 'Force with Lease', value: true, description: 'Rewrites the remote only if it has not changed' }
      ], { title: 'Push Current Branch' });
      if (!forceLease) return undefined;
      const tags = await vscode.window.showQuickPick([{ label: 'Branch only', value: false }, { label: 'Include tags', value: true }], { title: 'Push Tags' });
      return tags ? { action, options: { forceLease: forceLease.value, tags: tags.value } } : undefined;
    }
    if (action === 'merge') {
      const mode = await vscode.window.showQuickPick([
        { label: 'Merge', noFf: false, squash: false }, { label: 'No Fast-Forward', noFf: true, squash: false },
        { label: 'Squash', noFf: false, squash: true }
      ], { title: `Merge ${message.ref} into Current` });
      return mode ? { action, ref: message.ref, options: { noFf: mode.noFf, squash: mode.squash } } : undefined;
    }
    if (action === 'deleteRemote') {
      const parts = (message.ref ?? '').split('/');
      return parts.length > 1 ? { action, ref: parts.slice(1).join('/'), options: { remote: parts[0] } } : undefined;
    }
    if (action === 'deleteBranch') {
      const choice = await vscode.window.showWarningMessage(`Delete local branch ${message.ref}?`, { modal: true }, 'Delete', 'Force Delete');
      return choice ? { action, ref: message.ref, options: { force: choice === 'Force Delete' } } : undefined;
    }
    if (action === 'pullInto') {
      const [remote, ...branchParts] = (message.ref ?? '').split('/');
      const strategy = await vscode.window.showQuickPick([{ label: 'Merge', rebase: false }, { label: 'Rebase', rebase: true }], { title: `Pull ${message.ref} into Current` });
      return strategy && branchParts.length ? { action, options: { remote, branch: branchParts.join('/'), rebase: strategy.rebase } } : undefined;
    }
    if (action === 'stashBranch') {
      const name = await vscode.window.showInputBox({ title: `Create Branch from ${message.ref}`, prompt: 'Branch name', validateInput: validateRefName });
      return name ? { action, ref: message.ref, options: { name } } : undefined;
    }
    if (action === 'deleteTag') {
      const mode = await vscode.window.showQuickPick([
        { label: 'Delete Local Tag', remote: '' }, { label: 'Delete Local and origin Tag', remote: 'origin' }
      ], { title: `Delete Tag ${message.ref}` });
      return mode ? { action, ref: message.ref, options: mode.remote ? { remote: mode.remote } : undefined } : undefined;
    }
    if (action === 'checkout' && (message.kind === 'tag' || message.kind === 'commit')) {
      const confirmed = await vscode.window.showWarningMessage(`Checkout ${message.ref ?? message.hash} in detached HEAD state?`, { modal: true }, 'Checkout Detached');
      return confirmed ? { action, ref: message.ref ?? message.hash, options: { detached: true } } : undefined;
    }
    if (action === 'reset') {
      const mode = await vscode.window.showQuickPick(['soft', 'mixed', 'hard', 'keep'], { title: `Reset Current Branch to ${message.hash}` });
      return mode ? { action, ref: message.hash, options: { mode } } : undefined;
    }
    if (action === 'tag') {
      const name = await vscode.window.showInputBox({ title: 'New Tag', prompt: 'Tag name', validateInput: validateRefName });
      if (!name) return undefined;
      const tagMessage = await vscode.window.showInputBox({ title: `Tag ${name}`, prompt: 'Annotation message (leave empty for lightweight tag)' });
      return tagMessage === undefined ? undefined : { action, ref: message.hash, options: { name, message: tagMessage } };
    }
    if (action === 'undoCommit') {
      const head = (await this.service.git(this.root!, ['rev-parse', 'HEAD'])).stdout.trim();
      if (head !== message.hash) throw new Error('Undo Commit is available only for the current HEAD commit.');
      return { action, hash: message.hash };
    }
    return { action, ref: message.ref ?? message.hash, hash: message.hash, hashes: message.hashes, path: message.path, options: message.operation ? { operation: message.operation } : undefined };
  }

  private async openDiff(hash: string, filePath: string, parent = 1): Promise<void> {
    const detail = await this.service.commitDetail(this.root!, hash, parent);
    const leftRef = detail.parents[parent - 1];
    const left = leftRef ? revisionUri(this.root!, leftRef, filePath) : vscode.Uri.parse('untitled:empty');
    const right = revisionUri(this.root!, hash, filePath);
    await vscode.commands.executeCommand('vscode.diff', left, right, `${filePath} (${hash.slice(0, 8)})`);
  }

  private async openConflict(filePath: string): Promise<void> {
    const uri = vscode.Uri.file(path.join(this.root!, filePath));
    try { await vscode.commands.executeCommand('git.openMergeEditor', uri); }
    catch { await vscode.window.showTextDocument(uri); }
  }

  private post(message: unknown): void { this.view?.webview.postMessage(message); }
}

function validateRefName(value: string): string | undefined {
  return !value.trim() || /[~^:?*\[\\\s]|\.\.|\/\//.test(value) ? 'Enter a valid Git ref name.' : undefined;
}

function contextActions(kind?: string): Array<{ label: string; action: string }> {
  if (kind === 'local') return [
    { label: 'Checkout', action: 'checkout' }, { label: 'Checkout and Update', action: 'checkoutUpdate' }, { label: 'New Branch from Selected...', action: 'createBranch' }, { label: 'Rename...', action: 'renameBranch' },
    { label: 'Compare with Current', action: 'compareCurrent' }, { label: 'Show Diff with Working Tree', action: 'workingDiff' },
    { label: 'Merge into Current', action: 'merge' }, { label: 'Rebase Current onto Selected', action: 'rebase' },
    { label: 'Checkout and Rebase onto Current', action: 'checkoutRebase' }, { label: 'Push', action: 'pushBranch' }, { label: 'Delete Branch', action: 'deleteBranch' }, { label: 'Copy Branch Name', action: 'copy' }
  ];
  if (kind === 'remote') return [
    { label: 'Checkout Tracking Branch', action: 'checkoutRemote' }, { label: 'Checkout and Update', action: 'checkoutUpdate' }, { label: 'New Branch from Selected...', action: 'createBranch' },
    { label: 'Compare with Current', action: 'compareCurrent' }, { label: 'Show Diff with Working Tree', action: 'workingDiff' }, { label: 'Merge into Current', action: 'merge' },
    { label: 'Rebase Current onto Selected', action: 'rebase' }, { label: 'Pull into Current', action: 'pullInto' }, { label: 'Delete on Remote', action: 'deleteRemote' }, { label: 'Copy Branch Name', action: 'copy' }
  ];
  if (kind === 'tag') return [{ label: 'Checkout Revision', action: 'checkout' }, { label: 'New Branch from Tag...', action: 'createBranch' }, { label: 'Delete Tag', action: 'deleteTag' }, { label: 'Copy Tag Name', action: 'copy' }];
  if (kind === 'stash') return [{ label: 'Apply', action: 'stashApply' }, { label: 'Pop', action: 'stashPop' }, { label: 'Drop', action: 'stashDrop' }, { label: 'Show Diff', action: 'stashDiff' }, { label: 'Create Branch from Stash', action: 'stashBranch' }];
  if (kind === 'commit') return [
    { label: 'Checkout Revision', action: 'checkout' }, { label: 'New Branch here...', action: 'createBranch' }, { label: 'New Tag here...', action: 'tag' },
    { label: 'Cherry-Pick', action: 'cherryPick' }, { label: 'Revert Commit', action: 'revert' }, { label: 'Undo Commit', action: 'undoCommit' }, { label: 'Drop Commit', action: 'dropCommit' }, { label: 'Reset Current Branch to Here...', action: 'reset' },
    { label: 'Show Repository at Revision', action: 'showRepository' }, { label: 'Open on GitHub/GitLab', action: 'openWeb' },
    { label: 'Copy Revision Number', action: 'copy' }, { label: 'Copy Short Hash', action: 'copyShort' }, { label: 'Copy Message', action: 'copyMessage' }
  ];
  if (kind === 'commits') return [{ label: 'Compare Versions', action: 'compare' }, { label: 'Cherry-Pick in Selected Order', action: 'cherryPick' }, { label: 'Revert in Selected Order', action: 'revert' }];
  if (kind === 'commitFile') return [
    { label: 'Show Diff', action: 'diff' }, { label: 'Show File History', action: 'fileHistory' }, { label: 'Open Version at Revision', action: 'openRevision' },
    { label: 'Get File from Revision', action: 'getFile' }, { label: 'Revert Selected Changes', action: 'revertFile' }, { label: 'Open in Editor', action: 'openFile' }, { label: 'Copy Path', action: 'copy' }
  ];
  if (kind === 'workingFile') return [{ label: 'Show Diff', action: 'workingFileDiff' }, { label: 'Rollback', action: 'rollbackFile' }, { label: 'Open in Editor', action: 'openFile' }];
  return [];
}

function renderHtml(webview: vscode.Webview): string {
  const nonce = Math.random().toString(36).slice(2);
  return `<!doctype html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'">
<style>
*{box-sizing:border-box}body{margin:0;color:var(--vscode-foreground);background:var(--vscode-panel-background);font:var(--vscode-font-size) var(--vscode-font-family);overflow:hidden}button,input,select{font:inherit;color:inherit;background:var(--vscode-input-background);border:1px solid var(--vscode-input-border);height:26px}button{cursor:pointer}.toolbar{min-height:34px;display:flex;gap:4px;align-items:center;padding:4px;border-bottom:1px solid var(--vscode-panel-border);overflow-x:auto}.toolbar .grow{flex:1}.layout{height:calc(100vh - 34px);display:grid;grid-template-columns:var(--left,220px) 4px minmax(320px,1fr) 4px var(--right,330px)}.split{background:var(--vscode-panel-border);cursor:col-resize}.pane{min-width:0;overflow:hidden}.branches,.right{display:flex;flex-direction:column}.heading{min-height:30px;padding:4px 9px;font-weight:600;border-bottom:1px solid var(--vscode-panel-border)}#branchSearch{margin:5px;width:calc(100% - 10px)}#branches,#files{overflow:auto;flex:1;padding:3px 0}.group{padding:7px 8px 3px;color:var(--vscode-descriptionForeground);font-size:11px;text-transform:uppercase}.item{height:24px;padding:4px 8px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:default}.item:hover,.row:hover{background:var(--vscode-list-hoverBackground)}.item.active{font-weight:600;color:var(--vscode-gitDecoration-addedResourceForeground)}.badge{float:right;color:var(--vscode-descriptionForeground)}.center{display:flex;flex-direction:column}.filters{min-height:64px;padding:4px;display:grid;grid-template-columns:minmax(110px,1.4fr) minmax(90px,1fr) minmax(110px,1.2fr) 118px 118px minmax(110px,1fr);grid-template-rows:26px 26px;gap:4px;border-bottom:1px solid var(--vscode-panel-border)}.filters>input{min-width:0}.filters label{display:flex;align-items:center;gap:4px;height:26px;white-space:nowrap}.filters label input{width:16px;height:16px}.filters label:first-of-type{grid-column:1}.filters label:nth-of-type(2){grid-column:2}.filters #clear{grid-column:6;grid-row:2;justify-self:end}.header,.row{display:grid;grid-template-columns:minmax(70px,auto) minmax(180px,1fr) minmax(90px,130px) minmax(100px,145px);align-items:center}.header{height:25px;color:var(--vscode-descriptionForeground);border-bottom:1px solid var(--vscode-panel-border)}.header>*{padding:0 7px}.viewport{position:relative;overflow:auto;flex:1}.spacer{position:relative}.row{position:absolute;left:0;right:0;height:28px;border-bottom:1px solid color-mix(in srgb,var(--vscode-panel-border) 45%,transparent)}.row>*{padding:0 7px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.row.selected{background:var(--vscode-list-activeSelectionBackground);color:var(--vscode-list-activeSelectionForeground)}.graph{font-family:monospace;color:var(--vscode-gitDecoration-modifiedResourceForeground);overflow:visible}.refs{color:var(--vscode-badge-foreground);background:var(--vscode-badge-background);padding:1px 4px;margin-left:6px}.right{border-left:0}.detail{height:44%;min-height:90px;border-top:1px solid var(--vscode-panel-border);overflow:auto;padding:9px}.file{display:grid;grid-template-columns:18px minmax(0,1fr) auto;gap:5px;padding:5px 8px;cursor:default}.file span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.file .stat{color:var(--vscode-descriptionForeground)}.message{font-weight:600;white-space:pre-wrap}.meta{margin-top:7px;color:var(--vscode-descriptionForeground);word-break:break-all}.empty{padding:14px;color:var(--vscode-descriptionForeground)}.banner{display:none;padding:6px 9px;background:var(--vscode-inputValidation-warningBackground);border-bottom:1px solid var(--vscode-inputValidation-warningBorder)}.context-menu{position:fixed;z-index:1000;display:none;min-width:220px;max-width:360px;padding:4px;background:var(--vscode-menu-background);color:var(--vscode-menu-foreground);border:1px solid var(--vscode-menu-border);box-shadow:0 4px 14px rgba(0,0,0,.35)}.context-menu button{display:block;width:100%;height:26px;padding:3px 8px;text-align:left;border:0;background:transparent;color:inherit}.context-menu button:hover,.context-menu button:focus{background:var(--vscode-menu-selectionBackground);color:var(--vscode-menu-selectionForeground);outline:none}@media(max-width:900px){.header,.row{grid-template-columns:minmax(64px,auto) minmax(160px,1fr) minmax(90px,120px)}.header>:nth-child(4),.row>:nth-child(4){display:none}.filters{grid-template-columns:repeat(3,minmax(100px,1fr));grid-template-rows:repeat(3,26px);min-height:94px}.filters #clear{grid-column:3;grid-row:3}}@media(max-width:700px){.header,.row{grid-template-columns:minmax(60px,auto) minmax(150px,1fr)}.header>:nth-child(3),.row>:nth-child(3){display:none}.layout{grid-template-columns:var(--left,180px) 4px minmax(260px,1fr) 4px var(--right,260px)}}
.header,.row{grid-template-columns:var(--graph-width,70px) minmax(180px,1fr) minmax(90px,130px) minmax(100px,145px)}.graph-overlay{position:absolute;inset:0 auto auto 0;z-index:3;pointer-events:none;overflow:visible}.toast{display:none;position:fixed;z-index:900;right:12px;bottom:12px;max-width:min(520px,calc(100vw - 24px));padding:8px 10px;background:var(--vscode-inputValidation-errorBackground);border:1px solid var(--vscode-inputValidation-errorBorder);white-space:pre-wrap}.busy .toolbar [data-action],.busy #repo{pointer-events:none;opacity:.5}.row.loading span:nth-child(2){width:45%;height:8px;background:var(--vscode-editorWidget-border);opacity:.45}.row.multi:not(.selected){background:var(--vscode-list-inactiveSelectionBackground)}
@media(max-width:900px){.header,.row{grid-template-columns:var(--graph-width,64px) minmax(160px,1fr) minmax(90px,120px)}}@media(max-width:700px){.header,.row{grid-template-columns:var(--graph-width,60px) minmax(150px,1fr)}}
</style></head><body>
<div class="toolbar"><button id="refresh" title="Refresh">↻</button><button data-action="fetch">Fetch</button><button data-action="update">Update Project</button><button data-action="pull">Pull</button><button data-action="push">Push</button><button data-action="stash">Stash</button><button data-action="createBranch">New Branch</button><button id="viewOptions">View</button><span id="status"></span><span class="grow"></span><select id="repo"></select></div>
<main class="layout" id="layout"><section class="pane branches"><div class="heading">BRANCHES</div><input id="branchSearch" placeholder="Search branches"><div id="branches"></div></section><div class="split" data-side="left"></div>
<section class="pane center"><div class="banner" id="banner"><b id="operation"></b><button data-conflict="continue">Continue</button><button data-conflict="abort">Abort</button><button data-conflict="skip">Skip</button></div><div class="filters"><input id="textFilter" placeholder="Message"><input id="authorFilter" placeholder="Author"><input id="pathFilter" placeholder="Path"><input id="sinceFilter" type="date" title="From date"><input id="untilFilter" type="date" title="To date"><input id="goto" placeholder="Hash / ref"><label><input type="checkbox" id="regex"> Regex</label><label><input type="checkbox" id="case"> Case</label><button id="clear">Clear</button></div><div class="header"><span>Graph</span><span>Subject</span><span>Author</span><span>Date</span></div><div class="row" id="uncommitted" style="display:none;position:relative"><span></span><strong>Uncommitted changes</strong><span></span><span></span></div><div class="viewport" id="viewport" tabindex="0"><svg class="graph-overlay" id="graphSvg" aria-hidden="true"></svg><div class="spacer" id="spacer"></div></div></section>
<div class="split" data-side="right"></div><section class="pane right"><div class="heading">CHANGED FILES <button id="fileMode" title="Toggle tree or flat view">Tree</button><button id="collapseFiles" title="Collapse all folders">−</button><button id="expandFiles" title="Expand all folders">+</button><select id="parentMode" style="display:none" title="Merge comparison parent"></select></div><div id="files"></div><div class="detail" id="detail"><div class="empty">Select a commit</div></div></section></main><div class="context-menu" id="contextMenu" role="menu"></div><div class="toast" id="toast" role="alert"></div>
<script nonce="${nonce}">
const vscode=acquireVsCodeApi(), ROW=28, PAGE=200, overscan=12, COL=16, PAD=8, LANE_COLORS=['#0085d9','#d9008f','#00d90a','#d98500','#a000d9','#00d9d9','#d94600','#7bd900'];let state={commits:[],commitIndexes:new Map(),total:0,generation:0,busy:false,loading:new Set(),selected:-1,selectionAnchor:-1,selectedHashes:new Set(),detail:null,uncommitted:[],visibleFiles:[],visibleFilesWorking:false,fileFolders:new Set(),fileMode:localStorage.getItem('gitLog.fileMode')||'tree',fileCollapsed:new Set(JSON.parse(localStorage.getItem('gitLog.fileCollapsed')||'[]')),favorites:new Set(JSON.parse(localStorage.getItem('gitLog.favorites')||'[]')),collapsed:new Set(JSON.parse(localStorage.getItem('gitLog.collapsed')||'[]'))};
const $=id=>document.getElementById(id), esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function send(type,data={}){vscode.postMessage({type,...data})}function date(ts){return new Date(ts*1000).toLocaleString()}
function refItem(x,label=x.name,depth=0){return '<div class="item '+(x.current?'active':'')+'" style="padding-left:'+(8+depth*14)+'px" data-kind="'+x.kind+'" data-hash="'+x.hash+'" data-ref="'+esc(x.name)+'"><button style="border:0;background:transparent;height:auto;padding:0 5px 0 0" data-star="'+esc(x.name)+'" title="Favorite">'+(state.favorites.has(x.name)?'★':'☆')+'</button>'+esc(label)+'<span class="badge">'+(x.ahead?'↑'+x.ahead+' ':'')+(x.behind?'↓'+x.behind:'')+'</span></div>'}
function refTree(refs,kind,q,prefix='',depth=0){const folders=new Map(),leaves=[];for(const ref of refs){const relative=prefix&&ref.name.startsWith(prefix+'/')?ref.name.slice(prefix.length+1):ref.name,parts=relative.split('/');if(parts.length===1)leaves.push(ref);else{const folder=parts[0];if(!folders.has(folder))folders.set(folder,[]);folders.get(folder).push(ref)}}let html=leaves.map(x=>refItem(x,x.name.split('/').pop(),depth)).join('');for(const [folder,children] of [...folders].sort(([a],[b])=>a.localeCompare(b))){const key=kind+':'+(prefix?prefix+'/':'')+folder,closed=!q&&state.collapsed.has(key);html+='<div class="item folder" style="padding-left:'+(8+depth*14)+'px" data-folder="'+esc(key)+'">'+(closed?'▸':'▾')+' '+esc(folder)+'</div>';if(!closed)html+=refTree(children,kind,q,prefix?prefix+'/'+folder:folder,depth+1)}return html}
function renderBranches(){const q=$('branchSearch').value.toLowerCase(),r=state.repository;if(!r)return;const matching=r.refs.filter(x=>!q||x.name.toLowerCase().includes(q)),current=r.refs.find(x=>x.current),favorites=matching.filter(x=>state.favorites.has(x.name)&&!x.current);let html=current?'<div class="group">Current Branch</div>'+refItem(current):'';if(favorites.length)html+='<div class="group">Favorites</div>'+favorites.map(x=>refItem(x)).join('');for(const kind of ['local','remote','tag']){const refs=matching.filter(x=>x.kind===kind&&!x.current);if(refs.length)html+='<div class="group">'+kind+'</div>'+refTree(refs,kind,q)}html+='<div class="group">Stashes</div>'+r.stashes.filter(x=>!q||(x.ref+' '+x.message).toLowerCase().includes(q)).map(x=>'<div class="item" data-kind="stash" data-ref="'+esc(x.ref)+'" data-hash="'+x.hash+'">'+esc(x.ref+' '+x.message)+'</div>').join('');$('branches').innerHTML=html}
function graphX(column){return PAD+column*COL+COL/2}function graphY(index,scrollTop){return index*ROW+ROW/2-scrollTop}function graphPath(x1,y1,x2,y2,stub=false){if(x1===x2||stub)return'M '+x1+' '+y1+' L '+x2+' '+y2;const bend=y2-Math.sign(y2-y1||1)*ROW*.65;return'M '+x1+' '+y1+' C '+x1+' '+bend+', '+x2+' '+(y1+ROW*.35)+', '+x2+' '+y2}
function renderGraph(start,end){const vp=$('viewport'),svg=$('graphSvg'),visible=[];state.commitIndexes.clear();let maxColumn=0;state.commits.forEach((commit,index)=>{if(!commit)return;state.commitIndexes.set(commit.hash,index);if(commit.lane)maxColumn=Math.max(maxColumn,commit.lane.column,...commit.lane.lines.map(line=>line.toColumn))});for(let i=start;i<end;i++){const c=state.commits[i];if(c?.lane)visible.push([i,c])}const width=(maxColumn+1)*COL+PAD*2;document.documentElement.style.setProperty('--graph-width',Math.max(56,width)+'px');svg.setAttribute('width',String(width));svg.setAttribute('height',String(vp.clientHeight));svg.setAttribute('viewBox','0 0 '+width+' '+vp.clientHeight);let paths='',nodes='';for(const [index,c] of visible){const lane=c.lane,x=graphX(lane.column),y=graphY(index,vp.scrollTop),color=LANE_COLORS[lane.color%LANE_COLORS.length];for(const line of lane.lines){const targetIndex=state.commitIndexes.get(line.toCommit),stub=targetIndex===undefined,toY=stub?y+ROW*.75:graphY(targetIndex,vp.scrollTop),toX=graphX(line.toColumn);paths+='<path d="'+graphPath(x,y,toX,toY,stub)+'" fill="none" stroke="'+color+'" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" '+(stub?'stroke-dasharray="4 2" opacity=".55"':'')+'/>'}const merge=c.parents.length>1;nodes+=merge?'<circle cx="'+x+'" cy="'+y+'" r="4.6" fill="'+color+'"/><circle cx="'+x+'" cy="'+y+'" r="2.4" fill="var(--vscode-panel-background)"/><circle cx="'+x+'" cy="'+y+'" r="1.5" fill="'+color+'"/>':'<circle cx="'+x+'" cy="'+y+'" r="3.6" fill="'+color+'"/>';if(c.refs.some(ref=>ref.includes('HEAD')))nodes+='<circle cx="'+x+'" cy="'+y+'" r="6.4" fill="none" stroke="'+color+'" stroke-width="1" opacity=".3"/>'}svg.innerHTML=paths+nodes}
function renderRows(){const vp=$('viewport'),start=Math.max(0,Math.floor(vp.scrollTop/ROW)-overscan),end=Math.min(state.total,Math.ceil((vp.scrollTop+vp.clientHeight)/ROW)+overscan);$('spacer').style.height=(state.total*ROW)+'px';$('spacer').innerHTML=Array.from({length:Math.max(0,end-start)},(_,i)=>{const n=start+i,c=state.commits[n];if(!c)return '<div class="row" style="top:'+(n*ROW)+'px"><span></span><span>Loading…</span></div>';const refs=c.refs.length?'<span class="refs">'+esc(c.refs[0].replace('refs/heads/','').replace('refs/remotes/','').replace('tag: refs/tags/',''))+'</span>':'';return '<div class="row '+(n===state.selected?'selected ':'')+(state.selectedHashes.has(c.hash)?'multi':'')+'" data-index="'+n+'" style="top:'+(n*ROW)+'px"><span></span><span>'+esc(c.subject)+refs+'</span><span>'+esc(c.author)+'</span><span>'+date(c.authorTimestamp)+'</span></div>'}).join('');renderGraph(start,end);for(let page=Math.floor(start/PAGE)*PAGE;page<end;page+=PAGE)if(!state.commits[page]&&!state.loading.has(page)){state.loading.add(page);send('loadLog',{offset:page,generation:state.generation,filter:filter()})}}
function fileRow(f,depth=0,working=false){return '<div class="file" style="padding-left:'+(8+depth*14)+'px" data-path="'+esc(f.path)+'" '+(working?'data-working="true"':'')+'><b>'+esc(f.status)+'</b><span>'+esc(state.fileMode==='flat'?f.path:f.path.split('/').pop())+'</span><span class="stat">+'+f.additions+' -'+f.deletions+'</span></div>'}
function fileTree(files){const root={folders:new Map(),files:[]};for(const file of files){let node=root;const parts=file.path.split('/');for(const folder of parts.slice(0,-1)){if(!node.folders.has(folder))node.folders.set(folder,{folders:new Map(),files:[]});node=node.folders.get(folder)}node.files.push(file)}return root}
function renderFileNode(node,prefix='',depth=0,working=false){let html='';for(const [name,child] of [...node.folders].sort(([a],[b])=>a.localeCompare(b))){const key=prefix?prefix+'/'+name:name,closed=state.fileCollapsed.has(key);state.fileFolders.add(key);html+='<div class="item folder" style="padding-left:'+(8+depth*14)+'px" data-file-folder="'+esc(key)+'">'+(closed?'▸':'▾')+' '+esc(name)+'</div>';if(!closed)html+=renderFileNode(child,key,depth+1,working)}html+=node.files.sort((a,b)=>a.path.localeCompare(b.path)).map(f=>fileRow(f,depth,working)).join('');return html}
function renderFiles(files,working=false){state.visibleFiles=files;state.visibleFilesWorking=working;state.fileFolders.clear();if(state.fileMode==='flat'){$('files').innerHTML=files.map(f=>fileRow(f,0,working)).join('');return}$('files').innerHTML=renderFileNode(fileTree(files),'',0,working)}
function renderDetail(){const d=state.detail;if(!d)return;$('detail').innerHTML='<div class="message">'+esc(d.message)+'</div><div class="meta">'+esc(d.hash)+'<br>'+esc(d.author+' <'+d.authorEmail+'> · '+date(d.authorTimestamp))+'<br>Parents: '+d.parents.map(p=>'<button data-parent="'+p+'">'+esc(p.slice(0,8))+'</button>').join(' ')+'</div>';const parent=$('parentMode');parent.style.display=d.parents.length>1?'inline-block':'none';parent.innerHTML=d.parents.map((p,i)=>'<option value="'+(i+1)+'">Parent '+(i+1)+'</option>').join('')+(d.parents.length>1?'<option value="combined">Combined</option>':'');renderFiles(d.files)}
function filter(){return{text:$('textFilter').value||undefined,author:$('authorFilter').value||undefined,path:$('pathFilter').value||undefined,since:$('sinceFilter').value||undefined,until:$('untilFilter').value||undefined,refs:state.selectedRef?[state.selectedRef]:undefined,regex:$('regex').checked,matchCase:$('case').checked}}
function loadFiltered(){state.generation++;state.commits=[];state.total=0;state.loading.clear();state.loading.add(0);send('loadLog',{offset:0,generation:state.generation,filter:filter()})}let timer;for(const id of ['textFilter','authorFilter','pathFilter','sinceFilter','untilFilter'])$(id).oninput=()=>{clearTimeout(timer);timer=setTimeout(loadFiltered,250)};$('regex').onchange=$('case').onchange=loadFiltered;$('clear').onclick=()=>{for(const id of ['textFilter','authorFilter','pathFilter','sinceFilter','untilFilter'])$(id).value='';state.selectedRef=undefined;$('regex').checked=$('case').checked=false;loadFiltered()};
let scrollFrame;$('viewport').onscroll=()=>{if(scrollFrame)return;scrollFrame=requestAnimationFrame(()=>{scrollFrame=undefined;renderRows()})};$('viewport').onclick=e=>{const row=e.target.closest('.row');if(!row)return;state.selected=Number(row.dataset.index);const hash=state.commits[state.selected].hash;if(e.shiftKey&&state.selectionAnchor>=0){state.selectedHashes.clear();const from=Math.min(state.selectionAnchor,state.selected),to=Math.max(state.selectionAnchor,state.selected);for(let i=from;i<=to;i++)if(state.commits[i])state.selectedHashes.add(state.commits[i].hash)}else if(e.ctrlKey||e.metaKey){state.selectionAnchor=state.selected;state.selectedHashes.has(hash)?state.selectedHashes.delete(hash):state.selectedHashes.add(hash)}else{state.selectionAnchor=state.selected;state.selectedHashes.clear();state.selectedHashes.add(hash)}send('detail',{hash,generation:state.generation});renderRows()};$('viewport').oncontextmenu=e=>{e.preventDefault();const row=e.target.closest('.row');if(row){const index=Number(row.dataset.index),c=state.commits[index];if(!state.selectedHashes.has(c.hash)){state.selected=index;state.selectionAnchor=index;state.selectedHashes=new Set([c.hash]);renderRows()}const hashes=state.commits.map(c=>c?.hash).filter(hash=>hash&&state.selectedHashes.has(hash)).reverse();send('context',{x:e.clientX,y:e.clientY,kind:hashes.length>1?'commits':'commit',hash:c.hash,ref:c.hash,hashes})}};$('viewport').onkeydown=e=>{if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();state.selected=Math.max(0,Math.min(state.commits.length-1,state.selected+(e.key==='ArrowDown'?1:-1)));state.selectionAnchor=state.selected;state.selectedHashes=new Set([state.commits[state.selected].hash]);send('detail',{hash:state.commits[state.selected].hash,generation:state.generation});$('viewport').scrollTop=Math.max(0,state.selected*ROW-$('viewport').clientHeight/2);renderRows()}if(e.key==='Enter'&&state.detail?.files[0])send('diff',{hash:state.detail.hash,path:state.detail.files[0].path})};
$('files').ondblclick=e=>{const f=e.target.closest('.file');if(!f)return;f.dataset.working?send('workingDiff',{path:f.dataset.path}):state.detail&&send('diff',{hash:state.detail.hash,path:f.dataset.path,parent:Number($('parentMode').value)||1})};$('files').oncontextmenu=e=>{e.preventDefault();const f=e.target.closest('.file');if(f)send('context',{x:e.clientX,y:e.clientY,kind:f.dataset.working?'workingFile':'commitFile',hash:state.detail?.hash,path:f.dataset.path,parent:Number($('parentMode').value)||1})};$('branchSearch').oninput=renderBranches;$('branches').onclick=e=>{const item=e.target.closest('.item');if(!item)return;if(item.dataset.ref){state.selectedRef=item.dataset.ref;loadFiltered()}else if(item.dataset.hash)send('detail',{hash:item.dataset.hash})};$('branches').oncontextmenu=e=>{e.preventDefault();const item=e.target.closest('.item');if(item)send('context',{x:e.clientX,y:e.clientY,kind:item.dataset.kind,ref:item.dataset.ref,hash:item.dataset.hash})};$('goto').onkeydown=e=>{if(e.key==='Enter'&&e.target.value)send('detail',{hash:e.target.value})};$('refresh').onclick=()=>send('refresh');for(const b of document.querySelectorAll('[data-action]'))b.onclick=()=>send('mutate',{action:b.dataset.action});for(const b of document.querySelectorAll('[data-conflict]'))b.onclick=()=>send('mutate',{action:b.dataset.conflict,operation:state.repository?.operation});$('repo').onchange=()=>send('selectRepo',{root:$('repo').value});
$('files').addEventListener('click',e=>{const f=e.target.closest('.file[data-conflict]');if(f)send('openConflict',{path:f.dataset.path})});
$('files').addEventListener('click',e=>{const folder=e.target.closest('[data-file-folder]');if(!folder)return;const key=folder.dataset.fileFolder;state.fileCollapsed.has(key)?state.fileCollapsed.delete(key):state.fileCollapsed.add(key);localStorage.setItem('gitLog.fileCollapsed',JSON.stringify([...state.fileCollapsed]));renderFiles(state.visibleFiles,state.visibleFilesWorking)});
$('detail').addEventListener('click',e=>{const parent=e.target.closest('[data-parent]');if(parent)send('detail',{hash:parent.dataset.parent})});
$('viewport').addEventListener('keydown',e=>{if(e.key!=='ArrowLeft'&&e.key!=='ArrowRight')return;const current=state.commits[state.selected];if(!current)return;e.preventDefault();const target=e.key==='ArrowLeft'?current.parents[0]:state.commits.find(c=>c?.parents.includes(current.hash))?.hash;if(!target)return;const index=state.commits.findIndex(c=>c?.hash===target);if(index>=0){state.selected=index;$('viewport').scrollTop=Math.max(0,index*ROW-$('viewport').clientHeight/2);renderRows()}send('detail',{hash:target})},true);
$('branches').addEventListener('click',e=>{const star=e.target.closest('[data-star]');if(star){e.stopPropagation();const ref=star.dataset.star;state.favorites.has(ref)?state.favorites.delete(ref):state.favorites.add(ref);localStorage.setItem('gitLog.favorites',JSON.stringify([...state.favorites]));renderBranches();return}const folder=e.target.closest('[data-folder]');if(folder){e.stopPropagation();const key=folder.dataset.folder;state.collapsed.has(key)?state.collapsed.delete(key):state.collapsed.add(key);localStorage.setItem('gitLog.collapsed',JSON.stringify([...state.collapsed]));renderBranches()}},true);
$('uncommitted').onclick=()=>{renderFiles(state.uncommitted,true);$('detail').innerHTML='<div class="message">Uncommitted changes</div>'};
$('fileMode').textContent=state.fileMode==='tree'?'Tree':'Flat';$('fileMode').onclick=()=>{state.fileMode=state.fileMode==='tree'?'flat':'tree';localStorage.setItem('gitLog.fileMode',state.fileMode);$('fileMode').textContent=state.fileMode==='tree'?'Tree':'Flat';renderFiles(state.visibleFiles,state.visibleFilesWorking)};$('parentMode').onchange=e=>{if(state.detail)send('detail',{hash:state.detail.hash,parent:e.target.value==='combined'?0:Number(e.target.value)})};
$('collapseFiles').onclick=()=>{state.fileCollapsed=new Set(state.fileFolders);localStorage.setItem('gitLog.fileCollapsed',JSON.stringify([...state.fileCollapsed]));renderFiles(state.visibleFiles,state.visibleFilesWorking)};$('expandFiles').onclick=()=>{state.fileCollapsed.clear();localStorage.setItem('gitLog.fileCollapsed','[]');renderFiles(state.visibleFiles,state.visibleFilesWorking)};
$('viewOptions').onclick=()=>{const compact=document.body.classList.toggle('compact');localStorage.setItem('gitLog.compact',String(compact));document.querySelectorAll('.header span:nth-child(3),.row span:nth-child(3)').forEach(x=>x.style.display=compact?'none':'')};
document.addEventListener('contextmenu',e=>{state.contextPoint={x:e.clientX,y:e.clientY}},true);document.addEventListener('click',e=>{if(!e.target.closest('#contextMenu'))$('contextMenu').style.display='none'});window.addEventListener('blur',()=>{$('contextMenu').style.display='none'});document.addEventListener('keydown',e=>{if(e.key==='Escape')$('contextMenu').style.display='none'});
function showInlineContextMenu(message){const menu=$('contextMenu'),context=message.context;state.contextPayload=context;menu.innerHTML=message.actions.map(item=>'<button role="menuitem" data-context-action="'+esc(item.action)+'">'+esc(item.label)+'</button>').join('');if(!message.actions.length)return;menu.style.display='block';menu.style.left='0';menu.style.top='0';const point={x:context.x??state.contextPoint?.x??0,y:context.y??state.contextPoint?.y??0},rect=menu.getBoundingClientRect();menu.style.left=Math.max(4,Math.min(point.x,window.innerWidth-rect.width-4))+'px';menu.style.top=Math.max(4,Math.min(point.y,window.innerHeight-rect.height-4))+'px';menu.querySelector('button')?.focus()}
$('contextMenu').onclick=e=>{const button=e.target.closest('[data-context-action]');if(!button)return;const {type,...context}=state.contextPayload;send('contextAction',{...context,action:button.dataset.contextAction});$('contextMenu').style.display='none'};window.addEventListener('message',e=>{const m=e.data;if(m.type==='contextMenu')showInlineContextMenu(m);if(m.type==='busy'){state.busy=m.busy;document.body.classList.toggle('busy',m.busy);if(m.busy)$('status').textContent='Running '+m.action+'…'}if(m.type==='error'){const toast=$('toast');toast.textContent=m.message;toast.style.display='block';clearTimeout(state.toastTimer);state.toastTimer=setTimeout(()=>toast.style.display='none',8000)}},true);
for(const split of document.querySelectorAll('.split'))split.onmousedown=e=>{const side=split.dataset.side,start=e.clientX,layout=$('layout'),initial=side==='left'?layout.children[0].offsetWidth:layout.children[4].offsetWidth;document.onmousemove=m=>{const value=Math.max(140,initial+(side==='left'?m.clientX-start:start-m.clientX));layout.style.setProperty('--'+side,value+'px');localStorage.setItem('gitLog.'+side,value)};document.onmouseup=()=>document.onmousemove=document.onmouseup=null};for(const side of ['left','right']){const v=localStorage.getItem('gitLog.'+side);if(v)$('layout').style.setProperty('--'+side,v+'px')}
window.onmessage=e=>{const m=e.data;if(m.type==='state'){state={...state,...m,commits:m.log?.commits??[],total:m.log?.total??0};state.commits.length=state.total;$('repo').style.display=m.repositories.length>1?'block':'none';$('repo').innerHTML=m.repositories.map(r=>'<option '+(r===m.repository?.root?'selected':'')+'>'+esc(r)+'</option>').join('');const r=m.repository;$('status').textContent=r?r.head+'  ↑'+r.ahead+' ↓'+r.behind+'  '+r.changedCount+' changed':'';$('uncommitted').style.display=state.uncommitted.length?'grid':'none';$('banner').style.display=r?.operation?'block':'none';$('operation').textContent=r?.operation??'';renderBranches();renderRows();if(r?.operation){$('files').innerHTML=state.uncommitted.filter(f=>f.conflict).map(f=>'<div class="file" data-conflict="true" data-path="'+esc(f.path)+'"><b>!</b><span>'+esc(f.path)+'</span></div>').join('')}}else if(m.type==='log'){state.total=m.log.total;if(state.commits.length!==state.total)state.commits.length=state.total;state.commits.splice(m.log.offset,m.log.commits.length,...m.log.commits);state.loading.delete(m.log.offset);renderRows()}else if(m.type==='detail'){state.detail=m.detail;renderDetail()}else if(m.type==='compareFiles'){renderFiles(m.files);$('detail').innerHTML='<div class="message">'+esc(m.from)+' ↔ '+esc(m.to)+'</div><div class="meta">'+(m.onlyCurrent?m.onlyCurrent.length+' commit(s) only in current<br>'+m.onlySelected.length+' commit(s) only in selected<br>':'')+m.files.length+' changed file(s)</div>'}};send('ready');
</script></body></html>`;
}
