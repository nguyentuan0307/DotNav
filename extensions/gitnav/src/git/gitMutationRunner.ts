import * as vscode from 'vscode';
import { GitMutationRequest } from './gitPanelModels';
import { GitRepositoryService } from './gitRepositoryService';
import { RepositoryMutationQueue } from './gitPanelCoordinator';
import { destructiveWarning, protectedRemoteMutationPattern, requiresDestructiveConfirmation, supportsBackup } from './gitMutationSafety';
import { isActionAllowedDuringOperation, operationArguments } from './gitOperationFlow';
import { runGit } from './gitCli';
import { runInteractiveRebase } from './gitInteractiveRebase';
import { GitRebasePlanItem } from './gitPanelModels';
import { currentBranchPushArgs, currentBranchPushPlan, pushNamedBranchArgs, sameNameRemoteBranchPlan, sameNameUpdateArgs, updateNamedBranchArgs } from './gitPush';

export class GitMutationRunner {
  private readonly queue = new RepositoryMutationQueue();
  constructor(private readonly service: GitRepositoryService) {}

  isBusy(root: string): boolean { return this.queue.isBusy(root); }

  async run(root: string, request: GitMutationRequest): Promise<boolean> {
    return this.queue.enqueue(root, () => this.runExclusive(root, request));
  }

  private async runExclusive(root: string, request: GitMutationRequest): Promise<boolean> {
    const operation = (await this.service.snapshot(root)).operation;
    if (operation && !isActionAllowedDuringOperation(request.action)) {
      throw new Error(`${request.action} is blocked while the repository is ${operation}. Continue, skip, or abort the current operation first.`);
    }
    const snapshot = await this.service.snapshot(root);
    const protectedPattern = this.protectedRemotePattern(snapshot.head, request);
    if (protectedPattern) {
      throw new Error(`This remote operation is blocked because the branch matches protected pattern "${protectedPattern}".`);
    }
    if (requiresDestructiveConfirmation(request)
      && !await confirmDestructive(root, request, this.service, snapshot.head, snapshot.upstream)) return false;
    const args = await this.argumentsFor(root, request);
    if (!args) return false;
    return vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title: `Git: ${labelFor(request.action)}`,
      cancellable: true
    }, async (_progress, token) => {
      await this.service.git(root, args, token);
      if (request.action === 'fetch' || request.action === 'update') this.service.markFetched(root);
      this.service.invalidateCaches(root);
      await vscode.commands.executeCommand('git.refresh');
      return true;
    });
  }

  private async argumentsFor(root: string, request: GitMutationRequest): Promise<string[] | undefined> {
    const ref = request.ref ?? request.hash ?? '';
    switch (request.action) {
      case 'fetch': return ['fetch', '--all', '--prune'];
      case 'pull': {
        await this.service.git(root, ['fetch', 'origin']);
        const plan = currentBranchPushPlan(await this.service.snapshot(root));
        return sameNameUpdateArgs(plan, 'merge');
      }
      case 'update': {
        await this.service.git(root, ['fetch', 'origin', '--prune']);
        const plan = currentBranchPushPlan(await this.service.snapshot(root));
        const strategy = request.options?.strategy === 'reset'
          ? 'reset'
          : request.options?.strategy === 'rebase' ? 'rebase' : 'merge';
        return sameNameUpdateArgs(plan, strategy);
      }
      case 'push': return currentBranchPushArgs(
        currentBranchPushPlan(await this.service.snapshot(root)),
        { forceLease: request.options?.forceLease === true, tags: request.options?.tags === true }
      );
      case 'checkout': return this.checkoutArgs(root, ref, request.options?.detached === true);
      case 'checkoutUpdate': {
        const checkout = request.options?.remote ? await this.remoteCheckoutArgs(root, ref) : await this.checkoutArgs(root, ref);
        if (!checkout) return undefined;
        await this.service.git(root, checkout);
        await this.service.git(root, ['fetch', 'origin', '--prune']);
        const plan = currentBranchPushPlan(await this.service.snapshot(root));
        return sameNameUpdateArgs(plan, request.options?.rebase ? 'rebase' : 'merge');
      }
      case 'checkoutRemote': return this.remoteCheckoutArgs(root, ref);
      case 'checkoutRebase': {
        const oldHead = (await this.service.git(root, ['rev-parse', 'HEAD'])).stdout.trim();
        const checkout = await this.checkoutArgs(root, ref);
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
        const plan = sameNameRemoteBranchPlan(await this.service.snapshot(root), ref);
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

  private async checkoutArgs(root: string, ref: string, detached = false, track = false): Promise<string[] | undefined> {
    const base = ['switch', ...(detached ? ['--detach'] : []), ...(track ? ['--track'] : []), ref];
    const snapshot = await this.service.snapshot(root);
    if (snapshot.operation) throw new Error(`Checkout is blocked while the repository is ${snapshot.operation}. Continue or abort that operation first.`);
    if (!detached && snapshot.head === ref) {
      void vscode.window.showInformationMessage(`${ref} is already checked out.`);
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

  private async remoteCheckoutArgs(root: string, ref: string): Promise<string[] | undefined> {
    const snapshot = await this.service.snapshot(root);
    const remoteSeparator = ref.indexOf('/');
    const localName = remoteSeparator >= 0 ? ref.slice(remoteSeparator + 1) : ref;
    const localExists = snapshot.refs.some(item => item.kind === 'local' && item.name === localName);
    return this.checkoutArgs(root, localExists ? localName : ref, false, !localExists);
  }
}

async function confirmDestructive(
  root: string,
  request: GitMutationRequest,
  service: GitRepositoryService,
  branch: string,
  upstream?: string
): Promise<boolean> {
  const canBackup = supportsBackup(request);
  const choice = await vscode.window.showWarningMessage(
    destructiveWarning(request, branch, upstream),
    { modal: true }, 'Continue', ...(canBackup ? ['Create Backup & Continue'] : [])
  );
  if (choice === 'Create Backup & Continue') {
    const snapshot = await service.snapshot(root);
    const name = `backup/${snapshot.head}-${new Date().toISOString().replace(/[:.]/g, '-')}`;
    await service.git(root, ['branch', name, 'HEAD']);
  }
  return choice === 'Continue' || choice === 'Create Backup & Continue';
}

function labelFor(action: string): string { return action.replace(/([A-Z])/g, ' $1').toLowerCase(); }
function validateBranchName(value: string): string | undefined { return value && !/[~^:?*[\\\s]|\.\.|@\{|\/$/.test(value) ? undefined : 'Enter a valid Git branch name.'; }
