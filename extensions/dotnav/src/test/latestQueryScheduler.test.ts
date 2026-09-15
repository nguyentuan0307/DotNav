import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LatestQueryScheduler, SEARCH_QUERY_DEBOUNCE_MS } from '../solutionSearch/latestQueryScheduler';

test('LatestQueryScheduler renders only the newest query after 100ms', context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const rendered: string[] = [];
  const scheduler = new LatestQueryScheduler(query => rendered.push(query));

  scheduler.schedule('get');
  scheduler.schedule('get form');
  scheduler.schedule('get form details');
  context.mock.timers.tick(SEARCH_QUERY_DEBOUNCE_MS - 1);
  assert.deepEqual(rendered, []);

  context.mock.timers.tick(1);
  assert.deepEqual(rendered, ['get form details']);
  scheduler.dispose();
});
