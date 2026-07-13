import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { canSkipOperation, isActionAllowedDuringOperation, operationArguments } from '../git/gitOperationFlow';

test('maps conflict actions to the active Git operation', () => {
  assert.deepEqual(operationArguments('MERGING', 'continue'), ['merge', '--continue']);
  assert.deepEqual(operationArguments('REBASING', 'abort'), ['rebase', '--abort']);
  assert.deepEqual(operationArguments('CHERRY-PICKING', 'skip'), ['cherry-pick', '--skip']);
});

test('blocks stale queued mutations while a conflict operation is active', () => {
  assert.equal(isActionAllowedDuringOperation('continue'), true);
  assert.equal(isActionAllowedDuringOperation('abort'), true);
  assert.equal(isActionAllowedDuringOperation('fetch'), true);
  assert.equal(isActionAllowedDuringOperation('checkout'), false);
  assert.equal(isActionAllowedDuringOperation('merge'), false);
});

test('allows skip only for rebase and cherry-pick', () => {
  assert.equal(canSkipOperation('REBASING'), true);
  assert.equal(canSkipOperation('CHERRY-PICKING'), true);
  assert.equal(canSkipOperation('MERGING'), false);
  assert.throws(() => operationArguments('MERGING', 'skip'), /not available/);
});
