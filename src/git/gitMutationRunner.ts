import * as vscode from 'vscode';
import { GitMutationRequest } from './gitPanelModels';
import { GitRepositoryService } from './gitRepositoryService';
import { RepositoryMutationQueue } from './gitPanelCoordinator';
import { matchingProtectedBranchPattern } from './gitBranchProtection';

export class GitMutationRunner {
  private readonly queue = new RepositoryMutationQueue();
  constructor(private readonly service: GitRepositoryService) {}

  isBusy(root: string): boolean { return this.queue.isBusy(root); }

  async run(root: string, request: GitMutationRequest): Promise<boolean> {
    return this.queue.enqueue(root, () => this.runExclusive(root, request));
  }

  private async runExclusive(root: string, request: GitMutationRequest): Promise<boolean> {
    const protectedPattern = await this.protectedPattern(root);
    if ((historyRewriteActions.has(request.action) || request.action === 'update' && request.options?.strategy === 'reset') && protectedPattern) {
      throw new Error(`This operation is blocked because the current branch matches protected pattern "${protectedPattern}".`);
    }
    if (destructiveActions.has(request.action) && !await confirmDestructive(request)) return false;
    const args = await this.argumentsFor(root, request);
    if (!args) return false;
    return vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title: `Git: ${labelFor(request.action)}`,
      cancellable: true
    }, async (_progress, token) => {
      await this.service.git(root, args, token);
      await vscode.commands.executeCommand('git.refresh');
      return true;
    });
  }

  private async argumentsFor(root: string, request: GitMutationRequest): Promise<string[] | undefined> {
    const ref = request.ref ?? request.hash ?? '';
    switch (request.action) {
      case 'fetch': return ['fetch', '--all', '--prune'];
      case 'pull': return ['pull', request.options?.rebase ? '--rebase' : '--no-rebase'];
      case 'update': {
        await this.service.git(root, ['fetch', '--all', '--prune']);
        if (request.options?.strategy === 'reset') {
          const snapshot = await this.service.snapshot(root);
          if (!snapshot.upstream) throw new Error('The current branch has no upstream branch.');
          return ['reset', '--hard', snapshot.upstream];
        }
        return ['pull', request.options?.strategy === 'rebase' ? '--rebase' : '--no-rebase'];
      }
      case 'push': return ['push', ...(request.options?.forceLease ? ['--force-with-lease'] : []), ...(request.options?.tags ? ['--tags'] : [])];
      case 'checkout': return this.checkoutArgs(root, ref, request.options?.detached === true);
      case 'checkoutUpdate': {
        const checkout = request.options?.remote ? await this.remoteCheckoutArgs(root, ref) : await this.checkoutArgs(root, ref);
        if (!checkout) return undefined;
        await this.service.git(root, checkout);
        return ['pull', request.options?.rebase ? '--rebase' : '--no-rebase'];
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
      case 'pushBranch': return ['push', '-u', String(request.options?.remote ?? 'origin'), ref];
      case 'pullInto': return ['pull', request.options?.rebase ? '--rebase' : '--no-rebase', String(request.options?.remote), String(request.options?.branch)];
      case 'dropCommit': return ['rebase', '--onto', `${ref}^`, ref, 'HEAD'];
      case 'rollbackFile': return ['restore', '--staged', '--worktree', '--', String(request.path)];
      case 'getFile': return ['restore', '--source', ref, '--', String(request.path)];
      case 'revertFile': {
        await this.service.reverseFileChange(root, ref, String(request.path));
        return ['status', '--short'];
      }
      case 'continue': return operationCommand(request.options?.operation, '--continue');
      case 'abort': return operationCommand(request.options?.operation, '--abort');
      case 'skip': return operationCommand(request.options?.operation, '--skip');
      default: throw new Error(`Unsupported Git action: ${request.action}`);
    }
  }

  private async protectedPattern(root: string): Promise<string | undefined> {
    const branch = (await this.service.snapshot(root)).head;
    const patterns = vscode.workspace.getConfiguration('dotnetSolutionNavigator.gitLog')
      .get<string[]>('protectedBranches', ['main', 'master', 'develop', 'release/*']);
    return matchingProtectedBranchPattern(branch, patterns);
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

const destructiveActions = new Set(['deleteRemote', 'stashDrop', 'rollbackFile', 'getFile', 'undoCommit', 'reset', 'dropCommit']);
const historyRewriteActions = new Set(['undoCommit', 'reset', 'dropCommit']);

async function confirmDestructive(request: GitMutationRequest): Promise<boolean> {
  const detail: Record<string, string> = {
    deleteRemote: `Remote branch ${request.ref} will be deleted for every collaborator.`,
    stashDrop: `${request.ref} will be permanently removed.`,
    rollbackFile: `All uncommitted changes in ${request.path} will be permanently discarded.`,
    getFile: `${request.path} in the working tree will be overwritten.`,
    undoCommit: 'The HEAD commit will be removed and its changes moved to the index.',
    reset: `The current branch will be reset to ${request.ref}. Hard mode permanently discards local changes.`
    ,dropCommit: `Commit ${request.ref} will be removed by rewriting branch history. A force push may be required.`
  };
  return await vscode.window.showWarningMessage(detail[request.action], { modal: true }, 'Continue') === 'Continue';
}

function operationCommand(operation: boolean | string | undefined, flag: string): string[] {
  const name = String(operation ?? '').toLowerCase();
  if (name.includes('rebas')) return ['rebase', flag];
  if (name.includes('cherry')) return ['cherry-pick', flag];
  if (name.includes('revert')) return ['revert', flag];
  return ['merge', flag];
}

function labelFor(action: string): string { return action.replace(/([A-Z])/g, ' $1').toLowerCase(); }
function validateBranchName(value: string): string | undefined { return value && !/[~^:?*[\\\s]|\.\.|@\{|\/$/.test(value) ? undefined : 'Enter a valid Git branch name.'; }
