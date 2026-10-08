import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import test from 'node:test';
import { listFileRevisions, readFileRevision, resolveFileRevision } from '../git/fileRevision';
import { getFileHistory, getLineHistory } from '../git/lineHistory';
import { captureRevisionHistoryContext, captureWorktreeHistoryContext } from '../git/editorHistoryContext';

test('file history and revision listing follow a real Git rename', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'gitnav-file-history-'));
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });
  const commit = (message: string) => {
    git('add', '.');
    git('commit', '-m', message);
  };

  try {
    git('init', '-b', 'main');
    git('config', 'user.name', 'Integration Test');
    git('config', 'user.email', 'integration@example.com');
    mkdirSync(path.join(root, 'src'));
    writeFileSync(path.join(root, 'src', 'Old.cs'), 'first\n');
    commit('Create old file');
    writeFileSync(path.join(root, 'src', 'Old.cs'), 'first\nsecond\n');
    commit('Modify old file');
    git('tag', 'old-version');
    renameSync(path.join(root, 'src', 'Old.cs'), path.join(root, 'src', 'New.cs'));
    commit('Rename file');
    writeFileSync(path.join(root, 'src', 'New.cs'), 'first\nsecond\nthird\n');
    commit('Modify new file');

    const history = await getFileHistory({ repoRoot: root, relPath: 'src/New.cs' }, 20);
    const revisions = await listFileRevisions(root, 'src/New.cs', 20);
    const lineHistory = await getLineHistory({
      repoRoot: root,
      relPath: 'src/New.cs',
      headStart: 3,
      headEnd: 3
    }, 1);
    const oldRevision = await resolveFileRevision(root, 'src/New.cs', 'old-version', revisions);
    const oldContents = await readFileRevision(root, oldRevision);

    assert.deepEqual(history.map(entry => entry.subject), [
      'Modify new file',
      'Rename file',
      'Modify old file',
      'Create old file'
    ]);
    assert.equal(history[1].oldPath, 'src/Old.cs');
    assert.equal(history[1].newPath, 'src/New.cs');
    assert.deepEqual(revisions.map(revision => revision.subject), history.map(entry => entry.subject));
    assert.equal(revisions[1].path, 'src/New.cs');
    assert.equal(revisions[2].path, 'src/Old.cs');
    assert.equal(lineHistory[0].subject, 'Modify new file');
    assert.equal(oldRevision.path, 'src/Old.cs');
    assert.equal(oldContents, 'first\nsecond\n');
    const oldHistory = await getFileHistory({ repoRoot: root, relPath: oldRevision.path, ref: oldRevision.ref }, 20);
    assert.deepEqual(oldHistory.map(entry => entry.subject), ['Modify old file', 'Create old file']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('file, line and selection history start from the selected branch or frozen commit', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'gitnav-branch-history-'));
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });
  const commit = (subject: string, content: string) => {
    writeFileSync(path.join(root, 'File.cs'), content);
    git('add', '.');
    git('commit', '-m', subject);
  };
  try {
    git('init', '-b', 'main');
    git('config', 'user.name', 'Integration Test');
    git('config', 'user.email', 'integration@example.com');
    commit('Common ancestor', 'first\nshared\nlast\n');
    const ancestor = await captureRevisionHistoryContext(root, 'File.cs', 'HEAD');
    git('switch', '-c', 'feature');
    commit('Feature change', 'first\nfeature\nlast\n');
    const feature = await captureRevisionHistoryContext(root, 'File.cs', 'feature');
    git('update-ref', 'refs/remotes/origin/feature', feature.ref);
    const remote = await captureRevisionHistoryContext(root, 'File.cs', 'origin/feature');
    git('switch', 'main');
    commit('Main change', 'first\nmain\nlast\n');
    const main = await captureRevisionHistoryContext(root, 'File.cs', 'HEAD');

    assert.equal(main.label, 'main');
    assert.equal(remote.label, 'origin/feature');
    assert.equal(remote.ref, feature.ref);
    assert.deepEqual((await getFileHistory(feature.fileQuery(), 20)).map(entry => entry.subject),
      ['Feature change', 'Common ancestor']);
    assert.deepEqual((await getFileHistory({ repoRoot: root, relPath: 'File.cs' }, 20)).map(entry => entry.subject),
      ['Main change', 'Common ancestor']);
    assert.deepEqual((await getLineHistory(feature.lineQuery(2, 2)!, 20)).map(entry => entry.subject),
      ['Feature change', 'Common ancestor']);
    assert.deepEqual((await getLineHistory(main.lineQuery(1, 2)!, 20)).map(entry => entry.subject),
      ['Main change', 'Common ancestor']);

    git('switch', 'feature');
    commit('Later feature change', 'first\nlater feature\nlast\n');
    assert.deepEqual((await getFileHistory(feature.fileQuery(), 20)).map(entry => entry.subject),
      ['Feature change', 'Common ancestor']);
    assert.deepEqual((await getLineHistory(main.lineQuery(2, 2)!, 20)).map(entry => entry.subject),
      ['Main change', 'Common ancestor']);
    assert.deepEqual((await getFileHistory(ancestor.fileQuery(), 20)).map(entry => entry.subject), ['Common ancestor']);
    assert.deepEqual((await getLineHistory(ancestor.lineQuery(2, 2)!, 20)).map(entry => entry.subject), ['Common ancestor']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('worktree snippet history captures unsaved and staged changes without changing the repository', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'gitnav-snippet-history-'));
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });
  try {
    git('init', '-b', 'main');
    git('config', 'user.name', 'Integration Test');
    git('config', 'user.email', 'integration@example.com');
    writeFileSync(path.join(root, 'File.cs'), 'zero\none\ntwo\nthree\n');
    git('add', '.');
    git('commit', '-m', 'Original file');
    const head = git('rev-parse', 'HEAD').trim();
    writeFileSync(path.join(root, 'File.cs'), 'zero\nstaged\none\ntwo\nthree\n');
    git('add', '.');
    const status = git('status', '--porcelain');
    const snapshot = 'zero\nstaged\nunsaved\none\ntwo\nthree\n'.replace(/\n/g, '\r\n');
    const context = await captureWorktreeHistoryContext(root, 'File.cs', snapshot, 3);
    const inserted = await captureWorktreeHistoryContext(root, 'File.cs', snapshot, 1);
    const untracked = await captureWorktreeHistoryContext(root, 'New.cs', 'new\n', 0);

    assert.equal(context.ref, head);
    assert.equal(context.lineQuery(1, 2)?.headStart, 2);
    assert.equal(context.lineQuery(1, 2)?.headEnd, 3);
    assert.equal(context.lineQuery(4, 4), undefined);
    assert.equal(inserted.lineQuery(1, 2), undefined);
    assert.equal(untracked.lineQuery(1, 1), undefined);
    assert.equal(git('status', '--porcelain'), status);
    assert.equal(git('rev-parse', 'HEAD').trim(), head);
    assert.deepEqual((await getLineHistory(context.lineQuery(1, 2)!, 20)).map(entry => entry.subject), ['Original file']);

    writeFileSync(path.join(root, 'File.cs'), 'entirely different\n');
    git('add', '.');
    git('commit', '-m', 'Later file');
    assert.equal(context.lineQuery(1, 2)?.headStart, 2);
    assert.deepEqual((await getLineHistory(context.lineQuery(1, 2)!, 20)).map(entry => entry.subject), ['Original file']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
