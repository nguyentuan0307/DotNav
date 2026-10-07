import * as assert from 'assert';
import { test } from 'node:test';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs/promises';
import { readFileSync } from 'fs';
import { readDirectoryNodes } from '../fileTree';

test('readDirectoryNodes correctly reads entries from directory', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dotnav-readdir-test-'));
  try {
    const subDir1 = path.join(tmpDir, 'Services');
    const subDir2 = path.join(tmpDir, 'Other');
    await fs.mkdir(subDir1, { recursive: true });
    await fs.mkdir(subDir2, { recursive: true });
    await fs.writeFile(path.join(subDir1, 'RecordService.cs'), '// code');
    await fs.writeFile(path.join(subDir2, 'Unrelated.cs'), '// code');

    const nodes = await readDirectoryNodes(tmpDir, tmpDir, undefined);
    assert.strictEqual(nodes.length, 2);
    const labels = nodes.map(n => n.label).sort();
    assert.deepStrictEqual(labels, ['Other', 'Services']);

    const fileNodes = await readDirectoryNodes(subDir1, tmpDir, undefined);
    assert.strictEqual(fileNodes.length, 1);
    assert.strictEqual(fileNodes[0].label, 'RecordService.cs');
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('package.json does not contribute obsolete filter commands, preserves standard navigation', () => {
  const manifest = JSON.parse(readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf8'));

  const searchCmd = manifest.contributes.commands.find((c: any) => c.command === 'dotnav.searchSolutionTree');
  const clearCmd = manifest.contributes.commands.find((c: any) => c.command === 'dotnav.clearSolutionTreeFilter');

  assert.strictEqual(searchCmd, undefined, 'dotnav.searchSolutionTree must be removed');
  assert.strictEqual(clearCmd, undefined, 'dotnav.clearSolutionTreeFilter must be removed');

  const selectOpenedCmd = manifest.contributes.commands.find((c: any) => c.command === 'dotnav.selectOpenedFile');
  assert.ok(selectOpenedCmd, 'dotnav.selectOpenedFile must be contributed in commands');
  assert.strictEqual(selectOpenedCmd.icon, '$(target)');
  const selectOpenedMenu = manifest.contributes.menus['view/title'].find(
    (m: any) => m.command === 'dotnav.selectOpenedFile'
  );
  assert.ok(selectOpenedMenu, 'dotnav.selectOpenedFile must be in view/title');
});
