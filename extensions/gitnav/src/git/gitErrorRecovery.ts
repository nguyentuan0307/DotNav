export type GitRecoveryLevel = 'auto' | 'guided' | 'manual';
export type GitRecoveryKind =
  | 'emptyCherryPick' | 'emptyRevert' | 'conflict' | 'pushRejected' | 'branchNotMerged'
  | 'stashConflict' | 'updateDiverged' | 'remoteMissing' | 'refExists' | 'worktreeDirty' | 'worktreeLocked' | 'worktreeStale'
  | 'authentication' | 'network' | 'hookFailed' | 'repositoryLocked' | 'unknown';

export interface GitErrorRecovery {
  readonly level: Exclude<GitRecoveryLevel, 'auto'>;
  readonly kind: GitRecoveryKind;
  readonly title: string;
  readonly message: string;
  readonly detail: string;
  readonly actions: GitRecoveryAction[];
}

export class GitRecoveryAction {
  constructor(
    readonly label: string,
    readonly action: string,
    readonly strategy?: 'rebase' | 'merge'
  ) {}
}

export interface GitErrorContext {
  readonly action?: string;
  readonly operation?: string;
}

export function isEmptySequencerError(message: string, action: string): boolean {
  if (action === 'cherryPick') return /previous cherry-pick is now empty|cherry-pick.*empty/i.test(message);
  return action === 'revert' && /revert.*empty|nothing to commit, working tree clean/i.test(message);
}

export function classifyGitError(message: string, context: GitErrorContext | string = {}): GitErrorRecovery {
  const action = typeof context === 'string' ? context : context.action;
  const operation = typeof context === 'string' ? undefined : context.operation;
  const detail = message.trim();
  if (/previous cherry-pick is now empty|cherry-pick.*empty/i.test(message)) return guided(
    'emptyCherryPick', 'Commit already applied', 'Skip this commit or stop the cherry-pick.', detail,
    [new GitRecoveryAction('Skip', 'skip'), new GitRecoveryAction('Abort', 'abort')]
  );
  if (action === 'revert' && /revert.*empty|nothing to commit, working tree clean/i.test(message)) return guided(
    'emptyRevert', 'Nothing to revert', 'Stop the revert or leave the repository unchanged.', detail,
    operation === 'REVERTING' ? [new GitRecoveryAction('Abort', 'abort')] : []
  );
  if (/conflict|unmerged files|fix conflicts/i.test(message)) {
    if (action === 'stashApply' || action === 'stashPop') return guided(
      'stashConflict', 'Stash applied with conflicts', 'Resolve the conflicted files. Your stash was kept.', detail, []
    );
    const actions = operation ? [new GitRecoveryAction('Abort', 'abort')] : [];
    return guided('conflict', 'Resolve conflicts to continue', 'Use the changed files list, then continue the operation.', detail, actions);
  }
  if (action === 'push' && /rejected|non-fast-forward|fetch first/i.test(message)) return guided(
    'pushRejected', 'Remote has new commits', 'Update your branch, then push again.', detail,
    [new GitRecoveryAction('Rebase & Push', 'pushAfterUpdate', 'rebase'), new GitRecoveryAction('Merge & Push', 'pushAfterUpdate', 'merge')]
  );
  if (['pull', 'update', 'pullInto'].includes(action ?? '') && /divergent branches|non-fast-forward|not possible to fast-forward|reconcile/i.test(message)) return guided(
    'updateDiverged', 'Branches have diverged', 'Choose how to update your branch.', detail,
    [new GitRecoveryAction('Rebase', 'update', 'rebase'), new GitRecoveryAction('Merge', 'update', 'merge')]
  );
  if (/remote ref does not exist|couldn't find remote ref|no such ref was fetched/i.test(message)) return guided(
    'remoteMissing', 'Remote branch no longer exists', 'Keep the local branch or choose another upstream.', detail, []
  );
  if (/already exists/i.test(message) && ['createBranch', 'tag', 'worktreeAdd'].includes(action ?? '')) return guided(
    'refExists', action === 'tag' ? 'Tag already exists' : 'Branch already exists', 'Choose another name or use the existing ref.', detail, []
  );
  if (action === 'worktreeRemove' && /modified or untracked files|contains modified/i.test(message)) return guided(
    'worktreeDirty', 'Worktree has changes', 'Force removal will discard tracked changes.', detail,
    [new GitRecoveryAction('Force Remove', 'worktreeRemove')]
  );
  if (action === 'worktreeRemove' && /worktree.*locked|is locked/i.test(message)) return guided(
    'worktreeLocked', 'Worktree is locked', 'Unlock it before removing it.', detail,
    [new GitRecoveryAction('Unlock', 'worktreeUnlock')]
  );
  if (/worktree.*(?:missing|prunable)|is stale/i.test(message)) return guided(
    'worktreeStale', 'Worktree is no longer available', 'Prune the stale worktree entry.', detail,
    [new GitRecoveryAction('Prune', 'worktreePrune')]
  );
  if (action === 'deleteBranch' && /not fully merged|not.*merged/i.test(message)) return guided(
    'branchNotMerged', 'Branch has unmerged commits', 'Review the branch before forcing deletion.', detail,
    [new GitRecoveryAction('Force Delete', 'forceDeleteBranch')]
  );
  if (/authentication failed|permission denied|could not read username|publickey/i.test(message)) return manual(
    'authentication', 'Authentication failed', 'Check your Git credentials, then retry.', detail
  );
  if (/could not resolve host|unable to access|connection.*(?:failed|timed out|reset)|network is unreachable/i.test(message)) return manual(
    'network', 'Cannot reach the remote', 'Check your connection, then retry.', detail
  );
  if (/hook declined|hook.*failed|pre-(?:commit|push|rebase)/i.test(message)) return manual(
    'hookFailed', 'Git hook blocked the action', 'Review the hook output before retrying.', detail
  );
  if (/index\.lock|another git process|unable to create.*lock/i.test(message)) return manual(
    'repositoryLocked', 'Repository is busy', 'Close other Git operations, then retry.', detail
  );
  return manual('unknown', 'Git action failed', 'Review the details, then retry.', detail);
}

function guided(kind: GitRecoveryKind, title: string, message: string, detail: string, actions: GitRecoveryAction[]): GitErrorRecovery {
  return { level: 'guided', kind, title, message, detail, actions: actions.slice(0, 2) };
}

function manual(kind: GitRecoveryKind, title: string, message: string, detail: string): GitErrorRecovery {
  return { level: 'manual', kind, title, message, detail, actions: [] };
}
