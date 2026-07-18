export type GitRefKind = 'local' | 'remote' | 'tag';

export interface GitRefInfo {
  readonly name: string;
  readonly fullName: string;
  readonly hash: string;
  readonly kind: GitRefKind;
  readonly upstream?: string;
  readonly ahead: number;
  readonly behind: number;
  readonly current: boolean;
}

export interface GitStashInfo {
  readonly ref: string;
  readonly hash: string;
  readonly message: string;
  readonly timestamp: number;
}

export interface GitWorktreeInfo {
  readonly path: string;
  readonly head: string;
  readonly branch?: string;
  readonly detached: boolean;
  readonly bare: boolean;
  readonly locked?: string;
  readonly prunable?: string;
  readonly current: boolean;
}

export interface GitFileChange {
  readonly status: string;
  readonly path: string;
  readonly oldPath?: string;
  readonly additions: number;
  readonly deletions: number;
  readonly conflict?: boolean;
}

export interface GitCommitSummary {
  readonly hash: string;
  readonly shortHash: string;
  readonly parents: string[];
  readonly subject: string;
  readonly author: string;
  readonly authorEmail: string;
  readonly authorTimestamp: number;
  readonly refs: string[];
  readonly lane?: GitGraphLane;
}

export interface GitGraphLine { readonly fromColumn: number; readonly toColumn: number; readonly toCommit: string; }
export interface GitGraphLane { readonly column: number; readonly color: number; readonly lines: GitGraphLine[]; }
export interface GitGraphSnapshot { readonly activeLanes: Array<string | null>; readonly laneColors: Array<number | null>; readonly nextColor: number; }

export interface GitCommitDetail extends GitCommitSummary {
  readonly message: string;
  readonly committer: string;
  readonly committerEmail: string;
  readonly committerTimestamp: number;
  readonly signature: 'good' | 'bad' | 'unknown' | 'unsigned';
  readonly signatureSigner?: string;
  readonly files: GitFileChange[];
}

export type GitRebaseAction = 'pick' | 'reword' | 'squash' | 'fixup' | 'drop';
export interface GitRebasePlanItem {
  readonly action: GitRebaseAction;
  readonly hash: string;
  readonly subject: string;
  readonly message?: string;
}

export interface GitRepositorySnapshot {
  readonly root: string;
  readonly name: string;
  readonly head: string;
  readonly detached: boolean;
  readonly upstream?: string;
  readonly ahead: number;
  readonly behind: number;
  readonly changedCount: number;
  readonly lastFetchedAt?: number;
  readonly operation?: GitOperationState;
  readonly refs: GitRefInfo[];
  readonly stashes: GitStashInfo[];
  readonly worktrees: GitWorktreeInfo[];
}

export type GitOperationState = 'MERGING' | 'REBASING' | 'CHERRY-PICKING' | 'REVERTING';

export interface GitLogFilter {
  readonly text?: string;
  readonly refs?: string[];
  readonly authors?: string[];
  readonly path?: string;
  readonly since?: string;
  readonly until?: string;
}

export interface GitFilterAuthor {
  readonly name: string;
  readonly email: string;
}

export interface GitFilterOptions {
  readonly authors: GitFilterAuthor[];
  readonly files: string[];
}

export interface GitLogPage {
  readonly commits: GitCommitSummary[];
  readonly offset: number;
  readonly hasMore: boolean;
}

export interface GitPanelState {
  readonly repositories: string[];
  readonly repository?: GitRepositorySnapshot;
  readonly log?: GitLogPage;
  readonly uncommitted: GitFileChange[];
}

export interface GitMutationRequest {
  readonly action: string;
  readonly ref?: string;
  readonly refs?: string[];
  readonly hash?: string;
  readonly hashes?: string[];
  readonly path?: string;
  readonly options?: Record<string, boolean | string>;
}
