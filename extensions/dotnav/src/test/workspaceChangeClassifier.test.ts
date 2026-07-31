import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyWorkspaceChange } from '../workspaceChangeClassifier';

test('classifies solution-wide metadata changes', () => {
  assert.equal(classifyWorkspaceChange('/repo/App.slnx', 'change').kind, 'solution');
  assert.equal(classifyWorkspaceChange('/repo/Directory.Packages.props', 'change').kind, 'solution');
  assert.equal(classifyWorkspaceChange('/repo/global.json', 'change').kind, 'solution');
});

test('classifies project metadata without reloading the solution', () => {
  assert.equal(classifyWorkspaceChange('/repo/src/App/App.csproj', 'change').kind, 'projectMetadata');
  assert.equal(
    classifyWorkspaceChange('/repo/src/App/Properties/launchSettings.json', 'change').kind,
    'projectMetadata'
  );
});

test('classifies file additions and deletions by parent directory', () => {
  const change = classifyWorkspaceChange('/repo/src/App/Features/New.cs', 'create');
  assert.equal(change.kind, 'directory');
  assert.equal(change.directoryPath, '/repo/src/App/Features');
  assert.equal(classifyWorkspaceChange('/repo/src/App/Old.cs', 'delete').kind, 'directory');
});

test('ignores content edits and generated directories', () => {
  assert.equal(classifyWorkspaceChange('/repo/src/App/Program.cs', 'change').kind, 'ignored');
  assert.equal(classifyWorkspaceChange('/repo/src/App/obj/generated.cs', 'create').kind, 'ignored');
  assert.equal(classifyWorkspaceChange('/repo/.git/index', 'change').kind, 'ignored');
});
