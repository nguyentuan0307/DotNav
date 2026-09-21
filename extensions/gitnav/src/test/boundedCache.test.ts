import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { BoundedCache } from '../git/boundedCache';

test('evicts the least recently used cache entry', () => {
  const cache = new BoundedCache<number>(2);
  cache.set('a', 1); cache.set('b', 2); cache.get('a'); cache.set('c', 3);
  assert.equal(cache.get('a'), 1);
  assert.equal(cache.get('b'), undefined);
  assert.equal(cache.get('c'), 3);
});

test('invalidates only entries matching a repository prefix', () => {
  const cache = new BoundedCache<number>(5);
  cache.set('/a\0one', 1); cache.set('/a\0two', 2); cache.set('/b\0one', 3);
  cache.deletePrefix('/a\0');
  assert.equal(cache.size, 1);
  assert.equal(cache.get('/b\0one'), 3);
});

test('supports has, clear, and undefined cached values', () => {
  const cache = new BoundedCache<string | undefined>(3);
  cache.set('key1', undefined);
  cache.set('key2', 'value2');

  assert.equal(cache.has('key1'), true);
  assert.equal(cache.get('key1'), undefined);
  assert.equal(cache.has('missing'), false);

  cache.clear();
  assert.equal(cache.size, 0);
  assert.equal(cache.has('key1'), false);
});
