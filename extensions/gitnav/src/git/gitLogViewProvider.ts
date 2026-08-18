import * as path from 'path';
import * as vscode from 'vscode';
import { GitLogFilter, GitRebasePlanItem } from './gitPanelModels';
import { GitRepositoryService } from './gitRepositoryService';
import { revisionUri } from './gitRevisionProvider';
import { GitMutationRunner } from './gitMutationRunner';
import { currentBranchPushPlan } from './gitPush';
import { GitMutationRequest } from './gitPanelModels';
import { CoalescedRefreshRunner, GitReadChannel, GitRequestCoordinator, GitRequestIdentity, InFlightOperationGuard, LocalRefreshKind, LocalRepositoryRefreshScheduler, RepositoryValueStore } from './gitPanelCoordinator';
import { classifyGitError } from './gitErrorRecovery';
import { MutationBusyTracker } from './gitMutationLifecycle';
import { actionFeedback, actionLabel, GitContextAction, GitContextActionGroup } from './gitActionPolicy';
import { matchingProtectedBranchPattern } from './gitBranchProtection';
import { GitPushRecoveryPreferences, GitPushRecoveryStrategy } from './gitPushRecoveryPreferences';
import { mapRevisionLineToWorktree } from './lineMapping';
import { GitWebviewMessage, GitWebviewMessageRouter } from './gitWebviewProtocol';
import { renderGitLogWebviewHtml } from './gitLogWebviewHtml';
import { formatFullCommitInfo } from './gitPanelParsers';

async function mapWithConcurrency<T, TResult>(
  items: readonly T[],
  limit: number,
  mapper: (item: T) => Promise<TResult>
): Promise<TResult[]> {
  const results = new Array<TResult>(items.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      results[index] = await mapper(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

export class GitLogViewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  static readonly viewId = 'gitnav.gitLog';
  private view?: vscode.WebviewView;
  private root?: string;
  private repositories: string[] = [];
  private readonly disposables: vscode.Disposable[] = [];
  private readonly mutations: GitMutationRunner;
  private readonly output = vscode.window.createOutputChannel('Git Log');
  private readonly requests = new GitRequestCoordinator();
  private readonly readCancellations = new Map<GitReadChannel, vscode.CancellationTokenSource>();
  private readonly mutationBusy = new MutationBusyTracker();
  private readonly refreshRunner = new CoalescedRefreshRunner();
  private readonly activeMutations = new InFlightOperationGuard();
  private readonly activeFilters = new RepositoryValueStore<GitLogFilter>();
  private readonly localRefreshScheduler: LocalRepositoryRefreshScheduler;
  private autoFetchTimer?: NodeJS.Timeout;
  private autoFetchEnabled = false;
  private readonly autoFetchWarmRoots = new Set<string>();
  private readonly backgroundFetchRoots = new Set<string>();
  private gitWatcher?: vscode.FileSystemWatcher;
  private builtInGitSyncAvailable = false;
  private lastInternalMutationAt = 0;
  private readonly pushRecoveryPreferences: GitPushRecoveryPreferences;
  private readonly messageRouter: GitWebviewMessageRouter;

  constructor(private readonly service: GitRepositoryService, private readonly extensionUri: vscode.Uri, state: vscode.Memento) {
    this.mutations = new GitMutationRunner(service);
    this.service.setDiagnosticLogger(message => this.logDiagnostic(message));
    this.pushRecoveryPreferences = new GitPushRecoveryPreferences(state);
    this.messageRouter = new GitWebviewMessageRouter(
      message => this.handle(message),
      () => this.logDiagnostic('Rejected malformed webview message.')
    );
    this.localRefreshScheduler = new LocalRepositoryRefreshScheduler((root, kind) => {
      void this.refreshFromLocalChange(root, kind);
    });
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    this.logDiagnostic('Webview resolved; registering message listener.');
    view.webview.options = { enableScripts: true, localResourceRoots: [this.extensionUri] };
    this.disposables.push(view.webview.onDidReceiveMessage(message => this.messageRouter.route(message)));
    this.disposables.push(view.onDidChangeVisibility(() => {
      if (view.visible && this.root) this.localRefreshScheduler.schedule(this.root, 'history');
    }));
    this.disposables.push(vscode.workspace.onDidChangeWorkspaceFolders(() => this.service.invalidateRepositoryDiscovery()));
    view.webview.html = renderGitLogWebviewHtml(view.webview, this.extensionUri);
    this.logDiagnostic('Webview HTML loaded; waiting for ready message.');
    this.configureAutoFetch();
    if (!this.builtInGitSyncAvailable) this.configureGitWatcher();
  }

  async refresh(): Promise<void> {
    return this.refreshRunner.run(() => this.refreshCore());
  }

  async revealCommit(root: string, hash: string): Promise<void> {
    await vscode.commands.executeCommand(`${GitLogViewProvider.viewId}.focus`);
    if (!this.view) {
      throw new Error('Git Log view could not be opened.');
    }

    const discovered = await this.service.discoverRepositories();
    this.repositories = discovered.includes(root) ? discovered : [root, ...discovered];
    this.cancelReads();
    this.root = root;
    this.activeFilters.set(root, { text: hash });
    await this.refreshRepositoryContent(this.repositories, root);
    this.post({ type: 'focusCommit', hash });
  }

  private async refreshCore(): Promise<void> {
    if (!this.view) return;
    const startedAt = Date.now();
    this.logDiagnostic('Refresh started: discovering repositories.');
    const repositories = await this.service.discoverRepositories();
    this.repositories = repositories;
    this.logDiagnostic(`Repository discovery completed (${repositories.length}) in ${Date.now() - startedAt} ms.`);
    if (!this.root || !repositories.includes(this.root)) this.root = repositories[0];
    if (!this.root) {
      this.logDiagnostic('No Git repository found; posting empty state.');
      return this.post({ type: 'state', repositories });
    }
    await this.refreshRepositoryContent(repositories, this.root, startedAt);
  }

  private async refreshRepositoryContent(repositories: string[], root: string, startedAt = Date.now()): Promise<void> {
    if (!this.view || this.root !== root) return;
    this.logDiagnostic(`Loading repository: ${root}`);
    this.cancelReads();
    this.requests.invalidate(root);
    const read = this.beginRead('refresh', root);
    const activeFilter = this.activeFilters.get(root, {});
    try {
      const [state, log] = await Promise.all([
        this.service.repositoryState(root, read.source.token),
        this.service.log(root, 0, 200, activeFilter, read.source.token)
      ]);
      const { repository, uncommitted } = state;
      if (this.requests.isCurrent('refresh', read.identity, this.root)) {
        const protectedBranches = vscode.workspace.getConfiguration('gitnav')
          .get<string[]>('protectedBranches', ['main', 'master', 'develop', 'release/*']);
        this.post({ type: 'state', repositories, repository, log, uncommitted, protectedBranches, activeFilter, generation: read.identity.generation, identity: read.identity });
        void this.loadFilterOptions(root);
        this.logDiagnostic(`State posted: ${repository.refs.length} refs, ${log.commits.length} commits${log.hasMore ? '+' : ''}, ${uncommitted.length} working tree files (${Date.now() - startedAt} ms).`);
        this.warmAutoFetch(root);
      } else {
        this.logDiagnostic(`Refresh ${read.identity.requestId} completed stale; state was not posted.`);
      }
    } finally {
      this.finishRead('refresh', read.source);
    }
  }

  dispose(): void {
    if (this.autoFetchTimer) clearInterval(this.autoFetchTimer);
    this.gitWatcher?.dispose();
    this.localRefreshScheduler.dispose();
    this.output.dispose();
    this.disposables.splice(0).forEach(item => item.dispose());
    this.cancelReads();
  }

  configureAutoFetch(): void {
    if (this.autoFetchTimer) clearInterval(this.autoFetchTimer);
    const config = vscode.workspace.getConfiguration('gitnav');
    this.autoFetchEnabled = config.get<boolean>('autoFetch', true);
    if (!this.autoFetchEnabled) {
      this.autoFetchWarmRoots.clear();
      return;
    }
    const minutes = config.get<number>('autoFetchMinutes', 20);
    this.autoFetchTimer = setInterval(() => {
      if (this.root) void this.runBackgroundAutoFetch(this.root).catch(() => undefined);
    }, Math.max(1, minutes) * 60_000);
    if (this.root) this.warmAutoFetch(this.root);
  }

  private warmAutoFetch(root: string): void {
    if (!this.autoFetchEnabled || this.autoFetchWarmRoots.has(root) || !this.view?.visible || this.mutations.isBusy(root)) return;
    this.autoFetchWarmRoots.add(root);
    void this.runBackgroundAutoFetch(root).catch(() => this.autoFetchWarmRoots.delete(root));
  }

  private async runBackgroundAutoFetch(root: string): Promise<void> {
    if (!this.autoFetchEnabled || this.backgroundFetchRoots.has(root) || !this.view?.visible || this.mutations.isBusy(root)) return;
    const startedAt = Date.now();
    this.backgroundFetchRoots.add(root);
    this.logDiagnostic(`Background fetch started: ${root}`);
    try {
      await this.mutations.fetchInBackground(root);
      this.logDiagnostic(`Background fetch completed in ${Date.now() - startedAt} ms.`);
      if (this.root === root && this.view?.visible && !this.mutations.isBusy(root)) this.schedulePostMutationRefresh(root);
    } catch (error) {
      this.logDiagnostic(`Background fetch failed: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    } finally {
      this.backgroundFetchRoots.delete(root);
    }
  }

  setBuiltInGitSyncAvailable(available: boolean): void {
    this.builtInGitSyncAvailable = available;
    if (available) {
      this.gitWatcher?.dispose();
      this.gitWatcher = undefined;
    } else if (this.view) {
      this.configureGitWatcher();
    }
  }

  private configureGitWatcher(): void {
    if (this.gitWatcher || this.builtInGitSyncAvailable) return;
    this.gitWatcher = vscode.workspace.createFileSystemWatcher('**/.git/{HEAD,index,packed-refs,refs/**,MERGE_HEAD,REBASE_HEAD,CHERRY_PICK_HEAD,REVERT_HEAD}');
    const schedule = (uri: vscode.Uri) => {
      const root = this.repositoryForGitMetadata(uri.fsPath);
      if (root) this.localRefreshScheduler.schedule(root, 'history');
    };
    this.gitWatcher.onDidCreate(schedule);
    this.gitWatcher.onDidChange(schedule);
    this.gitWatcher.onDidDelete(schedule);
  }

  private repositoryForGitMetadata(fsPath: string): string | undefined {
    const resolved = path.resolve(fsPath);
    return [...this.repositories]
      .sort((left, right) => right.length - left.length)
      .find(root => resolved.startsWith(`${path.resolve(root)}${path.sep}.git${path.sep}`));
  }

  scheduleLocalRepositoryChange(root: string, kind: LocalRefreshKind): void {
    this.localRefreshScheduler.schedule(root, kind);
  }

  scheduleRepositoryDiscoveryRefresh(): void {
    this.service.invalidateRepositoryDiscovery();
    if (this.view?.visible) {
      void this.refresh().catch(error => { if (!(error instanceof vscode.CancellationError)) console.error(error); });
    }
  }

  private async refreshFromLocalChange(root: string, kind: LocalRefreshKind): Promise<void> {
    if (!this.root || !this.view?.visible || path.resolve(root) !== path.resolve(this.root)) return;
    if (this.backgroundFetchRoots.has(root) || this.mutations.isBusy(root) || Date.now() - this.lastInternalMutationAt < 1200) return;
    if (kind === 'history') {
      this.service.invalidateCaches(root);
      await this.refresh();
      return;
    }

    this.service.invalidateRepositoryState(root, ['status']);
    await this.refreshRepositoryStatus(root);
  }

  private async refreshRepositoryStatus(root: string): Promise<void> {
    const read = this.beginRead('local-status', root);
    try {
      const { repository, uncommitted } = await this.service.repositoryState(root, read.source.token);
      if (this.requests.isCurrent('local-status', read.identity, this.root)) {
        this.post({ type: 'repositoryStatus', repository, uncommitted, identity: read.identity });
      }
    } finally {
      this.finishRead('local-status', read.source);
    }
  }

  private async handle(message: GitWebviewMessage): Promise<void> {
    if (message.type === 'clientError') {
      this.logDiagnostic(`Webview runtime error: ${message.operation ?? 'Unknown client error'}`);
      return;
    }
    if (message.type === 'ready' || message.type === 'refresh') this.logDiagnostic(`Received webview message: ${message.type}.`);
    try {
      if (message.type === 'ready') return await this.refresh();
      if (message.type === 'refresh') {
        try { return await this.refresh(); }
        finally { this.post({ type: 'pending', pending: false }); }
      }
      if (message.type === 'selectRepo' && message.root) { this.cancelReads(); this.root = message.root; return await this.refresh(); }
      if (!this.root) return;
      if (message.type === 'loadLog') {
        const startedAt = Date.now();
        const channel = `log:${message.offset ?? 0}`;
        const read = this.beginRead(channel, this.root, message.generation);
        const filter = message.filter ?? {};
        if ((message.offset ?? 0) === 0 && this.requests.isGenerationCurrent(read.identity, this.root)) {
          this.activeFilters.set(this.root, filter);
        }
        try {
          const log = await this.service.log(this.root, message.offset ?? 0, 200, filter, read.source.token);
          if (this.requests.isCurrent(channel, read.identity, this.root)) {
            this.post({ type: 'log', log, identity: read.identity });
            this.logDiagnostic(`Lazy log page ${log.offset}: ${log.commits.length} commits${log.hasMore ? '+' : ''} in ${Date.now() - startedAt} ms.`);
          }
        } finally { this.finishRead(channel, read.source); }
        return;
      }
      if (message.type === 'performance') {
        this.logDiagnostic(`Webview performance: ${message.operation ?? 'render'} ${message.durationMs ?? 0} ms.`);
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
      if (message.type === 'pushRecoverySettings') {
        try { return await this.configurePushRecovery(); }
        finally { this.post({ type: 'pending', pending: false }); }
      }
      if (message.type === 'interactiveRebase' && message.plan) {
        const request = await this.prepareInteractiveRebase(message.plan);
        if (request) await this.runMutation(request, this.root);
        else this.post({ type: 'pending', pending: false });
        return;
      }
      if (message.type === 'diff' && message.hash && message.path) return await this.openDiff(message.hash, message.path, message.parent);
      if (message.type === 'compareDiff' && message.from && message.to && message.path) return await this.openCompareDiff(message.from, message.to, message.path);
      if (message.type === 'workingDiff' && message.path) return await vscode.commands.executeCommand('git.openChange', vscode.Uri.file(path.join(this.root, message.path)));
      if (message.type === 'fileDiff' && message.path) {
        const root = this.root;
        const channel = `diff:${message.path}`;
        const read = this.beginRead(channel, root, message.generation);
        try {
          const patch = await this.service.filePatch(
            root,
            message.path,
            message.hash,
            message.parent,
            message.working,
            read.source.token,
            message.from,
            message.to
          );
          if (this.requests.isCurrent(channel, read.identity, this.root)) {
            this.post({ type: 'fileDiffResult', path: message.path, patch, hash: message.hash, working: message.working, identity: read.identity });
          }
        } finally {
          this.finishRead(channel, read.source);
        }
        return;
      }
      if (message.type === 'openFile' && message.path) {
        await this.openWorkingTreeFile(this.root, message.path, message.hash);
        return;
      }
      if (message.type === 'searchAuthors' && message.query?.trim()) {
        const root = this.root;
        const channel = 'filter-authors';
        const read = this.beginRead(channel, root);
        try {
          const query = message.query.trim();
          const authors = await this.service.searchAuthors(root, query, read.source.token);
          if (this.requests.isCurrent(channel, read.identity, this.root)) {
            this.post({ type: 'filterAuthors', authors, query, repositoryId: root, identity: read.identity });
          }
        } catch (error) {
          if (!read.source.token.isCancellationRequested) {
            this.logDiagnostic(`Author search unavailable: ${error instanceof Error ? error.message : String(error)}`);
          }
        }
        finally { this.finishRead(channel, read.source); }
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
        else this.post({ type: 'pending', pending: false });
      }
      if (message.type === 'context') {
        this.post({ type: 'contextMenu', actions: contextActions(message.kind, message.current === true), context: { ...message, root: this.root } });
      }
      if (message.type === 'contextAction' && message.action) {
        try { await this.executeContextAction(message); }
        finally { this.post({ type: 'pending', pending: false }); }
      }
    } catch (error) {
      if (error instanceof vscode.CancellationError) {
        this.logDiagnostic(`Request cancelled: ${message.type}.`);
        return;
      }
      const text = error instanceof Error ? error.message : String(error);
      this.logDiagnostic(`Request failed (${message.type}): ${error instanceof Error ? error.stack ?? text : text}`);
      let operation: string | undefined;
      if (this.root && (message.type === 'mutate' || message.type === 'contextAction')) {
        try { operation = (await this.service.snapshot(this.root, undefined, true)).operation; }
        catch { /* Preserve and present the original Git error. */ }
      }
      const recovery = classifyGitError(text, { action: message.action, operation });
      if (recovery?.kind === 'pushRejected' && this.root) {
        const strategy = this.pushRecoveryPreferences.get(this.root);
        if (strategy !== 'ask') {
          try {
            await this.runMutation({ action: 'pushAfterUpdate', options: { strategy } }, this.root);
            return;
          } catch (recoveryError) {
            const detail = recoveryError instanceof Error ? recoveryError.message : String(recoveryError);
            this.post({ type: 'error', message: detail, scope: 'pushRecovery' });
            return;
          }
        }
      }
      if (recovery.kind === 'conflict' && operation) return;
      if (message.type === 'mutate' || message.type === 'contextAction') {
        this.post({ type: 'recovery', recovery, operation, request: { ref: message.ref, hash: message.hash, path: message.path } });
      } else this.post({ type: 'error', message: text, scope: message.type });
      if (message.type === 'mutate' || message.type === 'contextAction' || message.type === 'interactiveRebase' || message.type === 'pushRecoverySettings') {
        this.post({ type: 'pending', pending: false });
      }
    }
  }

  private beginRead(channel: GitReadChannel, root: string, generation?: number): { identity: GitRequestIdentity; source: vscode.CancellationTokenSource } {
    const identity = this.requests.begin(channel, root, generation);
    const source = new vscode.CancellationTokenSource();
    if (!this.requests.isGenerationCurrent(identity, root)) {
      source.cancel();
      return { identity, source };
    }
    this.readCancellations.get(channel)?.cancel();
    this.readCancellations.get(channel)?.dispose();
    this.readCancellations.set(channel, source);
    return { identity, source };
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
      this.post({ type: 'pending', pending: false });
      return;
    }
    this.cancelReads();
    this.requests.invalidate(root);
    this.mutationBusy.begin(root);
    this.post({ type: 'busy', busy: true, action: request.action, repositoryId: root });
    const startedAt = Date.now();
    this.logDiagnostic(`Mutation started: ${request.action} (${root}).`);
    let applied = false;
    let succeeded = false;
    let recoveryMessage: string | undefined;
    try {
      applied = await this.mutations.run(root, request);
      recoveryMessage = this.mutations.consumeRecoveryMessage(root);
      succeeded = true;
    } finally {
      this.logDiagnostic(`Mutation completed: ${request.action} in ${Date.now() - startedAt} ms (succeeded=${succeeded}, applied=${applied}).`);
      this.activeMutations.leave(mutationKey);
      this.lastInternalMutationAt = Date.now();
      if (this.mutationBusy.end(root) === 0) {
        this.post({
          type: 'busy', busy: false, action: request.action, repositoryId: root,
          durationMs: Date.now() - startedAt, succeeded, applied,
          feedback: actionFeedback(request.action), actionLabel: actionLabel(request.action)
        });
        if (recoveryMessage) this.post({ type: 'autoRecovery', message: recoveryMessage });
        if (this.root === root) this.schedulePostMutationRefresh(root);
      }
    }
  }

  private schedulePostMutationRefresh(root: string): void {
    const repositories = this.repositories.length ? this.repositories : [root];
    void this.refreshRepositoryContent(repositories, root)
      .catch(error => { if (!(error instanceof vscode.CancellationError)) console.error(error); });
  }

  private async executeContextAction(message: GitWebviewMessage): Promise<void> {
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
      const details = await mapWithConcurrency(message.hashes, 4, hash => this.service.commitDetail(root, hash));
      const selected = details.map(commit => ({ action: 'pick' as const, hash: commit.hash, subject: commit.subject }));
      this.post({ type: 'rebasePlan', plan: selected });
      return;
    }
    if (action === 'diff' && message.hash && message.path) return await this.openDiff(message.hash, message.path, message.parent, root);
    if (action === 'compareDiff' && message.from && message.to && message.path) return await this.openCompareDiff(message.from, message.to, message.path, root);
    if (action === 'openRevision' && message.hash && message.path) {
      await vscode.window.showTextDocument(revisionUri(root, message.hash, message.path), { preview: true });
      return;
    }
    if (action === 'openFile' && message.path) {
      await this.openWorkingTreeFile(root, message.path, message.hash);
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
    if (action === 'copyFormatted' && message.hash) {
      const detail = await this.service.commitDetail(root, message.hash);
      const fullText = formatFullCommitInfo(detail);
      await vscode.env.clipboard.writeText(fullText);
      vscode.window.setStatusBarMessage('$(check) Copied commit info to clipboard', 3000);
      return;
    }
    const request = await this.prepareMutation({ ...message, type: 'mutate', action });
    if (request) await this.runMutation(request, message.root);
  }

  private contextRoot(message: GitWebviewMessage): string {
    if (!this.root || !message.root || message.root !== this.root) {
      throw new Error('This context menu is stale because the active repository changed. Open the menu again.');
    }
    return this.root;
  }

  private async configurePushRecovery(): Promise<void> {
    if (!this.root) return;
    const current = this.pushRecoveryPreferences.get(this.root);
    const choices = [
      { label: 'Ask every time', description: 'Show Rebase and Merge together after a non-fast-forward push', strategy: 'ask' as const },
      { label: 'Always rebase', description: 'Fetch, rebase onto origin, then push', strategy: 'rebase' as const },
      { label: 'Always merge', description: 'Fetch, merge origin, then push', strategy: 'merge' as const }
    ];
    const choice = await vscode.window.showQuickPick(choices, {
      title: `Non-fast-forward Push · ${path.basename(this.root)}`,
      placeHolder: `Current: ${choices.find(item => item.strategy === current)?.label}`
    });
    if (!choice) return;
    await this.pushRecoveryPreferences.set(this.root, choice.strategy);
    this.post({ type: 'pushRecoveryPreference', strategy: choice.strategy });
  }

  private async prepareMutation(message: GitWebviewMessage): Promise<GitMutationRequest | undefined> {
    const action = message.action!;
    if (action === 'stash') {
      const value = await vscode.window.showInputBox({ title: 'Stash Changes', prompt: 'Stash message', value: `WIP on ${new Date().toLocaleString()}` });
      return value === undefined ? undefined : { action, options: { message: value, includeUntracked: true } };
    }
    if (action === 'stashFile') {
      const fileName = message.path ? path.basename(message.path) : 'file';
      const value = await vscode.window.showInputBox({
        title: `Stash File Changes · ${fileName}`,
        prompt: 'Stash message',
        value: `WIP on ${message.path ?? fileName}`
      });
      if (value === undefined) return undefined;
      return { action: 'stash', path: message.path, options: { message: value, includeUntracked: true, paths: message.path ? [message.path] : [] } };
    }
    if (action === 'createBranch') {
      const name = await vscode.window.showInputBox({ title: 'New Branch', prompt: 'Branch name', validateInput: validateRefName });
      if (!name) return undefined;
      const snapshot = await this.service.snapshot(this.root!);
      if (snapshot.refs.some(item => item.kind === 'local' && item.name === name)) {
        const choice = await vscode.window.showInformationMessage(`Branch ${name} already exists.`, 'Checkout Branch');
        return choice ? { action: 'checkout', ref: name } : undefined;
      }
      return { action, ref: message.ref, options: { name, checkout: true } };
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
      return { action, ref: branch.name };
    }
    if (action === 'checkoutRemote' && message.ref) {
      const snapshot = await this.service.snapshot(this.root!, undefined, true);
      const remoteRef = message.ref;
      const local = remoteRef.split('/').slice(1).join('/');
      const localBranch = snapshot.refs.find(item => item.kind === 'local' && item.name === local);
      if (!localBranch) return { action, ref: remoteRef };
      const counts = await this.service.git(this.root!, ['rev-list', '--left-right', '--count', `${local}...${remoteRef}`]);
      const [ahead, behind] = counts.stdout.trim().split(/\s+/).map(Number);
      if ((ahead || 0) > 0 || snapshot.changedCount > 0) {
        const consequences = [
          ahead ? `${ahead} unpublished commit(s)` : '',
          snapshot.changedCount ? `${snapshot.changedCount} working tree change(s)` : ''
        ].filter(Boolean).join(' and ');
        const choice = await vscode.window.showWarningMessage(
          `${local} has ${consequences}. Resetting will permanently drop them.`,
          { modal: true }, 'Keep Local', 'Reset to Origin'
        );
        if (choice === 'Reset to Origin') return { action: 'checkoutRemoteReset', options: { local, remoteRef, clean: snapshot.changedCount > 0, confirmed: true } };
        return choice === 'Keep Local' ? { action: 'checkout', ref: local } : undefined;
      }
      if ((behind || 0) > 0) {
        const choice = await vscode.window.showInformationMessage(
          `${local} is behind ${remoteRef}.`, { modal: true }, 'Update & Checkout', 'Keep Local'
        );
        if (!choice) return undefined;
        return choice === 'Update & Checkout' ? { action: 'checkoutRemoteReset', options: { local, remoteRef } } : { action: 'checkout', ref: local };
      }
      return { action: 'checkout', ref: local };
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
      return message.strategy === 'merge' || message.strategy === 'rebase'
        ? { action, options: { strategy: message.strategy } }
        : { action };
    }
    if (action === 'push') return { action, options: { forceLease: false, tags: false } };
    if (action === 'pushAfterUpdate' && (message.strategy === 'rebase' || message.strategy === 'merge')) {
      if (message.remember && this.root) await this.pushRecoveryPreferences.set(this.root, message.strategy);
      return { action, options: { strategy: message.strategy } };
    }
    if (action === 'pushOptions') {
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
      return { action: 'push', options: { forceLease: forceLease.value, tags: false } };
    }
    if (action === 'merge') {
      const mode = await vscode.window.showQuickPick([
        { label: 'Merge', noFf: false, squash: false }, { label: 'No Fast-Forward', noFf: true, squash: false },
        { label: 'Squash', noFf: false, squash: true }
      ], { title: `Merge ${message.ref} into Current` });
      return mode ? { action, ref: message.ref, options: { noFf: mode.noFf, squash: mode.squash } } : undefined;
    }
    if (action === 'rebase' && message.ref) {
      const snapshot = await this.service.snapshot(this.root!);
      const commits = await this.service.commitsInRange(this.root!, `${message.ref}..HEAD`, 200);
      const published = await this.service.publishedCommits(this.root!, commits.map(commit => commit.hash));
      const patterns = vscode.workspace.getConfiguration('gitnav').get<string[]>('protectedBranches', []);
      const protectedPattern = matchingProtectedBranchPattern(snapshot.head, patterns);
      if (!published.length && !protectedPattern) return { action, ref: message.ref };
      const details = [published.length ? `${published.length} commit(s) exist upstream and may require a force-with-lease push.` : '', protectedPattern ? `Current branch matches protected pattern "${protectedPattern}".` : ''].filter(Boolean).join(' ');
      const choice = await vscode.window.showWarningMessage(
        `Rebase ${snapshot.head} onto ${message.ref}? ${details} GitNav will not force-push automatically.`,
        { modal: true }, 'Rebase', 'Create Backup & Rebase');
      if (!choice) return undefined;
      if (choice === 'Create Backup & Rebase') {
        const name = `backup/${snapshot.head}-${new Date().toISOString().replace(/[:.]/g, '-')}`;
        await this.service.git(this.root!, ['branch', name, 'HEAD']);
      }
      return { action, ref: message.ref };
    }
    if (action === 'deleteRemote') {
      const refs: string[] = message.refs?.length ? message.refs : (message.ref ? [message.ref] : []);
      if (!refs.length) return undefined;
      const remoteMap = new Map<string, string[]>();
      for (const r of refs) {
        const parts = r.split('/');
        if (parts.length > 1) {
          const remote = parts[0];
          const branch = parts.slice(1).join('/');
          if (!remoteMap.has(remote)) remoteMap.set(remote, []);
          remoteMap.get(remote)!.push(branch);
        }
      }
      if (!remoteMap.size) return undefined;
      const [remote, branches] = [...remoteMap.entries()][0];
      return { action, ref: branches[0], refs: branches, options: { remote } };
    }
    if (action === 'deleteBranch' || action === 'forceDeleteBranch') {
      const force = action === 'forceDeleteBranch';
      const refs: string[] = message.refs?.length ? message.refs : (message.ref ? [message.ref] : []);
      const head = (await this.service.git(this.root!, ['rev-parse', '--abbrev-ref', 'HEAD'])).stdout.trim();
      const filtered = refs.filter((r: string) => r !== head);
      if (!filtered.length) {
        vscode.window.showWarningMessage('Cannot delete the currently checked-out branch.');
        return undefined;
      }
      if (filtered.length !== refs.length) {
        vscode.window.showWarningMessage(`The currently checked-out branch (${head}) will be excluded from deletion.`);
      }
      return { action: 'deleteBranch', ref: filtered[0], refs: filtered, options: { force } };
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
      return { action, ref: message.ref ?? message.hash, options: { detached: true } };
    }
    if (action === 'reset') {
      const mode = await vscode.window.showQuickPick([
        { label: 'Keep Changes Staged', description: 'Soft reset', value: 'soft' },
        { label: 'Keep Changes Unstaged', description: 'Mixed reset', value: 'mixed' },
        { label: 'Keep Non-conflicting Changes', description: 'Keep reset; stops on conflicts', value: 'keep' },
        { label: 'Discard Commits and Changes', description: 'Hard reset · cannot be undone from the working tree', value: 'hard' }
      ], { title: `Reset Current Branch to ${message.hash?.slice(0, 8)}` });
      return mode ? { action, ref: message.hash, options: { mode: mode.value } } : undefined;
    }
    if (action === 'tag') {
      const name = await vscode.window.showInputBox({ title: 'New Tag', prompt: 'Tag name', validateInput: validateRefName });
      if (!name) return undefined;
      const snapshot = await this.service.snapshot(this.root!);
      if (snapshot.refs.some(item => item.kind === 'tag' && item.name === name)) {
        const choice = await vscode.window.showInformationMessage(`Tag ${name} already exists.`, 'Show Tag');
        if (choice) this.post({ type: 'selectRef', ref: name });
        return undefined;
      }
      const tagMessage = await vscode.window.showInputBox({ title: `Tag ${name}`, prompt: 'Annotation message (leave empty for lightweight tag)' });
      return tagMessage === undefined ? undefined : { action, ref: message.hash, options: { name, message: tagMessage } };
    }
    if (action === 'undoCommit') {
      const head = (await this.service.git(this.root!, ['rev-parse', 'HEAD'])).stdout.trim();
      if (head !== message.hash) throw new Error('Undo Commit is available only for the current HEAD commit.');
      return { action, hash: message.hash };
    }
    if (action === 'editCommitMessage') {
      const hash = message.hash ?? message.ref;
      if (!hash) return undefined;
      const detail = await this.service.commitDetail(this.root!, hash);
      const newMessage = await vscode.window.showInputBox({
        title: `Edit Commit Message · ${hash.slice(0, 8)}`,
        prompt: 'New commit message',
        value: detail.message || detail.subject,
        ignoreFocusOut: true
      });
      if (newMessage === undefined) return undefined;
      if (!newMessage.trim()) {
        vscode.window.showErrorMessage('Commit message cannot be empty.');
        return undefined;
      }
      const head = (await this.service.git(this.root!, ['rev-parse', 'HEAD'])).stdout.trim();
      if (hash !== head) {
        const snapshot = await this.service.snapshot(this.root!);
        if (snapshot.changedCount) {
          throw new Error('Commit or stash working tree changes before editing past commit messages.');
        }
        const published = await this.service.publishedCommits(this.root!, [hash]);
        const patterns = vscode.workspace.getConfiguration('gitnav').get<string[]>('protectedBranches', []);
        const protectedPattern = matchingProtectedBranchPattern(snapshot.head, patterns);
        if (published.length || protectedPattern) {
          const note = published.length ? ' This commit exists upstream; completing this change may require a force-with-lease push.' : '';
          const protNote = protectedPattern ? ` Current branch matches protected pattern "${protectedPattern}".` : '';
          const choice = await vscode.window.showWarningMessage(
            `Edit past commit ${hash.slice(0, 8)} on ${snapshot.head}?${note}${protNote} GitNav will not force-push automatically.`,
            { modal: true }, 'Edit Message', 'Create Backup & Edit'
          );
          if (!choice) return undefined;
          if (choice === 'Create Backup & Edit') {
            const name = `backup/${snapshot.head}-${new Date().toISOString().replace(/[:.]/g, '-')}`;
            await this.service.git(this.root!, ['branch', name, 'HEAD']);
          }
        }
      }
      return { action, hash, options: { message: newMessage } };
    }
    if (action === 'amendCommit') {
      const snapshot = await this.service.snapshot(this.root!);
      if (snapshot.changedCount === 0) {
        vscode.window.showInformationMessage('No uncommitted changes in the working tree to amend.');
        return undefined;
      }
      const head = (await this.service.git(this.root!, ['rev-parse', 'HEAD'])).stdout.trim();
      const headDetail = await this.service.commitDetail(this.root!, head);
      const choice = await vscode.window.showQuickPick([
        { label: 'Amend Changes (Keep Message)', value: 'keep', description: `Amend ${snapshot.changedCount} file(s) into HEAD and keep "${headDetail.subject}"` },
        { label: 'Amend Changes & Edit Message…', value: 'edit', description: 'Amend files into HEAD and modify the commit message' }
      ], { title: `Amend Changes to HEAD (${head.slice(0, 8)})` });
      if (!choice) return undefined;
      let newMessage: string | undefined;
      if (choice.value === 'edit') {
        newMessage = await vscode.window.showInputBox({
          title: `Amend Commit Message · ${head.slice(0, 8)}`,
          prompt: 'Commit message',
          value: headDetail.message || headDetail.subject,
          ignoreFocusOut: true
        });
        if (newMessage === undefined) return undefined;
        if (!newMessage.trim()) {
          vscode.window.showErrorMessage('Commit message cannot be empty.');
          return undefined;
        }
      }
      return { action, hash: head, options: { stageAll: true, ...(newMessage ? { message: newMessage } : {}) } };
    }
    if (action === 'abort') {
      const files = await this.service.workingTreeFiles(this.root!);
      const hasResolvedChanges = files.some(file => !file.conflict);
      return { action, options: { operation: message.operation ?? '', hasResolvedChanges } };
    }
    return { action, ref: message.ref ?? message.hash, hash: message.hash, hashes: message.hashes, path: message.path, options: message.operation ? { operation: message.operation } : undefined };
  }

  private async prepareInteractiveRebase(plan: GitRebasePlanItem[]): Promise<GitMutationRequest | undefined> {
    if (!this.root || !plan.length) return undefined;
    const details = await mapWithConcurrency(plan, 4, item => this.service.commitDetail(this.root!, item.hash));
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
    const patterns = vscode.workspace.getConfiguration('gitnav').get<string[]>('protectedBranches', []);
    const protectedPattern = matchingProtectedBranchPattern(snapshot.head, patterns);
    const publishedNote = published.length
      ? ` ${published.length} selected commit(s) exist upstream; completing this change may require a force-with-lease push.`
      : '';
    const protectedNote = protectedPattern ? ` Current branch matches protected pattern "${protectedPattern}".` : '';
    let backup: string | undefined;
    if (published.length || protectedPattern) {
      backup = await vscode.window.showWarningMessage(
        `Rewrite ${plan.length} commit(s) on ${snapshot.head}?${publishedNote}${protectedNote} GitNav will not force-push automatically.`,
        { modal: true }, 'Rebase', 'Create Backup & Rebase');
      if (!backup) return undefined;
    }
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

  private async openCompareDiff(from: string, to: string, filePath: string, expectedRoot = this.root): Promise<void> {
    if (!expectedRoot) return;
    if (to === 'working tree') {
      const left = revisionUri(expectedRoot, from, filePath);
      const right = vscode.Uri.file(path.join(expectedRoot, filePath));
      const title = `${path.basename(filePath)} (${from} ↔ Working Tree)`;
      await vscode.commands.executeCommand('vscode.diff', left, right, title, { preview: true });
      return;
    }

    const left = revisionUri(expectedRoot, to, filePath);
    const right = revisionUri(expectedRoot, from, filePath);
    const title = `${path.basename(filePath)} (${from} ↔ ${to})`;
    await vscode.commands.executeCommand('vscode.diff', left, right, title, { preview: true });
  }

  private async openWorkingTreeFile(root: string, filePath: string, hash?: string): Promise<void> {
    const uri = vscode.Uri.file(path.join(root, filePath));
    const revision = this.activeRevisionLocation(root, filePath);
    try {
      await vscode.workspace.fs.stat(uri);
    } catch {
      const choice = hash
        ? await vscode.window.showInformationMessage('File is not available locally.', 'Restore from Commit')
        : await vscode.window.showInformationMessage('File is not available locally.');
      if (choice === 'Restore from Commit') {
        await this.runMutation({ action: 'getFile', hash, path: filePath }, root);
        await vscode.window.showTextDocument(uri, { preview: false });
      }
      return;
    }
    const editor = await vscode.window.showTextDocument(uri, { preview: false });
    if (revision) {
      const diff = await this.service.git(root, ['diff', '--no-ext-diff', '--unified=0', revision.ref, '--', filePath]);
      const targetLine = Math.min(editor.document.lineCount, mapRevisionLineToWorktree(diff.stdout, revision.line)) - 1;
      const position = new vscode.Position(Math.max(0, targetLine), 0);
      editor.selection = new vscode.Selection(position, position);
      editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
    }
  }

  private async loadFilterOptions(root: string): Promise<void> {
    const channel = 'filter-options';
    const read = this.beginRead(channel, root);
    try {
      const filterOptions = await this.service.filterOptions(root, read.source.token);
      if (this.requests.isCurrent(channel, read.identity, this.root)) {
        this.post({ type: 'filterOptions', filterOptions, repositoryId: root, identity: read.identity });
      }
    } catch (error) {
      if (!read.source.token.isCancellationRequested) {
        this.logDiagnostic(`Filter options unavailable: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    finally { this.finishRead(channel, read.source); }
  }

  private activeRevisionLocation(root: string, filePath: string): { ref: string; line: number } | undefined {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.uri.scheme !== 'gitnav-revision') return undefined;
    const query = new URLSearchParams(editor.document.uri.query);
    const ref = query.get('ref');
    if (query.get('root') !== root || query.get('path') !== filePath || !ref) return undefined;
    return { ref, line: editor.selection.active.line + 1 };
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

function contextAction(action: string, label = actionLabel(action), group: GitContextActionGroup = 'primary'): GitContextAction {
  return new GitContextAction(action, label, group);
}

function contextActions(kind?: string, current = false): GitContextAction[] {
  if (kind === 'local') return [
    ...(current ? [
      contextAction('update', 'Update Current Branch'), contextAction('push'), contextAction('workingDiff', 'Compare with Working Tree'),
      contextAction('createBranch', 'Create Branch from Here…', 'more'), contextAction('renameBranch', 'Rename Branch…', 'more'),
      contextAction('worktreeAdd', 'Create Worktree…', 'more'), contextAction('copy', 'Copy Branch Name', 'more')
    ] : [
      contextAction('checkout'), contextAction('compareCurrent', 'Compare with Current'), contextAction('merge'), contextAction('rebase'), contextAction('pushBranch'),
      contextAction('updateBranchFromOrigin', 'Update from Origin'), contextAction('checkoutUpdate', undefined, 'more'),
      contextAction('createBranch', 'Create Branch from Here…', 'more'), contextAction('renameBranch', 'Rename Branch…', 'more'),
      contextAction('workingDiff', 'Compare with Working Tree', 'more'), contextAction('checkoutRebase', undefined, 'more'),
      contextAction('worktreeAdd', 'Create Worktree…', 'more'), contextAction('copy', 'Copy Branch Name', 'more'),
      contextAction('deleteBranch', 'Delete Branch')
    ])
  ];
  if (kind === 'remote') return [
    contextAction('checkoutRemote'), contextAction('compareCurrent', 'Compare with Current'), contextAction('merge'), contextAction('rebase'),
    contextAction('checkoutUpdate', undefined, 'more'), contextAction('createBranch', 'Create Branch from Here…', 'more'),
    contextAction('workingDiff', 'Compare with Working Tree', 'more'), contextAction('pullInto', 'Pull into Current', 'more'),
    contextAction('copy', 'Copy Branch Name', 'more'), contextAction('deleteRemote', 'Delete Remote Branch', 'danger')
  ];
  if (kind === 'tag') return [contextAction('showInLog', 'Show in Log'), contextAction('checkout', 'Checkout Revision'), contextAction('createBranch', 'Create Branch from Tag…'), contextAction('copy', 'Copy Tag Name', 'more'), contextAction('deleteTag', 'Delete Tag', 'danger')];
  if (kind === 'stash') return [contextAction('stashApply', 'Apply Stash'), contextAction('stashPop', 'Pop Stash'), contextAction('stashDiff', 'Show Diff'), contextAction('stashBranch', 'Create Branch from Stash', 'more'), contextAction('stashDrop', 'Drop Stash', 'danger')];
  if (kind === 'commit') return [
    contextAction('workingDiff', 'Compare with Working Tree'), contextAction('cherryPick', 'Cherry-pick'), contextAction('revert', 'Revert Commit'), contextAction('createBranch', 'Create Branch Here…'),
    contextAction('editCommitMessage', 'Edit Commit Message…'), contextAction('amendCommit', 'Amend Changes to HEAD…'),
    contextAction('checkout', 'Checkout Revision', 'more'), contextAction('tag', 'Create Tag Here…', 'more'), contextAction('showRepository', 'Browse Repository at Revision', 'more'),
    contextAction('openWeb', 'Open on GitHub/GitLab', 'more'), contextAction('copy', 'Copy Commit Hash', 'more'), contextAction('copyShort', 'Copy Short Hash', 'more'), contextAction('copyMessage', 'Copy Commit Message', 'more'), contextAction('copyFormatted', 'Copy Full Commit Info', 'more'),
    contextAction('undoCommit', 'Undo HEAD Commit', 'more'), contextAction('reset', 'Reset Current Branch Here…', 'danger'), contextAction('dropCommit', 'Drop Commit', 'danger')
  ];
  if (kind === 'uncommitted') return [
    contextAction('amendCommit', 'Amend to HEAD Commit…'),
    contextAction('stash', 'Stash Changes…')
  ];
  if (kind === 'branches') return [
    contextAction('deleteBranch', 'Delete Selected Branches'),
    contextAction('forceDeleteBranch', 'Force Delete Selected Branches', 'danger')
  ];
  if (kind === 'remotes') return [
    contextAction('deleteRemote', 'Delete Selected Remote Branches', 'danger')
  ];
  if (kind === 'commits') return [contextAction('compare', 'Compare Versions'), contextAction('cherryPick', 'Cherry-pick in Selected Order'), contextAction('revert', 'Revert in Selected Order'), contextAction('interactiveRebase', 'Interactive Rebase…', 'danger')];
  if (kind === 'commitFile') return [
    contextAction('diff', 'Show Diff'), contextAction('fileHistory', 'Show File History'), contextAction('openRevision', 'Open Version at Revision'), contextAction('openFile', 'Open Working Tree File'),
    contextAction('copy', 'Copy Path', 'more'), contextAction('copyRelative', 'Copy Relative Path', 'more'), contextAction('revertFile', 'Revert This Commit’s File Changes', 'more'),
    contextAction('getFile', 'Restore File from Revision', 'danger')
  ];
  if (kind === 'compareFile') return [
    contextAction('compareDiff', 'Show Diff'),
    contextAction('openFile', 'Open Working Tree File'),
    contextAction('fileHistory', 'Show File History'),
    contextAction('copy', 'Copy Path', 'more'),
    contextAction('copyRelative', 'Copy Relative Path', 'more')
  ];
  if (kind === 'workingFile') return [contextAction('workingFileDiff', 'Show Diff'), contextAction('openFile', 'Open in Editor'), contextAction('stashFile', 'Stash File Changes…', 'more'), contextAction('rollbackFile', 'Discard File Changes', 'danger')];
  if (kind === 'worktree') return [contextAction('openWorktree', 'Open in New Window'), contextAction('worktreeTerminal', 'Open Terminal'), contextAction('worktreePrune', 'Prune Worktrees', 'more'), contextAction('worktreeRemove', 'Remove Worktree', 'danger')];
  if (kind === 'worktreeCurrent') return [contextAction('worktreeTerminal', 'Open Terminal'), contextAction('worktreePrune', 'Prune Worktrees', 'more')];
  return [];
}
