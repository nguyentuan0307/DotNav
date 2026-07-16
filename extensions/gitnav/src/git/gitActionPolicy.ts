import { GitMutationRequest } from './gitPanelModels';

export type GitActionSeverity = 'normal' | 'danger';
export type GitActionFeedback = 'silent' | 'status' | 'toast';
export type GitActionProgress = 'window' | 'notification';
export type GitContextActionGroup = 'primary' | 'more' | 'danger';

export class GitActionPresentation {
  constructor(
    readonly label: string,
    readonly confirmationLabel: string,
    readonly severity: GitActionSeverity,
    readonly feedback: GitActionFeedback
  ) {}
}

export class GitContextAction {
  constructor(
    readonly action: string,
    readonly label: string,
    readonly group: GitContextActionGroup = 'primary'
  ) {}
}

const defaultPresentation = new GitActionPresentation('Git Operation', 'Run Operation', 'normal', 'toast');

const presentations: Readonly<Record<string, GitActionPresentation>> = {
  fetch: new GitActionPresentation('Fetch', 'Fetch', 'normal', 'silent'),
  pull: new GitActionPresentation('Pull', 'Pull', 'normal', 'status'),
  update: new GitActionPresentation('Update Branch', 'Update Branch', 'normal', 'status'),
  push: new GitActionPresentation('Push', 'Push', 'normal', 'status'),
  pushAfterUpdate: new GitActionPresentation('Update and Push', 'Update and Push', 'normal', 'status'),
  pushBranch: new GitActionPresentation('Push Branch', 'Push Branch', 'normal', 'status'),
  checkout: new GitActionPresentation('Checkout', 'Checkout', 'normal', 'status'),
  checkoutRemote: new GitActionPresentation('Checkout Tracking Branch', 'Checkout', 'normal', 'status'),
  checkoutRemoteReset: new GitActionPresentation('Reset to Origin', 'Reset to Origin', 'danger', 'toast'),
  checkoutUpdate: new GitActionPresentation('Checkout and Update', 'Checkout and Update', 'normal', 'status'),
  checkoutRebase: new GitActionPresentation('Checkout and Rebase', 'Checkout and Rebase', 'normal', 'status'),
  createBranch: new GitActionPresentation('Create Branch', 'Create Branch', 'normal', 'status'),
  renameBranch: new GitActionPresentation('Rename Branch', 'Rename Branch', 'normal', 'status'),
  deleteBranch: new GitActionPresentation('Delete Branch', 'Delete Branch', 'normal', 'status'),
  forceDeleteBranch: new GitActionPresentation('Force Delete Branch', 'Force Delete Branch', 'danger', 'toast'),
  deleteRemote: new GitActionPresentation('Delete Remote Branch', 'Delete Remote Branch', 'danger', 'toast'),
  merge: new GitActionPresentation('Merge into Current', 'Merge', 'normal', 'status'),
  rebase: new GitActionPresentation('Rebase Current onto This Branch', 'Rebase', 'normal', 'status'),
  interactiveRebase: new GitActionPresentation('Interactive Rebase', 'Run Rebase', 'danger', 'toast'),
  cherryPick: new GitActionPresentation('Cherry-pick', 'Cherry-pick', 'normal', 'status'),
  revert: new GitActionPresentation('Revert Commit', 'Revert Commit', 'normal', 'status'),
  undoCommit: new GitActionPresentation('Undo HEAD Commit', 'Undo Commit', 'normal', 'status'),
  reset: new GitActionPresentation('Reset Current Branch', 'Reset Branch', 'danger', 'toast'),
  dropCommit: new GitActionPresentation('Drop Commit', 'Drop Commit', 'danger', 'toast'),
  stash: new GitActionPresentation('Stash Changes', 'Stash Changes', 'normal', 'status'),
  stashApply: new GitActionPresentation('Apply Stash', 'Apply Stash', 'normal', 'status'),
  stashPop: new GitActionPresentation('Pop Stash', 'Pop Stash', 'normal', 'status'),
  stashDrop: new GitActionPresentation('Drop Stash', 'Drop Stash', 'danger', 'toast'),
  stashBranch: new GitActionPresentation('Create Branch from Stash', 'Create Branch', 'normal', 'status'),
  tag: new GitActionPresentation('Create Tag', 'Create Tag', 'normal', 'status'),
  deleteTag: new GitActionPresentation('Delete Tag', 'Delete Tag', 'danger', 'toast'),
  rollbackFile: new GitActionPresentation('Discard File Changes', 'Discard Changes', 'danger', 'toast'),
  getFile: new GitActionPresentation('Restore File from Revision', 'Overwrite File', 'danger', 'toast'),
  revertFile: new GitActionPresentation('Revert File Changes', 'Revert Changes', 'normal', 'status'),
  worktreeAdd: new GitActionPresentation('Create Worktree', 'Create Worktree', 'normal', 'status'),
  worktreeRemove: new GitActionPresentation('Remove Worktree', 'Remove Worktree', 'danger', 'toast'),
  worktreePrune: new GitActionPresentation('Prune Worktrees', 'Prune Worktrees', 'normal', 'silent'),
  worktreeUnlock: new GitActionPresentation('Unlock Worktree', 'Unlock Worktree', 'normal', 'status'),
  continue: new GitActionPresentation('Continue Operation', 'Continue', 'normal', 'status'),
  skip: new GitActionPresentation('Skip Commit', 'Skip Commit', 'normal', 'status'),
  abort: new GitActionPresentation('Abort Operation', 'Abort Operation', 'danger', 'toast'),
  commitEmptyContinue: new GitActionPresentation('Commit Empty and Continue', 'Commit and Continue', 'normal', 'status')
};

export function actionPresentation(action: string): GitActionPresentation {
  return presentations[action] ?? defaultPresentation;
}

export function actionLabel(action: string): string {
  return actionPresentation(action).label;
}

export function actionConfirmationLabel(request: GitMutationRequest): string {
  if (request.action === 'reset') {
    const mode = String(request.options?.mode ?? 'mixed');
    if (mode === 'hard') return 'Reset and Discard Changes';
    if (mode === 'soft') return 'Reset and Keep Staged';
    if (mode === 'keep') return 'Reset and Keep Changes';
    return 'Reset and Keep Changes';
  }
  if (request.action === 'update' && request.options?.strategy === 'reset') return 'Reset to Remote Branch';
  if (request.action === 'deleteBranch' && request.options?.force === true) return 'Force Delete Branch';
  if (request.action === 'push' && request.options?.forceLease === true) return 'Force Push with Lease';
  const operation = String(request.options?.operation ?? '').toLowerCase();
  if (request.action === 'abort' && operation) return `Abort ${operation.replace(/ing$/, 'e')}`;
  return actionPresentation(request.action).confirmationLabel;
}

export function actionFeedback(action: string): GitActionFeedback {
  return actionPresentation(action).feedback;
}

export function isDangerousAction(action: string): boolean {
  return actionPresentation(action).severity === 'danger';
}

const longRunningActions = new Set([
  'fetch', 'pull', 'update', 'push', 'pushBranch', 'merge', 'rebase', 'interactiveRebase',
  'cherryPick', 'revert', 'checkoutUpdate', 'checkoutRebase'
]);

export function actionProgress(action: string): GitActionProgress {
  return longRunningActions.has(action) ? 'notification' : 'window';
}
