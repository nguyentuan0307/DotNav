import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { recoverMutationFailure } from '../git/gitMutationRecovery';
import { GitOperationState, GitRepositorySnapshot } from '../git/gitPanelModels';

function snapshot(operation?: GitOperationState): GitRepositorySnapshot {
  return { root: '/repo', name: 'repo', head: 'develop', detached: false, ahead: 0, behind: 0, changedCount: 0, operation, refs: [], stashes: [], worktrees: [] };
}

test('auto-skips an empty cherry-pick without conflicts', async () => {
  const calls: string[][] = [];
  const result = await recoverMutationFailure({ snapshot: async () => snapshot('CHERRY-PICKING'), git: async (_root, args) => { calls.push(args); }, hasConflicts: async () => false }, '/repo', { action: 'cherryPick' }, new Error('The previous cherry-pick is now empty'));
  assert.equal(result.recovered, true);
  assert.deepEqual(calls, [['cherry-pick', '--skip']]);
});

test('never auto-skips a conflict', async () => {
  const result = await recoverMutationFailure({ snapshot: async () => snapshot('CHERRY-PICKING'), git: async () => assert.fail('must not run Git'), hasConflicts: async () => true }, '/repo', { action: 'cherryPick' }, new Error('cherry-pick is now empty'));
  assert.equal(result.recovered, false);
});

test('treats an already-finished operation as idempotent success', async () => {
  const result = await recoverMutationFailure({ snapshot: async () => snapshot(), git: async () => assert.fail('must not run Git'), hasConflicts: async () => false }, '/repo', { action: 'abort' }, new Error('no cherry-pick in progress'));
  assert.equal(result.recovered, true);
});

test('treats an already up-to-date update as success', async () => {
  const result = await recoverMutationFailure({ snapshot: async () => snapshot(), git: async () => assert.fail('must not run Git'), hasConflicts: async () => false }, '/repo', { action: 'pull' }, new Error('Already up-to-date.'));
  assert.equal(result.recovered, true);
  assert.equal(result.message, 'Already up to date');
});

test('preserves the original error when recovery state cannot be read', async () => {
  const original = new Error('cherry-pick is now empty');
  await assert.rejects(recoverMutationFailure({ snapshot: async () => { throw new Error('snapshot failed'); }, git: async () => undefined, hasConflicts: async () => false }, '/repo', { action: 'cherryPick' }, original), error => error === original);
});
