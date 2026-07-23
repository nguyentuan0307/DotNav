import assert from 'node:assert/strict';
import test from 'node:test';
import { GenerationTracker, QueueCancelledError, SerialQueue } from '../ef/efQueue';

function delay(milliseconds: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

test('runs jobs strictly one at a time in order', async () => {
  const queue = new SerialQueue();
  const events: string[] = [];

  const first = queue.enqueue('first', true, async () => {
    events.push('first:start');
    await delay(30);
    events.push('first:end');
    return 1;
  });
  const second = queue.enqueue('second', false, async () => {
    events.push('second:start');
    return 2;
  });

  assert.deepEqual(await Promise.all([first, second]), [1, 2]);
  assert.deepEqual(events, ['first:start', 'first:end', 'second:start']);
});

test('exposes running and pending entries', async () => {
  const queue = new SerialQueue();
  let release: () => void = () => undefined;
  const blocked = queue.enqueue('running', true, () => new Promise<void>(resolve => { release = resolve; }));
  await delay(10);

  const queued = queue.enqueue('queued', true, async () => undefined);
  assert.equal(queue.runningEntry?.label, 'running');
  assert.equal(queue.snapshot.pending.length, 1);
  assert.equal(queue.snapshot.pending[0].label, 'queued');
  assert.equal(queue.busy, true);

  release();
  await Promise.all([blocked, queued]);
  assert.equal(queue.busy, false);
  assert.equal(queue.runningEntry, undefined);
});

test('a failing job does not break the queue', async () => {
  const queue = new SerialQueue();
  const failing = queue.enqueue('bad', true, async () => {
    throw new Error('boom');
  });
  const following = queue.enqueue('good', false, async () => 'ok');

  await assert.rejects(failing, /boom/);
  assert.equal(await following, 'ok');
});

test('clearPending cancels queued jobs but not the running one', async () => {
  const queue = new SerialQueue();
  let release: () => void = () => undefined;
  const running = queue.enqueue('running', true, () => new Promise<void>(resolve => { release = resolve; }));
  await delay(10);

  const pending = queue.enqueue('pending', true, async () => 'never');
  const cleared = queue.clearPending();
  assert.equal(cleared, 1);
  await assert.rejects(pending, QueueCancelledError);

  release();
  await running;
  assert.equal(queue.busy, false);
});

test('generation tracker detects stale reads', () => {
  const generations = new GenerationTracker();
  const before = generations.current('key');
  assert.equal(generations.isCurrent('key', before), true);

  generations.bump('key');
  assert.equal(generations.isCurrent('key', before), false);
  assert.equal(generations.isCurrent('key', generations.current('key')), true);

  generations.bumpAll();
  assert.equal(generations.isCurrent('key', generations.current('key')), true);
  assert.equal(generations.current('key'), before + 2);
});
