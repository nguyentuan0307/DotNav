import { isEmptySequencerError } from './gitErrorRecovery';
import { GitMutationRequest, GitRepositorySnapshot } from './gitPanelModels';

export interface GitRecoveryCommands {
  snapshot(root: string): Promise<GitRepositorySnapshot>;
  git(root: string, args: string[]): Promise<unknown>;
  hasConflicts(root: string): Promise<boolean>;
}

export interface GitAutoRecoveryResult {
  readonly recovered: boolean;
  readonly message?: string;
}

export async function recoverMutationFailure(
  commands: GitRecoveryCommands,
  root: string,
  request: GitMutationRequest,
  error: unknown
): Promise<GitAutoRecoveryResult> {
  let snapshot: GitRepositorySnapshot;
  try { snapshot = await commands.snapshot(root); }
  catch { throw error; }
  const message = error instanceof Error ? error.message : String(error);
  const operation = snapshot.operation;
  if (request.action === 'cherryPick' && operation === 'CHERRY-PICKING' && isEmptySequencerError(message, request.action)) {
    if (await commands.hasConflicts(root)) return { recovered: false };
    await commands.git(root, ['cherry-pick', '--skip']);
    return { recovered: true, message: 'Commit already applied — skipped' };
  }
  if (request.action === 'revert' && operation === 'REVERTING' && isEmptySequencerError(message, request.action)) {
    if (await commands.hasConflicts(root)) return { recovered: false };
    await commands.git(root, ['revert', '--skip']);
    return { recovered: true, message: 'Nothing to revert — skipped' };
  }
  if (['continue', 'skip', 'abort'].includes(request.action) && !operation && /no .*in progress|no .*operation/i.test(message)) {
    return { recovered: true, message: 'Operation already finished' };
  }
  if (['pull', 'update', 'merge', 'rebase'].includes(request.action) && !operation && /already up[ -]to[ -]date|up to date/i.test(message)) {
    return { recovered: true, message: 'Already up to date' };
  }
  return { recovered: false };
}
