import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { CoalescedRefreshRunner, GitFetchCoordinator, GitRequestCoordinator, InFlightOperationGuard, LocalRepositoryRefreshScheduler, RepositoryMutationQueue, RepositoryValueStore } from '../git/gitPanelCoordinator';

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

test('recognizes only the latest filter generation for the selected repository', () => {
  const coordinator = new GitRequestCoordinator();
  const current = coordinator.begin('log:0', '/repo', 2);
  const stale = coordinator.begin('log:0', '/repo', 1);
  assert.equal(coordinator.isGenerationCurrent(current, '/repo'), true);
  assert.equal(coordinator.isGenerationCurrent(stale, '/repo'), false);
  assert.equal(coordinator.isCurrent('log:0', current, '/repo'), true);
  assert.equal(coordinator.isCurrent('log:0', stale, '/repo'), false);
  assert.equal(coordinator.isGenerationCurrent(current, '/other'), false);
});

test('keeps active filters isolated per repository and supports clearing', () => {
  const filters = new RepositoryValueStore<{ refs?: string[] }>();
  filters.set('/repo-a', { refs: ['feature/a'] });
  filters.set('/repo-b', { refs: ['feature/b'] });
  assert.deepEqual(filters.get('/repo-a', {}), { refs: ['feature/a'] });
  assert.deepEqual(filters.get('/repo-b', {}), { refs: ['feature/b'] });
  filters.set('/repo-a', {});
  assert.deepEqual(filters.get('/repo-a', { refs: ['fallback'] }), {});
});

test('coalesces local Git events per repository and keeps history refresh priority', async () => {
  const events: Array<{ root: string; kind: string }> = [];
  const scheduler = new LocalRepositoryRefreshScheduler((root, kind) => events.push({ root, kind }), 5);
  scheduler.schedule('/repo-a', 'status');
  scheduler.schedule('/repo-a', 'history');
  scheduler.schedule('/repo-a', 'status');
  scheduler.schedule('/repo-b', 'status');
  await new Promise(resolve => setTimeout(resolve, 15));
  assert.deepEqual(events, [
    { root: '/repo-a', kind: 'history' },
    { root: '/repo-b', kind: 'status' }
  ]);
  scheduler.dispose();
});

test('cancels pending local Git refreshes when disposed', async () => {
  let calls = 0;
  const scheduler = new LocalRepositoryRefreshScheduler(() => calls++, 5);
  scheduler.schedule('/repo', 'history');
  scheduler.dispose();
  await new Promise(resolve => setTimeout(resolve, 15));
  assert.equal(calls, 0);
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

test('shares a full fetch with branch fetches for the same repository', async () => {
  const coordinator = new GitFetchCoordinator();
  let release!: () => void;
  const blocked = new Promise<void>(resolve => { release = resolve; });
  let calls = 0;
  const full = coordinator.run('/repo', { kind: 'all' }, async () => { calls++; await blocked; });
  const branch = coordinator.run('/repo', { kind: 'branch', branch: 'feature/a' }, async () => { calls++; });
  assert.equal(full, branch);
  assert.equal(calls, 1);
  release();
  await Promise.all([full, branch]);
});

test('does not let a branch fetch replace a required full fetch', async () => {
  const coordinator = new GitFetchCoordinator();
  let release!: () => void;
  const blocked = new Promise<void>(resolve => { release = resolve; });
  const calls: string[] = [];
  const branch = coordinator.run('/repo', { kind: 'branch', branch: 'feature/a' }, async () => {
    calls.push('branch');
    await blocked;
  });
  const full = coordinator.run('/repo', { kind: 'all' }, async () => { calls.push('all'); });
  assert.notEqual(branch, full);
  await full;
  assert.deepEqual(calls, ['branch', 'all']);
  release();
  await branch;
});

test('coalesces concurrent refresh requests into the active refresh', async () => {
  const runner = new CoalescedRefreshRunner();
  const events: string[] = [];
  let release!: () => void;
  const blocked = new Promise<void>(resolve => { release = resolve; });
  let runs = 0;
  const operation = async () => {
    runs++;
    events.push(`start:${runs}`);
    if (runs === 1) await blocked;
    events.push(`end:${runs}`);
  };

  const first = runner.run(operation);
  const second = runner.run(operation);
  const third = runner.run(operation);
  assert.equal(first, second);
  assert.equal(second, third);
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.deepEqual(events, ['start:1']);
  release();
  await Promise.all([first, second, third]);
  assert.deepEqual(events, ['start:1', 'end:1']);
});

test('refresh runner accepts another request after a failure', async () => {
  const runner = new CoalescedRefreshRunner();
  await assert.rejects(runner.run(async () => { throw new Error('expected'); }), /expected/);
  let completed = false;
  await runner.run(async () => { completed = true; });
  assert.equal(completed, true);
});

test('shares a refresh failure with concurrent callers without retrying', async () => {
  const runner = new CoalescedRefreshRunner();
  let release!: () => void;
  const blocked = new Promise<void>(resolve => { release = resolve; });
  let runs = 0;
  const operation = async () => {
    runs++;
    if (runs === 1) {
      await blocked;
      throw new Error('first refresh failed');
    }
  };

  const first = runner.run(operation);
  await new Promise<void>(resolve => setImmediate(resolve));
  const queued = runner.run(operation);
  release();

  await assert.rejects(first, /first refresh failed/);
  await assert.rejects(queued, /first refresh failed/);
  assert.equal(runs, 1);
});

test('blocks only duplicate in-flight operations and releases completed keys', () => {
  const guard = new InFlightOperationGuard();
  assert.equal(guard.tryEnter('checkout:main'), true);
  assert.equal(guard.tryEnter('checkout:main'), false);
  assert.equal(guard.tryEnter('fetch'), true);
  guard.leave('checkout:main');
  assert.equal(guard.tryEnter('checkout:main'), true);
});
