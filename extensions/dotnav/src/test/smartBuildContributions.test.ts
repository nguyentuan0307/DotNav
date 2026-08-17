import * as assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { test } from 'node:test';

const manifest = JSON.parse(readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf8'));

test('manifest exposes standard Build, Rebuild, and Clean commands at every supported scope', () => {
  const commands = new Set(manifest.contributes.commands.map((item: { command: string }) => item.command));
  for (const command of [
    'dotnav.buildProject', 'dotnav.rebuildProject', 'dotnav.cleanProject',
    'dotnav.buildFolderProjects',
    'dotnav.buildSolution', 'dotnav.rebuildSolution', 'dotnav.cleanSolution'
  ]) {
    assert.ok(commands.has(command), `${command} must be declared`);
  }
  assert.equal(manifest.contributes.configuration.properties['dotnav.smartBuild.enabled'], undefined);
  assert.equal(manifest.contributes.configuration.properties['dotnav.smartBuild.mode'], undefined);
});

test('build optimization helper flags are defined', () => {
  const { buildOptimizationFlags, buildOptimizationArgs } = require('../buildOptimizations') as typeof import('../buildOptimizations');
  assert.match(buildOptimizationFlags(), /-maxcpucount/);
  assert.match(buildOptimizationFlags(), /BuildInParallel=true/);
  assert.match(buildOptimizationFlags(), /UseSharedCompilation=true/);
  assert.deepEqual(buildOptimizationArgs(), ['-maxcpucount', '-p:BuildInParallel=true', '-p:UseSharedCompilation=true']);
});
