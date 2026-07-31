import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import test from 'node:test';
import { listFileRevisions, readFileRevision, resolveFileRevision } from '../git/fileRevision';
import { getFileHistory, getLineHistory } from '../git/lineHistory';

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
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
