import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { matchingProtectedBranchPattern } from '../git/gitBranchProtection';
import { destructiveWarning, protectedRemoteMutationPattern, requiresDestructiveConfirmation, supportsBackup } from '../git/gitMutationSafety';

test('matches exact and wildcard protected branch patterns', () => {
  assert.equal(matchingProtectedBranchPattern('main', ['main', 'release/*']), 'main');
  assert.equal(matchingProtectedBranchPattern('release/2026.07', ['main', 'release/*']), 'release/*');
  assert.equal(matchingProtectedBranchPattern('feature/main', ['main', 'release/*']), undefined);
});

test('treats regex characters in protected patterns literally', () => {
  assert.equal(matchingProtectedBranchPattern('release/v1.2', ['release/v1.2']), 'release/v1.2');
  assert.equal(matchingProtectedBranchPattern('release/v1x2', ['release/v1.2']), undefined);
});

test('allows local history changes on protected branches', () => {
  const patterns = ['main', 'release/*'];
  for (const action of ['reset', 'undoCommit', 'dropCommit', 'interactiveRebase']) {
    assert.equal(protectedRemoteMutationPattern('main', { action }, patterns), undefined);
  }
  assert.equal(protectedRemoteMutationPattern('main', { action: 'update', options: { strategy: 'reset' } }, patterns), undefined);
});

test('blocks remote destructive mutations for protected branches', () => {
  assert.equal(protectedRemoteMutationPattern('main', { action: 'push', options: { forceLease: true } }, ['main']), 'main');
  assert.equal(protectedRemoteMutationPattern('main', { action: 'push', options: { forceLease: false } }, ['main']), undefined);
  assert.equal(protectedRemoteMutationPattern('feature/a', { action: 'deleteRemote', ref: 'release/1.0' }, ['release/*']), 'release/*');
});

test('describes each reset mode accurately', () => {
  assert.match(destructiveWarning({ action: 'reset', ref: 'abc', options: { mode: 'soft' } }, 'main'), /remain staged/);
  assert.match(destructiveWarning({ action: 'reset', ref: 'abc', options: { mode: 'mixed' } }, 'main'), /unstaged/);
  assert.match(destructiveWarning({ action: 'reset', ref: 'abc', options: { mode: 'hard' } }, 'main'), /permanently discarded/);
  assert.match(destructiveWarning({ action: 'reset', ref: 'abc', options: { mode: 'keep' } }, 'main'), /Git will stop/);
});

test('confirms and offers backup for reset-to-upstream', () => {
  const request = { action: 'update', options: { strategy: 'reset', destination: 'origin/feature/a' } };
  assert.equal(requiresDestructiveConfirmation(request), true);
  assert.equal(supportsBackup(request), true);
  assert.match(destructiveWarning(request, 'feature/a', 'origin/main'), /origin\/feature\/a/);
  assert.doesNotMatch(destructiveWarning(request, 'feature/a', 'origin/main'), /origin\/main/);
});

test('confirms only reset modes that discard work', () => {
  assert.equal(requiresDestructiveConfirmation({ action: 'reset', options: { mode: 'soft' } }), false);
  assert.equal(requiresDestructiveConfirmation({ action: 'reset', options: { mode: 'mixed' } }), false);
  assert.equal(requiresDestructiveConfirmation({ action: 'reset', options: { mode: 'keep' } }), false);
  assert.equal(requiresDestructiveConfirmation({ action: 'reset', options: { mode: 'hard' } }), true);
});

test('confirms force delete but lets Git safely reject an unmerged branch', () => {
  assert.equal(requiresDestructiveConfirmation({ action: 'deleteBranch', options: { force: false } }), false);
  assert.equal(requiresDestructiveConfirmation({ action: 'deleteBranch', options: { force: true } }), true);
});

test('confirms remote and destructive working tree mutations', () => {
  assert.equal(requiresDestructiveConfirmation({ action: 'push', options: { forceLease: false } }), false);
  assert.equal(requiresDestructiveConfirmation({ action: 'push', options: { forceLease: true } }), true);
  assert.equal(requiresDestructiveConfirmation({ action: 'deleteTag' }), false);
  assert.equal(requiresDestructiveConfirmation({ action: 'deleteTag', options: { remote: 'origin' } }), true);
  assert.equal(requiresDestructiveConfirmation({ action: 'worktreeRemove' }), false);
  assert.equal(requiresDestructiveConfirmation({ action: 'worktreeRemove', options: { force: true } }), true);
});

test('confirms abort only when resolved changes may be discarded', () => {
  assert.equal(requiresDestructiveConfirmation({ action: 'abort', options: { operation: 'REBASING', hasResolvedChanges: false } }), false);
  assert.equal(requiresDestructiveConfirmation({ action: 'abort', options: { operation: 'REBASING', hasResolvedChanges: true } }), true);
});

test('requires confirmation for an unconfirmed remote reset only', () => {
  assert.equal(requiresDestructiveConfirmation({ action: 'checkoutRemoteReset', options: { confirmed: false } }), true);
  assert.equal(requiresDestructiveConfirmation({ action: 'checkoutRemoteReset', options: { confirmed: true } }), false);
});
