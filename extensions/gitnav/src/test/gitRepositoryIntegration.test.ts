import * as assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { computeGraphLayout } from '../git/gitGraphLayout';
import { logPrettyFormat, parseLog } from '../git/gitPanelParsers';

test('parses and lays out a real paged Git merge history', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'git-log-integration-'));
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });
  const commit = (name: string, contents: string) => {
    writeFileSync(path.join(root, name), contents);
    git('add', name); git('commit', '-m', contents);
  };
  try {
    git('init', '-b', 'main');
    git('config', 'user.name', 'Integration Test');
    git('config', 'user.email', 'integration@example.com');
    commit('base.txt', 'base');
    git('switch', '-c', 'feature'); commit('feature.txt', 'feature');
    git('switch', 'main'); commit('main.txt', 'main');
    git('merge', '--no-ff', 'feature', '-m', 'merge feature');

    const records = parseLog(git('log', `--format=${logPrettyFormat}`, '--decorate=full'));
    assert.equal(records.length, 4);
    assert.equal(records[0].parents.length, 2);
    const firstPage = computeGraphLayout(records.slice(0, 2));
    const secondPage = computeGraphLayout(records.slice(2), firstPage.snapshot);
    assert.ok(firstPage.lanes[records[0].hash].lines.some(line => line.toColumn > 0));
    assert.equal(secondPage.snapshot.activeLanes.length, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
