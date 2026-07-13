import * as path from 'path';
import * as vscode from 'vscode';
import { GitLogFilter, GitRebasePlanItem } from './gitPanelModels';
import { GitRepositoryService } from './gitRepositoryService';
import { revisionUri } from './gitRevisionProvider';
import { GitMutationRunner } from './gitMutationRunner';
import { GitMutationRequest } from './gitPanelModels';
import { CoalescedRefreshRunner, GitReadChannel, GitRequestCoordinator, GitRequestIdentity, InFlightOperationGuard } from './gitPanelCoordinator';
import { classifyGitError } from './gitErrorRecovery';
import { MutationBusyTracker, runMutationLifecycle } from './gitMutationLifecycle';

interface WebviewMessage { type: string; root?: string; hash?: string; hashes?: string[]; path?: string; ref?: string; action?: string; kind?: string; operation?: string; parent?: number; offset?: number; x?: number; y?: number; requestId?: number; generation?: number; filter?: GitLogFilter; plan?: GitRebasePlanItem[]; allowPublished?: boolean; }

export class GitLogViewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  static readonly viewId = 'dotnetSolutionNavigator.gitLog';
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
        this.post({ type: 'state', repositories, repository, log, uncommitted, generation: read.identity.generation, identity: read.identity });
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
      if (message.type === 'inlineDiff' && message.path) {
        const root = this.root;
        const diff = await this.service.inlineDiff(root, message.hash, message.path, message.parent);
        if (this.root === root) this.post({ type: 'inlineDiff', diff });
        return;
      }
      if (message.type === 'copyText' && message.ref !== undefined) return await vscode.env.clipboard.writeText(message.ref);
      if (message.type === 'interactiveRebase' && message.plan) {
        const request = await this.prepareInteractiveRebase(message.plan, message.allowPublished === true);
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
        this.post({ type: 'contextMenu', actions: contextActions(message.kind), context: { ...message, root: this.root } });
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
    try {
      await runMutationLifecycle(
        async () => { await this.mutations.run(root, request); },
        async () => { if (this.root === root && this.mutationBusy.pending(root) === 1) await this.refresh(); },
        error => { if (!(error instanceof vscode.CancellationError)) console.error(error); }
      );
    } finally {
      this.activeMutations.leave(mutationKey);
      this.lastInternalMutationAt = Date.now();
      if (this.mutationBusy.end(root) === 0) this.post({ type: 'busy', busy: false, repositoryId: root });
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

  private async prepareInteractiveRebase(plan: GitRebasePlanItem[], allowPublished: boolean): Promise<GitMutationRequest | undefined> {
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
    if (published.length && !allowPublished) {
      const choice = await vscode.window.showWarningMessage(
        `${published.length} selected commit(s) already exist on the upstream branch. Rebase would rewrite published history and may require a manual force-with-lease push.`,
        { modal: true }, 'Allow Published Rebase');
      if (choice !== 'Allow Published Rebase') return undefined;
    }
    const snapshot = await this.service.snapshot(this.root);
    if (snapshot.changedCount) throw new Error('Commit or stash working tree changes before interactive rebase.');
    const backup = await vscode.window.showWarningMessage(
      `Preview: rewrite ${plan.length} commit(s) on ${snapshot.head}. No force-push will be performed.`,
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
  return [];
}

function renderHtml(webview: vscode.Webview): string {
  const nonce = Math.random().toString(36).slice(2);
  return `<!doctype html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'">
<style>
*{box-sizing:border-box}body{margin:0;color:var(--vscode-foreground);background:var(--vscode-panel-background);font:var(--vscode-font-size) var(--vscode-font-family);overflow:hidden}button,input,select{font:inherit;color:inherit;background:var(--vscode-input-background);border:1px solid var(--vscode-input-border);height:26px}button{cursor:pointer}.toolbar{min-height:34px;display:flex;gap:4px;align-items:center;padding:4px;border-bottom:1px solid var(--vscode-panel-border);overflow-x:auto}.toolbar .grow{flex:1}.layout{height:calc(100vh - 34px);display:grid;grid-template-columns:var(--left,220px) 4px minmax(320px,1fr) 4px var(--right,330px)}.split{background:var(--vscode-panel-border);cursor:col-resize}.pane{min-width:0;overflow:hidden}.branches,.right{display:flex;flex-direction:column}.heading{min-height:30px;padding:4px 9px;font-weight:600;border-bottom:1px solid var(--vscode-panel-border)}#branchSearch{margin:5px;width:calc(100% - 10px)}#branches,#files{overflow:auto;flex:1;padding:3px 0}.group{padding:7px 8px 3px;color:var(--vscode-descriptionForeground);font-size:11px;text-transform:uppercase}.item{height:24px;padding:4px 8px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:default}.item:hover,.row:hover{background:var(--vscode-list-hoverBackground)}.item.active{font-weight:600;color:var(--vscode-gitDecoration-addedResourceForeground)}.badge{float:right;color:var(--vscode-descriptionForeground)}.center{display:flex;flex-direction:column}.filters{min-height:64px;padding:4px;display:grid;grid-template-columns:minmax(110px,1.4fr) minmax(90px,1fr) minmax(110px,1.2fr) 118px 118px minmax(110px,1fr);grid-template-rows:26px 26px;gap:4px;border-bottom:1px solid var(--vscode-panel-border)}.filters>input{min-width:0}.filters label{display:flex;align-items:center;gap:4px;height:26px;white-space:nowrap}.filters label input{width:16px;height:16px}.filters label:first-of-type{grid-column:1}.filters label:nth-of-type(2){grid-column:2}.filters #clear{grid-column:6;grid-row:2;justify-self:end}.header,.row{display:grid;grid-template-columns:minmax(70px,auto) minmax(180px,1fr) minmax(90px,130px) minmax(100px,145px);align-items:center}.header{height:25px;color:var(--vscode-descriptionForeground);border-bottom:1px solid var(--vscode-panel-border)}.header>*{padding:0 7px}.viewport{position:relative;overflow:auto;flex:1}.spacer{position:relative}.row{position:absolute;left:0;right:0;height:28px;border-bottom:1px solid color-mix(in srgb,var(--vscode-panel-border) 45%,transparent)}.row>*{padding:0 7px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.row.selected{background:var(--vscode-list-activeSelectionBackground);color:var(--vscode-list-activeSelectionForeground)}.graph{font-family:monospace;color:var(--vscode-gitDecoration-modifiedResourceForeground);overflow:visible}.refs{color:var(--vscode-badge-foreground);background:var(--vscode-badge-background);padding:1px 4px;margin-left:6px}.right{border-left:0}.detail{height:44%;min-height:90px;border-top:1px solid var(--vscode-panel-border);overflow:auto;padding:9px}.file{display:grid;grid-template-columns:18px minmax(0,1fr) auto;gap:5px;padding:5px 8px;cursor:default}.file span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.file .stat{color:var(--vscode-descriptionForeground)}.message{font-weight:600;white-space:pre-wrap}.meta{margin-top:7px;color:var(--vscode-descriptionForeground);word-break:break-all}.empty{padding:14px;color:var(--vscode-descriptionForeground)}.banner{display:none;padding:6px 9px;background:var(--vscode-inputValidation-warningBackground);border-bottom:1px solid var(--vscode-inputValidation-warningBorder)}.context-menu{position:fixed;z-index:1000;display:none;min-width:220px;max-width:360px;padding:4px;background:var(--vscode-menu-background);color:var(--vscode-menu-foreground);border:1px solid var(--vscode-menu-border);box-shadow:0 4px 14px rgba(0,0,0,.35)}.context-menu button{display:block;width:100%;height:26px;padding:3px 8px;text-align:left;border:0;background:transparent;color:inherit}.context-menu button:hover,.context-menu button:focus{background:var(--vscode-menu-selectionBackground);color:var(--vscode-menu-selectionForeground);outline:none}@media(max-width:900px){.header,.row{grid-template-columns:minmax(64px,auto) minmax(160px,1fr) minmax(90px,120px)}.header>:nth-child(4),.row>:nth-child(4){display:none}.filters{grid-template-columns:repeat(3,minmax(100px,1fr));grid-template-rows:repeat(3,26px);min-height:94px}.filters #clear{grid-column:3;grid-row:3}}@media(max-width:700px){.header,.row{grid-template-columns:minmax(60px,auto) minmax(150px,1fr)}.header>:nth-child(3),.row>:nth-child(3){display:none}.layout{grid-template-columns:var(--left,180px) 4px minmax(260px,1fr) 4px var(--right,260px)}}
.header,.row{grid-template-columns:var(--graph-width,70px) minmax(180px,1fr) minmax(90px,130px) minmax(100px,145px)}.graph-overlay{position:absolute;inset:0 auto auto 0;z-index:3;pointer-events:none;overflow:visible}.toast{display:none;position:fixed;z-index:900;right:12px;bottom:12px;max-width:min(520px,calc(100vw - 24px));padding:8px 10px;background:var(--vscode-inputValidation-errorBackground);border:1px solid var(--vscode-inputValidation-errorBorder);white-space:pre-wrap}.busy .toolbar [data-action],.busy #repo,.busy .context-menu{pointer-events:none;opacity:.5}.row.loading span:nth-child(2){width:45%;height:8px;background:var(--vscode-editorWidget-border);opacity:.45}.row.multi:not(.selected){background:var(--vscode-list-inactiveSelectionBackground)}
.toolbar{min-height:38px;padding:5px 8px;gap:2px;background:var(--vscode-sideBar-background)}.toolbar button{border-color:transparent;background:transparent;padding:0 8px}.toolbar button:hover{background:var(--vscode-toolbar-hoverBackground);border-color:var(--vscode-contrastBorder,transparent)}.toolbar button:focus-visible,.item:focus-visible,.row:focus-visible{outline:1px solid var(--vscode-focusBorder);outline-offset:-1px}.toolbar [data-action="update"],.toolbar [data-action="createBranch"]{margin-left:5px;border-left-color:var(--vscode-panel-border)}#status{margin-left:8px;color:var(--vscode-descriptionForeground);white-space:nowrap}.layout{height:calc(100vh - 38px);background:var(--vscode-editor-background)}.pane{background:var(--vscode-sideBar-background)}.center{background:var(--vscode-editor-background)}.split{background:transparent;border-left:1px solid var(--vscode-panel-border)}.split:hover{background:var(--vscode-sash-hoverBorder)}.heading{display:flex;align-items:center;gap:4px;height:32px;padding:0 8px;color:var(--vscode-sideBarSectionHeader-foreground);background:var(--vscode-sideBarSectionHeader-background);font-size:11px;letter-spacing:0;font-weight:600}.heading .heading-title{margin-right:auto}.heading button{width:25px;padding:0;border-color:transparent;background:transparent}.heading button:hover{background:var(--vscode-toolbar-hoverBackground)}#branchSearch{height:28px;margin:7px;width:calc(100% - 14px);padding:0 8px}.group{padding:10px 10px 4px;font-size:10px;font-weight:600;letter-spacing:0;color:var(--vscode-sideBarSectionHeader-foreground)}.item{height:26px;padding-top:5px;padding-bottom:5px;border-left:2px solid transparent}.item:hover{background:var(--vscode-list-hoverBackground)}.item.active{color:var(--vscode-foreground);background:color-mix(in srgb,var(--vscode-list-activeSelectionBackground) 45%,transparent);border-left-color:var(--vscode-focusBorder)}.ref-icon{display:inline-block;width:16px;text-align:center;color:var(--vscode-descriptionForeground)}.item[data-kind="local"] .ref-icon{color:var(--vscode-gitDecoration-modifiedResourceForeground)}.item[data-kind="remote"] .ref-icon{color:var(--vscode-charts-blue)}.item[data-kind="tag"] .ref-icon{color:var(--vscode-charts-yellow)}.item[data-kind="stash"] .ref-icon{color:var(--vscode-charts-purple)}.badge{display:inline-flex;gap:3px;float:right;padding:0 4px;color:var(--vscode-badge-foreground);background:var(--vscode-badge-background);font-size:10px}.filters{padding:6px 7px;gap:5px;background:var(--vscode-editorGroupHeader-tabsBackground)}.filters input{padding:0 7px}.header{height:27px;background:var(--vscode-editorGroupHeader-tabsBackground);font-size:11px}.row{height:28px;border-bottom-color:color-mix(in srgb,var(--vscode-panel-border) 28%,transparent)}.row:hover{background:var(--vscode-list-hoverBackground)}.row.selected{background:var(--vscode-list-activeSelectionBackground);color:var(--vscode-list-activeSelectionForeground)}.refs{display:inline-flex;align-items:center;max-width:190px;height:18px;border-radius:2px;padding:0 5px;font-size:11px;font-weight:500}.ref-head{color:var(--vscode-badge-foreground);background:var(--vscode-badge-background)}.ref-local{color:var(--vscode-gitDecoration-modifiedResourceForeground);background:color-mix(in srgb,var(--vscode-gitDecoration-modifiedResourceForeground) 15%,transparent)}.ref-remote{color:var(--vscode-charts-blue);background:color-mix(in srgb,var(--vscode-charts-blue) 15%,transparent)}.ref-tag{color:var(--vscode-charts-yellow);background:color-mix(in srgb,var(--vscode-charts-yellow) 14%,transparent)}#files{padding:0}.file{grid-template-columns:24px minmax(70px,auto) minmax(0,1fr) auto;align-items:center;min-height:28px;padding-top:4px;padding-bottom:4px;border-left:2px solid transparent}.file:hover{background:var(--vscode-list-hoverBackground);border-left-color:var(--file-color)}.file-status{display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;color:var(--file-color);font-size:11px;font-weight:700}.file-name{color:var(--vscode-foreground);font-weight:500}.file-path{color:var(--vscode-descriptionForeground);font-size:11px}.file-stat{display:flex;gap:5px;font-variant-numeric:tabular-nums}.file-add{color:var(--vscode-gitDecoration-addedResourceForeground)}.file-del{color:var(--vscode-gitDecoration-deletedResourceForeground)}.status-a,.status-u{--file-color:var(--vscode-gitDecoration-addedResourceForeground)}.status-m{--file-color:var(--vscode-gitDecoration-modifiedResourceForeground)}.status-d{--file-color:var(--vscode-gitDecoration-deletedResourceForeground)}.status-r,.status-c{--file-color:var(--vscode-gitDecoration-renamedResourceForeground,var(--vscode-charts-blue))}.status-conflict{--file-color:var(--vscode-gitDecoration-conflictingResourceForeground,var(--vscode-errorForeground))}.file-folder{font-weight:500;color:var(--vscode-foreground)}.right-split{height:5px;flex:0 0 5px;cursor:row-resize;border-top:1px solid var(--vscode-panel-border)}.right-split:hover{background:var(--vscode-sash-hoverBorder)}.detail{height:var(--detail-height,42%);flex:0 0 var(--detail-height,42%);min-height:90px;padding:10px 12px;background:var(--vscode-editor-background)}.message{font-size:13px;line-height:1.4}.meta{line-height:1.55}.right-tabs{display:none;margin-left:auto}.empty{text-align:center;padding:24px 12px}
@media(max-width:900px){.header,.row{grid-template-columns:var(--graph-width,64px) minmax(160px,1fr) minmax(90px,120px)}}@media(max-width:700px){.header,.row{grid-template-columns:var(--graph-width,60px) minmax(150px,1fr)}}
.file.selected{background:var(--vscode-list-activeSelectionBackground);color:var(--vscode-list-activeSelectionForeground);border-left-color:var(--file-color)}.file.selected .file-name,.file.selected .file-path{color:inherit}@media(max-width:760px){.right-tabs{display:inline-flex}.right.mobile-files .detail,.right.mobile-files .right-split{display:none}.right.mobile-detail #files,.right.mobile-detail .right-split{display:none}.right.mobile-detail .detail{display:block;flex:1;height:auto}.layout{grid-template-columns:var(--left,170px) 3px minmax(260px,1fr) 3px var(--right,250px)}}
.context-menu button{height:27px;padding:3px 9px}.context-menu button.danger{color:var(--vscode-errorForeground)}
.ref-shape{display:inline-block;width:7px;height:7px;border:1.5px solid currentColor;border-radius:50%}.item.active .ref-shape{background:currentColor;box-shadow:0 0 0 2px color-mix(in srgb,currentColor 20%,transparent)}.item[data-kind="remote"] .ref-shape{width:9px;height:6px;border-radius:2px;background:linear-gradient(90deg,currentColor 0 2px,transparent 2px 4px,currentColor 4px 6px,transparent 6px)}.item[data-kind="tag"] .ref-shape{border-radius:1px;transform:rotate(45deg)}.toast{width:min(480px,calc(100vw - 24px));max-height:min(320px,calc(100vh - 24px));overflow:auto;padding:12px 36px 12px 13px;border-radius:3px;box-shadow:0 6px 22px rgba(0,0,0,.35)}.toast-close{position:absolute;right:6px;top:6px;width:24px;height:24px;padding:0;border:0;background:transparent;font-size:18px}.toast strong{display:block;margin-bottom:5px}.toast #toastMessage{line-height:1.4}.toast-actions{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px}.toast-actions button{height:27px;padding:0 9px}.toast details{margin-top:9px;color:var(--vscode-descriptionForeground)}.toast pre{max-height:130px;overflow:auto;white-space:pre-wrap;font:11px var(--vscode-editor-font-family);margin:6px 0 0}.toast.recovery{background:var(--vscode-inputValidation-warningBackground);border-color:var(--vscode-inputValidation-warningBorder)}
.item.viewing{background:var(--vscode-list-inactiveSelectionBackground);box-shadow:inset -2px 0 var(--vscode-focusBorder)}.item.viewing:not(.active){color:var(--vscode-list-inactiveSelectionForeground,var(--vscode-foreground))}.item.active.viewing{box-shadow:inset -2px 0 var(--vscode-focusBorder)}
.repo-badges{display:flex;gap:5px;margin-left:7px}.repo-badge,.filter-chip{height:22px;padding:2px 7px;border-radius:10px;border:1px solid var(--vscode-panel-border);color:var(--vscode-descriptionForeground);background:var(--vscode-editor-background);white-space:nowrap}.repo-badge.operation{color:var(--vscode-editorWarning-foreground);border-color:var(--vscode-editorWarning-foreground)}.filters{display:flex;min-height:38px;flex-wrap:wrap;align-items:center}.filters .advanced{display:none;gap:5px;flex:1;flex-wrap:wrap}.filters.expanded .advanced{display:flex}.filters #textFilter{min-width:180px;flex:1}.filter-chips{display:flex;gap:4px;flex-wrap:wrap;padding:0 7px 5px;background:var(--vscode-editorGroupHeader-tabsBackground)}.filter-chips:empty{display:none}.history-map{height:14px;position:relative;border-bottom:1px solid var(--vscode-panel-border);background:var(--vscode-editorGroupHeader-tabsBackground);cursor:pointer}.history-dot{position:absolute;top:3px;width:6px;height:6px;border-radius:50%;background:var(--vscode-charts-blue)}.history-dot.head{background:var(--vscode-charts-green);box-shadow:0 0 0 2px color-mix(in srgb,var(--vscode-charts-green) 25%,transparent)}.history-window{position:absolute;top:1px;height:11px;border:1px solid var(--vscode-focusBorder);background:color-mix(in srgb,var(--vscode-focusBorder) 10%,transparent)}.empty-state{position:absolute;inset:0;z-index:5;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;color:var(--vscode-descriptionForeground);background:var(--vscode-editor-background)}.empty-state[hidden]{display:none}.diff-preview{font:12px/1.45 var(--vscode-editor-font-family);white-space:pre;overflow:auto}.diff-preview .add{color:var(--vscode-gitDecoration-addedResourceForeground);background:color-mix(in srgb,var(--vscode-gitDecoration-addedResourceForeground) 8%,transparent)}.diff-preview .del{color:var(--vscode-gitDecoration-deletedResourceForeground);background:color-mix(in srgb,var(--vscode-gitDecoration-deletedResourceForeground) 8%,transparent)}.detail-actions{display:flex;gap:5px;margin-bottom:8px}.modal{display:none;position:fixed;inset:0;z-index:1100;background:rgba(0,0,0,.45);align-items:center;justify-content:center}.modal.open{display:flex}.modal-card{width:min(720px,calc(100vw - 30px));max-height:80vh;overflow:auto;padding:14px;background:var(--vscode-editorWidget-background);border:1px solid var(--vscode-widget-border);box-shadow:0 8px 30px rgba(0,0,0,.45)}.rebase-row{display:grid;grid-template-columns:90px 1fr auto;gap:6px;align-items:center;margin:5px 0}.modal-actions{display:flex;justify-content:flex-end;gap:7px;margin-top:12px}.skeleton{animation:pulse 1.2s ease-in-out infinite}@keyframes pulse{50%{opacity:.3}}
.layout{grid-template-columns:var(--left,220px) 34px 4px minmax(320px,1fr) 4px var(--right,330px)}.quick-actions{display:flex;min-width:34px;flex-direction:column;align-items:center;padding:5px 3px;border-left:1px solid var(--vscode-panel-border);background:var(--vscode-sideBar-background)}.quick-actions button{width:27px;height:27px;padding:0;border:0;background:transparent;color:var(--vscode-icon-foreground);font-size:15px}.quick-actions button:hover{background:var(--vscode-toolbar-hoverBackground)}.quick-actions button:focus-visible{outline:1px solid var(--vscode-focusBorder);outline-offset:-1px}.quick-separator{width:20px;margin:4px 0;border-top:1px solid var(--vscode-panel-border)}.quick-spacer{flex:1}.busy .quick-actions [data-action]{pointer-events:none;opacity:.45}.filters{display:grid;grid-template-columns:minmax(180px,1fr) auto;min-height:38px;align-items:center}.filters .advanced{display:none;grid-column:1/-1;grid-template-columns:minmax(110px,1fr) minmax(130px,1.3fr) 118px 118px minmax(100px,1fr) auto auto auto;gap:5px;width:100%}.filters.expanded .advanced{display:grid}.filters #textFilter{width:100%;min-width:180px}.filter-chips{padding-top:0}.toolbar{min-height:30px;padding:3px 7px}.layout{height:calc(100vh - 30px)}@media(max-width:900px){.filters .advanced{grid-template-columns:repeat(3,minmax(100px,1fr))}.layout{grid-template-columns:var(--left,180px) 32px 3px minmax(260px,1fr) 3px var(--right,260px)}}
.layout{grid-template-columns:var(--left,220px) 44px 4px minmax(320px,1fr) 4px var(--right,330px)}.quick-actions{min-width:44px;padding:7px 4px;gap:2px}.quick-actions button{display:flex;width:35px;height:35px;align-items:center;justify-content:center;border:1px solid transparent;border-radius:4px;color:var(--vscode-foreground);opacity:.88}.quick-actions button svg{width:20px;height:20px;overflow:visible;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}.quick-actions button:hover{border-color:var(--vscode-panel-border);background:var(--vscode-toolbar-hoverBackground);color:var(--vscode-focusBorder);opacity:1}.quick-actions button.running{border-color:var(--vscode-focusBorder);background:color-mix(in srgb,var(--vscode-focusBorder) 14%,transparent);color:var(--vscode-focusBorder);opacity:1}.quick-actions button.running svg{animation:quickPulse .9s ease-in-out infinite alternate}.quick-separator{width:28px;margin:5px 0}@keyframes quickPulse{to{opacity:.35;transform:scale(.88)}}.filters{display:block;min-height:0;padding:7px;border-bottom:1px solid var(--vscode-panel-border)}.filter-primary{display:grid;grid-template-columns:minmax(180px,1fr) auto;gap:6px}.filter-primary input{width:100%}.filters .advanced{display:none;width:100%;margin-top:7px;padding-top:7px;border-top:1px solid color-mix(in srgb,var(--vscode-panel-border) 65%,transparent)}.filters.expanded .advanced{display:block}.filter-fields{display:grid;grid-template-columns:minmax(110px,1fr) minmax(140px,1.35fr) 118px 118px minmax(110px,1fr);gap:6px}.filter-fields input{width:100%;min-width:0}.filter-options{display:flex;align-items:center;gap:14px;min-height:30px;margin-top:5px}.filter-options label{display:inline-flex;align-items:center;gap:5px;height:26px}.filter-options label input{width:16px;height:16px}.filter-options #clear{margin-left:auto}.filter-chips{padding:5px 7px;border-bottom:1px solid var(--vscode-panel-border)}.filter-chips:empty{display:none}@media(max-width:900px){.layout{grid-template-columns:var(--left,180px) 42px 3px minmax(260px,1fr) 3px var(--right,260px)}.filter-fields{grid-template-columns:repeat(2,minmax(110px,1fr))}.filter-fields #goto{grid-column:1/-1}}@media(max-width:620px){.filter-fields{grid-template-columns:1fr}.filter-fields #goto{grid-column:auto}.filter-options{flex-wrap:wrap;gap:7px 12px}.filter-options #clear{margin-left:0}}
</style></head><body>
<div class="toolbar"><span class="repo-badges" id="repoBadges"></span><span class="grow"></span><select id="repo" title="Repository"></select></div>
<main class="layout" id="layout"><section class="pane branches"><div class="heading">BRANCHES</div><input id="branchSearch" placeholder="Search branches"><div id="branches"></div></section><nav class="quick-actions" aria-label="Git quick actions"><button id="refresh" title="Refresh Git Log" aria-label="Refresh Git Log"><svg viewBox="0 0 24 24"><path d="M19 8a8 8 0 1 0 1 7M19 3v5h-5"/></svg></button><span class="quick-separator"></span><button data-action="fetch" title="Fetch all remotes and prune" aria-label="Fetch"><svg viewBox="0 0 24 24"><path d="M12 3v12m-4-4 4 4 4-4M5 19h14"/></svg></button><button data-action="update" title="Fetch and integrate upstream changes" aria-label="Update"><svg viewBox="0 0 24 24"><path d="M8 4v14m-3-3 3 3 3-3M16 20V6m-3 3 3-3 3 3"/></svg></button><button data-action="pull" title="Pull current branch" aria-label="Pull"><svg viewBox="0 0 24 24"><path d="M12 3v13m-5-5 5 5 5-5M5 20h14"/></svg></button><button data-action="push" title="Push current branch" aria-label="Push"><svg viewBox="0 0 24 24"><path d="M12 21V8m-5 5 5-5 5 5M5 4h14"/></svg></button><span class="quick-separator"></span><button data-action="stash" title="Stash working tree changes" aria-label="Stash"><svg viewBox="0 0 24 24"><path d="M4 7h16v13H4zM7 4h10v3M8 12h8m-4-3v6"/></svg></button><button data-action="createBranch" title="Create branch from HEAD" aria-label="New Branch"><svg viewBox="0 0 24 24"><circle cx="6" cy="5" r="2"/><circle cx="6" cy="19" r="2"/><circle cx="15" cy="12" r="2"/><path d="M6 7v10m2-6c4 0 5 1 5 1m6-5v10m-5-5h10"/></svg></button><span class="quick-spacer"></span><button id="viewOptions" title="View options" aria-label="View options"><svg viewBox="0 0 24 24"><circle cx="6" cy="12" r="1.5" fill="currentColor"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/><circle cx="18" cy="12" r="1.5" fill="currentColor"/></svg></button></nav><div class="split" data-side="left"></div>
<section class="pane center"><div class="banner" id="banner"><b id="operation"></b><button data-conflict="continue">Continue</button><button data-conflict="abort">Abort</button><button data-conflict="skip">Skip</button></div><div class="filters" id="filters"><div class="filter-primary"><input id="textFilter" placeholder="Search commit messages"><button id="toggleFilters" title="More filters" aria-expanded="false">Filters</button></div><div class="advanced"><div class="filter-fields"><input id="authorFilter" placeholder="Author"><input id="pathFilter" placeholder="Path"><input id="sinceFilter" type="date" title="From date"><input id="untilFilter" type="date" title="To date"><input id="goto" placeholder="Hash / ref"></div><div class="filter-options"><label><input type="checkbox" id="regex"> Regex</label><label><input type="checkbox" id="case"> Case sensitive</label><button id="clear">Clear all</button></div></div></div><div class="filter-chips" id="filterChips"></div><div class="header"><span>Graph</span><span>Subject</span><span>Author</span><span>Date</span></div><div class="row" id="uncommitted" style="display:none;position:relative"><span></span><strong>Uncommitted changes</strong><span></span><span></span></div><div class="viewport" id="viewport" tabindex="0"><div class="empty-state" id="emptyState"><b>Loading Git history…</b><span>Reading commits and branches</span></div><svg class="graph-overlay" id="graphSvg" aria-hidden="true"></svg><div class="spacer" id="spacer"></div></div></section>
<div class="split" data-side="right"></div><section class="pane right mobile-files" id="rightPane"><div class="heading"><span class="heading-title">CHANGED FILES</span><span class="right-tabs"><button data-right-tab="files" title="Changed files">Files</button><button data-right-tab="detail" title="Commit details">Details</button></span><button id="fileMode" title="Toggle tree or flat view">Tree</button><button id="collapseFiles" title="Collapse all folders">−</button><button id="expandFiles" title="Expand all folders">+</button><select id="parentMode" style="display:none" title="Merge comparison parent"></select></div><div id="files"></div><div class="right-split" id="rightSplit" title="Resize changed files and commit details"></div><div class="detail" id="detail"><div class="empty">Select a commit</div></div></section></main><div class="context-menu" id="contextMenu" role="menu"></div><div class="toast" id="toast" role="alert"><button class="toast-close" id="toastClose" title="Dismiss">×</button><strong id="toastTitle"></strong><div id="toastMessage"></div><div class="toast-actions" id="toastActions"></div><details id="toastDetails"><summary>Details</summary><pre id="toastDetailText"></pre></details></div><div class="modal" id="rebaseModal"><div class="modal-card"><h3>Interactive Rebase Preview</h3><p>Oldest commit first. Reordering or changing an action rewrites local history.</p><div id="rebaseRows"></div><div class="modal-actions"><button id="cancelRebase">Cancel</button><button id="runRebase">Run Rebase</button></div></div></div>
<script nonce="${nonce}">
const vscode=acquireVsCodeApi(), ROW=28, PAGE=200, overscan=12, COL=16, PAD=8, LANE_COLORS=['var(--vscode-charts-blue)','var(--vscode-charts-purple)','var(--vscode-charts-green)','var(--vscode-charts-yellow)','var(--vscode-charts-red)','var(--vscode-charts-orange)','var(--vscode-charts-foreground)','var(--vscode-gitDecoration-modifiedResourceForeground)'];
function reportClientError(value){const text=value instanceof Error?(value.stack||value.message):String(value);vscode.postMessage({type:'clientError',operation:text})}
window.addEventListener('error',event=>reportClientError(event.error||event.message));window.addEventListener('unhandledrejection',event=>reportClientError(event.reason));
function storedArray(key){try{const value=JSON.parse(localStorage.getItem(key)||'[]');if(Array.isArray(value))return value}catch(error){reportClientError('Reset invalid '+key+': '+error)}localStorage.removeItem(key);return[]}
let state={commits:[],commitIndexes:new Map(),total:0,generation:0,busy:false,contextRequestId:0,loading:new Set(),selected:-1,selectionAnchor:-1,selectedHashes:new Set(),detail:null,uncommitted:[],visibleFiles:[],visibleFilesWorking:false,fileFolders:new Set(),fileMode:localStorage.getItem('gitLog.fileMode')||'tree',fileCollapsed:new Set(storedArray('gitLog.fileCollapsed')),favorites:new Set(storedArray('gitLog.favorites')),collapsed:new Set(storedArray('gitLog.collapsed'))};
const $=id=>document.getElementById(id), esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function send(type,data={}){vscode.postMessage({type,...data})}function date(ts){return new Date(ts*1000).toLocaleString()}function actionLabel(action){return String(action||'Git operation').replace(/([A-Z])/g,' $1').toLowerCase()}
function relativeTime(ms){if(!ms)return'Not fetched this session';const minutes=Math.max(0,Math.round((Date.now()-ms)/60000));return minutes<1?'Fetched just now':'Fetched '+minutes+'m ago'}
function renderStatusBadges(){const r=state.repository,host=$('repoBadges');if(!r){host.innerHTML='';return}const values=[];if(r.ahead||r.behind)values.push(['↑ '+r.ahead+' ↓ '+r.behind,'Ahead / behind upstream','']);if(r.changedCount)values.push([r.changedCount+' changed','Working tree files','']);if(r.detached)values.push(['Detached HEAD','No branch is checked out','operation']);if(r.operation)values.push([r.operation,'Git operation in progress','operation']);values.push([relativeTime(r.lastFetchedAt),'Last successful fetch','']);host.innerHTML=values.map(x=>'<span class="repo-badge '+x[2]+'" title="'+esc(x[1])+'">'+esc(x[0])+'</span>').join('')}
function activeFilters(){const values=[['authorFilter','Author'],['pathFilter','Path'],['sinceFilter','From'],['untilFilter','To']];const chips=values.filter(([id])=>$(id).value).map(([id,label])=>({id,label:label+': '+$(id).value}));if(state.selectedRef)chips.push({id:'ref',label:'Branch: '+state.selectedRef});if($('regex').checked)chips.push({id:'regex',label:'Regex'});if($('case').checked)chips.push({id:'case',label:'Case'});return chips}
function renderFilterChips(){$('filterChips').innerHTML=activeFilters().map(x=>'<button class="filter-chip" data-clear-filter="'+x.id+'">'+esc(x.label)+' ×</button>').join('')}
function requestContext(data){state.contextRequestId++;$('contextMenu').style.display='none';if(!state.busy)send('context',{...data,requestId:state.contextRequestId})}
function refItem(x,label=x.name,depth=0){return '<div class="item '+(x.current?'active ':'')+(state.selectedRef===x.name?'viewing':'')+'" style="padding-left:'+(8+depth*14)+'px" data-kind="'+x.kind+'" data-hash="'+x.hash+'" data-ref="'+esc(x.name)+'"><button style="border:0;background:transparent;height:auto;padding:0 4px 0 0" data-star="'+esc(x.name)+'" title="Favorite">'+(state.favorites.has(x.name)?'★':'☆')+'</button><span class="ref-icon" aria-hidden="true"><span class="ref-shape"></span></span>'+esc(label)+'<span class="badge">'+(x.ahead?'↑ '+x.ahead:'')+(x.ahead&&x.behind?' · ':'')+(x.behind?'↓ '+x.behind:'')+'</span></div>'}
function refTree(refs,kind,q,prefix='',depth=0){const folders=new Map(),leaves=[];for(const ref of refs){const relative=prefix&&ref.name.startsWith(prefix+'/')?ref.name.slice(prefix.length+1):ref.name,parts=relative.split('/');if(parts.length===1)leaves.push(ref);else{const folder=parts[0];if(!folders.has(folder))folders.set(folder,[]);folders.get(folder).push(ref)}}let html=leaves.map(x=>refItem(x,x.name.split('/').pop(),depth)).join('');for(const [folder,children] of [...folders].sort(([a],[b])=>a.localeCompare(b))){const key=kind+':'+(prefix?prefix+'/':'')+folder,closed=!q&&state.collapsed.has(key);html+='<div class="item folder" style="padding-left:'+(8+depth*14)+'px" data-folder="'+esc(key)+'">'+(closed?'▸':'▾')+' '+esc(folder)+'</div>';if(!closed)html+=refTree(children,kind,q,prefix?prefix+'/'+folder:folder,depth+1)}return html}
function renderBranches(){const q=$('branchSearch').value.toLowerCase(),r=state.repository;if(!r)return;const matching=r.refs.filter(x=>!q||x.name.toLowerCase().includes(q)),current=r.refs.find(x=>x.current),favorites=matching.filter(x=>state.favorites.has(x.name)&&!x.current);let html=current?'<div class="group">Current Branch</div>'+refItem(current):'';if(favorites.length)html+='<div class="group">Favorites</div>'+favorites.map(x=>refItem(x)).join('');for(const kind of ['local','remote','tag']){const refs=matching.filter(x=>x.kind===kind&&!x.current);if(refs.length)html+='<div class="group">'+kind+'</div>'+refTree(refs,kind,q)}html+='<div class="group">Stashes</div>'+r.stashes.filter(x=>!q||(x.ref+' '+x.message).toLowerCase().includes(q)).map(x=>'<div class="item" data-kind="stash" data-ref="'+esc(x.ref)+'" data-hash="'+x.hash+'">'+esc(x.ref+' '+x.message)+'</div>').join('');$('branches').innerHTML=html}
function refClass(ref){return ref.includes('HEAD')?'ref-head':ref.startsWith('tag:')?'ref-tag':ref.includes('refs/remotes/')?'ref-remote':'ref-local'}
function contextClass(action){return ['deleteRemote','deleteBranch','deleteTag','stashDrop','dropCommit','reset','rollbackFile','getFile'].includes(action)?'danger':''}
function hideToast(){$('toast').style.display='none';$('toast').classList.remove('recovery')}
function showErrorToast(message){const lines=String(message).trim().split(/\\r?\\n/),toast=$('toast');$('toastTitle').textContent='Git command failed';$('toastMessage').textContent=lines[0]||'Git command failed';$('toastActions').innerHTML='';$('toastDetailText').textContent=message;$('toastDetails').open=false;$('toastDetails').style.display=lines.length>1?'block':'none';toast.classList.remove('recovery');toast.style.display='block'}
function showRecoveryToast(message){const recovery=message.recovery,toast=$('toast');$('toastTitle').textContent=recovery.title;$('toastMessage').textContent='Choose how to continue the cherry-pick.';$('toastDetailText').textContent=recovery.detail;$('toastDetails').style.display='block';$('toastDetails').open=false;$('toastActions').innerHTML='';for(const item of recovery.actions){const button=document.createElement('button');button.textContent=item.label;button.onclick=()=>{hideToast();send('mutate',{action:item.action,operation:message.operation})};$('toastActions').appendChild(button)}toast.classList.add('recovery');toast.style.display='block'}
$('toastClose').onclick=hideToast;window.addEventListener('message',e=>{const m=e.data;if(m.type==='recovery'){showRecoveryToast(m);e.stopImmediatePropagation()}else if(m.type==='error'){showErrorToast(m.message);$('emptyState').hidden=false;$('emptyState').innerHTML='<b>Unable to load Git history</b><span>'+esc(m.message)+'</span><button data-empty-action="refresh">Try again</button>';e.stopImmediatePropagation()}else if(m.type==='busy'){if(state.repository?.root&&m.repositoryId!==state.repository.root){e.stopImmediatePropagation();return}state.busy=m.busy;document.body.classList.toggle('busy',m.busy);for(const button of document.querySelectorAll('.quick-actions [data-action]'))button.classList.toggle('running',m.busy&&button.dataset.action===m.action);if(m.busy)$('repoBadges').innerHTML='<span class="repo-badge operation">Running '+esc(actionLabel(m.action))+'…</span>';else renderStatusBadges();e.stopImmediatePropagation()}},true);
function graphX(column){return PAD+column*COL+COL/2}function graphY(index,scrollTop){return index*ROW+ROW/2-scrollTop}function graphPath(x1,y1,x2,y2,stub=false){if(x1===x2||stub)return'M '+x1+' '+y1+' L '+x2+' '+y2;const bend=y2-Math.sign(y2-y1||1)*ROW*.65;return'M '+x1+' '+y1+' C '+x1+' '+bend+', '+x2+' '+(y1+ROW*.35)+', '+x2+' '+y2}
function renderGraph(start,end){const vp=$('viewport'),svg=$('graphSvg'),visible=[];state.commitIndexes.clear();let maxColumn=0;state.commits.forEach((commit,index)=>{if(!commit)return;state.commitIndexes.set(commit.hash,index);if(commit.lane)maxColumn=Math.max(maxColumn,commit.lane.column,...commit.lane.lines.map(line=>line.toColumn))});for(let i=start;i<end;i++){const c=state.commits[i];if(c?.lane)visible.push([i,c])}const width=(maxColumn+1)*COL+PAD*2;document.documentElement.style.setProperty('--graph-width',Math.max(56,width)+'px');svg.setAttribute('width',String(width));svg.setAttribute('height',String(vp.clientHeight));svg.setAttribute('viewBox','0 0 '+width+' '+vp.clientHeight);let paths='',nodes='';for(const [index,c] of visible){const lane=c.lane,x=graphX(lane.column),y=graphY(index,vp.scrollTop),color=LANE_COLORS[lane.color%LANE_COLORS.length];for(const line of lane.lines){const targetIndex=state.commitIndexes.get(line.toCommit),stub=targetIndex===undefined,toY=stub?y+ROW*.75:graphY(targetIndex,vp.scrollTop),toX=graphX(line.toColumn);paths+='<path d="'+graphPath(x,y,toX,toY,stub)+'" fill="none" stroke="'+color+'" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" '+(stub?'stroke-dasharray="4 2" opacity=".55"':'')+'/>'}const merge=c.parents.length>1;nodes+=merge?'<circle cx="'+x+'" cy="'+y+'" r="4.6" fill="'+color+'"/><circle cx="'+x+'" cy="'+y+'" r="2.4" fill="var(--vscode-panel-background)"/><circle cx="'+x+'" cy="'+y+'" r="1.5" fill="'+color+'"/>':'<circle cx="'+x+'" cy="'+y+'" r="3.6" fill="'+color+'"/>';if(c.refs.some(ref=>ref.includes('HEAD')))nodes+='<circle cx="'+x+'" cy="'+y+'" r="6.4" fill="none" stroke="'+color+'" stroke-width="1" opacity=".3"/>'}svg.innerHTML=paths+nodes}
function renderRows(){const vp=$('viewport'),start=Math.max(0,Math.floor(vp.scrollTop/ROW)-overscan),end=Math.min(state.total,Math.ceil((vp.scrollTop+vp.clientHeight)/ROW)+overscan),empty=$('emptyState');if(!state.total){empty.hidden=false;empty.innerHTML=state.loading.size?'<b>Loading Git history…</b><span>Reading commits and branches</span>':activeFilters().length||$('textFilter').value?'<b>No commits match these filters</b><span>Change or clear filters to see more commits</span><button onclick="clearFilters()">Clear filters</button>':'<b>No commits yet</b><span>This repository has no visible history</span>'}else empty.hidden=true;$('spacer').style.height=(state.total*ROW)+'px';$('spacer').innerHTML=Array.from({length:Math.max(0,end-start)},(_,i)=>{const n=start+i,c=state.commits[n];if(!c)return '<div class="row loading skeleton" style="top:'+(n*ROW)+'px"><span></span><span></span></div>';const refs=c.refs.length?'<span class="refs '+refClass(c.refs[0])+'">'+esc(c.refs[0].replace('refs/heads/','').replace('refs/remotes/','').replace('tag: refs/tags/',''))+'</span>':'';return '<div class="row '+(n===state.selected?'selected ':'')+(state.selectedHashes.has(c.hash)?'multi':'')+'" data-index="'+n+'" style="top:'+(n*ROW)+'px"><span></span><span>'+esc(c.subject)+refs+'</span><span>'+esc(c.author)+'</span><span>'+date(c.authorTimestamp)+'</span></div>'}).join('');renderGraph(start,end);for(let page=Math.floor(start/PAGE)*PAGE;page<end;page+=PAGE)if(!state.commits[page]&&!state.loading.has(page)){state.loading.add(page);send('loadLog',{offset:page,generation:state.generation,filter:filter()})}}
function fileStatus(f){const raw=String(f.status||'?').toUpperCase(),conflict=f.conflict||/^(DD|AU|UD|UA|DU|AA|UU)$/.test(raw);if(conflict)return{code:'!',label:'Conflict',css:'status-conflict'};const code=raw==='?'?'U':raw[0];return{code,label:{A:'Added',M:'Modified',D:'Deleted',R:'Renamed',C:'Copied',U:'Untracked'}[code]||raw,css:'status-'+code.toLowerCase()}}
function fileRow(f,depth=0,working=false){const status=fileStatus(f),parts=f.path.split('/'),name=parts.pop()||f.path,folder=parts.join('/'),old=f.oldPath?' ← '+f.oldPath:'';return '<div class="file '+status.css+'" title="'+esc(status.label+': '+f.path+old)+'" style="padding-left:'+(8+depth*14)+'px" data-path="'+esc(f.path)+'" '+(working?'data-working="true" ':'')+(f.conflict?'data-conflict="true"':'')+'><span class="file-status" aria-label="'+status.label+'">'+status.code+'</span><span class="file-name">'+esc(name)+'</span><span class="file-path">'+esc((state.fileMode==='flat'?f.path:folder)+old)+'</span><span class="file-stat"><span class="file-add">+'+f.additions+'</span><span class="file-del">−'+f.deletions+'</span></span></div>'}
function fileTree(files){const root={folders:new Map(),files:[]};for(const file of files){let node=root;const parts=file.path.split('/');for(const folder of parts.slice(0,-1)){if(!node.folders.has(folder))node.folders.set(folder,{folders:new Map(),files:[]});node=node.folders.get(folder)}node.files.push(file)}return root}
function renderFileNode(node,prefix='',depth=0,working=false){let html='';for(const [name,child] of [...node.folders].sort(([a],[b])=>a.localeCompare(b))){const key=prefix?prefix+'/'+name:name,closed=state.fileCollapsed.has(key);state.fileFolders.add(key);html+='<div class="item folder file-folder" style="padding-left:'+(8+depth*14)+'px" data-file-folder="'+esc(key)+'"><span class="ref-icon">'+(closed?'▸':'▾')+'</span>'+esc(name)+'</div>';if(!closed)html+=renderFileNode(child,key,depth+1,working)}html+=node.files.sort((a,b)=>a.path.localeCompare(b.path)).map(f=>fileRow(f,depth,working)).join('');return html}
function renderFiles(files,working=false){state.visibleFiles=files;state.visibleFilesWorking=working;state.fileFolders.clear();if(state.fileMode==='flat'){$('files').innerHTML=files.map(f=>fileRow(f,0,working)).join('');return}$('files').innerHTML=renderFileNode(fileTree(files),'',0,working)}
function renderDetail(){const d=state.detail;if(!d)return;const signature=d.signature==='good'?'✓ Verified'+(d.signatureSigner?' · '+d.signatureSigner:''):d.signature==='bad'?'⚠ Invalid signature':d.signature==='unsigned'?'Unsigned':'Signature unknown';$('detail').innerHTML='<div class="detail-actions"><button data-copy-detail="'+esc(d.hash)+'">Copy hash</button><button data-copy-detail="'+esc(d.message)+'">Copy message</button></div><div class="message">'+esc(d.message)+'</div><div class="meta"><b>Author</b> '+esc(d.author+' <'+d.authorEmail+'>')+'<br>'+date(d.authorTimestamp)+'<br><b>Committer</b> '+esc(d.committer+' <'+d.committerEmail+'>')+'<br>'+date(d.committerTimestamp)+'<br><b>Commit</b> '+esc(d.hash)+'<br><b>Signature</b> '+esc(signature)+'<br><b>Parents</b> '+d.parents.map(p=>'<button data-parent="'+p+'">'+esc(p.slice(0,8))+'</button>').join(' ')+'</div>';const parent=$('parentMode');parent.style.display=d.parents.length>1?'inline-block':'none';parent.innerHTML=d.parents.map((p,i)=>'<option value="'+(i+1)+'">Parent '+(i+1)+'</option>').join('')+(d.parents.length>1?'<option value="combined">Combined</option>':'');renderFiles(d.files)}
function renderInlineDiff(diff){const lines=String(diff.patch||'').split('\\n'),body=lines.map(line=>'<div class="'+(line.startsWith('+')&&!line.startsWith('+++')?'add':line.startsWith('-')&&!line.startsWith('---')?'del':'')+'">'+esc(line)+'</div>').join('');$('detail').innerHTML='<div class="detail-actions"><button id="backToDetail">Commit details</button><button data-copy-detail="'+esc(diff.patch)+'">Copy patch</button><span>'+esc(diff.path)+'</span></div><div class="diff-preview">'+(body||'<div class="empty">No textual changes</div>')+'</div>';$('backToDetail').onclick=renderDetail}
function filter(){return{text:$('textFilter').value||undefined,author:$('authorFilter').value||undefined,path:$('pathFilter').value||undefined,since:$('sinceFilter').value||undefined,until:$('untilFilter').value||undefined,refs:state.selectedRef?[state.selectedRef]:undefined,regex:$('regex').checked,matchCase:$('case').checked}}
function loadFiltered(){state.generation++;state.commits=[];state.total=0;state.loading.clear();state.loading.add(0);renderFilterChips();renderRows();send('loadLog',{offset:0,generation:state.generation,filter:filter()})}function clearFilters(){for(const id of ['textFilter','authorFilter','pathFilter','sinceFilter','untilFilter'])$(id).value='';state.selectedRef=undefined;$('regex').checked=$('case').checked=false;renderBranches();loadFiltered()}let timer;for(const id of ['textFilter','authorFilter','pathFilter','sinceFilter','untilFilter'])$(id).oninput=()=>{clearTimeout(timer);timer=setTimeout(loadFiltered,250)};$('regex').onchange=$('case').onchange=loadFiltered;$('clear').onclick=clearFilters;$('toggleFilters').onclick=()=>{const expanded=$('filters').classList.toggle('expanded');$('toggleFilters').setAttribute('aria-expanded',String(expanded))};$('filterChips').onclick=e=>{const chip=e.target.closest('[data-clear-filter]');if(!chip)return;const id=chip.dataset.clearFilter;if(id==='ref')state.selectedRef=undefined;else if(id==='regex'||id==='case')$(id).checked=false;else $(id).value='';renderBranches();loadFiltered()};
let scrollFrame;$('viewport').onscroll=()=>{if(scrollFrame)return;$('contextMenu').style.display='none';scrollFrame=requestAnimationFrame(()=>{scrollFrame=undefined;renderRows()})};$('viewport').onclick=e=>{const row=e.target.closest('.row');if(!row)return;state.selected=Number(row.dataset.index);const hash=state.commits[state.selected].hash;if(e.shiftKey&&state.selectionAnchor>=0){state.selectedHashes.clear();const from=Math.min(state.selectionAnchor,state.selected),to=Math.max(state.selectionAnchor,state.selected);for(let i=from;i<=to;i++)if(state.commits[i])state.selectedHashes.add(state.commits[i].hash)}else if(e.ctrlKey||e.metaKey){state.selectionAnchor=state.selected;state.selectedHashes.has(hash)?state.selectedHashes.delete(hash):state.selectedHashes.add(hash)}else{state.selectionAnchor=state.selected;state.selectedHashes.clear();state.selectedHashes.add(hash)}send('detail',{hash,generation:state.generation});renderRows()};$('viewport').oncontextmenu=e=>{e.preventDefault();const row=e.target.closest('.row');if(row){const index=Number(row.dataset.index),c=state.commits[index];if(!state.selectedHashes.has(c.hash)){state.selected=index;state.selectionAnchor=index;state.selectedHashes=new Set([c.hash]);renderRows()}const hashes=state.commits.map(c=>c?.hash).filter(hash=>hash&&state.selectedHashes.has(hash)).reverse();requestContext({x:e.clientX,y:e.clientY,kind:hashes.length>1?'commits':'commit',hash:c.hash,ref:c.hash,hashes})}};$('viewport').onkeydown=e=>{if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();state.selected=Math.max(0,Math.min(state.commits.length-1,state.selected+(e.key==='ArrowDown'?1:-1)));state.selectionAnchor=state.selected;state.selectedHashes=new Set([state.commits[state.selected].hash]);send('detail',{hash:state.commits[state.selected].hash,generation:state.generation});$('viewport').scrollTop=Math.max(0,state.selected*ROW-$('viewport').clientHeight/2);renderRows()}if(e.key==='Enter'&&state.detail?.files[0])send('diff',{hash:state.detail.hash,path:state.detail.files[0].path})};
$('files').ondblclick=e=>{const f=e.target.closest('.file');if(!f)return;f.dataset.working?send('workingDiff',{path:f.dataset.path}):state.detail&&send('diff',{hash:state.detail.hash,path:f.dataset.path,parent:Number($('parentMode').value)||1})};$('files').oncontextmenu=e=>{e.preventDefault();const f=e.target.closest('.file');if(f)requestContext({x:e.clientX,y:e.clientY,kind:f.dataset.working?'workingFile':'commitFile',hash:state.detail?.hash,path:f.dataset.path,parent:Number($('parentMode').value)||1})};$('branchSearch').oninput=renderBranches;$('branches').onclick=e=>{const item=e.target.closest('.item');if(!item)return;if(item.dataset.ref){state.selectedRef=item.dataset.ref;renderBranches();loadFiltered()}else if(item.dataset.hash)send('detail',{hash:item.dataset.hash})};$('branches').oncontextmenu=e=>{e.preventDefault();const item=e.target.closest('.item');if(item)requestContext({x:e.clientX,y:e.clientY,kind:item.dataset.kind,ref:item.dataset.ref,hash:item.dataset.hash})};$('goto').onkeydown=e=>{if(e.key==='Enter'&&e.target.value)send('detail',{hash:e.target.value})};$('refresh').onclick=()=>send('refresh');for(const b of document.querySelectorAll('[data-action]'))b.onclick=()=>{if(!state.busy)send('mutate',{action:b.dataset.action})};for(const b of document.querySelectorAll('[data-conflict]'))b.onclick=()=>{if(!state.busy)send('mutate',{action:b.dataset.conflict,operation:state.repository?.operation})};$('repo').onchange=()=>send('selectRepo',{root:$('repo').value});
$('files').addEventListener('click',e=>{const f=e.target.closest('.file[data-conflict]');if(f)send('openConflict',{path:f.dataset.path})});
$('files').addEventListener('click',e=>{const file=e.target.closest('.file');if(!file)return;for(const row of $('files').querySelectorAll('.file.selected'))row.classList.remove('selected');file.classList.add('selected');send('inlineDiff',{hash:file.dataset.working?undefined:state.detail?.hash,path:file.dataset.path,parent:Number($('parentMode').value)||1})});
$('files').addEventListener('click',e=>{const folder=e.target.closest('[data-file-folder]');if(!folder)return;const key=folder.dataset.fileFolder;state.fileCollapsed.has(key)?state.fileCollapsed.delete(key):state.fileCollapsed.add(key);localStorage.setItem('gitLog.fileCollapsed',JSON.stringify([...state.fileCollapsed]));renderFiles(state.visibleFiles,state.visibleFilesWorking)});
$('detail').addEventListener('click',e=>{const parent=e.target.closest('[data-parent]');if(parent)send('detail',{hash:parent.dataset.parent});const copy=e.target.closest('[data-copy-detail]');if(copy)send('copyText',{ref:copy.dataset.copyDetail})});
$('viewport').addEventListener('keydown',e=>{if(e.key!=='ArrowLeft'&&e.key!=='ArrowRight')return;const current=state.commits[state.selected];if(!current)return;e.preventDefault();const target=e.key==='ArrowLeft'?current.parents[0]:state.commits.find(c=>c?.parents.includes(current.hash))?.hash;if(!target)return;const index=state.commits.findIndex(c=>c?.hash===target);if(index>=0){state.selected=index;$('viewport').scrollTop=Math.max(0,index*ROW-$('viewport').clientHeight/2);renderRows()}send('detail',{hash:target})},true);
$('branches').addEventListener('click',e=>{const star=e.target.closest('[data-star]');if(star){e.stopPropagation();const ref=star.dataset.star;state.favorites.has(ref)?state.favorites.delete(ref):state.favorites.add(ref);localStorage.setItem('gitLog.favorites',JSON.stringify([...state.favorites]));renderBranches();return}const folder=e.target.closest('[data-folder]');if(folder){e.stopPropagation();const key=folder.dataset.folder;state.collapsed.has(key)?state.collapsed.delete(key):state.collapsed.add(key);localStorage.setItem('gitLog.collapsed',JSON.stringify([...state.collapsed]));renderBranches()}},true);
$('uncommitted').onclick=()=>{renderFiles(state.uncommitted,true);$('detail').innerHTML='<div class="message">Uncommitted changes</div>'};
$('fileMode').textContent=state.fileMode==='tree'?'Tree':'Flat';$('fileMode').onclick=()=>{state.fileMode=state.fileMode==='tree'?'flat':'tree';localStorage.setItem('gitLog.fileMode',state.fileMode);$('fileMode').textContent=state.fileMode==='tree'?'Tree':'Flat';renderFiles(state.visibleFiles,state.visibleFilesWorking)};$('parentMode').onchange=e=>{if(state.detail)send('detail',{hash:state.detail.hash,parent:e.target.value==='combined'?0:Number(e.target.value)})};
$('collapseFiles').onclick=()=>{state.fileCollapsed=new Set(state.fileFolders);localStorage.setItem('gitLog.fileCollapsed',JSON.stringify([...state.fileCollapsed]));renderFiles(state.visibleFiles,state.visibleFilesWorking)};$('expandFiles').onclick=()=>{state.fileCollapsed.clear();localStorage.setItem('gitLog.fileCollapsed','[]');renderFiles(state.visibleFiles,state.visibleFilesWorking)};
$('viewOptions').onclick=()=>{const compact=document.body.classList.toggle('compact');localStorage.setItem('gitLog.compact',String(compact));document.querySelectorAll('.header span:nth-child(3),.row span:nth-child(3)').forEach(x=>x.style.display=compact?'none':'')};
document.addEventListener('contextmenu',e=>{state.contextPoint={x:e.clientX,y:e.clientY}},true);document.addEventListener('click',e=>{if(!e.target.closest('#contextMenu'))$('contextMenu').style.display='none'});window.addEventListener('blur',()=>{$('contextMenu').style.display='none'});document.addEventListener('keydown',e=>{if(e.key==='Escape')$('contextMenu').style.display='none'});
function showInlineContextMenu(message){const menu=$('contextMenu'),context=message.context;if(state.busy||context.requestId!==state.contextRequestId)return;state.contextPayload=context;menu.innerHTML=message.actions.map(item=>'<button class="'+contextClass(item.action)+'" role="menuitem" data-context-action="'+esc(item.action)+'">'+esc(item.label)+'</button>').join('');if(!message.actions.length)return;menu.style.display='block';menu.style.left='0';menu.style.top='0';const point={x:context.x??state.contextPoint?.x??0,y:context.y??state.contextPoint?.y??0},rect=menu.getBoundingClientRect();menu.style.left=Math.max(4,Math.min(point.x,window.innerWidth-rect.width-4))+'px';menu.style.top=Math.max(4,Math.min(point.y,window.innerHeight-rect.height-4))+'px';menu.querySelector('button')?.focus()}
function showRebasePlan(plan){state.rebasePlan=plan;$('rebaseRows').innerHTML=plan.map((item,index)=>'<div class="rebase-row" data-rebase-index="'+index+'"><select><option>pick</option><option>reword</option><option>squash</option><option>fixup</option><option>drop</option></select><input value="'+esc(item.subject)+'" title="Message used by reword"><span><button data-move="up">↑</button><button data-move="down">↓</button></span></div>').join('');$('rebaseModal').classList.add('open')}
function readRebasePlan(){return [...$('rebaseRows').children].map(row=>{const original=state.rebasePlan[Number(row.dataset.rebaseIndex)];return{...original,action:row.querySelector('select').value,message:row.querySelector('input').value}})}
$('rebaseRows').onclick=e=>{const button=e.target.closest('[data-move]');if(!button)return;const row=button.closest('.rebase-row'),sibling=button.dataset.move==='up'?row.previousElementSibling:row.nextElementSibling;if(sibling)button.dataset.move==='up'?row.parentNode.insertBefore(row,sibling):row.parentNode.insertBefore(sibling,row)};$('cancelRebase').onclick=()=>$('rebaseModal').classList.remove('open');$('runRebase').onclick=()=>{const plan=readRebasePlan();$('rebaseModal').classList.remove('open');send('interactiveRebase',{plan})};
$('contextMenu').onclick=e=>{const button=e.target.closest('[data-context-action]');if(!button||state.busy)return;button.disabled=true;const {type,...context}=state.contextPayload;send('contextAction',{...context,action:button.dataset.contextAction});$('contextMenu').style.display='none'};window.addEventListener('message',e=>{const m=e.data;if(m.type==='contextMenu')showInlineContextMenu(m);if(m.type==='busy'&&m.busy)$('contextMenu').style.display='none';if(m.type==='state'&&m.repository?.operation)setTimeout(()=>{const conflicts=m.uncommitted.filter(file=>file.conflict);$('operation').textContent=m.repository.operation+' · '+conflicts.length+' unresolved';document.querySelector('[data-conflict="continue"]').disabled=conflicts.length>0;document.querySelector('[data-conflict="skip"]').style.display=/REBAS|CHERRY/.test(m.repository.operation)?'inline-block':'none'},0)},true);
for(const split of document.querySelectorAll('.split'))split.onmousedown=e=>{const side=split.dataset.side,start=e.clientX,layout=$('layout'),initial=side==='left'?layout.children[0].offsetWidth:layout.children[5].offsetWidth;document.onmousemove=m=>{const value=Math.max(140,initial+(side==='left'?m.clientX-start:start-m.clientX));layout.style.setProperty('--'+side,value+'px');localStorage.setItem('gitLog.'+side,value)};document.onmouseup=()=>document.onmousemove=document.onmouseup=null};for(const side of ['left','right']){const v=localStorage.getItem('gitLog.'+side);if(v)$('layout').style.setProperty('--'+side,v+'px')}
const savedDetail=localStorage.getItem('gitLog.detailHeight');if(savedDetail)$('rightPane').style.setProperty('--detail-height',savedDetail+'px');$('rightSplit').onmousedown=e=>{const pane=$('rightPane'),start=e.clientY,initial=$('detail').offsetHeight;document.onmousemove=m=>{const height=Math.max(90,Math.min(pane.clientHeight-90,initial+start-m.clientY));pane.style.setProperty('--detail-height',height+'px');localStorage.setItem('gitLog.detailHeight',String(height))};document.onmouseup=()=>document.onmousemove=document.onmouseup=null};for(const tab of document.querySelectorAll('[data-right-tab]'))tab.onclick=()=>{$('rightPane').classList.toggle('mobile-files',tab.dataset.rightTab==='files');$('rightPane').classList.toggle('mobile-detail',tab.dataset.rightTab==='detail')};
window.onmessage=e=>{const m=e.data;if(m.type==='rebasePlan')showRebasePlan(m.plan);else if(m.type==='inlineDiff')renderInlineDiff(m.diff);else if(m.type==='selectRef'){state.selectedRef=m.ref;renderBranches();loadFiltered()}else if(m.type==='state'){state={...state,...m,commits:m.log?.commits??[],total:m.log?.total??0};state.commits.length=state.total;$('repo').style.display=m.repositories.length>1?'block':'none';$('repo').innerHTML=m.repositories.map(r=>'<option '+(r===m.repository?.root?'selected':'')+'>'+esc(r)+'</option>').join('');const r=m.repository;renderStatusBadges();$('uncommitted').style.display=state.uncommitted.length?'grid':'none';$('banner').style.display=r?.operation?'block':'none';$('operation').textContent=r?.operation??'';renderBranches();renderFilterChips();renderRows();if(r?.operation){$('files').innerHTML=state.uncommitted.filter(f=>f.conflict).map(f=>fileRow(f,0,true)).join('')}}else if(m.type==='log'){state.total=m.log.total;if(state.commits.length!==state.total)state.commits.length=state.total;state.commits.splice(m.log.offset,m.log.commits.length,...m.log.commits);state.loading.delete(m.log.offset);renderRows()}else if(m.type==='detail'){state.detail=m.detail;renderDetail()}else if(m.type==='compareFiles'){renderFiles(m.files);$('detail').innerHTML='<div class="message">'+esc(m.from)+' ↔ '+esc(m.to)+'</div><div class="meta">'+(m.onlyCurrent?m.onlyCurrent.length+' commit(s) only in current<br>'+m.onlySelected.length+' commit(s) only in selected<br>':'')+m.files.length+' changed file(s)</div>'}};send('ready');
</script></body></html>`;
}
