import * as assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { computeGraphLayout } from '../git/gitGraphLayout';
import { logPrettyFormat, parseLog, parseNameStatusZ } from '../git/gitPanelParsers';

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

test('git diff correctly retrieves patches for additions, merge commits, and root commits', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'git-filepatch-test-'));
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });
  const commit = (name: string, contents: string) => {
    writeFileSync(path.join(root, name), contents);
    git('add', name); git('commit', '-m', contents);
  };
  try {
    git('init', '-b', 'main');
    git('config', 'user.name', 'Integration Test');
    git('config', 'user.email', 'integration@example.com');
    commit('root.txt', 'root line 1\nroot line 2\n');

    const logRecords = parseLog(git('log', `--format=${logPrettyFormat}`, '--decorate=full'));
    const rootHash = logRecords[0].hash;

    // Test root commit diff
    const rootPatch = git('diff-tree', '-p', '--root', '-U3', rootHash, '--', 'root.txt');
    assert.ok(rootPatch.includes('+root line 1'));

    // Create a commit that only adds lines to an existing file
    writeFileSync(path.join(root, 'root.txt'), 'root line 1\nroot line 2\nroot line 3\nroot line 4\n');
    git('add', 'root.txt');
    git('commit', '-m', 'add lines only');
    const addOnlyLog = parseLog(git('log', `--format=${logPrettyFormat}`, '-n', '1'));
    const addOnlyHash = addOnlyLog[0].hash;

    const addOnlyPatch = git('diff', '-U3', `${addOnlyHash}^1`, addOnlyHash, '--', 'root.txt');
    assert.ok(addOnlyPatch.includes('+root line 3'));
    assert.ok(addOnlyPatch.includes('+root line 4'));

    // Create a feature branch and merge it
    git('switch', '-c', 'feature-branch');
    commit('added-in-feature.txt', 'brand new file in feature');
    git('switch', 'main');
    commit('main-update.txt', 'main line');
    git('merge', '--no-ff', 'feature-branch', '-m', 'Merge feature-branch');

    const mergeLog = parseLog(git('log', `--format=${logPrettyFormat}`, '-n', '1'));
    const mergeHash = mergeLog[0].hash;

    // Test Parent 1 on merge commit (should show added-in-feature.txt diff)
    const mergeParent1Patch = git('diff', '-U3', `${mergeHash}^1`, mergeHash, '--', 'added-in-feature.txt');
    assert.ok(mergeParent1Patch.includes('+brand new file in feature'));

    // Test working tree unstaged changes
    writeFileSync(path.join(root, 'root.txt'), 'modified locally\n');
    const workingPatch = git('diff', '-U3', '--', 'root.txt');
    assert.ok(workingPatch.includes('+modified locally'));

    // Test branch compare between main and feature-branch
    const branchDiffPatch = git('diff', '-U3', 'feature-branch...main', '--', 'main-update.txt');
    assert.ok(branchDiffPatch.includes('+main line'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('direct two-tip diff reports added, deleted, and renamed paths', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'git-direct-compare-test-'));
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });
  try {
    git('init', '-b', 'main');
    git('config', 'user.name', 'Integration Test');
    git('config', 'user.email', 'integration@example.com');
    writeFileSync(path.join(root, 'old.txt'), 'same content\n');
    writeFileSync(path.join(root, 'removed.txt'), 'removed\n');
    git('add', '.');
    git('commit', '-m', 'base');
    git('switch', '-c', 'feature');
    git('mv', 'old.txt', 'renamed.txt');
    writeFileSync(path.join(root, 'added.txt'), 'added\n');
    git('rm', 'removed.txt');
    git('add', '.');
    git('commit', '-m', 'feature changes');

    git('switch', 'main');

    const changes = parseNameStatusZ(git('diff', '--name-status', '-z', '--find-renames', 'main', 'feature'))
      .map(file => ({ status: file.status, path: file.path, oldPath: file.oldPath }))
      .sort((left, right) => left.path.localeCompare(right.path));
    assert.deepEqual(changes, [
      { status: 'A', path: 'added.txt', oldPath: undefined },
      { status: 'D', path: 'removed.txt', oldPath: undefined },
      { status: 'R', path: 'renamed.txt', oldPath: 'old.txt' }
    ]);
    const renamePatch = git('diff', '--find-renames', '-U3', 'main', 'feature', '--', 'old.txt', 'renamed.txt');
    assert.match(renamePatch, /similarity index 100%/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
