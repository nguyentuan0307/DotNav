import * as assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { test } from 'node:test';

const manifest = JSON.parse(readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf8'));

test('manifest exposes standard Build, Rebuild, and Clean commands at every supported scope', () => {
  const commands = new Set(manifest.contributes.commands.map((item: { command: string }) => item.command));
  for (const command of [
    'dotnav.buildProject', 'dotnav.rebuildProject', 'dotnav.cleanProject',
    'dotnav.buildFolderProjects', 'dotnav.rebuildFolderProjects', 'dotnav.cleanFolderProjects',
    'dotnav.buildSolution', 'dotnav.rebuildSolution', 'dotnav.cleanSolution'
  ]) {
    assert.ok(commands.has(command), `${command} must be declared`);
  }
  assert.equal(manifest.contributes.configuration.properties['dotnav.smartBuild.enabled'], undefined);
  assert.equal(manifest.contributes.configuration.properties['dotnav.smartBuild.mode'], undefined);
});

test('manifest routes ReSharper reload through Explorer guidance and gates menus by active engine', () => {
  const commands = new Set(manifest.contributes.commands.map((item: { command: string }) => item.command));
  assert.ok(commands.has('dotnav.resharper.openExplorerForReload'));
  assert.equal(commands.has('dotnav.resharper.reloadAllProjects'), false);

  const menus = manifest.contributes.menus['view/item/context'] as Array<{ command?: string; when?: string }>;
  const reloadMenus = menus.filter(item => item.command === 'dotnav.resharper.openExplorerForReload');
  assert.equal(reloadMenus.length, 2);
  assert.ok(reloadMenus.every(item => item.when?.includes('dotnav.isReSharperActive')));
  assert.ok(menus.some(item => item.command === 'dotnav.rebuildFolderProjects' && item.when?.includes('solutionFolder')));
  assert.ok(menus.some(item => item.command === 'dotnav.cleanFolderProjects' && item.when?.includes('solutionFolder')));
});

test('build optimization helper flags are defined', () => {
  const { buildOptimizationFlags, buildOptimizationArgs } = require('../buildOptimizations') as typeof import('../buildOptimizations');
  assert.match(buildOptimizationFlags(), /-maxcpucount/);
  assert.match(buildOptimizationFlags(), /BuildInParallel=true/);
  assert.match(buildOptimizationFlags(), /UseSharedCompilation=false/);
  assert.deepEqual(buildOptimizationArgs(), [
    '-maxcpucount',
    '-p:BuildInParallel=true',
    '-p:UseSharedCompilation=false',
    '-clp:NoSummary',
    '-clp:Verbosity=minimal'
  ]);
});
