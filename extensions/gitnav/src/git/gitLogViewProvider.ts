import * as path from 'path';
import * as vscode from 'vscode';
import { GitLogFilter, GitRebasePlanItem } from './gitPanelModels';
import { GitRepositoryService } from './gitRepositoryService';
import { revisionUri } from './gitRevisionProvider';
import { GitMutationRunner } from './gitMutationRunner';
import { currentBranchPushPlan } from './gitPush';
import { GitMutationRequest } from './gitPanelModels';
import { CoalescedRefreshRunner, GitReadChannel, GitRequestCoordinator, GitRequestIdentity, InFlightOperationGuard } from './gitPanelCoordinator';
import { classifyGitError } from './gitErrorRecovery';
import { MutationBusyTracker, runMutationLifecycle } from './gitMutationLifecycle';

interface WebviewMessage { type: string; root?: string; hash?: string; hashes?: string[]; path?: string; ref?: string; action?: string; kind?: string; current?: boolean; operation?: string; parent?: number; offset?: number; x?: number; y?: number; requestId?: number; generation?: number; filter?: GitLogFilter; plan?: GitRebasePlanItem[]; }

export class GitLogViewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  static readonly viewId = 'gitnav.gitLog';
  private view?: vscode.WebviewView;
  private root?: string;
  private readonly disposables: vscode.Disposable[] = [];
  private readonly mutations: GitMutationRunner;
  private readonly output = vscode.window.createOutputChannel('Git Log');
  private readonly requests = new GitRequestCoordinator();
  private readonly readCancellations = new Map<GitReadChannel, vscode.CancellationTokenSource>();
  private readonly mutationBusy = new MutationBusyTracker();
  private readonly refreshRunner = new CoalescedRefreshRunner();
  private readonly activeMutations = new InFlightOperationGuard();
  private autoFetchTimer?: NodeJS.Timeout;
  private externalRefreshTimer?: NodeJS.Timeout;
  private gitWatcher?: vscode.FileSystemWatcher;
  private lastInternalMutationAt = 0;

  constructor(private readonly service: GitRepositoryService, private readonly extensionUri: vscode.Uri) {
    this.mutations = new GitMutationRunner(service);
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    this.logDiagnostic('Webview resolved; registering message listener.');
    view.webview.options = { enableScripts: true, localResourceRoots: [this.extensionUri] };
    this.disposables.push(view.webview.onDidReceiveMessage(message => this.handle(message)));
    view.webview.html = renderHtml(view.webview);
    this.logDiagnostic('Webview HTML loaded; waiting for ready message.');
    this.configureAutoFetch();
    this.configureGitWatcher();
  }

  async refresh(): Promise<void> {
    return this.refreshRunner.run(() => this.refreshCore());
  }

  private async refreshCore(): Promise<void> {
    if (!this.view) return;
    const startedAt = Date.now();
    this.logDiagnostic('Refresh started: discovering repositories.');
    const repositories = await this.service.discoverRepositories();
    this.logDiagnostic(`Repository discovery completed (${repositories.length}) in ${Date.now() - startedAt} ms.`);
    if (!this.root || !repositories.includes(this.root)) this.root = repositories[0];
    if (!this.root) {
      this.logDiagnostic('No Git repository found; posting empty state.');
      return this.post({ type: 'state', repositories });
    }
    this.logDiagnostic(`Loading repository: ${this.root}`);
    this.cancelReads();
    this.requests.invalidate(this.root);
    const read = this.beginRead('refresh', this.root);
    try {
      const [repository, log, uncommitted] = await Promise.all([
        this.service.snapshot(this.root, read.source.token), this.service.log(this.root, 0, 200, {}, read.source.token), this.service.workingTreeFiles(this.root, read.source.token)
      ]);
      if (this.requests.isCurrent('refresh', read.identity, this.root)) {
        const protectedBranches = vscode.workspace.getConfiguration('gitnav')
          .get<string[]>('protectedBranches', ['main', 'master', 'develop', 'release/*']);
        this.post({ type: 'state', repositories, repository, log, uncommitted, protectedBranches, generation: read.identity.generation, identity: read.identity });
        this.logDiagnostic(`State posted: ${repository.refs.length} refs, ${log.commits.length}/${log.total} commits, ${uncommitted.length} working tree files (${Date.now() - startedAt} ms).`);
      } else {
        this.logDiagnostic(`Refresh ${read.identity.requestId} completed stale; state was not posted.`);
      }
    } finally {
      this.finishRead('refresh', read.source);
    }
  }

  dispose(): void {
    if (this.autoFetchTimer) clearInterval(this.autoFetchTimer);
    if (this.externalRefreshTimer) clearTimeout(this.externalRefreshTimer);
    this.gitWatcher?.dispose();
    this.output.dispose();
    this.disposables.splice(0).forEach(item => item.dispose());
    this.cancelReads();
  }

  configureAutoFetch(): void {
    if (this.autoFetchTimer) clearInterval(this.autoFetchTimer);
    const config = vscode.workspace.getConfiguration('gitnav');
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
    if (message.type === 'clientError') {
      this.logDiagnostic(`Webview runtime error: ${message.operation ?? 'Unknown client error'}`);
      return;
    }
    if (message.type === 'ready' || message.type === 'refresh') this.logDiagnostic(`Received webview message: ${message.type}.`);
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
      if (message.type === 'copyText' && message.ref !== undefined) return await vscode.env.clipboard.writeText(message.ref);
      if (message.type === 'interactiveRebase' && message.plan) {
        const request = await this.prepareInteractiveRebase(message.plan);
        if (request) await this.runMutation(request, this.root);
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
        const mutationRoot = this.root;
        if (message.action === 'continue') {
          const unresolved = (await this.service.workingTreeFiles(this.root)).filter(file => file.conflict);
          if (unresolved.length) throw new Error(`Resolve these files before continuing: ${unresolved.map(file => file.path).join(', ')}`);
        }
        const request = await this.prepareMutation(message);
        if (request) await this.runMutation(request, mutationRoot);
      }
      if (message.type === 'context') {
        this.post({ type: 'contextMenu', actions: contextActions(message.kind, message.current === true), context: { ...message, root: this.root } });
      }
      if (message.type === 'contextAction' && message.action) await this.executeContextAction(message);
    } catch (error) {
      if (error instanceof vscode.CancellationError) {
        this.logDiagnostic(`Request cancelled: ${message.type}.`);
        return;
      }
      const text = error instanceof Error ? error.message : String(error);
      this.logDiagnostic(`Request failed (${message.type}): ${error instanceof Error ? error.stack ?? text : text}`);
      const recovery = classifyGitError(text);
      this.post(recovery ? { type: 'recovery', recovery, operation: 'CHERRY-PICKING' } : { type: 'error', message: text });
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

  private async runMutation(request: GitMutationRequest, expectedRoot?: string): Promise<void> {
    if (!this.root) return;
    if (expectedRoot && this.root !== expectedRoot) throw new Error('The active repository changed while this action was open. Review the action and try again.');
    const root = this.root;
    const mutationKey = JSON.stringify([root, request.action, request.ref, request.hash, request.hashes, request.path, request.options]);
    if (!this.activeMutations.tryEnter(mutationKey)) {
      this.logDiagnostic(`Ignored duplicate mutation: ${request.action}.`);
      return;
    }
    this.cancelReads();
    this.requests.invalidate(root);
    this.mutationBusy.begin(root);
    this.post({ type: 'busy', busy: true, action: request.action, repositoryId: root });
    const startedAt = Date.now();
    let applied = false;
    let succeeded = false;
    try {
      await runMutationLifecycle(
        async () => { applied = await this.mutations.run(root, request); },
        async () => { if (this.root === root && this.mutationBusy.pending(root) === 1) await this.refresh(); },
        error => { if (!(error instanceof vscode.CancellationError)) console.error(error); }
      );
      succeeded = true;
    } finally {
      this.activeMutations.leave(mutationKey);
      this.lastInternalMutationAt = Date.now();
      if (this.mutationBusy.end(root) === 0) this.post({
        type: 'busy', busy: false, action: request.action, repositoryId: root,
        durationMs: Date.now() - startedAt, succeeded, applied
      });
    }
  }

  private async executeContextAction(message: WebviewMessage): Promise<void> {
    const action = message.action!;
    const root = this.contextRoot(message);
    if (action === 'copy' || action === 'copyRelative') {
      await vscode.env.clipboard.writeText(message.path ?? message.ref ?? message.hash ?? '');
      return;
    }
    if (action === 'showInLog' && message.ref) {
      this.post({ type: 'selectRef', ref: message.ref });
      return;
    }
    if (action === 'openWorktree' && message.path) {
      await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(message.path), true);
      return;
    }
    if (action === 'worktreeTerminal' && message.path) {
      vscode.window.createTerminal({ name: `Worktree: ${path.basename(message.path)}`, cwd: message.path }).show();
      return;
    }
    if (action === 'interactiveRebase' && message.hashes?.length) {
      const details = await Promise.all(message.hashes.map(hash => this.service.commitDetail(root, hash)));
      const selected = details.map(commit => ({ action: 'pick' as const, hash: commit.hash, subject: commit.subject }));
      this.post({ type: 'rebasePlan', plan: selected });
      return;
    }
    if (action === 'diff' && message.hash && message.path) return await this.openDiff(message.hash, message.path, message.parent, root);
    if (action === 'openRevision' && message.hash && message.path) {
      await vscode.window.showTextDocument(revisionUri(root, message.hash, message.path), { preview: true });
      return;
    }
    if (action === 'openFile' && message.path) {
      await vscode.window.showTextDocument(vscode.Uri.file(path.join(root, message.path)));
      return;
    }
    if (action === 'workingFileDiff' && message.path) {
      await vscode.commands.executeCommand('git.openChange', vscode.Uri.file(path.join(root, message.path)));
      return;
    }
    if (action === 'fileHistory' && message.path) {
      await vscode.window.showTextDocument(vscode.Uri.file(path.join(root, message.path)));
      await vscode.commands.executeCommand('timeline.focus');
      return;
    }
    if (action === 'compare' && message.hashes?.length === 2) {
      const files = await this.service.filesBetween(root, message.hashes[0], message.hashes[1]);
      if (this.root !== root) return;
      this.post({ type: 'compareFiles', files, from: message.hashes[0], to: message.hashes[1] });
      return;
    }
    if (action === 'compareCurrent' && message.ref) {
      const [onlyCurrent, onlySelected, files] = await Promise.all([
        this.service.commitsInRange(root, `${message.ref}..HEAD`),
        this.service.commitsInRange(root, `HEAD..${message.ref}`),
        this.service.filesBetween(root, 'HEAD', message.ref)
      ]);
      if (this.root !== root) return;
      this.post({ type: 'compareFiles', files, from: 'HEAD', to: message.ref, onlyCurrent, onlySelected });
      return;
    }
    if (action === 'workingDiff' && message.ref) {
      const files = await this.service.filesAgainstWorkingTree(root, message.ref);
      if (this.root === root) this.post({ type: 'compareFiles', files, from: message.ref, to: 'working tree' });
      return;
    }
    if (action === 'stashDiff' && message.ref) {
      const files = await this.service.stashFiles(root, message.ref);
      if (this.root === root) this.post({ type: 'compareFiles', files, from: `${message.ref}^`, to: message.ref });
      return;
    }
    if (action === 'openWeb' && message.hash) {
      const url = await this.service.remoteWebUrl(root, message.hash);
      if (!url) throw new Error('The origin remote is not a supported GitHub or GitLab URL.');
      await vscode.env.openExternal(vscode.Uri.parse(url));
      return;
    }
    if (action === 'showRepository' && message.hash) {
      const file = await vscode.window.showQuickPick(await this.service.repositoryFiles(root, message.hash), {
        title: `Repository at ${message.hash.slice(0, 8)}`, placeHolder: 'Select a file to open read-only'
      });
      if (file && this.root === root) await vscode.window.showTextDocument(revisionUri(root, message.hash, file), { preview: true });
      return;
    }
    if (action === 'copyShort' && message.hash) return await vscode.env.clipboard.writeText(message.hash.slice(0, 8));
    if (action === 'copyMessage' && message.hash) {
      const detail = await this.service.commitDetail(root, message.hash);
      return await vscode.env.clipboard.writeText(detail.message);
    }
    const request = await this.prepareMutation({ ...message, type: 'mutate', action });
    if (request) await this.runMutation(request, message.root);
  }

  private contextRoot(message: WebviewMessage): string {
    if (!this.root || !message.root || message.root !== this.root) {
      throw new Error('This context menu is stale because the active repository changed. Open the menu again.');
    }
    return this.root;
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
    if (action === 'worktreeAdd') {
      const folders = await vscode.window.showOpenDialog({ title: `Create Worktree for ${message.ref}`, canSelectFolders: true, canSelectFiles: false, canSelectMany: false });
      const target = folders?.[0]?.fsPath;
      if (!target) return undefined;
      const snapshot = await this.service.snapshot(this.root!);
      const branchInUse = snapshot.worktrees.some(item => item.branch === message.ref);
      let newBranch: string | undefined;
      if (branchInUse) {
        newBranch = await vscode.window.showInputBox({ title: `${message.ref} is already checked out`, prompt: 'New branch name for this worktree', validateInput: validateRefName });
        if (!newBranch) return undefined;
      }
      return { action, ref: message.ref, path: target, options: newBranch ? { newBranch } : undefined };
    }
    if (action === 'worktreeRemove' && message.path) {
      const changed = await this.service.worktreeChangedCount(message.path);
      if (!changed) return { action, path: message.path };
      return { action, path: message.path, options: { force: true, changedCount: String(changed) } };
    }
    if (action === 'updateBranchFromOrigin') {
      if (!message.ref) return undefined;
      const snapshot = await this.service.snapshot(this.root!);
      const branch = snapshot.refs.find(item => item.kind === 'local' && item.name === message.ref);
      if (!branch) throw new Error(`Local branch ${message.ref} was not found.`);
      if (branch.current) throw new Error('Use Update for the current branch.');
      const remoteBranch = `origin/${branch.name}`;
      const remoteExists = snapshot.refs.some(item => item.kind === 'remote' && item.name === remoteBranch);
      if (!remoteExists) throw new Error(`${remoteBranch} does not exist.`);
      const choice = await vscode.window.showWarningMessage(
        `Update local branch ${branch.name} from ${remoteBranch} without checkout? This only succeeds when Git can fast-forward the local branch.`,
        { modal: true }, 'Update Branch');
      return choice === 'Update Branch' ? { action, ref: branch.name } : undefined;
    }
    if (action === 'renameBranch') {
      const name = await vscode.window.showInputBox({ title: `Rename ${message.ref}`, prompt: 'New branch name', value: message.ref, validateInput: validateRefName });
      return name ? { action, ref: message.ref, options: { name } } : undefined;
    }
    if (action === 'checkoutUpdate') {
      const localBranch = message.kind === 'remote' ? (message.ref ?? '').split('/').slice(1).join('/') : message.ref;
      const strategy = await vscode.window.showQuickPick([
        { label: 'Merge', description: `from origin/${localBranch}`, rebase: false },
        { label: 'Rebase', description: `onto origin/${localBranch}`, rebase: true }
      ], { title: `Checkout and Update ${message.ref}` });
      return strategy ? { action, ref: message.ref, options: { rebase: strategy.rebase, remote: message.kind === 'remote' } } : undefined;
    }
    if (action === 'update') {
      const snapshot = await this.service.snapshot(this.root!);
      const destination = `origin/${snapshot.head}`;
      const strategy = await vscode.window.showQuickPick([
        { label: 'Merge', description: `Merge ${destination}`, value: 'merge' },
        { label: 'Rebase', description: `Rebase onto ${destination}`, value: 'rebase' },
        { label: 'Reset to Remote Branch', description: `Hard reset to ${destination}; discards local commits and changes`, value: 'reset' }
      ], { title: `Update ${snapshot.head} from Same-Named Origin Branch` });
      if (!strategy) return undefined;
      return { action, options: { strategy: strategy.value, destination } };
    }
    if (action === 'push') {
      const snapshot = await this.service.snapshot(this.root!);
      const pushPlan = currentBranchPushPlan(snapshot);
      const outgoing = pushPlan.remoteBranchExists
        ? await this.service.commitsInRange(this.root!, `${pushPlan.destination}..HEAD`, 50)
        : [];
      const destinationDescription = pushPlan.remoteBranchExists
        ? pushPlan.destination
        : `${pushPlan.destination} · new remote branch`;
      const forceLease = await vscode.window.showQuickPick([
        { label: 'Push', value: false, description: `${destinationDescription} · ${outgoing.length} outgoing commit(s)`, detail: outgoing.slice(0, 5).map(commit => `${commit.shortHash} ${commit.subject}`).join('\n') },
        { label: 'Force with Lease', value: true, description: `Safely rewrite ${pushPlan.destination} only if it has not changed` }
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
      const mode = await vscode.window.showQuickPick([
        { label: 'Delete', force: false, description: 'Only if fully merged' },
        { label: 'Force Delete', force: true, description: 'Delete even if not merged' }
      ], { title: `Delete Local Branch ${message.ref}` });
      return mode ? { action, ref: message.ref, options: { force: mode.force } } : undefined;
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

  private async prepareInteractiveRebase(plan: GitRebasePlanItem[]): Promise<GitMutationRequest | undefined> {
    if (!this.root || !plan.length) return undefined;
    const details = await Promise.all(plan.map(item => this.service.commitDetail(this.root!, item.hash)));
    if (details.some(item => item.parents.length > 1)) throw new Error('Interactive rebase of merge commits is not supported yet.');
    for (let index = 1; index < plan.length; index++) {
      const detail = details.find(item => item.hash === plan[index].hash)!;
      if (detail.parents[0] !== plan[index - 1].hash) throw new Error('Interactive rebase requires a contiguous first-parent commit range.');
    }
    const head = (await this.service.git(this.root, ['rev-parse', 'HEAD'])).stdout.trim();
    if (plan[plan.length - 1].hash !== head) throw new Error('Interactive rebase selection must include the current HEAD commit to avoid rewriting unselected commits.');
    const oldest = plan[0];
    const oldestDetail = details.find(item => item.hash === oldest.hash)!;
    if (!oldestDetail.parents[0]) throw new Error('The root commit cannot be interactively rebased.');
    const published = await this.service.publishedCommits(this.root, plan.map(item => item.hash));
    const snapshot = await this.service.snapshot(this.root);
    if (snapshot.changedCount) throw new Error('Commit or stash working tree changes before interactive rebase.');
    const publishedNote = published.length
      ? ` ${published.length} selected commit(s) exist upstream; completing this change may require a force-with-lease push.`
      : '';
    const backup = await vscode.window.showWarningMessage(
      `Rewrite ${plan.length} commit(s) on ${snapshot.head}?${publishedNote} GitNav will not force-push automatically.`,
      { modal: true }, 'Rebase', 'Create Backup & Rebase');
    if (!backup) return undefined;
    if (backup === 'Create Backup & Rebase') {
      const name = `backup/${snapshot.head}-${new Date().toISOString().replace(/[:.]/g, '-')}`;
      await this.service.git(this.root, ['branch', name, 'HEAD']);
    }
    return { action: 'interactiveRebase', options: { base: oldestDetail.parents[0], plan: JSON.stringify(plan), publishedOverride: published.length > 0 } };
  }

  private async openDiff(hash: string, filePath: string, parent = 1, expectedRoot = this.root): Promise<void> {
    if (!expectedRoot) return;
    const detail = await this.service.commitDetail(expectedRoot, hash, parent);
    if (this.root !== expectedRoot) return;
    const leftRef = detail.parents[parent - 1];
    const left = leftRef ? revisionUri(expectedRoot, leftRef, filePath) : vscode.Uri.parse('untitled:empty');
    const right = revisionUri(expectedRoot, hash, filePath);
    await vscode.commands.executeCommand('vscode.diff', left, right, `${filePath} (${hash.slice(0, 8)})`);
  }

  private async openConflict(filePath: string): Promise<void> {
    const uri = vscode.Uri.file(path.join(this.root!, filePath));
    try { await vscode.commands.executeCommand('git.openMergeEditor', uri); }
    catch { await vscode.window.showTextDocument(uri); }
  }

  private post(message: unknown): void { this.view?.webview.postMessage(message); }

  private logDiagnostic(message: string): void {
    this.output.appendLine(`[${new Date().toISOString()}] ${message}`);
  }
}

function validateRefName(value: string): string | undefined {
  return !value.trim() || /[~^:?*\[\\\s]|\.\.|\/\//.test(value) ? 'Enter a valid Git ref name.' : undefined;
}

function contextActions(kind?: string, current = false): Array<{ label: string; action: string }> {
  if (kind === 'local') return [
    ...(current ? [
      { label: 'Update Current Branch', action: 'update' }, { label: 'Push', action: 'push' }, { label: 'New Branch from Selected...', action: 'createBranch' },
      { label: 'Rename...', action: 'renameBranch' }, { label: 'Show Diff with Working Tree', action: 'workingDiff' }, { label: 'Create Worktree...', action: 'worktreeAdd' },
      { label: 'Copy Branch Name', action: 'copy' }
    ] : [
    { label: 'Checkout', action: 'checkout' }, { label: 'Checkout and Update', action: 'checkoutUpdate' }, { label: 'Update from Origin', action: 'updateBranchFromOrigin' }, { label: 'New Branch from Selected...', action: 'createBranch' }, { label: 'Rename...', action: 'renameBranch' },
    { label: 'Compare with Current', action: 'compareCurrent' }, { label: 'Show Diff with Working Tree', action: 'workingDiff' },
    { label: 'Merge into Current', action: 'merge' }, { label: 'Rebase Current onto Selected', action: 'rebase' },
    { label: 'Checkout and Rebase onto Current', action: 'checkoutRebase' }, { label: 'Create Worktree...', action: 'worktreeAdd' }, { label: 'Push', action: 'pushBranch' }, { label: 'Delete Branch', action: 'deleteBranch' }, { label: 'Copy Branch Name', action: 'copy' }
    ])
  ];
  if (kind === 'remote') return [
    { label: 'Checkout Tracking Branch', action: 'checkoutRemote' }, { label: 'Checkout and Update', action: 'checkoutUpdate' }, { label: 'New Branch from Selected...', action: 'createBranch' },
    { label: 'Compare with Current', action: 'compareCurrent' }, { label: 'Show Diff with Working Tree', action: 'workingDiff' }, { label: 'Merge into Current', action: 'merge' },
    { label: 'Rebase Current onto Selected', action: 'rebase' }, { label: 'Pull into Current', action: 'pullInto' }, { label: 'Delete on Remote', action: 'deleteRemote' }, { label: 'Copy Branch Name', action: 'copy' }
  ];
  if (kind === 'tag') return [{ label: 'Show in Log', action: 'showInLog' }, { label: 'Checkout Revision', action: 'checkout' }, { label: 'New Branch from Tag...', action: 'createBranch' }, { label: 'Delete Tag', action: 'deleteTag' }, { label: 'Copy Tag Name', action: 'copy' }];
  if (kind === 'stash') return [{ label: 'Apply', action: 'stashApply' }, { label: 'Pop', action: 'stashPop' }, { label: 'Drop', action: 'stashDrop' }, { label: 'Show Diff', action: 'stashDiff' }, { label: 'Create Branch from Stash', action: 'stashBranch' }];
  if (kind === 'commit') return [
    { label: 'Checkout Revision', action: 'checkout' }, { label: 'New Branch here...', action: 'createBranch' }, { label: 'New Tag here...', action: 'tag' },
    { label: 'Cherry-Pick', action: 'cherryPick' }, { label: 'Revert Commit', action: 'revert' }, { label: 'Undo Commit', action: 'undoCommit' }, { label: 'Drop Commit', action: 'dropCommit' }, { label: 'Reset Current Branch to Here...', action: 'reset' },
    { label: 'Compare with Working Tree', action: 'workingDiff' }, { label: 'Show Repository at Revision', action: 'showRepository' }, { label: 'Open on GitHub/GitLab', action: 'openWeb' },
    { label: 'Copy Revision Number', action: 'copy' }, { label: 'Copy Short Hash', action: 'copyShort' }, { label: 'Copy Message', action: 'copyMessage' }
  ];
  if (kind === 'commits') return [{ label: 'Interactive Rebase...', action: 'interactiveRebase' }, { label: 'Compare Versions', action: 'compare' }, { label: 'Cherry-Pick in Selected Order', action: 'cherryPick' }, { label: 'Revert in Selected Order', action: 'revert' }];
  if (kind === 'commitFile') return [
    { label: 'Show Diff', action: 'diff' }, { label: 'Show File History', action: 'fileHistory' }, { label: 'Open Version at Revision', action: 'openRevision' },
    { label: 'Get File from Revision', action: 'getFile' }, { label: 'Revert Selected Changes', action: 'revertFile' }, { label: 'Open in Editor', action: 'openFile' }, { label: 'Copy Path', action: 'copy' }, { label: 'Copy Relative Path', action: 'copyRelative' }
  ];
  if (kind === 'workingFile') return [{ label: 'Show Diff', action: 'workingFileDiff' }, { label: 'Rollback', action: 'rollbackFile' }, { label: 'Open in Editor', action: 'openFile' }];
  if (kind === 'worktree') return [{ label: 'Open in New Window', action: 'openWorktree' }, { label: 'Open Terminal', action: 'worktreeTerminal' }, { label: 'Remove Worktree', action: 'worktreeRemove' }, { label: 'Prune Worktrees', action: 'worktreePrune' }];
  if (kind === 'worktreeCurrent') return [{ label: 'Open Terminal', action: 'worktreeTerminal' }, { label: 'Prune Worktrees', action: 'worktreePrune' }];
  return [];
}

function renderHtml(webview: vscode.Webview): string {
  const nonce = Math.random().toString(36).slice(2);
  return `<!doctype html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'">
<style>
*{box-sizing:border-box}body{margin:0;color:var(--vscode-foreground);background:var(--vscode-panel-background);font:var(--vscode-font-size) var(--vscode-font-family);overflow:hidden;user-select:none}input,textarea,.detail .message,.detail .meta,.diff-preview{user-select:text}button,input,select{font:inherit;color:inherit;background:var(--vscode-input-background);border:1px solid var(--vscode-input-border);height:26px}button{cursor:pointer}.toolbar{min-height:34px;display:flex;gap:4px;align-items:center;padding:4px;border-bottom:1px solid var(--vscode-panel-border);overflow-x:auto}.toolbar .grow{flex:1}.layout{height:calc(100vh - 34px);display:grid;grid-template-columns:var(--left,220px) 4px minmax(320px,1fr) 4px var(--right,330px)}.split{background:var(--vscode-panel-border);cursor:col-resize}.pane{min-width:0;overflow:hidden}.branches,.right{display:flex;flex-direction:column}.heading{min-height:30px;padding:4px 9px;font-weight:600;border-bottom:1px solid var(--vscode-panel-border)}#branchSearch{margin:5px;width:calc(100% - 10px)}#branches,#files{overflow:auto;flex:1;padding:3px 0}.group{padding:7px 8px 3px;color:var(--vscode-descriptionForeground);font-size:11px;text-transform:uppercase}.item{height:24px;padding:4px 8px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:default}.item:hover,.row:hover{background:var(--vscode-list-hoverBackground)}.item.active{font-weight:600;color:var(--vscode-gitDecoration-addedResourceForeground)}.badge{float:right;color:var(--vscode-descriptionForeground)}.center{display:flex;flex-direction:column}.filters{min-height:64px;padding:4px;display:grid;grid-template-columns:minmax(110px,1.4fr) minmax(90px,1fr) minmax(110px,1.2fr) 118px 118px minmax(110px,1fr);grid-template-rows:26px 26px;gap:4px;border-bottom:1px solid var(--vscode-panel-border)}.filters>input{min-width:0}.filters label{display:flex;align-items:center;gap:4px;height:26px;white-space:nowrap}.filters label input{width:16px;height:16px}.filters label:first-of-type{grid-column:1}.filters label:nth-of-type(2){grid-column:2}.filters #clear{grid-column:6;grid-row:2;justify-self:end}.header,.row{display:grid;grid-template-columns:minmax(70px,auto) minmax(180px,1fr) minmax(90px,130px) minmax(100px,145px);align-items:center}.header{height:25px;color:var(--vscode-descriptionForeground);border-bottom:1px solid var(--vscode-panel-border)}.header>*{padding:0 7px}.viewport{position:relative;overflow:auto;flex:1}.spacer{position:relative}.row{position:absolute;left:0;right:0;height:28px;border-bottom:1px solid color-mix(in srgb,var(--vscode-panel-border) 45%,transparent)}.row>*{padding:0 7px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.row.selected{background:var(--vscode-list-activeSelectionBackground);color:var(--vscode-list-activeSelectionForeground)}.graph{font-family:monospace;color:var(--vscode-gitDecoration-modifiedResourceForeground);overflow:visible}.refs{color:var(--vscode-badge-foreground);background:var(--vscode-badge-background);padding:1px 4px;margin-left:6px}.right{border-left:0}.detail{height:44%;min-height:90px;border-top:1px solid var(--vscode-panel-border);overflow:auto;padding:9px}.file{display:grid;grid-template-columns:18px minmax(0,1fr) auto;gap:5px;padding:5px 8px;cursor:default}.file span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.file .stat{color:var(--vscode-descriptionForeground)}.message{font-weight:600;white-space:pre-wrap}.meta{margin-top:7px;color:var(--vscode-descriptionForeground);word-break:break-all}.empty{padding:14px;color:var(--vscode-descriptionForeground)}.banner{display:none;padding:6px 9px;background:var(--vscode-inputValidation-warningBackground);border-bottom:1px solid var(--vscode-inputValidation-warningBorder)}.context-menu{position:fixed;z-index:1000;display:none;min-width:220px;max-width:360px;padding:4px;background:var(--vscode-menu-background);color:var(--vscode-menu-foreground);border:1px solid var(--vscode-menu-border);box-shadow:0 4px 14px rgba(0,0,0,.35)}.context-menu button{display:block;width:100%;height:26px;padding:3px 8px;text-align:left;border:0;background:transparent;color:inherit}.context-menu button:hover,.context-menu button:focus{background:var(--vscode-menu-selectionBackground);color:var(--vscode-menu-selectionForeground);outline:none}@media(max-width:900px){.header,.row{grid-template-columns:minmax(64px,auto) minmax(160px,1fr) minmax(90px,120px)}.header>:nth-child(4),.row>:nth-child(4){display:none}.filters{grid-template-columns:repeat(3,minmax(100px,1fr));grid-template-rows:repeat(3,26px);min-height:94px}.filters #clear{grid-column:3;grid-row:3}}@media(max-width:700px){.header,.row{grid-template-columns:minmax(60px,auto) minmax(150px,1fr)}.header>:nth-child(3),.row>:nth-child(3){display:none}.layout{grid-template-columns:var(--left,180px) 4px minmax(260px,1fr) 4px var(--right,260px)}}
.header,.row{grid-template-columns:var(--graph-width,70px) minmax(180px,1fr) minmax(90px,130px) minmax(100px,145px)}.graph-clip{position:absolute;inset:0 auto 0 0;z-index:3;width:var(--graph-width,70px);overflow:hidden;pointer-events:none}.graph-overlay{position:absolute;inset:0 auto auto 0;overflow:visible}.toast{display:none;position:fixed;z-index:900;right:12px;bottom:12px;max-width:min(520px,calc(100vw - 24px));padding:8px 10px;background:var(--vscode-inputValidation-errorBackground);border:1px solid var(--vscode-inputValidation-errorBorder);white-space:pre-wrap}.busy .toolbar [data-action],.busy #repo,.busy .context-menu{pointer-events:none;opacity:.5}.row.loading span:nth-child(2){width:45%;height:8px;background:var(--vscode-editorWidget-border);opacity:.45}.row.multi:not(.selected){background:var(--vscode-list-inactiveSelectionBackground)}
.toolbar{min-height:38px;padding:5px 8px;gap:2px;background:var(--vscode-sideBar-background)}.toolbar button{border-color:transparent;background:transparent;padding:0 8px}.toolbar button:hover{background:var(--vscode-toolbar-hoverBackground);border-color:var(--vscode-contrastBorder,transparent)}.toolbar button:focus-visible,.item:focus-visible,.row:focus-visible{outline:1px solid var(--vscode-focusBorder);outline-offset:-1px}.toolbar [data-action="update"],.toolbar [data-action="createBranch"]{margin-left:5px;border-left-color:var(--vscode-panel-border)}#status{margin-left:8px;color:var(--vscode-descriptionForeground);white-space:nowrap}.layout{height:calc(100vh - 38px);background:var(--vscode-editor-background)}.pane{background:var(--vscode-sideBar-background)}.center{background:var(--vscode-editor-background)}.split{background:transparent;border-left:1px solid var(--vscode-panel-border)}.split:hover{background:var(--vscode-sash-hoverBorder)}.heading{display:flex;align-items:center;gap:4px;height:32px;padding:0 8px;color:var(--vscode-sideBarSectionHeader-foreground);background:var(--vscode-sideBarSectionHeader-background);font-size:11px;letter-spacing:0;font-weight:600}.heading .heading-title{margin-right:auto}.heading button{width:25px;padding:0;border-color:transparent;background:transparent}.heading button:hover{background:var(--vscode-toolbar-hoverBackground)}#branchSearch{height:28px;margin:7px;width:calc(100% - 14px);padding:0 8px}.group{padding:10px 10px 4px;font-size:10px;font-weight:600;letter-spacing:0;color:var(--vscode-sideBarSectionHeader-foreground)}.item{height:26px;padding-top:5px;padding-bottom:5px;border-left:2px solid transparent}.item:hover{background:var(--vscode-list-hoverBackground)}.item.active{color:var(--vscode-foreground);background:color-mix(in srgb,var(--vscode-list-activeSelectionBackground) 45%,transparent);border-left-color:var(--vscode-focusBorder)}.ref-icon{display:inline-block;width:16px;text-align:center;color:var(--vscode-descriptionForeground)}.item[data-kind="local"] .ref-icon{color:var(--vscode-gitDecoration-modifiedResourceForeground)}.item[data-kind="remote"] .ref-icon{color:var(--vscode-charts-blue)}.item[data-kind="tag"] .ref-icon{color:var(--vscode-charts-yellow)}.item[data-kind="stash"] .ref-icon{color:var(--vscode-charts-purple)}.badge{display:inline-flex;gap:3px;float:right;padding:0 4px;color:var(--vscode-badge-foreground);background:var(--vscode-badge-background);font-size:10px}.filters{padding:6px 7px;gap:5px;background:var(--vscode-editorGroupHeader-tabsBackground)}.filters input{padding:0 7px}.header{height:27px;background:var(--vscode-editorGroupHeader-tabsBackground);font-size:11px}.row{height:28px;border-bottom-color:color-mix(in srgb,var(--vscode-panel-border) 28%,transparent)}.row:hover{background:var(--vscode-list-hoverBackground)}.row.selected{background:var(--vscode-list-activeSelectionBackground);color:var(--vscode-list-activeSelectionForeground)}.refs{display:inline-flex;align-items:center;max-width:190px;height:18px;border-radius:2px;padding:0 5px;font-size:11px;font-weight:500}.ref-head{color:var(--vscode-badge-foreground);background:var(--vscode-badge-background)}.ref-local{color:var(--vscode-gitDecoration-modifiedResourceForeground);background:color-mix(in srgb,var(--vscode-gitDecoration-modifiedResourceForeground) 15%,transparent)}.ref-remote{color:var(--vscode-charts-blue);background:color-mix(in srgb,var(--vscode-charts-blue) 15%,transparent)}.ref-tag{color:var(--vscode-charts-yellow);background:color-mix(in srgb,var(--vscode-charts-yellow) 14%,transparent)}#files{padding:0}.file{grid-template-columns:24px minmax(70px,auto) minmax(0,1fr) auto;align-items:center;min-height:28px;padding-top:4px;padding-bottom:4px;border-left:2px solid transparent}.file:hover{background:var(--vscode-list-hoverBackground);border-left-color:var(--file-color)}.file-status{display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;color:var(--file-color);font-size:11px;font-weight:700}.file-name{color:var(--vscode-foreground);font-weight:500}.file-path{color:var(--vscode-descriptionForeground);font-size:11px}.file-stat{display:flex;gap:5px;font-variant-numeric:tabular-nums}.file-add{color:var(--vscode-gitDecoration-addedResourceForeground)}.file-del{color:var(--vscode-gitDecoration-deletedResourceForeground)}.status-a,.status-u{--file-color:var(--vscode-gitDecoration-addedResourceForeground)}.status-m{--file-color:var(--vscode-gitDecoration-modifiedResourceForeground)}.status-d{--file-color:var(--vscode-gitDecoration-deletedResourceForeground)}.status-r,.status-c{--file-color:var(--vscode-gitDecoration-renamedResourceForeground,var(--vscode-charts-blue))}.status-conflict{--file-color:var(--vscode-gitDecoration-conflictingResourceForeground,var(--vscode-errorForeground))}.file-folder{font-weight:500;color:var(--vscode-foreground)}.right-split{height:5px;flex:0 0 5px;cursor:row-resize;border-top:1px solid var(--vscode-panel-border)}.right-split:hover{background:var(--vscode-sash-hoverBorder)}.detail{height:var(--detail-height,42%);flex:0 0 var(--detail-height,42%);min-height:90px;padding:10px 12px;background:var(--vscode-editor-background)}.message{font-size:13px;line-height:1.4}.meta{line-height:1.55}.right-tabs{display:none;margin-left:auto}.empty{text-align:center;padding:24px 12px}
@media(max-width:900px){.header,.row{grid-template-columns:var(--graph-width,64px) minmax(160px,1fr) minmax(90px,120px)}}@media(max-width:700px){.header,.row{grid-template-columns:var(--graph-width,60px) minmax(150px,1fr)}}
.file.selected{background:var(--vscode-list-activeSelectionBackground);color:var(--vscode-list-activeSelectionForeground);border-left-color:var(--file-color)}.file.selected .file-name,.file.selected .file-path{color:inherit}@media(max-width:760px){.right-tabs{display:inline-flex}.right.mobile-files .detail,.right.mobile-files .right-split{display:none}.right.mobile-detail #files,.right.mobile-detail .right-split{display:none}.right.mobile-detail .detail{display:block;flex:1;height:auto}.layout{grid-template-columns:var(--left,170px) 3px minmax(260px,1fr) 3px var(--right,250px)}}
.context-menu button{height:27px;padding:3px 9px}.context-menu button.danger{color:var(--vscode-errorForeground)}
.ref-shape{display:inline-block;width:7px;height:7px;border:1.5px solid currentColor;border-radius:50%}.item.active .ref-shape{background:currentColor;box-shadow:0 0 0 2px color-mix(in srgb,currentColor 20%,transparent)}.item[data-kind="remote"] .ref-shape{width:9px;height:6px;border-radius:2px;background:linear-gradient(90deg,currentColor 0 2px,transparent 2px 4px,currentColor 4px 6px,transparent 6px)}.item[data-kind="tag"] .ref-shape{border-radius:1px;transform:rotate(45deg)}.toast{width:min(480px,calc(100vw - 24px));max-height:min(320px,calc(100vh - 24px));overflow:auto;padding:12px 36px 12px 13px;border-radius:3px;box-shadow:0 6px 22px rgba(0,0,0,.35)}.toast-close{position:absolute;right:6px;top:6px;width:24px;height:24px;padding:0;border:0;background:transparent;font-size:18px}.toast strong{display:block;margin-bottom:5px}.toast #toastMessage{line-height:1.4}.toast-actions{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px}.toast-actions button{height:27px;padding:0 9px}.toast details{margin-top:9px;color:var(--vscode-descriptionForeground)}.toast pre{max-height:130px;overflow:auto;white-space:pre-wrap;font:11px var(--vscode-editor-font-family);margin:6px 0 0}.toast.recovery{background:var(--vscode-inputValidation-warningBackground);border-color:var(--vscode-inputValidation-warningBorder)}.toast.success{background:var(--vscode-notifications-background);border-color:var(--vscode-testing-iconPassed);border-left:3px solid var(--vscode-testing-iconPassed)}
.item.viewing{background:var(--vscode-list-inactiveSelectionBackground);box-shadow:inset -2px 0 var(--vscode-focusBorder)}.item.viewing:not(.active){color:var(--vscode-list-inactiveSelectionForeground,var(--vscode-foreground))}.item.active.viewing{box-shadow:inset -2px 0 var(--vscode-focusBorder)}
.repo-badges{display:flex;gap:5px;margin-left:7px}.repo-badge,.filter-chip{height:22px;padding:2px 7px;border-radius:10px;border:1px solid var(--vscode-panel-border);color:var(--vscode-descriptionForeground);background:var(--vscode-editor-background);white-space:nowrap}.repo-badge.operation{color:var(--vscode-editorWarning-foreground);border-color:var(--vscode-editorWarning-foreground)}.filters{display:flex;min-height:38px;flex-wrap:wrap;align-items:center}.filters .advanced{display:none;gap:5px;flex:1;flex-wrap:wrap}.filters.expanded .advanced{display:flex}.filters #textFilter{min-width:180px;flex:1}.filter-chips{display:flex;gap:4px;flex-wrap:wrap;padding:0 7px 5px;background:var(--vscode-editorGroupHeader-tabsBackground)}.filter-chips:empty{display:none}.history-map{height:14px;position:relative;border-bottom:1px solid var(--vscode-panel-border);background:var(--vscode-editorGroupHeader-tabsBackground);cursor:pointer}.history-dot{position:absolute;top:3px;width:6px;height:6px;border-radius:50%;background:var(--vscode-charts-blue)}.history-dot.head{background:var(--vscode-charts-green);box-shadow:0 0 0 2px color-mix(in srgb,var(--vscode-charts-green) 25%,transparent)}.history-window{position:absolute;top:1px;height:11px;border:1px solid var(--vscode-focusBorder);background:color-mix(in srgb,var(--vscode-focusBorder) 10%,transparent)}.empty-state{position:absolute;inset:0;z-index:5;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;color:var(--vscode-descriptionForeground);background:var(--vscode-editor-background)}.empty-state[hidden]{display:none}.diff-preview{font:12px/1.45 var(--vscode-editor-font-family);white-space:pre;overflow:auto}.diff-preview .add{color:var(--vscode-gitDecoration-addedResourceForeground);background:color-mix(in srgb,var(--vscode-gitDecoration-addedResourceForeground) 8%,transparent)}.diff-preview .del{color:var(--vscode-gitDecoration-deletedResourceForeground);background:color-mix(in srgb,var(--vscode-gitDecoration-deletedResourceForeground) 8%,transparent)}.detail-actions{display:flex;gap:5px;margin-bottom:8px}.modal{display:none;position:fixed;inset:0;z-index:1100;background:rgba(0,0,0,.45);align-items:center;justify-content:center}.modal.open{display:flex}.modal-card{width:min(720px,calc(100vw - 30px));max-height:80vh;overflow:auto;padding:14px;background:var(--vscode-editorWidget-background);border:1px solid var(--vscode-widget-border);box-shadow:0 8px 30px rgba(0,0,0,.45)}.rebase-row{display:grid;grid-template-columns:90px 1fr auto;gap:6px;align-items:center;margin:5px 0}.modal-actions{display:flex;justify-content:flex-end;gap:7px;margin-top:12px}.skeleton{animation:pulse 1.2s ease-in-out infinite}@keyframes pulse{50%{opacity:.3}}
.layout{grid-template-columns:var(--left,220px) 34px 4px minmax(320px,1fr) 4px var(--right,330px)}.quick-actions{display:flex;min-width:34px;flex-direction:column;align-items:center;padding:5px 3px;border-left:1px solid var(--vscode-panel-border);background:var(--vscode-sideBar-background)}.quick-actions button{width:27px;height:27px;padding:0;border:0;background:transparent;color:var(--vscode-icon-foreground);font-size:15px}.quick-actions button:hover{background:var(--vscode-toolbar-hoverBackground)}.quick-actions button:focus-visible{outline:1px solid var(--vscode-focusBorder);outline-offset:-1px}.quick-separator{width:20px;margin:4px 0;border-top:1px solid var(--vscode-panel-border)}.quick-spacer{flex:1}.busy .quick-actions [data-action]{pointer-events:none;opacity:.45}.filters{display:grid;grid-template-columns:minmax(180px,1fr) auto;min-height:38px;align-items:center}.filters .advanced{display:none;grid-column:1/-1;grid-template-columns:minmax(110px,1fr) minmax(130px,1.3fr) 118px 118px minmax(100px,1fr) auto auto auto;gap:5px;width:100%}.filters.expanded .advanced{display:grid}.filters #textFilter{width:100%;min-width:180px}.filter-chips{padding-top:0}.toolbar{min-height:30px;padding:3px 7px}.layout{height:calc(100vh - 30px)}@media(max-width:900px){.filters .advanced{grid-template-columns:repeat(3,minmax(100px,1fr))}.layout{grid-template-columns:var(--left,180px) 32px 3px minmax(260px,1fr) 3px var(--right,260px)}}
.layout{grid-template-columns:var(--left,220px) 44px 4px minmax(320px,1fr) 4px var(--right,330px)}.quick-actions{min-width:44px;padding:7px 4px;gap:2px}.quick-actions button{display:flex;width:35px;height:35px;align-items:center;justify-content:center;border:1px solid transparent;border-radius:4px;color:var(--vscode-foreground);opacity:.88}.quick-actions button svg{width:20px;height:20px;overflow:visible;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}.quick-actions button:hover{border-color:var(--vscode-panel-border);background:var(--vscode-toolbar-hoverBackground);color:var(--vscode-focusBorder);opacity:1}.quick-actions button.running{border-color:var(--vscode-focusBorder);background:color-mix(in srgb,var(--vscode-focusBorder) 14%,transparent);color:var(--vscode-focusBorder);opacity:1}.quick-actions button.running svg{animation:quickPulse .9s ease-in-out infinite alternate}.quick-separator{width:28px;margin:5px 0}@keyframes quickPulse{to{opacity:.35;transform:scale(.88)}}.filters{display:block;min-height:0;padding:7px;border-bottom:1px solid var(--vscode-panel-border)}.filter-primary{display:grid;grid-template-columns:minmax(180px,1fr) auto auto;gap:6px}.filter-primary input{width:100%}.filters .advanced{display:none;width:100%;margin-top:7px;padding-top:7px;border-top:1px solid color-mix(in srgb,var(--vscode-panel-border) 65%,transparent)}.filters.expanded .advanced{display:block}.filter-fields{display:grid;grid-template-columns:minmax(110px,1fr) minmax(140px,1.35fr) 118px 118px minmax(110px,1fr);gap:6px}.filter-fields input{width:100%;min-width:0}.filter-options{display:flex;align-items:center;gap:14px;min-height:30px;margin-top:5px}.filter-options label{display:inline-flex;align-items:center;gap:5px;height:26px}.filter-options label input{width:16px;height:16px}.filter-options #clear{margin-left:auto}.filter-chips{padding:5px 7px;border-bottom:1px solid var(--vscode-panel-border)}.filter-chips:empty{display:none}@media(max-width:900px){.layout{grid-template-columns:var(--left,180px) 42px 3px minmax(260px,1fr) 3px var(--right,260px)}.filter-fields{grid-template-columns:repeat(2,minmax(110px,1fr))}.filter-fields #goto{grid-column:1/-1}}@media(max-width:620px){.filter-fields{grid-template-columns:1fr}.filter-fields #goto{grid-column:auto}.filter-options{flex-wrap:wrap;gap:7px 12px}.filter-options #clear{margin-left:0}}
.header,.row{grid-template-columns:var(--commit-grid,var(--graph-width,70px) minmax(120px,1fr) var(--author-width,130px) var(--date-width,145px))}.header>span{position:relative;height:100%;display:flex;align-items:center}.commit-col-hidden{display:none!important}.column-resizer{position:absolute;z-index:4;top:0;right:-4px;width:8px;height:100%;cursor:col-resize;touch-action:none}.column-resizer:hover,.column-resizer.dragging{background:var(--vscode-sash-hoverBorder)}.column-menu{position:fixed;z-index:800;display:none;min-width:190px;padding:7px;background:var(--vscode-menu-background);color:var(--vscode-menu-foreground);border:1px solid var(--vscode-menu-border);box-shadow:0 4px 14px rgba(0,0,0,.35)}.column-menu.open{display:block}.column-menu label{display:flex;align-items:center;gap:7px;height:26px}.column-menu input{width:16px;height:16px}.column-menu small{display:block;margin-top:5px;color:var(--vscode-descriptionForeground)}body.resizing-columns{cursor:col-resize;user-select:none}@media(max-width:900px){.header,.row{grid-template-columns:var(--commit-grid,var(--graph-width,64px) minmax(120px,1fr) var(--author-width,120px))}.column-resizer[data-resize="author"]{display:none}}@media(max-width:700px){.header,.row{grid-template-columns:var(--commit-grid,var(--graph-width,60px) minmax(120px,1fr))}.column-resizer[data-resize="subject"]{display:none}}
.layout{grid-template-columns:var(--left,250px) 4px minmax(360px,1fr) 4px var(--right,350px)}.branches{grid-column:1;grid-row:1}.split[data-side="left"]{grid-column:2;grid-row:1}.center{grid-column:3;grid-row:1}.split[data-side="right"]{grid-column:4;grid-row:1}.right{grid-column:5;grid-row:1}@media(max-width:900px){.layout{grid-template-columns:var(--left,190px) 3px minmax(280px,1fr) 3px var(--right,280px)}}
.ui-icon{display:inline-block;width:18px;height:18px;flex:0 0 18px;fill:none;stroke:currentColor;stroke-width:1.9;stroke-linecap:round;stroke-linejoin:round}.toolbar-icon .ui-icon{width:17px;height:17px}.branch-lock .ui-icon{width:14px;height:14px;stroke-width:2}.toolbar-action .ui-icon{width:17px;height:17px;stroke-width:2}.ui-icon.dots{fill:currentColor;stroke:none}.toolbar-action .action-icon{display:inline-flex;align-items:center;justify-content:center}.protected-icon{display:inline-flex;margin-left:6px;color:var(--vscode-descriptionForeground);vertical-align:middle}.protected-icon .ui-icon{width:13px;height:13px;stroke-width:2}
.row>[data-col="subject"]{position:relative;padding-right:62px}.row-actions{position:absolute;z-index:2;right:3px;top:5px;display:inline-flex;visibility:hidden;align-items:center;gap:2px;padding-left:12px;background:linear-gradient(90deg,transparent,var(--vscode-list-hoverBackground) 12px)}.row:hover .row-actions,.row:focus-within .row-actions{display:inline-flex;visibility:visible}.row.selected .row-actions{background:linear-gradient(90deg,transparent,color-mix(in srgb,var(--vscode-list-activeSelectionBackground) 70%,var(--vscode-editor-background)) 12px)}.row-action{display:inline-flex;align-items:center;justify-content:center;border-radius:3px;color:var(--vscode-descriptionForeground)}.row-action:hover{color:var(--vscode-foreground);background:var(--vscode-toolbar-hoverBackground)}.right .detail{order:0;height:var(--detail-height,42%);flex:0 0 var(--detail-height,42%);min-height:110px;max-height:none}.right .right-split{display:block;order:1;height:5px;flex:0 0 5px;cursor:row-resize;border:0;border-top:1px solid var(--vscode-panel-border);background:transparent}.right .right-split:hover,.right .right-split.dragging{background:var(--vscode-sash-hoverBorder);border-color:var(--vscode-sash-hoverBorder)}.right .heading{order:2}.right #files{order:3}.branches .item{display:flex;align-items:center;gap:0;height:30px;padding-top:0;padding-bottom:0;font-size:12px;font-weight:400}.branches .item.folder{font-weight:500;color:var(--vscode-foreground)}.branches .group{height:29px;padding:10px 12px 5px;color:var(--vscode-descriptionForeground);font-size:10px;font-weight:650;letter-spacing:.55px}.branches .item.active{font-weight:500;background:color-mix(in srgb,var(--vscode-list-activeSelectionBackground) 45%,transparent)}.branches .item button[data-star]{display:inline-flex;width:18px;min-width:18px;align-items:center;justify-content:center;margin-right:2px;color:var(--vscode-descriptionForeground);font-size:12px}.branches .item.active button[data-star]{color:var(--vscode-charts-yellow)}.branches .ref-icon{display:inline-flex;width:17px;min-width:17px;align-items:center;justify-content:center;margin-right:3px}.branches .ref-icon .ui-icon{width:14px;height:14px;stroke-width:1.8}.branches .protected-icon{margin-left:5px}.branches .badge{display:flex;align-items:center;gap:6px;margin-left:auto;padding-left:8px;font-size:10px;font-weight:500}.branch-ahead{color:var(--vscode-gitDecoration-addedResourceForeground)}.branch-behind{color:var(--vscode-gitDecoration-deletedResourceForeground)}
.toolbar{height:50px;min-height:50px;padding:7px 10px;gap:7px;background:var(--vscode-editor-background);overflow:visible}.layout{height:calc(100vh - 50px)}.toolbar-control{display:inline-flex;align-items:center;height:34px;padding:0 10px;border:1px solid var(--vscode-panel-border);border-radius:4px;background:var(--vscode-dropdown-background);color:var(--vscode-dropdown-foreground)}#repo{max-width:210px;height:34px;padding:0 28px 0 9px;border-radius:4px}#branchTrigger{min-width:150px;gap:8px;justify-content:flex-start}.toolbar-icon{width:16px;text-align:center;color:var(--vscode-descriptionForeground)}#branchName{overflow:hidden;text-overflow:ellipsis}.branch-lock{display:none;color:var(--vscode-descriptionForeground)}.branch-lock.visible{display:inline}.toolbar-chevron{margin-left:auto;color:var(--vscode-descriptionForeground)}.toolbar-search{position:relative;flex:1;max-width:720px;min-width:220px}.toolbar-search:before{content:'⌕';position:absolute;z-index:1;left:10px;top:7px;color:var(--vscode-descriptionForeground);font-size:17px}.toolbar-search input{width:100%;height:34px;padding:0 10px 0 32px;border-radius:4px;background:var(--vscode-input-background)}.toolbar-action{display:inline-flex;align-items:center;gap:7px;height:34px!important;padding:0 10px!important;border-radius:4px!important;color:var(--vscode-foreground)!important}.toolbar-action .action-icon{font-size:16px}.toolbar-action.running{color:var(--vscode-focusBorder)!important;background:color-mix(in srgb,var(--vscode-focusBorder) 12%,transparent)!important}.repo-badges{margin:0}.repo-badge{height:28px;border-radius:4px;padding:5px 8px;background:var(--vscode-editor-background)}.repo-badge.fetch-status,.repo-badge.changed-status{display:none}.branch-picker{position:fixed;z-index:850;display:none;width:min(360px,calc(100vw - 20px));max-height:min(480px,calc(100vh - 70px));overflow:auto;padding:5px;background:var(--vscode-menu-background);color:var(--vscode-menu-foreground);border:1px solid var(--vscode-menu-border);border-radius:4px;box-shadow:0 8px 24px rgba(0,0,0,.4)}.branch-picker.open{display:block}.branch-picker-search{position:sticky;top:0;width:100%;height:30px;margin-bottom:4px;padding:0 8px;z-index:1}.picker-group{padding:8px 8px 4px;color:var(--vscode-descriptionForeground);font-size:10px;font-weight:700;text-transform:uppercase}.picker-item{display:flex;width:100%;height:28px;align-items:center;gap:8px;padding:0 8px;border:0;background:transparent;text-align:left}.picker-item:hover,.picker-item:focus{background:var(--vscode-menu-selectionBackground);color:var(--vscode-menu-selectionForeground);outline:none}.picker-item.current:after{content:'✓';margin-left:auto}.filters{display:none}.filters.expanded{display:block;position:absolute;z-index:20;top:4px;left:8px;right:8px;padding:9px;background:var(--vscode-editorWidget-background);border:1px solid var(--vscode-widget-border);box-shadow:0 7px 22px rgba(0,0,0,.4)}.center{position:relative}.filter-chips{min-height:0;padding:5px 8px;background:var(--vscode-editor-background);border-bottom:1px solid var(--vscode-panel-border)}.filter-chips:empty{display:none}.heading{height:37px;padding:0 12px;background:transparent;border-bottom:1px solid var(--vscode-panel-border);letter-spacing:.35px}.branches .heading{height:37px}.branches{background:var(--vscode-editor-background)}#branchSearch{height:30px;margin:8px 10px;width:calc(100% - 20px);border-radius:4px}.group{display:flex;align-items:center;height:27px;padding:7px 12px 4px;font-size:10px;letter-spacing:.5px}.item{height:30px;padding-top:6px;padding-bottom:6px;padding-right:10px}.item button[data-star]{visibility:hidden}.item:hover button[data-star],.item.active button[data-star]{visibility:visible}.item.active{font-weight:500;border-left-color:var(--vscode-focusBorder);background:color-mix(in srgb,var(--vscode-list-activeSelectionBackground) 62%,transparent)}.badge{border:0;background:transparent;color:var(--vscode-descriptionForeground);font-variant-numeric:tabular-nums}.header{height:37px;padding:0 2px;background:var(--vscode-editor-background)}.row{height:32px}.row:hover .row-actions{display:inline-flex}.row-actions{display:none;float:right;gap:2px}.row-action{width:22px;height:22px;padding:0;border:0;background:transparent}.row.selected{outline:1px solid var(--vscode-focusBorder);outline-offset:-1px;background:color-mix(in srgb,var(--vscode-list-activeSelectionBackground) 70%,transparent)}.refs{border:1px solid color-mix(in srgb,currentColor 45%,transparent);border-radius:8px;background:transparent!important;height:17px}.right{background:var(--vscode-editor-background)}.right .detail{order:0;flex:0 0 auto;height:auto;min-height:172px;max-height:42%;padding:15px 16px;border:0;border-bottom:1px solid var(--vscode-panel-border)}.right .heading{order:1}.right #files{order:2}.right .right-split{display:none}.detail-title{font-size:15px;font-weight:650;line-height:1.35;margin-bottom:8px}.detail-subject-body{margin:10px 0;color:var(--vscode-descriptionForeground);font:12px/1.5 var(--vscode-editor-font-family);white-space:pre-wrap}.detail-meta-line{display:flex;flex-wrap:wrap;gap:6px 12px;color:var(--vscode-descriptionForeground)}.detail-icon-actions{display:flex;gap:6px;margin-top:13px}.detail-icon-actions button{width:28px;height:28px;padding:0;border-color:var(--vscode-panel-border);border-radius:4px;background:var(--vscode-editor-background)}.file-summary{display:flex;align-items:center;gap:9px;margin-left:auto;font-variant-numeric:tabular-nums}.summary-count{display:inline-flex;min-width:20px;height:20px;align-items:center;justify-content:center;border-radius:10px;background:var(--vscode-badge-background);color:var(--vscode-badge-foreground)}.summary-add{color:var(--vscode-gitDecoration-addedResourceForeground)}.summary-del{color:var(--vscode-gitDecoration-deletedResourceForeground)}.file-view-toggle{display:flex;margin-left:8px}.file-view-toggle button{width:auto;padding:0 8px}.file-view-toggle button.active{color:var(--vscode-focusBorder);border-color:var(--vscode-focusBorder)}#files{background:var(--vscode-editor-background)}.file{min-height:34px;border-bottom:1px solid color-mix(in srgb,var(--vscode-panel-border) 45%,transparent)}@media(max-width:1050px){.toolbar-action span:last-child{display:none}.toolbar-action{width:34px;justify-content:center;padding:0!important}.layout{grid-template-columns:var(--left,190px) 3px minmax(280px,1fr) 3px var(--right,285px)}}@media(max-width:780px){.branches,.split[data-side="left"]{display:none}.layout{grid-template-columns:minmax(280px,1fr) 3px var(--right,270px)}.center{grid-column:1}.split[data-side="right"]{grid-column:2}.right{grid-column:3}#repoBadges{display:none}}@media(max-width:600px){.right,.split[data-side="right"]{display:none}.layout{display:block}.toolbar-search{min-width:120px}.toolbar-action{display:none}}
.right .detail{order:0;height:var(--detail-height,42%);flex:0 0 var(--detail-height,42%);min-height:110px;max-height:none}.right .right-split{display:block;order:1;height:7px;flex:0 0 7px;cursor:row-resize;border:0;border-top:1px solid var(--vscode-panel-border);background:transparent}.right .right-split:hover,.right .right-split.dragging{background:var(--vscode-sash-hoverBorder);border-color:var(--vscode-sash-hoverBorder)}.right .heading{order:2}.right #files{order:3}.repo-badge.sync-ahead,.repo-badge.sync-behind{display:inline-flex;align-items:center;min-width:34px;justify-content:center;font-size:13px;font-weight:650;font-variant-numeric:tabular-nums}.repo-badge.sync-ahead{color:var(--vscode-gitDecoration-addedResourceForeground);border-color:color-mix(in srgb,var(--vscode-gitDecoration-addedResourceForeground) 60%,var(--vscode-panel-border))}.repo-badge.sync-behind{color:var(--vscode-gitDecoration-deletedResourceForeground);border-color:color-mix(in srgb,var(--vscode-gitDecoration-deletedResourceForeground) 60%,var(--vscode-panel-border))}.branches .badge .branch-ahead,.branches .badge .branch-behind{display:inline-flex;min-width:25px;height:20px;align-items:center;justify-content:center;padding:0 4px;border:1px solid currentColor;border-radius:4px;font-size:12px;font-weight:700;font-variant-numeric:tabular-nums}
</style></head><body>
<div class="toolbar"><select id="repo" title="Switch repository" aria-label="Repository"></select><button class="toolbar-control" id="branchTrigger" title="Switch branch" aria-expanded="false"><span class="toolbar-icon"><svg class="ui-icon" viewBox="0 0 24 24"><circle cx="6" cy="5" r="2"/><circle cx="6" cy="19" r="2"/><circle cx="18" cy="8" r="2"/><path d="M6 7v10M8 8h4a6 6 0 0 1 6 6v-4"/></svg></span><span id="branchName">No branch</span><span class="branch-lock" id="branchLock"><svg class="ui-icon" viewBox="0 0 24 24"><rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg></span><span class="toolbar-chevron">⌄</span></button><span class="repo-badges" id="repoBadges"></span><span class="toolbar-search"><input id="textFilter" placeholder="Search commits, authors, hashes…" aria-label="Search commits"></span><button class="toolbar-action" id="toggleFilters" title="More filters" aria-expanded="false"><span class="action-icon"><svg class="ui-icon" viewBox="0 0 24 24"><path d="M4 6h16M7 12h10M10 18h4"/></svg></span><span>Filters</span></button><span class="grow"></span><button class="toolbar-action" id="refresh" title="Refresh Git Log"><span class="action-icon"><svg class="ui-icon" viewBox="0 0 24 24"><path d="M20 7v5h-5M4 17v-5h5M6.1 8a7 7 0 0 1 11.8-1L20 12M4 12l2.1 5a7 7 0 0 0 11.8-1"/></svg></span><span>Refresh</span></button><button class="toolbar-action" data-action="fetch" title="Fetch all remotes"><span class="action-icon"><svg class="ui-icon" viewBox="0 0 24 24"><path d="M12 3v12M8 11l4 4 4-4M5 20h14"/></svg></span><span>Fetch</span></button><button class="toolbar-action" data-action="pull" title="Pull current branch"><span class="action-icon"><svg class="ui-icon" viewBox="0 0 24 24"><circle cx="6" cy="5" r="2"/><circle cx="6" cy="19" r="2"/><path d="M6 7v10M18 4v11M14 11l4 4 4-4"/></svg></span><span>Pull</span></button><button class="toolbar-action" data-action="push" title="Push current branch"><span class="action-icon"><svg class="ui-icon" viewBox="0 0 24 24"><circle cx="6" cy="5" r="2"/><circle cx="6" cy="19" r="2"/><path d="M6 7v10M18 20V9M14 13l4-4 4 4"/></svg></span><span>Push</span></button><button class="toolbar-action" id="viewOptions" title="View options"><span class="action-icon"><svg class="ui-icon dots" viewBox="0 0 24 24"><circle cx="5" cy="12" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="19" cy="12" r="1.7"/></svg></span></button><button id="toggleColumns" hidden title="Commit columns" aria-expanded="false">Columns</button></div><div class="branch-picker" id="branchPicker"><input class="branch-picker-search" id="branchPickerSearch" placeholder="Switch branch…"><div id="branchPickerItems"></div></div>
<main class="layout" id="layout"><section class="pane branches"><div class="heading"><span class="heading-title">BRANCHES</span><button data-action="createBranch" title="Create branch">＋</button></div><input id="branchSearch" placeholder="Search branches"><div id="branches"></div></section><div class="split" data-side="left"></div>
<section class="pane center"><div class="banner" id="banner"><b id="operation"></b><button data-conflict="continue">Continue</button><button data-conflict="abort">Abort</button><button data-conflict="skip">Skip</button></div><div class="filters" id="filters"><div class="advanced"><div class="filter-fields"><input id="authorFilter" placeholder="Author"><input id="pathFilter" placeholder="Path"><input id="sinceFilter" type="date" title="From date"><input id="untilFilter" type="date" title="To date"><input id="goto" placeholder="Hash / ref"></div><div class="filter-options"><label><input type="checkbox" id="regex"> Regex</label><label><input type="checkbox" id="case"> Case sensitive</label><button id="clear">Clear all</button></div></div></div><div class="column-menu" id="columnMenu" role="menu" aria-label="Commit columns"></div><div class="filter-chips" id="filterChips"></div><div class="header"><span data-col="graph">Graph<i class="column-resizer" data-resize="graph" title="Resize Graph column"></i></span><span data-col="subject">Commit<i class="column-resizer" data-resize="subject" title="Resize Commit and Author columns"></i></span><span data-col="author">Author<i class="column-resizer" data-resize="author" title="Resize Author and Date columns"></i></span><span data-col="date">Date</span></div><div class="row" id="uncommitted" style="display:none;position:relative"><span data-col="graph"></span><strong data-col="subject">Uncommitted changes</strong><span data-col="author"></span><span data-col="date"></span></div><div class="viewport" id="viewport" tabindex="0"><div class="empty-state" id="emptyState"><b>Loading Git history…</b><span>Reading commits and branches</span></div><div class="graph-clip" id="graphClip" aria-hidden="true"><svg class="graph-overlay" id="graphSvg"></svg></div><div class="spacer" id="spacer"></div></div></section>
<div class="split" data-side="right"></div><section class="pane right" id="rightPane"><div class="detail" id="detail"><div class="empty">Select a commit</div></div><div class="heading"><span class="heading-title">CHANGED FILES</span><span class="file-summary" id="fileSummary"></span><span class="file-view-toggle"><button id="treeMode" title="Tree view">Tree</button><button id="listMode" title="List view">List</button></span><button id="fileMode" hidden>Tree</button><button id="collapseFiles" title="Collapse all folders">−</button><button id="expandFiles" title="Expand all folders">＋</button><select id="parentMode" style="display:none" title="Merge comparison parent"></select></div><div id="files"></div><div class="right-split" id="rightSplit"></div></section></main><div class="context-menu" id="contextMenu" role="menu"></div><div class="toast" id="toast" role="alert"><button class="toast-close" id="toastClose" title="Dismiss">×</button><strong id="toastTitle"></strong><div id="toastMessage"></div><div class="toast-actions" id="toastActions"></div><details id="toastDetails"><summary>Details</summary><pre id="toastDetailText"></pre></details></div><div class="modal" id="rebaseModal"><div class="modal-card"><h3>Interactive Rebase Preview</h3><p>Oldest commit first. Reordering or changing an action rewrites local history.</p><div id="rebaseRows"></div><div class="modal-actions"><button id="cancelRebase">Cancel</button><button id="runRebase">Run Rebase</button></div></div></div>
<script nonce="${nonce}">
const vscode=acquireVsCodeApi(), ROW=32, PAGE=200, overscan=12, COL=16, PAD=8, LANE_COLORS=['var(--vscode-charts-blue)','var(--vscode-charts-purple)','var(--vscode-charts-green)','var(--vscode-charts-yellow)','var(--vscode-charts-red)','var(--vscode-charts-orange)','var(--vscode-charts-foreground)','var(--vscode-gitDecoration-modifiedResourceForeground)'];
function reportClientError(value){const text=value instanceof Error?(value.stack||value.message):String(value);vscode.postMessage({type:'clientError',operation:text})}
window.addEventListener('error',event=>reportClientError(event.error||event.message));window.addEventListener('unhandledrejection',event=>reportClientError(event.reason));
function storedArray(key){try{const value=JSON.parse(localStorage.getItem(key)||'[]');if(Array.isArray(value))return value}catch(error){reportClientError('Reset invalid '+key+': '+error)}localStorage.removeItem(key);return[]}
let state={commits:[],commitIndexes:new Map(),commitsByHash:new Map(),graphMaxColumn:0,total:0,generation:0,busy:false,contextRequestId:0,loading:new Set(),selected:-1,selectionAnchor:-1,selectedHashes:new Set(),detail:null,uncommitted:[],visibleFiles:[],visibleFilesWorking:false,fileFolders:new Set(),fileMode:localStorage.getItem('gitLog.fileMode')||'tree',fileCollapsed:new Set(storedArray('gitLog.fileCollapsed')),favorites:new Set(storedArray('gitLog.favorites')),recentBranches:storedArray('gitLog.recentBranches'),collapsed:new Set(storedArray('gitLog.collapsed')),protectedBranches:[]};
const $=id=>document.getElementById(id), esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),pathBase=s=>String(s||'').replace(/\\\\/g,'/').split('/').filter(Boolean).pop()||String(s||'');
const COMMIT_COLUMNS=[{id:'graph',label:'Graph',width:'var(--graph-width,70px)',min:28},{id:'subject',label:'Subject',width:'minmax(120px,1fr)',min:120},{id:'author',label:'Author',width:'var(--author-width,130px)',min:80},{id:'date',label:'Date',width:'var(--date-width,145px)',min:105}];
const columnWidths={};try{const saved=JSON.parse(localStorage.getItem('gitLog.columnWidths')||'{}');for(const name of ['graph','author','date'])if(Number.isFinite(saved[name])){columnWidths[name]=saved[name];document.documentElement.style.setProperty('--'+name+'-width',saved[name]+'px')}}catch{}
let visibleColumns=new Set(storedArray('gitLog.visibleColumns').filter(x=>COMMIT_COLUMNS.some(c=>c.id===x)));if(!visibleColumns.size)visibleColumns=new Set(COMMIT_COLUMNS.map(c=>c.id));
function setColumnWidth(name,value){const rounded=Math.round(value);columnWidths[name]=rounded;document.documentElement.style.setProperty('--'+name+'-width',rounded+'px')}function saveColumnWidths(){localStorage.setItem('gitLog.columnWidths',JSON.stringify(columnWidths))}
function applyColumnVisibility(){const visible=COMMIT_COLUMNS.filter(c=>visibleColumns.has(c.id));document.documentElement.style.setProperty('--commit-grid',visible.map(c=>c.width).join(' '));document.querySelectorAll('[data-col]').forEach(el=>el.classList.toggle('commit-col-hidden',!visibleColumns.has(el.dataset.col)));$('graphClip').style.display=visibleColumns.has('graph')?'':'none';renderColumnMenu()}
function renderColumnMenu(){const visibleCount=visibleColumns.size;$('columnMenu').innerHTML=COMMIT_COLUMNS.map(c=>'<label><input type="checkbox" data-column-toggle="'+c.id+'" '+(visibleColumns.has(c.id)?'checked':'')+' '+(visibleColumns.has(c.id)&&visibleCount===1?'disabled':'')+'> '+c.label+'</label>').join('')+'<small>Keep at least one column visible.</small>'}
function send(type,data={}){vscode.postMessage({type,...data})}function date(ts){return new Date(ts*1000).toLocaleString()}function commitAge(ts){const seconds=Math.max(0,Math.floor(Date.now()/1000-ts));if(seconds<60)return'now';if(seconds<3600)return Math.floor(seconds/60)+'m ago';if(seconds<86400)return Math.floor(seconds/3600)+'h ago';if(seconds<172800)return'yesterday';if(seconds<604800)return Math.floor(seconds/86400)+' days ago';return new Date(ts*1000).toLocaleDateString()}function actionLabel(action){return String(action||'Git operation').replace(/([A-Z])/g,' $1').toLowerCase()}
function relativeTime(ms){if(!ms)return'Not fetched this session';const minutes=Math.max(0,Math.round((Date.now()-ms)/60000));return minutes<1?'Fetched just now':'Fetched '+minutes+'m ago'}
function renderStatusBadges(){const r=state.repository,host=$('repoBadges');if(!r){host.innerHTML='';return}const values=[];if(r.ahead)values.push(['↑ '+r.ahead,r.ahead+' local commit(s) not on the upstream branch','sync-ahead']);if(r.behind)values.push(['↓ '+r.behind,r.behind+' upstream commit(s) not in the local branch','sync-behind']);if(r.changedCount)values.push([r.changedCount+' changed','Working tree files','changed-status']);if(r.detached)values.push(['Detached HEAD','No branch is checked out','operation']);if(r.operation)values.push([r.operation,'Git operation in progress','operation']);values.push([relativeTime(r.lastFetchedAt),'Last successful fetch','fetch-status']);host.innerHTML=values.map(x=>'<span class="repo-badge '+x[2]+'" title="'+esc(x[1])+'">'+esc(x[0])+'</span>').join('')}
function activeFilters(){const values=[['authorFilter','Author'],['pathFilter','Path'],['sinceFilter','From'],['untilFilter','To']];const chips=values.filter(([id])=>$(id).value).map(([id,label])=>({id,label:label+': '+$(id).value}));if(state.selectedRef)chips.push({id:'ref',label:'Branch: '+state.selectedRef});if($('regex').checked)chips.push({id:'regex',label:'Regex'});if($('case').checked)chips.push({id:'case',label:'Case'});return chips}
function renderFilterChips(){$('filterChips').innerHTML=activeFilters().map(x=>'<button class="filter-chip" data-clear-filter="'+x.id+'">'+esc(x.label)+' ×</button>').join('')}
function requestContext(data){state.contextRequestId++;$('contextMenu').style.display='none';if(!state.busy)send('context',{...data,requestId:state.contextRequestId})}
function lockIcon(){return'<span class="protected-icon" title="Protected branch"><svg class="ui-icon" viewBox="0 0 24 24"><rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg></span>'}function branchRefIcon(kind){return'<span class="ref-icon" aria-hidden="true"><svg class="ui-icon" viewBox="0 0 24 24">'+(kind==='remote'?'<circle cx="6" cy="6" r="2"/><circle cx="18" cy="6" r="2"/><path d="M6 8v10M18 8v4a6 6 0 0 1-6 6H6"/>':'<circle cx="6" cy="5" r="2"/><circle cx="6" cy="19" r="2"/><circle cx="18" cy="8" r="2"/><path d="M6 7v10M8 8h10"/>')+'</svg></span>'}function protectedBranch(name){const special='\\.^$+?()[]{}|';return(state.protectedBranches||[]).some(pattern=>{const escaped=[...String(pattern)].map(c=>c==='*'?'.*':special.includes(c)?'\\\\'+c:c).join('');return new RegExp('^'+escaped+'$').test(name)})}function refItem(x,label=x.name,depth=0){return '<div class="item '+(x.current?'active ':'')+(state.selectedRef===x.name?'viewing':'')+'" style="padding-left:'+(8+depth*14)+'px" data-kind="'+x.kind+'" data-hash="'+x.hash+'" data-ref="'+esc(x.name)+'" title="'+esc(x.name)+'"><button style="border:0;background:transparent;height:auto;padding:0" data-star="'+esc(x.name)+'" title="Favorite">'+(state.favorites.has(x.name)?'★':'☆')+'</button>'+branchRefIcon(x.kind)+ '<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+esc(label)+'</span>'+(protectedBranch(x.name)?lockIcon():'')+'<span class="badge">'+(x.ahead?'<span class="branch-ahead" title="'+x.ahead+' local commit(s) not on upstream">↑ '+x.ahead+'</span>':'')+(x.behind?'<span class="branch-behind" title="'+x.behind+' upstream commit(s) not in local branch">↓ '+x.behind+'</span>':'')+'</span></div>'}
function refTree(refs,kind,q,prefix='',depth=0){const folders=new Map(),leaves=[];for(const ref of refs){const relative=prefix&&ref.name.startsWith(prefix+'/')?ref.name.slice(prefix.length+1):ref.name,parts=relative.split('/');if(parts.length===1)leaves.push(ref);else{const folder=parts[0];if(!folders.has(folder))folders.set(folder,[]);folders.get(folder).push(ref)}}let html=leaves.map(x=>refItem(x,x.name.split('/').pop(),depth)).join('');for(const [folder,children] of [...folders].sort(([a],[b])=>a.localeCompare(b))){const key=kind+':'+(prefix?prefix+'/':'')+folder,closed=!q&&state.collapsed.has(key);html+='<div class="item folder" style="padding-left:'+(8+depth*14)+'px" data-folder="'+esc(key)+'">'+(closed?'▸':'▾')+' '+esc(folder)+'</div>';if(!closed)html+=refTree(children,kind,q,prefix?prefix+'/'+folder:folder,depth+1)}return html}
function renderBranches(){const q=$('branchSearch').value.toLowerCase(),r=state.repository;if(!r)return;const matching=r.refs.filter(x=>!q||x.name.toLowerCase().includes(q)),recent=state.recentBranches.map(name=>matching.find(x=>x.kind==='local'&&x.name===name)).filter(Boolean).slice(0,4),favorites=matching.filter(x=>state.favorites.has(x.name)&&!recent.includes(x));let html='';if(recent.length)html+='<div class="group">Recent</div>'+recent.map(x=>refItem(x)).join('');if(favorites.length)html+='<div class="group">Favorites</div>'+favorites.map(x=>refItem(x)).join('');for(const kind of ['local','remote','tag']){const refs=matching.filter(x=>x.kind===kind&&!recent.includes(x)&&!favorites.includes(x));if(refs.length)html+='<div class="group">'+kind+'</div>'+refTree(refs,kind,q)}const worktrees=(r.worktrees||[]).filter(x=>!q||(x.path+' '+(x.branch||'detached')).toLowerCase().includes(q));if(worktrees.length)html+='<div class="group">Worktrees</div>'+worktrees.map(x=>'<div class="item worktree '+(x.current?'active':'')+'" data-kind="'+(x.current?'worktreeCurrent':'worktree')+'" data-ref="'+esc(x.branch||x.head)+'" data-hash="'+esc(x.head)+'" data-path="'+esc(x.path)+'" title="'+esc(x.path+(x.locked?' · locked: '+x.locked:'')+(x.prunable?' · prunable: '+x.prunable:''))+'"><span class="ref-icon">⌂</span>'+esc(x.branch||'detached @ '+x.head.slice(0,8))+'<span class="badge">'+esc(pathBase(x.path))+'</span></div>').join('');if(r.stashes.length)html+='<div class="group">Stashes</div>'+r.stashes.filter(x=>!q||(x.ref+' '+x.message).toLowerCase().includes(q)).map(x=>'<div class="item" data-kind="stash" data-ref="'+esc(x.ref)+'" data-hash="'+x.hash+'">'+esc(x.ref+' '+x.message)+'</div>').join('');$('branches').innerHTML=html}
function renderBranchPicker(){const r=state.repository,q=$('branchPickerSearch').value.toLowerCase();if(!r)return;let html='';for(const kind of ['local','remote']){const refs=r.refs.filter(x=>x.kind===kind&&(!q||x.name.toLowerCase().includes(q)));if(!refs.length)continue;html+='<div class="picker-group">'+kind+'</div>'+refs.map(x=>'<button class="picker-item '+(x.current?'current':'')+'" data-picker-kind="'+kind+'" data-picker-ref="'+esc(x.name)+'">'+branchRefIcon(kind)+'<span>'+esc(x.name)+'</span>'+(protectedBranch(x.name)?lockIcon():'')+'</button>').join('')}if(!html)html='<div class="empty">No matching branches</div>';$('branchPickerItems').innerHTML=html}function closeBranchPicker(){$('branchPicker').classList.remove('open');$('branchTrigger').setAttribute('aria-expanded','false')}function openBranchPicker(){renderBranchPicker();const button=$('branchTrigger'),picker=$('branchPicker'),rect=button.getBoundingClientRect();picker.classList.add('open');picker.style.left=Math.max(6,Math.min(rect.left,window.innerWidth-picker.offsetWidth-6))+'px';picker.style.top=(rect.bottom+4)+'px';$('branchTrigger').setAttribute('aria-expanded','true');$('branchPickerSearch').focus();$('branchPickerSearch').select()}
function refClass(ref){return ref.includes('HEAD')?'ref-head':ref.startsWith('tag:')?'ref-tag':ref.includes('refs/remotes/')?'ref-remote':'ref-local'}
function contextClass(action){return ['deleteRemote','deleteBranch','deleteTag','stashDrop','dropCommit','reset','rollbackFile','getFile'].includes(action)?'danger':''}
function hideToast(){$('toast').style.display='none';$('toast').classList.remove('recovery','success')}
function showErrorToast(message){const lines=String(message).trim().split(/\\r?\\n/),toast=$('toast');$('toastTitle').textContent='Git command failed';$('toastMessage').textContent=lines[0]||'Git command failed';$('toastActions').innerHTML='';$('toastDetailText').textContent=message;$('toastDetails').open=false;$('toastDetails').style.display=lines.length>1?'block':'none';toast.classList.remove('recovery');toast.style.display='block'}
function showActionFeedback(action,durationMs){const toast=$('toast'),seconds=durationMs>=1000?(durationMs/1000).toFixed(1)+'s':durationMs+'ms';$('toastTitle').textContent='Git action completed';$('toastMessage').textContent=actionLabel(action)+' completed in '+seconds;$('toastActions').innerHTML='';$('toastDetails').style.display='none';toast.classList.remove('recovery');toast.classList.add('success');toast.style.display='block';clearTimeout(state.feedbackTimer);state.feedbackTimer=setTimeout(hideToast,3500)}
function showRecoveryToast(message){const recovery=message.recovery,toast=$('toast');$('toastTitle').textContent=recovery.title;$('toastMessage').textContent='Choose how to continue the cherry-pick.';$('toastDetailText').textContent=recovery.detail;$('toastDetails').style.display='block';$('toastDetails').open=false;$('toastActions').innerHTML='';for(const item of recovery.actions){const button=document.createElement('button');button.textContent=item.label;button.onclick=()=>{hideToast();send('mutate',{action:item.action,operation:message.operation})};$('toastActions').appendChild(button)}toast.classList.add('recovery');toast.style.display='block'}
$('toastClose').onclick=hideToast;window.addEventListener('message',e=>{const m=e.data;if(m.type==='recovery'){showRecoveryToast(m);e.stopImmediatePropagation()}else if(m.type==='error'){showErrorToast(m.message);$('emptyState').hidden=false;$('emptyState').innerHTML='<b>Unable to load Git history</b><span>'+esc(m.message)+'</span><button data-empty-action="refresh">Try again</button>';e.stopImmediatePropagation()}else if(m.type==='busy'){if(state.repository?.root&&m.repositoryId!==state.repository.root){e.stopImmediatePropagation();return}state.busy=m.busy;document.body.classList.toggle('busy',m.busy);for(const button of document.querySelectorAll('.toolbar [data-action]')){if(!button.dataset.idleTitle)button.dataset.idleTitle=button.title;const running=m.busy&&button.dataset.action===m.action;button.classList.toggle('running',running);button.title=running?actionLabel(m.action)+' running…':button.dataset.idleTitle}if(m.busy)$('repoBadges').innerHTML='<span class="repo-badge operation">Running '+esc(actionLabel(m.action))+'…</span>';else{renderStatusBadges();if(m.succeeded&&m.applied)showActionFeedback(m.action,m.durationMs)}e.stopImmediatePropagation()}},true);
function graphX(column){return PAD+column*COL+COL/2}function graphY(index,scrollTop){return index*ROW+ROW/2-scrollTop}function graphPath(x1,y1,x2,y2,stub=false){if(x1===x2||stub)return'M '+x1+' '+y1+' L '+x2+' '+y2;const bend=y2-Math.sign(y2-y1||1)*ROW*.65;return'M '+x1+' '+y1+' C '+x1+' '+bend+', '+x2+' '+(y1+ROW*.35)+', '+x2+' '+y2}
function selectedFirstParentPath(){const selected=state.commits[state.selected];if(!selected)return new Set();const childByParent=new Map();for(const commit of state.commitsByHash.values()){const parent=commit.parents[0];if(parent&&!childByParent.has(parent))childByParent.set(parent,commit.hash)}const active=new Set();let hash=selected.hash;while(hash&&!active.has(hash)){active.add(hash);hash=state.commitsByHash.get(hash)?.parents[0]}hash=childByParent.get(selected.hash);while(hash&&!active.has(hash)){active.add(hash);hash=childByParent.get(hash)}return active}
function indexCommits(commits,offset=0,reset=false){if(reset||offset===0){state.commitIndexes.clear();state.commitsByHash.clear();state.graphMaxColumn=0}commits.forEach((commit,index)=>{if(!commit)return;state.commitIndexes.set(commit.hash,offset+index);state.commitsByHash.set(commit.hash,commit);if(commit.lane)state.graphMaxColumn=Math.max(state.graphMaxColumn,commit.lane.column,...commit.lane.lines.map(line=>line.toColumn))})}
function visibleRange(){const vp=$('viewport');return{start:Math.max(0,Math.floor(vp.scrollTop/ROW)-overscan),end:Math.min(state.total,Math.ceil((vp.scrollTop+vp.clientHeight)/ROW)+overscan)}}
function renderGraph(start,end){if(document.body.classList.contains('resizing'))return;const vp=$('viewport'),clip=$('graphClip'),svg=$('graphSvg'),visible=[],active=selectedFirstParentPath(),hasSelection=active.size>0;clip.style.transform='translateY('+vp.scrollTop+'px)';for(let i=start;i<end;i++){const c=state.commits[i];if(c?.lane)visible.push([i,c])}const width=(state.graphMaxColumn+1)*COL+PAD*2;document.documentElement.style.setProperty('--graph-min-width',Math.max(56,width)+'px');svg.setAttribute('width',String(width));svg.setAttribute('height',String(vp.clientHeight));svg.setAttribute('viewBox','0 0 '+width+' '+vp.clientHeight);let paths='',nodes='';for(const [index,c] of visible){const lane=c.lane,x=graphX(lane.column),y=graphY(index,vp.scrollTop),color=LANE_COLORS[lane.color%LANE_COLORS.length],nodeActive=active.has(c.hash);for(const line of lane.lines){const targetIndex=state.commitIndexes.get(line.toCommit),stub=targetIndex===undefined,toY=stub?y+ROW*.75:graphY(targetIndex,vp.scrollTop),toX=graphX(line.toColumn),edgeActive=nodeActive&&active.has(line.toCommit);paths+='<path d="'+graphPath(x,y,toX,toY,stub)+'" fill="none" stroke="'+color+'" stroke-width="'+(edgeActive?'2.8':'1.6')+'" stroke-linecap="round" stroke-linejoin="round" opacity="'+(hasSelection&&!edgeActive?'.2':stub?'.55':'1')+'" '+(stub?'stroke-dasharray="4 2"':'')+'/>'}const merge=c.parents.length>1,opacity=hasSelection&&!nodeActive?'.25':'1';nodes+=merge?'<circle cx="'+x+'" cy="'+y+'" r="4.6" fill="'+color+'" opacity="'+opacity+'"/><circle cx="'+x+'" cy="'+y+'" r="2.4" fill="var(--vscode-panel-background)" opacity="'+opacity+'"/><circle cx="'+x+'" cy="'+y+'" r="1.5" fill="'+color+'" opacity="'+opacity+'"/>':'<circle cx="'+x+'" cy="'+y+'" r="'+(nodeActive?'4.2':'3.6')+'" fill="'+color+'" opacity="'+opacity+'"/>';if(index===state.selected)nodes+='<circle cx="'+x+'" cy="'+y+'" r="7" fill="none" stroke="var(--vscode-focusBorder)" stroke-width="1.8"/>';else if(c.refs.some(ref=>ref.includes('HEAD')))nodes+='<circle cx="'+x+'" cy="'+y+'" r="6.4" fill="none" stroke="'+color+'" stroke-width="1" opacity=".3"/>'}svg.innerHTML=paths+nodes}
function refreshSelection(){for(const row of $('spacer').querySelectorAll('.row')){const index=Number(row.dataset.index),commit=state.commits[index];row.classList.toggle('selected',index===state.selected);row.classList.toggle('multi',!!commit&&state.selectedHashes.has(commit.hash))}const range=visibleRange();renderGraph(range.start,range.end)}
function renderRows(){const vp=$('viewport'),start=Math.max(0,Math.floor(vp.scrollTop/ROW)-overscan),end=Math.min(state.total,Math.ceil((vp.scrollTop+vp.clientHeight)/ROW)+overscan),empty=$('emptyState');if(!state.total){empty.hidden=false;empty.innerHTML=state.loading.size?'<b>Loading Git history…</b><span>Reading commits and branches</span>':activeFilters().length||$('textFilter').value?'<b>No commits match these filters</b><span>Change or clear filters to see more commits</span><button onclick="clearFilters()">Clear filters</button>':'<b>No commits yet</b><span>This repository has no visible history</span>'}else empty.hidden=true;$('spacer').style.height=(state.total*ROW)+'px';$('spacer').innerHTML=Array.from({length:Math.max(0,end-start)},(_,i)=>{const n=start+i,c=state.commits[n];if(!c)return '<div class="row loading skeleton" style="top:'+(n*ROW)+'px"><span data-col="graph"></span><span data-col="subject"></span><span data-col="author"></span><span data-col="date"></span></div>';const refs=c.refs.slice(0,3).map(ref=>'<span class="refs '+refClass(ref)+'">'+esc(ref.replace('HEAD -> ','').replace('refs/heads/','').replace('refs/remotes/','').replace('tag: refs/tags/',''))+'</span>').join('');return '<div class="row '+(n===state.selected?'selected ':'')+(state.selectedHashes.has(c.hash)?'multi':'')+'" data-index="'+n+'" style="top:'+(n*ROW)+'px"><span data-col="graph"></span><span data-col="subject">'+esc(c.subject)+refs+'<span class="row-actions"><button class="row-action" data-row-copy="'+esc(c.hash)+'" title="Copy hash">⧉</button><button class="row-action" data-row-menu="'+n+'" title="More actions">•••</button></span></span><span data-col="author">'+esc(c.author)+'</span><span data-col="date" title="'+esc(date(c.authorTimestamp))+'">'+commitAge(c.authorTimestamp)+'</span></div>'}).join('');applyColumnVisibility();renderGraph(start,end);for(let page=Math.floor(start/PAGE)*PAGE;page<end;page+=PAGE)if(!state.commits[page]&&!state.loading.has(page)){state.loading.add(page);send('loadLog',{offset:page,generation:state.generation,filter:filter()})}}
function fileStatus(f){const raw=String(f.status||'?').toUpperCase(),conflict=f.conflict||/^(DD|AU|UD|UA|DU|AA|UU)$/.test(raw);if(conflict)return{code:'!',label:'Conflict',css:'status-conflict'};const code=raw==='?'?'U':raw[0];return{code,label:{A:'Added',M:'Modified',D:'Deleted',R:'Renamed',C:'Copied',U:'Untracked'}[code]||raw,css:'status-'+code.toLowerCase()}}
function fileRow(f,depth=0,working=false){const status=fileStatus(f),parts=f.path.split('/'),name=parts.pop()||f.path,folder=parts.join('/'),old=f.oldPath?' ← '+f.oldPath:'';return '<div class="file '+status.css+'" title="'+esc(status.label+': '+f.path+old)+'" style="padding-left:'+(8+depth*14)+'px" data-path="'+esc(f.path)+'" '+(working?'data-working="true" ':'')+(f.conflict?'data-conflict="true"':'')+'><span class="file-status" aria-label="'+status.label+'">'+status.code+'</span><span class="file-name">'+esc(name)+'</span><span class="file-path">'+esc((state.fileMode==='flat'?f.path:folder)+old)+'</span><span class="file-stat"><span class="file-add">+'+f.additions+'</span><span class="file-del">−'+f.deletions+'</span></span></div>'}
function fileTree(files){const root={folders:new Map(),files:[]};for(const file of files){let node=root;const parts=file.path.split('/');for(const folder of parts.slice(0,-1)){if(!node.folders.has(folder))node.folders.set(folder,{folders:new Map(),files:[]});node=node.folders.get(folder)}node.files.push(file)}return root}
function renderFileNode(node,prefix='',depth=0,working=false){let html='';for(const [name,child] of [...node.folders].sort(([a],[b])=>a.localeCompare(b))){const key=prefix?prefix+'/'+name:name,closed=state.fileCollapsed.has(key);state.fileFolders.add(key);html+='<div class="item folder file-folder" style="padding-left:'+(8+depth*14)+'px" data-file-folder="'+esc(key)+'"><span class="ref-icon">'+(closed?'▸':'▾')+'</span>'+esc(name)+'</div>';if(!closed)html+=renderFileNode(child,key,depth+1,working)}html+=node.files.sort((a,b)=>a.path.localeCompare(b.path)).map(f=>fileRow(f,depth,working)).join('');return html}
function renderFiles(files,working=false){state.visibleFiles=files;state.visibleFilesWorking=working;state.fileFolders.clear();const additions=files.reduce((sum,f)=>sum+f.additions,0),deletions=files.reduce((sum,f)=>sum+f.deletions,0);$('fileSummary').innerHTML='<span class="summary-count">'+files.length+'</span><span class="summary-add">+'+additions+'</span><span class="summary-del">−'+deletions+'</span>';$('treeMode').classList.toggle('active',state.fileMode==='tree');$('listMode').classList.toggle('active',state.fileMode==='flat');if(state.fileMode==='flat'){$('files').innerHTML=files.map(f=>fileRow(f,0,working)).join('');return}$('files').innerHTML=renderFileNode(fileTree(files),'',0,working)}
function renderDetail(){const d=state.detail;if(!d)return;const lines=String(d.message||d.subject).split(/\\r?\\n/),body=lines.slice(1).join('\\n').trim(),signature=d.signature==='good'?'✓ Verified':d.signature==='bad'?'⚠ Invalid signature':'';$('detail').innerHTML='<div class="detail-title">'+esc(d.subject)+'</div><div class="detail-meta-line"><span>'+esc(d.shortHash)+'</span><span>♙ '+esc(d.author)+'</span><span title="'+esc(date(d.authorTimestamp))+'">'+commitAge(d.authorTimestamp)+'</span>'+(signature?'<span>'+esc(signature)+'</span>':'')+'</div>'+(body?'<div class="detail-subject-body">'+esc(body)+'</div>':'')+'<div class="detail-icon-actions"><button data-copy-detail="'+esc(d.hash)+'" title="Copy hash">⧉</button><button data-copy-detail="'+esc(d.message)+'" title="Copy message">≡</button>'+(d.parents.length?'<button data-parent="'+d.parents[0]+'" title="Open parent commit">⑂</button>':'')+'<button data-detail-menu="'+esc(d.hash)+'" title="More commit actions">•••</button></div>';const parent=$('parentMode');parent.style.display=d.parents.length>1?'inline-block':'none';parent.innerHTML=d.parents.map((p,i)=>'<option value="'+(i+1)+'">Parent '+(i+1)+'</option>').join('')+(d.parents.length>1?'<option value="combined">Combined</option>':'');renderFiles(d.files)}
const renderInlineDiff=()=>renderDetail()
function filter(){return{text:$('textFilter').value||undefined,author:$('authorFilter').value||undefined,path:$('pathFilter').value||undefined,since:$('sinceFilter').value||undefined,until:$('untilFilter').value||undefined,refs:state.selectedRef?[state.selectedRef]:undefined,regex:$('regex').checked,matchCase:$('case').checked}}
function loadFiltered(){state.generation++;state.commits=[];state.commitIndexes.clear();state.graphMaxColumn=0;state.total=0;state.loading.clear();state.loading.add(0);renderFilterChips();renderRows();send('loadLog',{offset:0,generation:state.generation,filter:filter()})}function clearFilters(){for(const id of ['textFilter','authorFilter','pathFilter','sinceFilter','untilFilter'])$(id).value='';state.selectedRef=undefined;$('regex').checked=$('case').checked=false;renderBranches();loadFiltered()}function debounce(callback,delay){let timer;return()=>{clearTimeout(timer);timer=setTimeout(callback,delay)}}const loadFilteredDebounced=debounce(loadFiltered,300);for(const id of ['textFilter','authorFilter','pathFilter','sinceFilter','untilFilter'])$(id).oninput=loadFilteredDebounced;$('regex').onchange=$('case').onchange=loadFiltered;$('clear').onclick=clearFilters;$('toggleFilters').onclick=()=>{const expanded=$('filters').classList.toggle('expanded');$('toggleFilters').setAttribute('aria-expanded',String(expanded))};$('filterChips').onclick=e=>{const chip=e.target.closest('[data-clear-filter]');if(!chip)return;const id=chip.dataset.clearFilter;if(id==='ref')state.selectedRef=undefined;else if(id==='regex'||id==='case')$(id).checked=false;else $(id).value='';renderBranches();loadFiltered()};
let scrollFrame;$('viewport').onscroll=()=>{if(scrollFrame)return;$('contextMenu').style.display='none';scrollFrame=requestAnimationFrame(()=>{scrollFrame=undefined;renderRows()})};$('viewport').onclick=e=>{const copy=e.target.closest('[data-row-copy]');if(copy){e.stopPropagation();send('copyText',{ref:copy.dataset.rowCopy});return}const menu=e.target.closest('[data-row-menu]');if(menu){e.stopPropagation();const index=Number(menu.dataset.rowMenu),c=state.commits[index],rect=menu.getBoundingClientRect();requestContext({x:rect.right,y:rect.bottom,kind:'commit',hash:c.hash,ref:c.hash,hashes:[c.hash]});return}const row=e.target.closest('.row');if(!row)return;state.selected=Number(row.dataset.index);const hash=state.commits[state.selected].hash;if(state.repository?.root)localStorage.setItem('gitLog.selected.'+state.repository.root,hash);if(e.shiftKey&&state.selectionAnchor>=0){state.selectedHashes.clear();const from=Math.min(state.selectionAnchor,state.selected),to=Math.max(state.selectionAnchor,state.selected);for(let i=from;i<=to;i++)if(state.commits[i])state.selectedHashes.add(state.commits[i].hash)}else if(e.ctrlKey||e.metaKey){state.selectionAnchor=state.selected;state.selectedHashes.has(hash)?state.selectedHashes.delete(hash):state.selectedHashes.add(hash)}else{state.selectionAnchor=state.selected;state.selectedHashes.clear();state.selectedHashes.add(hash)}send('detail',{hash,generation:state.generation});refreshSelection()};$('viewport').oncontextmenu=e=>{e.preventDefault();const row=e.target.closest('.row');if(row){const index=Number(row.dataset.index),c=state.commits[index];if(!state.selectedHashes.has(c.hash)){state.selected=index;state.selectionAnchor=index;state.selectedHashes=new Set([c.hash]);refreshSelection()}const hashes=state.commits.map(c=>c?.hash).filter(hash=>hash&&state.selectedHashes.has(hash)).reverse();requestContext({x:e.clientX,y:e.clientY,kind:hashes.length>1?'commits':'commit',hash:c.hash,ref:c.hash,hashes})}};
$('files').ondblclick=e=>{const f=e.target.closest('.file');if(!f)return;f.dataset.working?send('workingDiff',{path:f.dataset.path}):state.detail&&send('diff',{hash:state.detail.hash,path:f.dataset.path,parent:Number($('parentMode').value)||1})};$('files').oncontextmenu=e=>{e.preventDefault();const f=e.target.closest('.file');if(f)requestContext({x:e.clientX,y:e.clientY,kind:f.dataset.working?'workingFile':'commitFile',hash:state.detail?.hash,path:f.dataset.path,parent:Number($('parentMode').value)||1})};$('branchSearch').oninput=renderBranches;$('branches').onclick=e=>{const item=e.target.closest('.item');if(!item)return;if(item.dataset.ref){state.selectedRef=item.dataset.ref;renderBranches();loadFiltered()}else if(item.dataset.hash)send('detail',{hash:item.dataset.hash})};$('branches').oncontextmenu=e=>{e.preventDefault();const item=e.target.closest('.item');if(item)requestContext({x:e.clientX,y:e.clientY,kind:item.dataset.kind,ref:item.dataset.ref,hash:item.dataset.hash,path:item.dataset.path,current:item.classList.contains('active')})};$('goto').onkeydown=e=>{if(e.key==='Enter'&&e.target.value)send('detail',{hash:e.target.value})};$('refresh').onclick=()=>send('refresh');for(const b of document.querySelectorAll('[data-action]'))b.onclick=()=>{if(!state.busy)send('mutate',{action:b.dataset.action})};for(const b of document.querySelectorAll('[data-conflict]'))b.onclick=()=>{if(!state.busy)send('mutate',{action:b.dataset.conflict,operation:state.repository?.operation})};$('repo').onchange=()=>send('selectRepo',{root:$('repo').value});
$('files').addEventListener('click',e=>{const f=e.target.closest('.file[data-conflict]');if(f)send('openConflict',{path:f.dataset.path})});
$('files').addEventListener('click',e=>{const file=e.target.closest('.file');if(!file)return;for(const row of $('files').querySelectorAll('.file.selected'))row.classList.remove('selected');file.classList.add('selected')});
$('files').addEventListener('click',e=>{const folder=e.target.closest('[data-file-folder]');if(!folder)return;const key=folder.dataset.fileFolder;state.fileCollapsed.has(key)?state.fileCollapsed.delete(key):state.fileCollapsed.add(key);localStorage.setItem('gitLog.fileCollapsed',JSON.stringify([...state.fileCollapsed]));renderFiles(state.visibleFiles,state.visibleFilesWorking)});
$('branchTrigger').onclick=()=>$('branchPicker').classList.contains('open')?closeBranchPicker():openBranchPicker();$('branchPickerSearch').oninput=renderBranchPicker;$('branchPickerItems').onclick=e=>{const item=e.target.closest('[data-picker-ref]');if(!item||state.busy)return;const ref=item.dataset.pickerRef,kind=item.dataset.pickerKind;if(kind==='local'){state.recentBranches=[ref,...state.recentBranches.filter(x=>x!==ref)].slice(0,6);localStorage.setItem('gitLog.recentBranches',JSON.stringify(state.recentBranches));send('mutate',{action:'checkout',ref})}else send('mutate',{action:'checkoutRemote',ref});closeBranchPicker()};
$('detail').addEventListener('click',e=>{const parent=e.target.closest('[data-parent]');if(parent)send('detail',{hash:parent.dataset.parent});const copy=e.target.closest('[data-copy-detail]');if(copy)send('copyText',{ref:copy.dataset.copyDetail});const menu=e.target.closest('[data-detail-menu]');if(menu){const rect=menu.getBoundingClientRect();requestContext({x:rect.right,y:rect.bottom,kind:'commit',hash:menu.dataset.detailMenu,ref:menu.dataset.detailMenu,hashes:[menu.dataset.detailMenu]})}});
$('branches').addEventListener('click',e=>{const star=e.target.closest('[data-star]');if(star){e.stopPropagation();const ref=star.dataset.star;state.favorites.has(ref)?state.favorites.delete(ref):state.favorites.add(ref);localStorage.setItem('gitLog.favorites',JSON.stringify([...state.favorites]));renderBranches();return}const folder=e.target.closest('[data-folder]');if(folder){e.stopPropagation();const key=folder.dataset.folder;state.collapsed.has(key)?state.collapsed.delete(key):state.collapsed.add(key);localStorage.setItem('gitLog.collapsed',JSON.stringify([...state.collapsed]));renderBranches()}},true);
$('uncommitted').onclick=()=>{renderFiles(state.uncommitted,true);$('detail').innerHTML='<div class="message">Uncommitted changes</div>'};
$('fileMode').textContent=state.fileMode==='tree'?'Tree':'Flat';function setFileMode(mode){state.fileMode=mode;localStorage.setItem('gitLog.fileMode',mode);$('fileMode').textContent=mode==='tree'?'Tree':'Flat';renderFiles(state.visibleFiles,state.visibleFilesWorking)}$('fileMode').onclick=()=>setFileMode(state.fileMode==='tree'?'flat':'tree');$('treeMode').onclick=()=>setFileMode('tree');$('listMode').onclick=()=>setFileMode('flat');$('parentMode').onchange=e=>{if(state.detail)send('detail',{hash:state.detail.hash,parent:e.target.value==='combined'?0:Number(e.target.value)})};
$('collapseFiles').onclick=()=>{state.fileCollapsed=new Set(state.fileFolders);localStorage.setItem('gitLog.fileCollapsed',JSON.stringify([...state.fileCollapsed]));renderFiles(state.visibleFiles,state.visibleFilesWorking)};$('expandFiles').onclick=()=>{state.fileCollapsed.clear();localStorage.setItem('gitLog.fileCollapsed','[]');renderFiles(state.visibleFiles,state.visibleFilesWorking)};
$('viewOptions').onclick=e=>{e.stopPropagation();const open=$('columnMenu').classList.toggle('open');$('viewOptions').setAttribute('aria-expanded',String(open));if(open)positionColumnMenu()};
function closeColumnMenu(){$('columnMenu').classList.remove('open');$('toggleColumns').setAttribute('aria-expanded','false')}
function positionColumnMenu(){const button=$('viewOptions'),menu=$('columnMenu'),anchor=button.getBoundingClientRect(),bounds=menu.getBoundingClientRect(),gap=4;menu.style.left=Math.max(gap,Math.min(anchor.right-bounds.width,window.innerWidth-bounds.width-gap))+'px';menu.style.top=Math.max(gap,Math.min(anchor.bottom+gap,window.innerHeight-bounds.height-gap))+'px'}
applyColumnVisibility();$('toggleColumns').onclick=e=>{e.stopPropagation();const open=$('columnMenu').classList.toggle('open');$('toggleColumns').setAttribute('aria-expanded',String(open));if(open)positionColumnMenu()};$('columnMenu').onclick=e=>{e.stopPropagation();const input=e.target.closest('[data-column-toggle]');if(!input)return;const id=input.dataset.columnToggle;if(input.checked)visibleColumns.add(id);else if(visibleColumns.size>1)visibleColumns.delete(id);localStorage.setItem('gitLog.visibleColumns',JSON.stringify([...visibleColumns]));applyColumnVisibility()};for(const handle of document.querySelectorAll('.column-resizer'))handle.onpointerdown=e=>{if(e.button!==0)return;e.preventDefault();e.stopPropagation();const kind=handle.dataset.resize,start=e.clientX,cell=id=>document.querySelector('.header>[data-col="'+id+'"]')?.getBoundingClientRect().width||0,graph=cell('graph'),author=cell('author'),date=cell('date'),center=document.querySelector('.center').clientWidth;let frame,latest=e.clientX;const apply=()=>{frame=undefined;const delta=latest-start;if(kind==='graph')setColumnWidth('graph',Math.max(28,Math.min(center-author-date-120,graph+delta)));else if(kind==='subject')setColumnWidth('author',Math.max(80,Math.min(center-28-date-120,author-delta)));else{const adjusted=Math.max(-(author-80),Math.min(date-105,delta));setColumnWidth('author',author+adjusted);setColumnWidth('date',date-adjusted)}};handle.classList.add('dragging');document.body.classList.add('resizing-columns','resizing');handle.setPointerCapture(e.pointerId);handle.onpointermove=m=>{latest=m.clientX;if(!frame)frame=requestAnimationFrame(apply)};handle.onpointerup=handle.onpointercancel=()=>{if(frame){cancelAnimationFrame(frame);apply()}handle.onpointermove=handle.onpointerup=handle.onpointercancel=null;handle.classList.remove('dragging');document.body.classList.remove('resizing-columns','resizing');saveColumnWidths();const range=visibleRange();renderGraph(range.start,range.end)}};
document.addEventListener('contextmenu',e=>{e.preventDefault();state.contextPoint={x:e.clientX,y:e.clientY}},true);document.addEventListener('click',e=>{if(!e.target.closest('#contextMenu'))$('contextMenu').style.display='none';if(!e.target.closest('#columnMenu,#viewOptions'))closeColumnMenu();if(!e.target.closest('#branchPicker,#branchTrigger'))closeBranchPicker()});window.addEventListener('blur',()=>{$('contextMenu').style.display='none';closeColumnMenu();closeBranchPicker()});window.addEventListener('resize',()=>{if($('columnMenu').classList.contains('open'))positionColumnMenu();if($('branchPicker').classList.contains('open'))openBranchPicker()});document.addEventListener('keydown',e=>{if(e.key==='Escape'){$('contextMenu').style.display='none';closeColumnMenu();closeBranchPicker()}});
function showInlineContextMenu(message){const menu=$('contextMenu'),context=message.context;if(state.busy||context.requestId!==state.contextRequestId)return;state.contextPayload=context;menu.innerHTML=message.actions.map(item=>'<button class="'+contextClass(item.action)+'" role="menuitem" data-context-action="'+esc(item.action)+'">'+esc(item.label)+'</button>').join('');if(!message.actions.length)return;menu.style.display='block';menu.style.left='0';menu.style.top='0';const point={x:context.x??state.contextPoint?.x??0,y:context.y??state.contextPoint?.y??0},rect=menu.getBoundingClientRect();menu.style.left=Math.max(4,Math.min(point.x,window.innerWidth-rect.width-4))+'px';menu.style.top=Math.max(4,Math.min(point.y,window.innerHeight-rect.height-4))+'px';menu.querySelector('button')?.focus()}
function showRebasePlan(plan){state.rebasePlan=plan;$('rebaseRows').innerHTML=plan.map((item,index)=>'<div class="rebase-row" data-rebase-index="'+index+'"><select><option>pick</option><option>reword</option><option>squash</option><option>fixup</option><option>drop</option></select><input value="'+esc(item.subject)+'" title="Message used by reword"><span><button data-move="up">↑</button><button data-move="down">↓</button></span></div>').join('');$('rebaseModal').classList.add('open')}
function readRebasePlan(){return [...$('rebaseRows').children].map(row=>{const original=state.rebasePlan[Number(row.dataset.rebaseIndex)];return{...original,action:row.querySelector('select').value,message:row.querySelector('input').value}})}
$('rebaseRows').onclick=e=>{const button=e.target.closest('[data-move]');if(!button)return;const row=button.closest('.rebase-row'),sibling=button.dataset.move==='up'?row.previousElementSibling:row.nextElementSibling;if(sibling)button.dataset.move==='up'?row.parentNode.insertBefore(row,sibling):row.parentNode.insertBefore(sibling,row)};$('cancelRebase').onclick=()=>$('rebaseModal').classList.remove('open');$('runRebase').onclick=()=>{const plan=readRebasePlan();$('rebaseModal').classList.remove('open');send('interactiveRebase',{plan})};
$('contextMenu').onclick=e=>{const button=e.target.closest('[data-context-action]');if(!button||state.busy)return;button.disabled=true;const {type,...context}=state.contextPayload;send('contextAction',{...context,action:button.dataset.contextAction});$('contextMenu').style.display='none'};window.addEventListener('message',e=>{const m=e.data;if(m.type==='contextMenu')showInlineContextMenu(m);if(m.type==='busy'&&m.busy)$('contextMenu').style.display='none';if(m.type==='state'&&m.repository?.operation)setTimeout(()=>{const conflicts=m.uncommitted.filter(file=>file.conflict);$('operation').textContent=m.repository.operation+' · '+conflicts.length+' unresolved';document.querySelector('[data-conflict="continue"]').disabled=conflicts.length>0;document.querySelector('[data-conflict="skip"]').style.display=/REBAS|CHERRY/.test(m.repository.operation)?'inline-block':'none'},0)},true);
for(const split of document.querySelectorAll('.split'))split.onmousedown=e=>{const side=split.dataset.side,start=e.clientX,layout=$('layout'),initial=side==='left'?layout.children[0].offsetWidth:layout.children[4].offsetWidth;let frame,latest=start,value=initial;document.body.classList.add('resizing');const apply=()=>{frame=undefined;value=Math.max(140,initial+(side==='left'?latest-start:start-latest));layout.style.setProperty('--'+side,value+'px')};document.onmousemove=m=>{latest=m.clientX;if(!frame)frame=requestAnimationFrame(apply)};document.onmouseup=()=>{if(frame){cancelAnimationFrame(frame);apply()}localStorage.setItem('gitLog.'+side,String(value));document.body.classList.remove('resizing');document.onmousemove=document.onmouseup=null;const range=visibleRange();renderGraph(range.start,range.end)}};for(const side of ['left','right']){const v=localStorage.getItem('gitLog.'+side);if(v)$('layout').style.setProperty('--'+side,v+'px')}
function detailHeightKey(){return'gitLog.detailHeight.'+(state.repository?.root||'default')}function restoreDetailHeight(){const saved=localStorage.getItem(detailHeightKey())||localStorage.getItem('gitLog.detailHeight');if(saved)$('rightPane').style.setProperty('--detail-height',saved+'px')}$('rightSplit').title='Drag to resize · Double-click to reset';$('rightSplit').onmousedown=e=>{const pane=$('rightPane'),handle=$('rightSplit'),start=e.clientY,initial=$('detail').offsetHeight;let frame,latest=start,height=initial;document.body.classList.add('resizing');handle.classList.add('dragging');const apply=()=>{frame=undefined;height=Math.max(110,Math.min(pane.clientHeight-110,initial+latest-start));pane.style.setProperty('--detail-height',height+'px')};document.onmousemove=m=>{latest=m.clientY;if(!frame)frame=requestAnimationFrame(apply)};document.onmouseup=()=>{if(frame){cancelAnimationFrame(frame);apply()}localStorage.setItem(detailHeightKey(),String(height));document.body.classList.remove('resizing');handle.classList.remove('dragging');document.onmousemove=document.onmouseup=null;const range=visibleRange();renderGraph(range.start,range.end)}};$('rightSplit').ondblclick=()=>{$('rightPane').style.removeProperty('--detail-height');localStorage.removeItem(detailHeightKey())};for(const tab of document.querySelectorAll('[data-right-tab]'))tab.onclick=()=>{$('rightPane').classList.toggle('mobile-files',tab.dataset.rightTab==='files');$('rightPane').classList.toggle('mobile-detail',tab.dataset.rightTab==='detail')};
window.onmessage=e=>{const m=e.data;if(m.type==='rebasePlan')showRebasePlan(m.plan);else if(m.type==='inlineDiff')renderInlineDiff(m.diff);else if(m.type==='selectRef'){state.selectedRef=m.ref;renderBranches();loadFiltered()}else if(m.type==='state'){state={...state,...m,commits:m.log?.commits??[],total:m.log?.total??0};state.commits.length=state.total;indexCommits(m.log?.commits??[],0,true);$('repo').style.display=m.repositories.length>1?'block':'none';$('repo').innerHTML=m.repositories.map(root=>'<option value="'+esc(root)+'" '+(root===m.repository?.root?'selected':'')+'>'+esc(pathBase(root))+'</option>').join('');const r=m.repository,current=r?.refs.find(x=>x.current);restoreDetailHeight();$('branchName').textContent=r?.detached?'Detached HEAD':r?.head||'No branch';$('branchLock').classList.toggle('visible',!!r&&!r.detached&&protectedBranch(r.head));if(current){state.recentBranches=[current.name,...state.recentBranches.filter(x=>x!==current.name)].slice(0,6);localStorage.setItem('gitLog.recentBranches',JSON.stringify(state.recentBranches))}renderStatusBadges();$('uncommitted').style.display=state.uncommitted.length?'grid':'none';$('banner').style.display=r?.operation?'block':'none';$('operation').textContent=r?.operation??'';renderBranches();renderBranchPicker();renderFilterChips();const saved=r&&localStorage.getItem('gitLog.selected.'+r.root),selectedIndex=saved?state.commits.findIndex(c=>c?.hash===saved):-1;state.selected=selectedIndex>=0?selectedIndex:(state.commits[0]?0:-1);state.selectionAnchor=state.selected;state.selectedHashes=new Set(state.selected>=0?[state.commits[state.selected].hash]:[]);renderRows();if(state.selected>=0)send('detail',{hash:state.commits[state.selected].hash,generation:state.generation});else{$('detail').innerHTML='<div class="empty">Select a commit</div>';renderFiles([])}if(r?.operation){$('files').innerHTML=state.uncommitted.filter(f=>f.conflict).map(f=>fileRow(f,0,true)).join('')}}else if(m.type==='log'){state.total=m.log.total;if(state.commits.length!==state.total)state.commits.length=state.total;state.commits.splice(m.log.offset,m.log.commits.length,...m.log.commits);indexCommits(m.log.commits,m.log.offset);state.loading.delete(m.log.offset);renderRows()}else if(m.type==='detail'){state.detail=m.detail;renderDetail()}else if(m.type==='compareFiles'){renderFiles(m.files);$('detail').innerHTML='<div class="detail-title">Compare commits</div><div class="detail-meta-line"><span>'+esc(m.from)+'</span><span>↔</span><span>'+esc(m.to)+'</span></div><div class="detail-subject-body">'+(m.onlyCurrent?m.onlyCurrent.length+' commit(s) only in current · '+m.onlySelected.length+' only in selected · ':'')+m.files.length+' changed file(s)</div>'}};send('ready');
</script></body></html>`;
}
