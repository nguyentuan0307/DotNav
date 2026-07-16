import { GitMutationRequest } from './gitPanelModels';
import { matchingProtectedBranchPattern } from './gitBranchProtection';

export function protectedRemoteMutationPattern(
  currentBranch: string,
  request: GitMutationRequest,
  patterns: readonly string[]
): string | undefined {
  if (request.action === 'push' && request.options?.forceLease === true) {
    return matchingProtectedBranchPattern(currentBranch, patterns);
  }
  if (request.action === 'deleteRemote') {
    return matchingProtectedBranchPattern(request.ref ?? '', patterns);
  }
  return undefined;
}

export function requiresDestructiveConfirmation(request: GitMutationRequest): boolean {
  if (request.action === 'reset') return request.options?.mode === 'hard';
  if (request.action === 'deleteBranch') return request.options?.force === true;
  if (request.action === 'worktreeRemove') return request.options?.force === true;
  if (request.action === 'deleteTag') return request.options?.remote !== undefined;
  if (request.action === 'abort') return request.options?.hasResolvedChanges === true;
  if (request.action === 'checkoutRemoteReset') return request.options?.confirmed !== true;
  return destructiveActions.has(request.action)
    || request.action === 'update' && request.options?.strategy === 'reset'
    || request.action === 'push' && request.options?.forceLease === true;
}

export function supportsBackup(request: GitMutationRequest): boolean {
  return ['reset', 'dropCommit'].includes(request.action)
    || request.action === 'update' && request.options?.strategy === 'reset';
}

export function destructiveWarning(request: GitMutationRequest, branch: string, upstream?: string): string {
  if (request.action === 'reset') {
    const target = request.ref ?? 'the selected commit';
    const mode = String(request.options?.mode ?? 'mixed');
    const effect: Record<string, string> = {
      soft: 'Removed commits remain staged. Working tree files are unchanged.',
      mixed: 'Removed commits remain in the working tree but become unstaged.',
      hard: 'Removed commits and all tracked working tree changes will be permanently discarded.',
      keep: 'Local changes are kept when possible; Git will stop if they conflict with the reset.'
    };
    return `Reset ${branch} to ${target} (${mode})? ${effect[mode] ?? effect.mixed}`;
  }
  if (request.action === 'update' && request.options?.strategy === 'reset') {
    return `Reset ${branch} to ${request.options?.destination ?? upstream ?? 'its same-named origin branch'} (hard)? Local commits and all tracked working tree changes will be permanently discarded.`;
  }
  const detail: Record<string, string> = {
    deleteRemote: `Remote branch ${request.ref} will be deleted for every collaborator.`,
    stashDrop: `${request.ref} will be permanently removed.`,
    rollbackFile: `All uncommitted changes in ${request.path} will be permanently discarded.`,
    getFile: `${request.path} in the working tree will be overwritten.`,
    undoCommit: `Undo the HEAD commit on ${branch}? Its changes will remain staged.`,
    dropCommit: `Remove commit ${request.ref} from ${branch}? This rewrites local history; a force push may be required if it was published.`,
    deleteBranch: `Local branch ${request.ref} will be deleted${request.options?.force ? ' even if it is not merged' : ''}.`,
    deleteTag: `Tag ${request.ref} will be deleted${request.options?.remote ? ` locally and from ${request.options.remote}` : ' locally'}.`,
    abort: `The current ${String(request.options?.operation ?? 'Git operation').toLowerCase()} will be aborted and its in-progress changes discarded.`,
    worktreeRemove: `Remove worktree ${request.path}?${request.options?.force ? ` Its ${request.options.changedCount ?? ''} uncommitted file(s) will be permanently discarded.` : ''}`,
    checkoutRemoteReset: `Reset ${request.options?.local ?? branch} to ${request.options?.remoteRef ?? 'origin'}? Local commits and working tree changes will be permanently discarded.`
  };
  return detail[request.action] ?? `Continue with ${request.action}?`;
}

const destructiveActions = new Set([
  'deleteRemote', 'stashDrop', 'rollbackFile', 'getFile', 'dropCommit'
]);
