import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  SEARCH_UPDATE_MAX_MS,
  SEARCH_UPDATE_QUIET_MS,
  SearchUpdateCoordinator
} from '../solutionSearch/searchUpdateCoordinator';

test('SearchUpdateCoordinator coalesces file events and waits for five quiet seconds', async context => {
  context.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1000 });
  const flushes: Array<Map<string, string>> = [];
  const states: string[] = [];
  const coordinator = new SearchUpdateCoordinator(
    async files => { flushes.push(new Map(files)); },
    async () => assert.fail('full refresh not expected'),
    state => states.push(state)
  );

  coordinator.queueFile('/src/App.cs', 'create');
  context.mock.timers.tick(SEARCH_UPDATE_QUIET_MS - 1);
  coordinator.queueFile('/src/App.cs', 'change');
  context.mock.timers.tick(SEARCH_UPDATE_QUIET_MS - 1);
  assert.equal(flushes.length, 0);

  context.mock.timers.tick(1);
  await Promise.resolve();
  assert.equal(flushes.length, 1);
  assert.equal(flushes[0].get('/src/App.cs'), 'change');
  assert.deepEqual(states.slice(-2), ['updating', 'ready']);
  coordinator.dispose();
});

test('SearchUpdateCoordinator enforces max delay and folds a burst into one full refresh', async context => {
  context.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1000 });
  let fullRefreshes = 0;
  const coordinator = new SearchUpdateCoordinator(
    async () => assert.fail('file flush not expected'),
    async () => { fullRefreshes++; },
    () => {}
  );

  coordinator.queueFullRefresh();
  for (let elapsed = 4000; elapsed < SEARCH_UPDATE_MAX_MS; elapsed += 4000) {
    context.mock.timers.tick(4000);
    coordinator.queueFullRefresh();
  }
  context.mock.timers.tick(SEARCH_UPDATE_MAX_MS % 4000);
  await Promise.resolve();
  assert.equal(fullRefreshes, 1);
  coordinator.dispose();
});

test('SearchUpdateCoordinator retains file changes queued during an active full refresh', async context => {
  context.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1000 });
  let releaseRefresh: (() => void) | undefined;
  const activeRefresh = new Promise<void>(resolve => { releaseRefresh = resolve; });
  const flushedFiles: string[][] = [];
  const coordinator = new SearchUpdateCoordinator(
    async files => { flushedFiles.push([...files.keys()]); },
    async () => activeRefresh,
    () => {}
  );

  coordinator.queueFullRefresh();
  context.mock.timers.tick(SEARCH_UPDATE_QUIET_MS);
  await Promise.resolve();
  coordinator.queueFile('/src/ChangedDuringScan.cs', 'change');
  releaseRefresh!();
  await coordinator.flushNow();

  assert.deepEqual(flushedFiles, [['/src/ChangedDuringScan.cs']]);
  coordinator.dispose();
});
