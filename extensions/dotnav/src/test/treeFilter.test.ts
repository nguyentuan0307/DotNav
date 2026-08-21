import * as assert from 'assert';
import { test } from 'node:test';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs/promises';
import { readFileSync } from 'fs';
import { readDirectoryNodes, hasMatchingFileDescendant } from '../fileTree';

test('hasMatchingFileDescendant correctly identifies matching files in subdirectories', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dotnav-filter-test-'));
  try {
    const subDir = path.join(tmpDir, 'Services', 'CustomApp');
    await fs.mkdir(subDir, { recursive: true });
    await fs.writeFile(path.join(subDir, 'RecordAppearanceService.cs'), '// code');

    const hasMatch = await hasMatchingFileDescendant(tmpDir, 'recordappearance');
    const noMatch = await hasMatchingFileDescendant(tmpDir, 'nonexistentxyz');

    assert.strictEqual(hasMatch, true);
    assert.strictEqual(noMatch, false);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('readDirectoryNodes filters entries when filterText is provided', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dotnav-readdir-test-'));
  try {
    const subDir1 = path.join(tmpDir, 'Services');
    const subDir2 = path.join(tmpDir, 'Other');
    await fs.mkdir(subDir1, { recursive: true });
    await fs.mkdir(subDir2, { recursive: true });
    await fs.writeFile(path.join(subDir1, 'RecordService.cs'), '// code');
    await fs.writeFile(path.join(subDir2, 'Unrelated.cs'), '// code');

    // Filter for "Record"
    const filteredNodes = await readDirectoryNodes(tmpDir, tmpDir, undefined, 'record');
    assert.strictEqual(filteredNodes.length, 1);
    assert.strictEqual(filteredNodes[0].label, 'Services');
    assert.strictEqual(filteredNodes[0].collapsibleState, 2); // Expanded

    // Filter inside subDir1 for "Record"
    const fileNodes = await readDirectoryNodes(subDir1, tmpDir, undefined, 'record');
    assert.strictEqual(fileNodes.length, 1);
    assert.strictEqual(fileNodes[0].label, 'RecordService.cs');
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('package.json contributes filter and clear filter commands with keybindings', () => {
  const manifest = JSON.parse(readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf8'));

  const searchCmd = manifest.contributes.commands.find((c: any) => c.command === 'dotnav.searchSolutionTree');
  const clearCmd = manifest.contributes.commands.find((c: any) => c.command === 'dotnav.clearSolutionTreeFilter');

  assert.ok(searchCmd, 'dotnav.searchSolutionTree must be contributed');
  assert.ok(clearCmd, 'dotnav.clearSolutionTreeFilter must be contributed');
  assert.strictEqual(searchCmd.icon, '$(filter)');
  assert.strictEqual(clearCmd.icon, '$(clear-all)');

  const clearMenu = manifest.contributes.menus['view/title'].find(
    (m: any) => m.command === 'dotnav.clearSolutionTreeFilter'
  );
  assert.ok(clearMenu, 'dotnav.clearSolutionTreeFilter must be in view/title');
  assert.strictEqual(clearMenu.when, 'view == dotnav && dotnav.hasTreeFilter');

  const escapeKey = manifest.contributes.keybindings.find(
    (k: any) => k.command === 'dotnav.clearSolutionTreeFilter'
  );
  assert.ok(escapeKey, 'escape keybinding must be contributed for clear filter');

  const selectOpenedCmd = manifest.contributes.commands.find((c: any) => c.command === 'dotnav.selectOpenedFile');
  assert.ok(selectOpenedCmd, 'dotnav.selectOpenedFile must be contributed in commands');
  assert.strictEqual(selectOpenedCmd.icon, '$(target)');
  const selectOpenedMenu = manifest.contributes.menus['view/title'].find(
    (m: any) => m.command === 'dotnav.selectOpenedFile'
  );
  assert.ok(selectOpenedMenu, 'dotnav.selectOpenedFile must be in view/title');
});
