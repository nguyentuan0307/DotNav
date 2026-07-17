import * as assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { createProjectStub, parseProject } from '../projectParser';

test('creates a lightweight project stub without loaded metadata', () => {
  const stub = createProjectStub('/repo/src/App/App.csproj', '/repo');

  assert.equal(stub.name, 'App');
  assert.equal(stub.relativePath, 'src/App/App.csproj');
  assert.equal(stub.metadataLoaded, false);
  assert.equal(stub.kind, 'unknown');
  assert.deepEqual(stub.targetFrameworks, []);
  assert.deepEqual(stub.launchProfiles, []);
});

test('reuses cached project metadata until the project file changes', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dotnav-project-parser-'));
  const projectPath = path.join(root, 'App.csproj');
  await fs.writeFile(projectPath, projectXml('net8.0'), 'utf8');

  const first = await parseProject(projectPath, root);
  const second = await parseProject(projectPath, root);

  assert.equal(first.metadataLoaded, true);
  assert.equal(second, first);
  assert.deepEqual(first.targetFrameworks, ['net8.0']);

  await delay(5);
  await fs.writeFile(projectPath, projectXml('net9.0'), 'utf8');
  const third = await parseProject(projectPath, root);

  assert.notEqual(third, first);
  assert.deepEqual(third.targetFrameworks, ['net9.0']);
});

function projectXml(targetFramework: string): string {
  return `<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><TargetFramework>${targetFramework}</TargetFramework></PropertyGroup></Project>`;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}
