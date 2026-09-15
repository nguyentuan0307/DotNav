import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DiskSymbolStore } from '../solutionSearch/searchDiskStore';
import {
  SEARCH_CACHE_SAVE_IDLE_MS,
  SEARCH_CACHE_SAVE_MAX_MS
} from '../solutionSearch/streamingCache';

class CountingDiskSymbolStore extends DiskSymbolStore {
  public saveCount = 0;

  public override async saveToDisk(): Promise<void> {
    this.saveCount++;
  }
}

test('cold cache save waits for 15 seconds of idle activity', context => {
  context.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1000 });
  const store = new CountingDiskSymbolStore();
  store.registerFileSymbols('/src/App.cs', 'App.cs', 'App', []);
  context.mock.timers.tick(SEARCH_CACHE_SAVE_IDLE_MS - 1);
  store.registerFileSymbols('/src/App.cs', 'App.cs', 'App', []);
  context.mock.timers.tick(SEARCH_CACHE_SAVE_IDLE_MS - 1);
  assert.equal(store.saveCount, 0);

  context.mock.timers.tick(1);
  assert.equal(store.saveCount, 1);
  store.clear();
});

test('cold cache save enforces the 60 second maximum delay', context => {
  context.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1000 });
  const store = new CountingDiskSymbolStore();
  store.registerFileSymbols('/src/App.cs', 'App.cs', 'App', []);

  for (let elapsed = 10000; elapsed < SEARCH_CACHE_SAVE_MAX_MS; elapsed += 10000) {
    context.mock.timers.tick(9999);
    store.registerFileSymbols('/src/App.cs', 'App.cs', 'App', []);
    context.mock.timers.tick(1);
  }
  context.mock.timers.tick(SEARCH_CACHE_SAVE_MAX_MS % 10000 || 10000);
  assert.equal(store.saveCount, 1);
  store.clear();
});
