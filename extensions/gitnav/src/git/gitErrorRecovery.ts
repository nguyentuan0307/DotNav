export type GitRecoveryKind = 'emptyCherryPick' | 'pushRejected' | 'branchNotMerged';

export interface GitErrorRecovery {
  readonly kind: GitRecoveryKind;
  readonly title: string;
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

export function shouldAutoSkipEmptyCherryPick(message: string, action: string, operation?: string): boolean {
  return action === 'cherryPick'
    && operation === 'CHERRY-PICKING'
    && /previous cherry-pick is now empty|cherry-pick.*empty/i.test(message);
}

export function classifyGitError(message: string, action?: string): GitErrorRecovery | undefined {
  if (/previous cherry-pick is now empty|cherry-pick.*empty/i.test(message)) {
    return {
      kind: 'emptyCherryPick',
      title: 'Cherry-pick produced no changes',
      detail: message.trim(),
      actions: [
        new GitRecoveryAction('Skip Commit', 'skip'),
        new GitRecoveryAction('Commit Empty & Continue', 'commitEmptyContinue'),
        new GitRecoveryAction('Abort', 'abort')
      ]
    };
  }
  if (action === 'push' && /rejected|non-fast-forward/i.test(message)) {
    return {
      kind: 'pushRejected',
      title: 'Origin has commits that are not available locally',
      detail: message.trim(),
      actions: [
        new GitRecoveryAction('Rebase then Push', 'pushAfterUpdate', 'rebase'),
        new GitRecoveryAction('Merge then Push', 'pushAfterUpdate', 'merge')
      ]
    };
  }
  if (action === 'deleteBranch' && /not fully merged|not.*merged/i.test(message)) {
    return {
      kind: 'branchNotMerged',
      title: 'Branch was not deleted',
      detail: message.trim(),
      actions: [new GitRecoveryAction('Force Delete Branch', 'forceDeleteBranch')]
    };
  }
  return undefined;
}
