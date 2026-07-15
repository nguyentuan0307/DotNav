import { GitRepositorySnapshot } from './gitPanelModels';

export interface CurrentBranchPushPlan {
  readonly branch: string;
  readonly remote: string;
  readonly destination: string;
  readonly remoteBranchExists: boolean;
  readonly setUpstream: boolean;
}

export function sameNameRemoteBranchPlan(
  snapshot: GitRepositorySnapshot,
  branch: string,
  remote = 'origin'
): CurrentBranchPushPlan {
  const destination = `${remote}/${branch}`;
  const remoteBranchExists = snapshot.refs.some(ref => ref.kind === 'remote' && ref.name === destination);
  return {
    branch,
    remote,
    destination,
    remoteBranchExists,
    setUpstream: !remoteBranchExists || snapshot.upstream !== destination
  };
}

export function currentBranchPushPlan(
  snapshot: GitRepositorySnapshot,
  remote = 'origin'
): CurrentBranchPushPlan {
  if (snapshot.detached || snapshot.head === 'HEAD' || snapshot.head === '(detached)') {
    throw new Error('Cannot push the current branch while HEAD is detached. Check out a local branch first.');
  }
  return sameNameRemoteBranchPlan(snapshot, snapshot.head, remote);
}

export function requireRemoteBranch(plan: CurrentBranchPushPlan): void {
  if (!plan.remoteBranchExists) {
    throw new Error(`${plan.destination} does not exist. Push the branch first to create it.`);
  }
}

export function sameNameUpdateArgs(
  plan: CurrentBranchPushPlan,
  strategy: 'merge' | 'rebase' | 'reset'
): string[] {
  requireRemoteBranch(plan);
  if (strategy === 'reset') return ['reset', '--hard', plan.destination];
  return [strategy, plan.destination];
}

export function pushNamedBranchArgs(branch: string, remote = 'origin'): string[] {
  return ['push', '--set-upstream', remote, `refs/heads/${branch}:refs/heads/${branch}`];
}

export function updateNamedBranchArgs(plan: CurrentBranchPushPlan): string[] {
  requireRemoteBranch(plan);
  return ['fetch', plan.remote, `refs/heads/${plan.branch}:refs/heads/${plan.branch}`];
}

export function currentBranchPushArgs(
  plan: CurrentBranchPushPlan,
  options?: { readonly forceLease?: boolean; readonly tags?: boolean }
): string[] {
  return [
    'push',
    ...(options?.forceLease ? ['--force-with-lease'] : []),
    ...(options?.tags ? ['--tags'] : []),
    ...(plan.setUpstream ? ['--set-upstream'] : []),
    plan.remote,
    `HEAD:refs/heads/${plan.branch}`
  ];
}
