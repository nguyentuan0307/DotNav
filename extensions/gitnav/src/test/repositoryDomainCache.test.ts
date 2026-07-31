import assert from 'node:assert/strict';
import test from 'node:test';
import { RepositoryDomainCache } from '../git/repositoryDomainCache';

test('caches repository domain values independently', async () => {
  const cache = new RepositoryDomainCache<number>(1_000);
  let loads = 0;
  const loader = async () => ++loads;

  assert.equal(await cache.read('/repo', loader), 1);
  assert.equal(await cache.read('/repo', loader), 1);
  assert.equal(loads, 1);
  assert.deepEqual(cache.stats, { hits: 1, misses: 1 });
});

test('invalidates one repository without affecting another', async () => {
  const cache = new RepositoryDomainCache<number>(1_000);
  let loads = 0;
  const loader = async () => ++loads;
  await cache.read('/one', loader);
  await cache.read('/two', loader);

  cache.invalidate('/one');

  assert.equal(await cache.read('/one', loader), 3);
  assert.equal(await cache.read('/two', loader), 2);
});

test('does not cache a stale load completed after invalidation', async () => {
  const cache = new RepositoryDomainCache<number>(1_000);
  let complete!: (value: number) => void;
  const pending = cache.read('/repo', () => new Promise(resolve => { complete = resolve; }));
  cache.invalidate('/repo');
  complete(1);
  assert.equal(await pending, 1);

  assert.equal(await cache.read('/repo', async () => 2), 2);
});
