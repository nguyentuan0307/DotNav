import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { actionConfirmationLabel, actionFeedback, actionLabel, actionProgress, isDangerousAction } from '../git/gitActionPolicy';

test('uses consistent user-facing labels', () => {
  assert.equal(actionLabel('checkoutRemote'), 'Checkout Tracking Branch');
  assert.equal(actionLabel('rollbackFile'), 'Discard File Changes');
  assert.equal(actionLabel('editCommitMessage'), 'Edit Commit Message');
  assert.equal(actionLabel('amendCommit'), 'Amend Commit');
  assert.equal(actionLabel('unknownAction'), 'Git Operation');
});

test('uses consequence-specific confirmation labels', () => {
  assert.equal(actionConfirmationLabel({ action: 'reset', options: { mode: 'hard' } }), 'Reset and Discard Changes');
  assert.equal(actionConfirmationLabel({ action: 'deleteBranch', options: { force: true } }), 'Force Delete Branch');
  assert.equal(actionConfirmationLabel({ action: 'deleteBranch', refs: ['feature/1', 'feature/2', 'feature/3'], options: { force: false } }), 'Delete 3 Branches');
  assert.equal(actionConfirmationLabel({ action: 'deleteBranch', refs: ['feature/1', 'feature/2', 'feature/3'], options: { force: true } }), 'Force Delete 3 Branches');
  assert.equal(actionConfirmationLabel({ action: 'deleteRemote', refs: ['origin/feature/1', 'origin/feature/2'] }), 'Delete 2 Remote Branches');
  assert.equal(actionConfirmationLabel({ action: 'push', options: { forceLease: true } }), 'Force Push with Lease');
});

test('keeps low-value feedback quiet', () => {
  assert.equal(actionFeedback('fetch'), 'silent');
  assert.equal(actionFeedback('checkout'), 'status');
  assert.equal(actionFeedback('pushAfterUpdate'), 'status');
  assert.equal(actionFeedback('editCommitMessage'), 'status');
  assert.equal(actionFeedback('amendCommit'), 'status');
  assert.equal(actionFeedback('reset'), 'toast');
});

test('marks only potentially destructive action families as dangerous', () => {
  assert.equal(isDangerousAction('reset'), true);
  assert.equal(isDangerousAction('deleteRemote'), true);
  assert.equal(isDangerousAction('checkout'), false);
  assert.equal(isDangerousAction('fetch'), false);
  assert.equal(isDangerousAction('editCommitMessage'), false);
  assert.equal(isDangerousAction('amendCommit'), false);
});

test('reserves cancellable notification progress for potentially long operations', () => {
  assert.equal(actionProgress('fetch'), 'notification');
  assert.equal(actionProgress('rebase'), 'notification');
  assert.equal(actionProgress('editCommitMessage'), 'notification');
  assert.equal(actionProgress('amendCommit'), 'notification');
  assert.equal(actionProgress('createBranch'), 'window');
  assert.equal(actionProgress('stashDrop'), 'window');
});
