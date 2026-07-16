import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { actionConfirmationLabel, actionFeedback, actionLabel, actionProgress, isDangerousAction } from '../git/gitActionPolicy';

test('uses consistent user-facing labels', () => {
  assert.equal(actionLabel('checkoutRemote'), 'Checkout Tracking Branch');
  assert.equal(actionLabel('rollbackFile'), 'Discard File Changes');
  assert.equal(actionLabel('unknownAction'), 'Git Operation');
});

test('uses consequence-specific confirmation labels', () => {
  assert.equal(actionConfirmationLabel({ action: 'reset', options: { mode: 'hard' } }), 'Reset and Discard Changes');
  assert.equal(actionConfirmationLabel({ action: 'deleteBranch', options: { force: true } }), 'Force Delete Branch');
  assert.equal(actionConfirmationLabel({ action: 'push', options: { forceLease: true } }), 'Force Push with Lease');
});

test('keeps low-value feedback quiet', () => {
  assert.equal(actionFeedback('fetch'), 'silent');
  assert.equal(actionFeedback('checkout'), 'status');
  assert.equal(actionFeedback('pushAfterUpdate'), 'status');
  assert.equal(actionFeedback('reset'), 'toast');
});

test('marks only potentially destructive action families as dangerous', () => {
  assert.equal(isDangerousAction('reset'), true);
  assert.equal(isDangerousAction('deleteRemote'), true);
  assert.equal(isDangerousAction('checkout'), false);
  assert.equal(isDangerousAction('fetch'), false);
});

test('reserves cancellable notification progress for potentially long operations', () => {
  assert.equal(actionProgress('fetch'), 'notification');
  assert.equal(actionProgress('rebase'), 'notification');
  assert.equal(actionProgress('createBranch'), 'window');
  assert.equal(actionProgress('stashDrop'), 'window');
});
