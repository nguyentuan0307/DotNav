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

test('Smart Build is an opt-in preview', () => {
  const manifest = JSON.parse(readFileSync(path.resolve(__dirname, '..', '..', 'package.json'), 'utf8'));
  const enabled = manifest.contributes.configuration.properties['dotnav.smartBuild.enabled'];
  assert.equal(enabled.default, false);
  assert.ok(enabled.tags.includes('experimental'));
  for (const command of manifest.contributes.commands.filter((item: { command: string }) => item.command.includes('smartBuild') || item.command.includes('SmartBuild'))) {
    assert.match(command.title, /Preview/);
  }
});

test('new opt-in features share one version-aware announcement picker', () => {
  const extensionSource = readFileSync(path.resolve(__dirname, '..', 'extension.js'), 'utf8');
  const announcementSource = readFileSync(path.resolve(__dirname, '..', 'featureAnnouncements.js'), 'utf8');
  const localHistorySource = readFileSync(path.resolve(__dirname, '..', 'localHistory', 'localHistoryMain.js'), 'utf8');
  assert.match(extensionSource, /showFeatureAnnouncements/);
  assert.match(announcementSource, /canPickMany:\s*true/);
  assert.match(announcementSource, /Smart Build \(Preview\)/);
  assert.match(announcementSource, /Local History \(Preview\)/);
  assert.doesNotMatch(localHistorySource, /New in DotNav/);
});

test('all Smart Build commands activate the extension explicitly', () => {
  const activations = new Set(manifest.activationEvents);
  for (const command of [
    'dotnav.smartBuildProject', 'dotnav.smartBuildFolderProjects', 'dotnav.smartBuildSolution',
    'dotnav.explainSmartBuildPlan', 'dotnav.invalidateSmartBuildCache'
  ]) assert.ok(activations.has(`onCommand:${command}`), command);
});
