import * as assert from 'assert';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import test from 'node:test';
import { synchronizeCopies } from '../build/artifactSynchronizer';

test('artifact synchronizer copies and verifies an evaluated output item', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dotnav-copy-test-'));
  try {
    const source = path.join(root, 'source.json');
    const destination = path.join(root, 'bin', 'source.json');
    await fs.writeFile(source, '{"version":2}', 'utf8');
    const result = await synchronizeCopies([{ source, destination, mode: 'PreserveNewest' }]);
    assert.strictEqual(result.failed.length, 0);
    assert.strictEqual(result.copied.length, 1);
    assert.strictEqual(await fs.readFile(destination, 'utf8'), '{"version":2}');
    if (process.platform !== 'win32') {
      assert.strictEqual((await fs.stat(destination)).mode & 0o777, (await fs.stat(source)).mode & 0o777);
    }
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('artifact synchronizer reports failure so the executor can fall back to MSBuild', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dotnav-copy-test-'));
  try {
    const result = await synchronizeCopies([{
      source: path.join(root, 'missing.txt'), destination: path.join(root, 'bin', 'missing.txt'), mode: 'Always'
    }]);
    assert.strictEqual(result.copied.length, 0);
    assert.strictEqual(result.failed.length, 1);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
