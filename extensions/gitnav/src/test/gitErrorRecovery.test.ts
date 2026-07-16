import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { classifyGitError, shouldAutoSkipEmptyCherryPick } from '../git/gitErrorRecovery';

test('auto-skips only an empty in-progress cherry-pick', () => {
  const empty = 'The previous cherry-pick is now empty, possibly due to conflict resolution.';
  assert.equal(shouldAutoSkipEmptyCherryPick(empty, 'cherryPick', 'CHERRY-PICKING'), true);
  assert.equal(shouldAutoSkipEmptyCherryPick(empty, 'cherryPick', undefined), false);
  assert.equal(shouldAutoSkipEmptyCherryPick(empty, 'revert', 'CHERRY-PICKING'), false);
  assert.equal(shouldAutoSkipEmptyCherryPick('CONFLICT (content)', 'cherryPick', 'CHERRY-PICKING'), false);
});

test('offers recovery actions for an empty cherry-pick', () => {
  const recovery = classifyGitError('The previous cherry-pick is now empty, possibly due to conflict resolution.');
  assert.equal(recovery?.kind, 'emptyCherryPick');
  assert.deepEqual(recovery?.actions.map(item => item.action), ['skip', 'commitEmptyContinue', 'abort']);
});

test('does not replace ordinary Git errors with unrelated recovery actions', () => {
  assert.equal(classifyGitError('fatal: not a git repository'), undefined);
});

test('offers an update action when a push is rejected', () => {
  const recovery = classifyGitError('rejected: non-fast-forward', 'push');
  assert.equal(recovery?.kind, 'pushRejected');
  assert.deepEqual(recovery?.actions.map(item => ({ label: item.label, action: item.action, strategy: item.strategy })), [
    { label: 'Rebase then Push', action: 'pushAfterUpdate', strategy: 'rebase' },
    { label: 'Merge then Push', action: 'pushAfterUpdate', strategy: 'merge' }
  ]);
});

test('offers force delete only after safe branch deletion is rejected', () => {
  const recovery = classifyGitError("error: branch 'feature/a' is not fully merged", 'deleteBranch');
  assert.equal(recovery?.kind, 'branchNotMerged');
  assert.deepEqual(recovery?.actions.map(item => ({ label: item.label, action: item.action })), [{ label: 'Force Delete Branch', action: 'forceDeleteBranch' }]);
});
