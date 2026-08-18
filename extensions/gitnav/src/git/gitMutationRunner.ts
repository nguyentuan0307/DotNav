import * as vscode from 'vscode';
import { GitMutationRequest, GitRepositorySnapshot } from './gitPanelModels';
import { GitRepositoryService } from './gitRepositoryService';
import { GitFetchCoordinator, GitFetchScope, RepositoryMutationQueue } from './gitPanelCoordinator';
import { destructiveWarning, protectedRemoteMutationPattern, requiresDestructiveConfirmation, supportsBackup } from './gitMutationSafety';
import { isActionAllowedDuringOperation, operationArguments } from './gitOperationFlow';
import { runGit } from './gitCli';
import { runInteractiveRebase } from './gitInteractiveRebase';
import { GitRebasePlanItem } from './gitPanelModels';
import { currentBranchPushArgs, currentBranchPushPlan, pushNamedBranchArgs, resetLocalBranchToRemoteCommands, sameNameRemoteBranchPlan, sameNameUpdateArgs, updateNamedBranchArgs } from './gitPush';
import { actionConfirmationLabel, actionLabel, actionProgress } from './gitActionPolicy';
import { prepareRecoveredPush } from './gitPushRecovery';
import { recoverMutationFailure } from './gitMutationRecovery';

class GitMutationExecutionContext {
  constructor(
    readonly root: string,
    readonly request: GitMutationRequest,
    readonly snapshot: GitRepositorySnapshot,
    readonly startedAt: number
  ) {}
}

export class GitMutationRunner {
  private readonly queue = new RepositoryMutationQueue();
  private readonly fetches = new GitFetchCoordinator();
  private readonly recoveryMessages = new Map<string, string>();
  constructor(private readonly service: GitRepositoryService) {}

  isBusy(root: string): boolean { return this.queue.isBusy(root); }

  consumeRecoveryMessage(root: string): string | undefined {
    const message = this.recoveryMessages.get(root);
    this.recoveryMessages.delete(root);
    return message;
  }

  async run(root: string, request: GitMutationRequest): Promise<boolean> {
    return this.queue.enqueue(root, () => this.runExclusive(root, request));
  }

  async fetchInBackground(root: string): Promise<void> {
    await this.fetchRemote(root, { kind: 'all' });
    this.service.markFetched(root);
    this.service.invalidateCaches(root);
    void vscode.commands.executeCommand('git.refresh').then(undefined, error => console.error('VS Code Git refresh failed', error));
  }

  private async runExclusive(root: string, request: GitMutationRequest): Promise<boolean> {
    if (request.action === 'fetch') {
      return this.execute(root, request, ['fetch', '--all', '--prune']);
    }
    const snapshot = await this.service.snapshot(root, undefined, true);
    const context = new GitMutationExecutionContext(root, request, snapshot, Date.now());
    const operation = snapshot.operation;
    if (operation && !isActionAllowedDuringOperation(request.action)) {
      throw new Error(`${request.action} is blocked while the repository is ${operation}. Continue, skip, or abort the current operation first.`);
    }
    const protectedPattern = this.protectedRemotePattern(snapshot.head, request);
    if (protectedPattern) {
      throw new Error(`This remote operation is blocked because the branch matches protected pattern "${protectedPattern}".`);
    }
    if (requiresDestructiveConfirmation(request)
      && !await confirmDestructive(root, request, this.service, snapshot)) return false;
    const args = await this.argumentsFor(context);
    if (!args) return false;
    return this.execute(root, request, args);
  }

  private async execute(root: string, request: GitMutationRequest, args: string[]): Promise<boolean> {
    const progress = actionProgress(request.action);
    return vscode.window.withProgress({
      location: progress === 'notification' ? vscode.ProgressLocation.Notification : vscode.ProgressLocation.Window,
      title: `Git: ${actionLabel(request.action)}`,
      cancellable: progress === 'notification'
    }, async (_progress, token) => {
      try {
        if (request.action === 'fetch') await this.fetchRemote(root, { kind: 'all' }, token);
        else await this.service.git(root, args, token);
      } catch (error) {
        const recovery = await recoverMutationFailure({
          snapshot: repositoryRoot => this.service.snapshot(repositoryRoot, undefined, true),
          git: (repositoryRoot, recoveryArgs) => this.service.git(repositoryRoot, recoveryArgs, token),
          hasConflicts: async repositoryRoot => (await this.service.workingTreeFiles(repositoryRoot)).some(file => file.conflict)
        }, root, request, error);
        if (!recovery.recovered) throw error;
        if (recovery.message) this.recoveryMessages.set(root, recovery.message);
      }
      if (request.action === 'fetch' || request.action === 'update') this.service.markFetched(root);
      this.service.invalidateCaches(root);
      void vscode.commands.executeCommand('git.refresh').then(undefined, error => console.error('VS Code Git refresh failed', error));
      return true;
    });
  }

  private async argumentsFor(context: GitMutationExecutionContext): Promise<string[] | undefined> {
    const { root, request, snapshot } = context;
    const ref = request.ref ?? request.hash ?? '';
    switch (request.action) {
      case 'fetch': return ['fetch', '--all', '--prune'];
      case 'pull': {
        const initialPlan = currentBranchPushPlan(snapshot);
        await this.fetchRemote(root, { kind: 'branch', branch: initialPlan.branch });
        const plan = currentBranchPushPlan(await this.service.snapshot(root, undefined, true));
        return sameNameUpdateArgs(plan, 'merge');
      }
      case 'update': {
        const initialPlan = currentBranchPushPlan(snapshot);
        await this.fetchRemote(root, { kind: 'branch', branch: initialPlan.branch });
        const plan = currentBranchPushPlan(await this.service.snapshot(root, undefined, true));
        if (!plan.remoteBranchExists) throw new Error(`${plan.destination} does not exist.`);
        const counts = await this.service.git(root, ['rev-list', '--left-right', '--count', `${plan.destination}...HEAD`]);
        const [incoming, outgoing] = counts.stdout.trim().split(/\s+/).map(Number);
        if (!(incoming || 0)) return ['status', '--short'];
        const requestedStrategy: 'merge' | 'rebase' | 'reset' | undefined = request.options?.strategy === 'reset'
          ? 'reset'
          : request.options?.strategy === 'rebase' ? 'rebase'
            : request.options?.strategy === 'merge' ? 'merge' : undefined;
        let strategy = requestedStrategy ?? 'merge';
        if ((outgoing || 0) > 0 && !requestedStrategy) {
          const choice = await vscode.window.showWarningMessage(
            `${snapshot.head} and ${plan.destination} have diverged.`, { modal: true }, 'Rebase', 'Merge'
          );
          if (!choice) return undefined;
          strategy = choice === 'Rebase' ? 'rebase' : 'merge';
        }
        return sameNameUpdateArgs(plan, strategy);
      }
      case 'push': return currentBranchPushArgs(
        currentBranchPushPlan(snapshot),
        { forceLease: request.options?.forceLease === true, tags: request.options?.tags === true }
      );
      case 'pushAfterUpdate': {
        const strategy = request.options?.strategy === 'rebase' ? 'rebase' : 'merge';
        return prepareRecoveredPush({
          git: async (repositoryRoot, args) => this.service.git(repositoryRoot, args),
          snapshot: repositoryRoot => this.service.snapshot(repositoryRoot, undefined, true)
        }, root, strategy);
      }
      case 'checkout': return this.checkoutArgs(context, ref, request.options?.detached === true);
      case 'checkoutUpdate': {
        const checkout = request.options?.remote ? await this.remoteCheckoutArgs(context, ref) : await this.checkoutArgs(context, ref);
        if (!checkout) return undefined;
        await this.service.git(root, checkout);
        const checkedOut = await this.service.snapshot(root, undefined, true);
        const initialPlan = currentBranchPushPlan(checkedOut);
        await this.fetchRemote(root, { kind: 'branch', branch: initialPlan.branch });
        const plan = currentBranchPushPlan(await this.service.snapshot(root, undefined, true));
        return sameNameUpdateArgs(plan, request.options?.rebase ? 'rebase' : 'merge');
      }
      case 'checkoutRemote': return this.remoteCheckoutArgs(context, ref);
      case 'checkoutRemoteReset': {
        const local = String(request.options?.local);
        const remoteRef = String(request.options?.remoteRef);
        const commands = resetLocalBranchToRemoteCommands(snapshot.head, local, remoteRef, request.options?.clean === true);
        for (const command of commands.slice(0, -1)) await this.service.git(root, command);
        return commands.at(-1)!;
      }
      case 'checkoutRebase': {
        const oldHead = (await this.service.git(root, ['rev-parse', 'HEAD'])).stdout.trim();
        const checkout = await this.checkoutArgs(context, ref);
        if (!checkout) return undefined;
        await this.service.git(root, checkout);
        return ['rebase', oldHead];
      }
      case 'createBranch': return request.options?.checkout === false
        ? ['branch', String(request.options?.name), ref || 'HEAD']
        : ['switch', '-c', String(request.options?.name), ref || 'HEAD'];
      case 'renameBranch': return ['branch', '-m', ref, String(request.options?.name)];
      case 'deleteBranch': {
        const targetRefs = request.refs?.length ? request.refs : [ref];
        return ['branch', request.options?.force ? '-D' : '-d', ...targetRefs];
      }
      case 'deleteRemote': {
        const targetRefs = request.refs?.length ? request.refs : [ref];
        return ['push', String(request.options?.remote), '--delete', ...targetRefs];
      }
      case 'merge': return ['merge', ...(request.options?.noFf ? ['--no-ff'] : []), ...(request.options?.squash ? ['--squash'] : []), ref];
      case 'rebase': return ['rebase', ref];
      case 'worktreeAdd': return ['worktree', 'add', ...(request.options?.newBranch ? ['-b', String(request.options.newBranch)] : []), String(request.path), ref];
      case 'worktreeRemove': return ['worktree', 'remove', ...(request.options?.force ? ['--force'] : []), String(request.path)];
      case 'worktreePrune': return ['worktree', 'prune'];
      case 'worktreeLock': return ['worktree', 'lock', ...(request.options?.reason ? ['--reason', String(request.options.reason)] : []), String(request.path)];
      case 'worktreeUnlock': return ['worktree', 'unlock', String(request.path)];
      case 'interactiveRebase': {
        const plan = JSON.parse(String(request.options?.plan ?? '[]')) as GitRebasePlanItem[];
        await runInteractiveRebase(root, String(request.options?.base), plan);
        return ['status', '--short'];
      }
      case 'cherryPick': return ['cherry-pick', ...(request.options?.noCommit ? ['--no-commit'] : []), ...(request.hashes ?? [ref])];
      case 'revert': return ['revert', ...(request.hashes ?? [ref])];
      case 'undoCommit': return ['reset', '--soft', 'HEAD^'];
      case 'reset': return ['reset', `--${String(request.options?.mode ?? 'mixed')}`, ref];
      case 'stash': {
        const paths = Array.isArray(request.options?.paths)
          ? (request.options.paths as string[])
          : (request.path ? [request.path] : []);
        return [
          'stash', 'push',
          ...(request.options?.includeUntracked ? ['--include-untracked'] : []),
          ...(request.options?.keepIndex ? ['--keep-index'] : []),
          '-m', String(request.options?.message ?? ''),
          ...(paths.length ? ['--', ...paths] : [])
        ];
      }
      case 'stashApply': return ['stash', 'apply', ref];
      case 'stashPop': return ['stash', 'pop', ref];
      case 'stashDrop': return ['stash', 'drop', ref];
      case 'stashBranch': return ['stash', 'branch', String(request.options?.name), ref];
      case 'tag': return ['tag', ...(request.options?.message ? ['-a', '-m', String(request.options.message)] : []), String(request.options?.name), ref];
      case 'deleteTag': {
        if (request.options?.remote) {
          await this.service.git(root, ['tag', '-d', ref]);
          return ['push', String(request.options.remote), `:refs/tags/${ref}`];
        }
        return ['tag', '-d', ref];
      }
      case 'pushBranch': return pushNamedBranchArgs(ref, String(request.options?.remote ?? 'origin'));
      case 'updateBranchFromOrigin': {
        const plan = sameNameRemoteBranchPlan(snapshot, ref);
        return updateNamedBranchArgs(plan);
      }
      case 'pullInto': return ['pull', request.options?.rebase ? '--rebase' : '--no-rebase', String(request.options?.remote), String(request.options?.branch)];
      case 'dropCommit': return ['rebase', '--onto', `${ref}^`, ref, 'HEAD'];
      case 'rollbackFile': return ['restore', '--staged', '--worktree', '--', String(request.path)];
      case 'getFile': return ['restore', '--source', ref, '--', String(request.path)];
      case 'revertFile': {
        await this.service.reverseFileChange(root, ref, String(request.path));
        return ['status', '--short'];
      }
      case 'continue': return operationArguments(String(request.options?.operation), 'continue');
      case 'abort': return operationArguments(String(request.options?.operation), 'abort');
      case 'skip': return operationArguments(String(request.options?.operation), 'skip');
      case 'commitEmptyContinue': {
        await this.service.git(root, ['commit', '--allow-empty', '--no-edit']);
        const continued = await runGit(root, ['cherry-pick', '--continue']);
        if (continued.exitCode !== 0 && !/no cherry-pick|no cherry.pick/i.test(continued.stderr)) {
          throw new Error(continued.stderr.trim() || 'Unable to continue cherry-pick after creating the empty commit.');
        }
        return ['status', '--short'];
      }
      case 'editCommitMessage': {
        const head = (await this.service.git(root, ['rev-parse', 'HEAD'])).stdout.trim();
        const targetHash = ref || request.hash || head;
        const message = String(request.options?.message ?? '');
        if (!message.trim()) throw new Error('Commit message cannot be empty.');
        if (targetHash === head) {
          return ['commit', '--amend', '-m', message];
        }
        const commits = await this.service.commitsInRange(root, `${targetHash}^..HEAD`, 500);
        if (!commits.length) throw new Error('Could not find commit range for rebase.');
        const ordered = [...commits].reverse();
        const plan: GitRebasePlanItem[] = ordered.map(item => {
          if (item.hash === targetHash) {
            return { action: 'reword', hash: item.hash, subject: item.subject, message };
          }
          return { action: 'pick', hash: item.hash, subject: item.subject };
        });
        const targetDetail = await this.service.commitDetail(root, targetHash);
        const base = targetDetail.parents[0];
        if (!base) throw new Error('The root commit cannot be interactively rebased.');
        await runInteractiveRebase(root, base, plan);
        return ['status', '--short'];
      }
      case 'amendCommit': {
        if (request.options?.stageAll === true) {
          await this.service.git(root, ['add', '-A']);
        }
        const message = request.options?.message !== undefined ? String(request.options.message) : undefined;
        if (message !== undefined) {
          if (!message.trim()) throw new Error('Commit message cannot be empty.');
          return ['commit', '--amend', '-m', message];
        }
        return ['commit', '--amend', '--no-edit'];
      }
      default: throw new Error(`Unsupported Git action: ${request.action}`);
    }
  }

  private fetchRemote(root: string, scope: GitFetchScope, token?: vscode.CancellationToken): Promise<void> {
    const args = scope.kind === 'all'
      ? ['fetch', '--all', '--prune']
      : ['fetch', 'origin', `+refs/heads/${scope.branch}:refs/remotes/origin/${scope.branch}`];
    return this.fetches.run(root, scope, async () => { await this.service.git(root, args, token); });
  }

  private protectedRemotePattern(branch: string, request: GitMutationRequest): string | undefined {
    const patterns = vscode.workspace.getConfiguration('gitnav')
      .get<string[]>('protectedBranches', ['main', 'master', 'develop', 'release/*']);
    return protectedRemoteMutationPattern(branch, request, patterns);
  }

  private async checkoutArgs(context: GitMutationExecutionContext, ref: string, detached = false, track = false): Promise<string[] | undefined> {
    const { root, snapshot } = context;
    const base = ['switch', ...(detached ? ['--detach'] : []), ...(track ? ['--track'] : []), ref];
    if (snapshot.operation) throw new Error(`Checkout is blocked while the repository is ${snapshot.operation}. Continue or abort that operation first.`);
    if (!detached && snapshot.head === ref) {
      return undefined;
    }
    if (!snapshot.changedCount) return base;
    const choice = await vscode.window.showWarningMessage(
      `Checkout ${ref} while ${snapshot.changedCount} working tree file(s) have changes. Discarding may permanently lose work.`,
      { modal: true }, 'Stash & Checkout', 'Move Changes to New Branch', 'Discard Changes & Checkout'
    );
    if (choice === 'Stash & Checkout') {
      await this.service.git(root, ['stash', 'push', '--include-untracked', '-m', `Auto stash before checkout ${ref}`]);
      return base;
    }
    if (choice === 'Move Changes to New Branch') {
      const name = await vscode.window.showInputBox({ title: 'Move Changes to New Branch', prompt: 'New branch name', validateInput: validateBranchName });
      return name ? ['switch', '-c', name] : undefined;
    }
    return choice === 'Discard Changes & Checkout' ? ['switch', '--discard-changes', ...(detached ? ['--detach'] : []), ...(track ? ['--track'] : []), ref] : undefined;
  }

  private async remoteCheckoutArgs(context: GitMutationExecutionContext, ref: string): Promise<string[] | undefined> {
    const { snapshot } = context;
    const remoteSeparator = ref.indexOf('/');
    const localName = remoteSeparator >= 0 ? ref.slice(remoteSeparator + 1) : ref;
    const localExists = snapshot.refs.some(item => item.kind === 'local' && item.name === localName);
    return this.checkoutArgs(context, localExists ? localName : ref, false, !localExists);
  }
}

async function confirmDestructive(
  root: string,
  request: GitMutationRequest,
  service: GitRepositoryService,
  snapshot: GitRepositorySnapshot
): Promise<boolean> {
  const canBackup = supportsBackup(request);
  const confirmationLabel = actionConfirmationLabel(request);
  const backupLabel = `Create Backup & ${confirmationLabel}`;
  const choice = await vscode.window.showWarningMessage(
    destructiveWarning(request, snapshot.head, snapshot.upstream),
    { modal: true }, confirmationLabel, ...(canBackup ? [backupLabel] : [])
  );
  if (choice === backupLabel) {
    const name = `backup/${snapshot.head}-${new Date().toISOString().replace(/[:.]/g, '-')}`;
    await service.git(root, ['branch', name, 'HEAD']);
  }
  return choice === confirmationLabel || choice === backupLabel;
}
function validateBranchName(value: string): string | undefined { return value && !/[~^:?*[\\\s]|\.\.|@\{|\/$/.test(value) ? undefined : 'Enter a valid Git branch name.'; }
