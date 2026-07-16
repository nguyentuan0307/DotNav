import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { classifyGitError, isEmptySequencerError } from '../git/gitErrorRecovery';

test('classifies guided recovery with at most two useful actions', () => {
  const empty = classifyGitError('The previous cherry-pick is now empty, possibly due to conflict resolution.', { action: 'cherryPick', operation: 'CHERRY-PICKING' });
  assert.equal(empty.level, 'guided');
  assert.equal(empty.kind, 'emptyCherryPick');
  assert.deepEqual(empty.actions.map(item => item.action), ['skip', 'abort']);
  const push = classifyGitError('rejected: non-fast-forward', { action: 'push' });
  assert.equal(push.kind, 'pushRejected');
  assert.deepEqual(push.actions.map(item => item.strategy), ['rebase', 'merge']);
});

test('classifies conflicts using operation context', () => {
  const conflict = classifyGitError('CONFLICT (content): merge conflict', { action: 'rebase', operation: 'REBASING' });
  assert.equal(conflict.kind, 'conflict');
  assert.deepEqual(conflict.actions.map(item => item.action), ['abort']);
  const stash = classifyGitError('CONFLICT (content)', { action: 'stashPop' });
  assert.equal(stash.kind, 'stashConflict');
  assert.match(stash.message, /stash was kept/i);
});

test('classifies manual errors without misleading actions', () => {
  for (const [message, kind] of [
    ['Authentication failed for origin', 'authentication'],
    ['Could not resolve host: github.com', 'network'],
    ['pre-push hook declined', 'hookFailed'],
    ['Unable to create .git/index.lock', 'repositoryLocked'],
    ['fatal: not a git repository', 'unknown']
  ] as const) {
    const recovery = classifyGitError(message);
    assert.equal(recovery.level, 'manual');
    assert.equal(recovery.kind, kind);
    assert.deepEqual(recovery.actions, []);
  }
});

test('recognizes only matching empty sequencer errors', () => {
  assert.equal(isEmptySequencerError('cherry-pick is now empty', 'cherryPick'), true);
  assert.equal(isEmptySequencerError('nothing to commit, working tree clean', 'revert'), true);
  assert.equal(isEmptySequencerError('CONFLICT (content)', 'cherryPick'), false);
});

test('offers force delete only after safe deletion is rejected', () => {
  const recovery = classifyGitError("error: branch 'feature/a' is not fully merged", { action: 'deleteBranch' });
  assert.equal(recovery.kind, 'branchNotMerged');
  assert.deepEqual(recovery.actions.map(item => item.action), ['forceDeleteBranch']);
});
