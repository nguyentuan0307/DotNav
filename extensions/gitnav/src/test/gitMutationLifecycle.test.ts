import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { MutationBusyTracker, runMutationLifecycle } from '../git/gitMutationLifecycle';

test('refreshes repository state after a failed mutation and preserves the Git error', async () => {
  const events: string[] = [];
  await assert.rejects(runMutationLifecycle(
    async () => { events.push('mutation'); throw new Error('cherry-pick failed'); },
    async () => { events.push('refresh'); }
  ), /cherry-pick failed/);
  assert.deepEqual(events, ['mutation', 'refresh']);
});

test('reports refresh failure after a successful mutation', async () => {
  await assert.rejects(runMutationLifecycle(async () => undefined, async () => { throw new Error('refresh failed'); }), /refresh failed/);
});

test('keeps the mutation error when refresh also fails', async () => {
  const secondary: unknown[] = [];
  await assert.rejects(runMutationLifecycle(
    async () => { throw new Error('mutation failed'); },
    async () => { throw new Error('refresh failed'); },
    error => secondary.push(error)
  ), /mutation failed/);
  assert.equal((secondary[0] as Error).message, 'refresh failed');
});

test('clears busy state only after the final queued mutation settles', () => {
  const tracker = new MutationBusyTracker();
  assert.equal(tracker.begin('/repo'), 1);
  assert.equal(tracker.begin('/repo'), 2);
  assert.equal(tracker.end('/repo'), 1);
  assert.equal(tracker.pending('/repo'), 1);
  assert.equal(tracker.isBusy('/repo'), true);
  assert.equal(tracker.end('/repo'), 0);
  assert.equal(tracker.isBusy('/repo'), false);
});
