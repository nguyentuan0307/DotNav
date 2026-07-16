import * as vscode from 'vscode';
import { GitMutationRequest, GitRepositorySnapshot } from './gitPanelModels';
import { GitRepositoryService } from './gitRepositoryService';
import { RepositoryMutationQueue } from './gitPanelCoordinator';
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

  private async runExclusive(root: string, request: GitMutationRequest): Promise<boolean> {
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
    const progress = actionProgress(request.action);
    return vscode.window.withProgress({
      location: progress === 'notification' ? vscode.ProgressLocation.Notification : vscode.ProgressLocation.Window,
      title: `Git: ${actionLabel(request.action)}`,
      cancellable: progress === 'notification'
    }, async (_progress, token) => {
      try {
        await this.service.git(root, args, token);
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
        await this.service.git(root, ['fetch', 'origin']);
        const plan = currentBranchPushPlan(await this.service.snapshot(root, undefined, true));
        return sameNameUpdateArgs(plan, 'merge');
      }
      case 'update': {
        await this.service.git(root, ['fetch', 'origin', '--prune']);
        const plan = currentBranchPushPlan(await this.service.snapshot(root, undefined, true));
        const strategy = request.options?.strategy === 'reset'
          ? 'reset'
          : request.options?.strategy === 'rebase' ? 'rebase' : 'merge';
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
        await this.service.git(root, ['fetch', 'origin', '--prune']);
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
      case 'deleteBranch': return ['branch', request.options?.force ? '-D' : '-d', ref];
      case 'deleteRemote': return ['push', String(request.options?.remote), '--delete', ref];
      case 'merge': return ['merge', ...(request.options?.noFf ? ['--no-ff'] : []), ...(request.options?.squash ? ['--squash'] : []), ref];
      case 'rebase': return ['rebase', ref];
      case 'worktreeAdd': return ['worktree', 'add', ...(request.options?.newBranch ? ['-b', String(request.options.newBranch)] : []), String(request.path), ref];
      case 'worktreeRemove': return ['worktree', 'remove', ...(request.options?.force ? ['--force'] : []), String(request.path)];
      case 'worktreePrune': return ['worktree', 'prune'];
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
      case 'stash': return ['stash', 'push', ...(request.options?.includeUntracked ? ['--include-untracked'] : []), ...(request.options?.keepIndex ? ['--keep-index'] : []), '-m', String(request.options?.message ?? '')];
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
      default: throw new Error(`Unsupported Git action: ${request.action}`);
    }
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
