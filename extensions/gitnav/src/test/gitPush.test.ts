import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  currentBranchPushArgs, currentBranchPushPlan, pushNamedBranchArgs,
  resetLocalBranchToRemoteCommands, sameNameRemoteBranchPlan, sameNameUpdateArgs, updateNamedBranchArgs
} from '../git/gitPush';
import { GitRepositorySnapshot } from '../git/gitPanelModels';

function snapshot(upstream?: string, remoteBranchExists = true): GitRepositorySnapshot {
  const head = 'feature/1407-lookup-search-value';
  return {
    root: '/repo', name: 'repo', head, detached: false, upstream,
    ahead: 1, behind: 0, changedCount: 0,
    refs: remoteBranchExists ? [{
      name: `origin/${head}`, fullName: `refs/remotes/origin/${head}`, hash: 'abc',
      kind: 'remote', ahead: 0, behind: 0, current: false
    }] : [],
    stashes: [], worktrees: []
  };
}

test('pushes HEAD explicitly to the same branch name on origin', () => {
  const plan = currentBranchPushPlan(snapshot('origin/feature/1407-lookup-search-value'));
  assert.equal(plan.setUpstream, false);
  assert.deepEqual(currentBranchPushArgs(plan), [
    'push', 'origin', 'HEAD:refs/heads/feature/1407-lookup-search-value'
  ]);
});

test('creates a missing origin branch and configures it as upstream', () => {
  const plan = currentBranchPushPlan(snapshot(undefined, false));
  assert.equal(plan.remoteBranchExists, false);
  assert.deepEqual(currentBranchPushArgs(plan), [
    'push', '--set-upstream', 'origin', 'HEAD:refs/heads/feature/1407-lookup-search-value'
  ]);
});

test('repairs an upstream that incorrectly points at origin master', () => {
  const plan = currentBranchPushPlan(snapshot('origin/master'));
  assert.equal(plan.destination, 'origin/feature/1407-lookup-search-value');
  assert.deepEqual(currentBranchPushArgs(plan, { forceLease: true, tags: true }), [
    'push', '--force-with-lease', '--tags', '--set-upstream', 'origin',
    'HEAD:refs/heads/feature/1407-lookup-search-value'
  ]);
});

test('blocks current-branch push from detached HEAD', () => {
  assert.throws(
    () => currentBranchPushPlan({ ...snapshot(), head: '(detached)', detached: true }),
    /HEAD is detached/
  );
});

test('updates only from the same-named origin branch when upstream points at master', () => {
  const plan = currentBranchPushPlan(snapshot('origin/master'));
  assert.deepEqual(sameNameUpdateArgs(plan, 'merge'), [
    'merge', 'origin/feature/1407-lookup-search-value'
  ]);
  assert.deepEqual(sameNameUpdateArgs(plan, 'rebase'), [
    'rebase', 'origin/feature/1407-lookup-search-value'
  ]);
  assert.deepEqual(sameNameUpdateArgs(plan, 'reset'), [
    'reset', '--hard', 'origin/feature/1407-lookup-search-value'
  ]);
});

test('refuses same-branch update when the origin branch is missing', () => {
  const plan = currentBranchPushPlan(snapshot('origin/master', false));
  assert.throws(() => sameNameUpdateArgs(plan, 'merge'), /does not exist/);
});

test('uses full same-name refspecs for a selected local branch', () => {
  const branch = 'feature/nested/name';
  const plan = { ...sameNameRemoteBranchPlan(snapshot('origin/master'), branch), remoteBranchExists: true };
  assert.deepEqual(pushNamedBranchArgs(branch), [
    'push', '--set-upstream', 'origin',
    'refs/heads/feature/nested/name:refs/heads/feature/nested/name'
  ]);
  assert.deepEqual(updateNamedBranchArgs(plan), [
    'fetch', 'origin',
    'refs/heads/feature/nested/name:refs/heads/feature/nested/name'
  ]);
});

test('resets an existing local branch to its remote without backup', () => {
  assert.deepEqual(resetLocalBranchToRemoteCommands('feature', 'develop', 'origin/develop', true), [
    ['clean', '-fd'], ['switch', '--discard-changes', 'develop'], ['reset', '--hard', 'origin/develop'], ['status', '--short']
  ]);
  assert.deepEqual(resetLocalBranchToRemoteCommands('develop', 'develop', 'origin/develop'), [
    ['reset', '--hard', 'origin/develop'], ['status', '--short']
  ]);
});
