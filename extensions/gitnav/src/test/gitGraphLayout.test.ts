import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { computeGraphLayout } from '../git/gitGraphLayout';
import { GitCommitSummary } from '../git/gitPanelModels';

function commit(hash: string, parents: string[] = []): GitCommitSummary {
  return {
    hash, shortHash: hash, parents, subject: hash, author: 'Test',
    authorEmail: 'test@example.com', authorTimestamp: 0, refs: []
  };
}

test('keeps a linear history in one lane', () => {
  const result = computeGraphLayout([commit('c3', ['c2']), commit('c2', ['c1']), commit('c1')]);
  assert.deepEqual([result.lanes.c3.column, result.lanes.c2.column, result.lanes.c1.column], [0, 0, 0]);
  assert.equal(result.lanes.c3.lines[0].toCommit, 'c2');
  assert.deepEqual(result.snapshot.activeLanes, []);
});

test('allocates a second lane for a merge parent', () => {
  const result = computeGraphLayout([
    commit('merge', ['main', 'feature']),
    commit('main', ['base']),
    commit('feature', ['base']),
    commit('base')
  ]);
  assert.deepEqual(result.lanes.merge.lines.map(line => line.toColumn), [0, 1]);
  assert.equal(result.lanes.main.column, 0);
  assert.equal(result.lanes.feature.column, 1);
  assert.equal(result.lanes.main.color, result.lanes.merge.color);
});

test('continues lane identity across paged log results', () => {
  const first = computeGraphLayout([commit('c3', ['c2'])]);
  const second = computeGraphLayout([commit('c2', ['c1']), commit('c1')], first.snapshot);
  assert.equal(second.lanes.c2.column, first.lanes.c3.column);
  assert.equal(second.lanes.c2.color, first.lanes.c3.color);
  assert.deepEqual(second.snapshot.activeLanes, []);
});
