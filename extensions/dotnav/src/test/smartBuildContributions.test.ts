import * as assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { test } from 'node:test';

const manifest = JSON.parse(readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf8'));

test('manifest exposes separate Build and Smart Build commands at every supported scope', () => {
  const commands = new Set(manifest.contributes.commands.map((item: { command: string }) => item.command));
  for (const command of [
    'dotnav.buildProject', 'dotnav.smartBuildProject',
    'dotnav.buildFolderProjects', 'dotnav.smartBuildFolderProjects',
    'dotnav.buildSolution', 'dotnav.smartBuildSolution',
    'dotnav.explainSmartBuildPlan', 'dotnav.invalidateSmartBuildCache'
  ]) assert.ok(commands.has(command), `${command} must be declared`);
  assert.equal(manifest.contributes.configuration.properties['dotnav.smartBuild.maxParallelBuilds'].minimum, 1);
  assert.deepEqual(manifest.contributes.configuration.properties['dotnav.smartBuild.mode'].enum, ['execute', 'shadow']);
  assert.deepEqual(manifest.contributes.configuration.properties['dotnav.buildBeforeRunMode'].enum, ['standard', 'smart', 'none']);
  assert.equal(manifest.contributes.configuration.properties['dotnav.smartBuild.generateBinaryLog'].default, false);
});

test('all Smart Build commands activate the extension explicitly', () => {
  const activations = new Set(manifest.activationEvents);
  for (const command of [
    'dotnav.smartBuildProject', 'dotnav.smartBuildFolderProjects', 'dotnav.smartBuildSolution',
    'dotnav.explainSmartBuildPlan', 'dotnav.invalidateSmartBuildCache'
  ]) assert.ok(activations.has(`onCommand:${command}`), command);
});
