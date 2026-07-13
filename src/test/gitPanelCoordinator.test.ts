import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { GitRequestCoordinator, RepositoryMutationQueue } from '../git/gitPanelCoordinator';

test('rejects a stale response superseded on the same channel', () => {
  const coordinator = new GitRequestCoordinator();
  const first = coordinator.begin('detail', '/repo');
  const second = coordinator.begin('detail', '/repo');
  assert.equal(coordinator.isCurrent('detail', first, '/repo'), false);
  assert.equal(coordinator.isCurrent('detail', second, '/repo'), true);
});

test('rejects responses from a previous repository or generation', () => {
  const coordinator = new GitRequestCoordinator();
  const request = coordinator.begin('log', '/repo-a');
  assert.equal(coordinator.isCurrent('log', request, '/repo-b'), false);
  coordinator.invalidate('/repo-a');
  assert.equal(coordinator.isCurrent('log', request, '/repo-a'), false);
});

test('serializes mutations per repository and recovers after failure', async () => {
  const queue = new RepositoryMutationQueue();
  const events: string[] = [];
  let release!: () => void;
  const blocked = new Promise<void>(resolve => { release = resolve; });
  const first = queue.enqueue('/repo', async () => { events.push('first:start'); await blocked; events.push('first:end'); });
  const second = queue.enqueue('/repo', async () => { events.push('second'); throw new Error('expected'); });
  const third = queue.enqueue('/repo', async () => { events.push('third'); });
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.deepEqual(events, ['first:start']);
  assert.equal(queue.isBusy('/repo'), true);
  release();
  await first;
  await assert.rejects(second, /expected/);
  await third;
  assert.deepEqual(events, ['first:start', 'first:end', 'second', 'third']);
  assert.equal(queue.isBusy('/repo'), false);
});

test('allows mutations in different repositories to run concurrently', async () => {
  const queue = new RepositoryMutationQueue();
  const entered: string[] = [];
  let release!: () => void;
  const blocked = new Promise<void>(resolve => { release = resolve; });
  const a = queue.enqueue('/a', async () => { entered.push('a'); await blocked; });
  const b = queue.enqueue('/b', async () => { entered.push('b'); });
  await b;
  assert.deepEqual(entered, ['a', 'b']);
  release();
  await a;
});
