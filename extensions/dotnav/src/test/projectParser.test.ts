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

test('parses mixed self-closing and paired PackageReference elements independently', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dotnav-project-parser-'));
  const projectPath = path.join(root, 'Infrastructure.csproj');
  await fs.writeFile(projectPath, `<Project Sdk="Microsoft.NET.Sdk">
    <PropertyGroup><TargetFramework>net8.0</TargetFramework></PropertyGroup>
    <ItemGroup>
      <PackageReference Include="ExcelDataReader" Version="3.7.0" />
      <PackageReference Include="ExcelNumberFormat" Version="1.1.0" />
      <PackageReference Include="Microsoft.EntityFrameworkCore.Design" Version="8.0.7">
        <PrivateAssets>all</PrivateAssets>
        <IncludeAssets>runtime; build; analyzers</IncludeAssets>
      </PackageReference>
      <PackageReference Include="Npgsql.EntityFrameworkCore.PostgreSQL">
        <Version>8.0.4</Version>
      </PackageReference>
    </ItemGroup>
  </Project>`, 'utf8');

  const project = await parseProject(projectPath, root);

  assert.deepEqual(project.packageReferences, [
    { name: 'ExcelDataReader', version: '3.7.0' },
    { name: 'ExcelNumberFormat', version: '1.1.0' },
    { name: 'Microsoft.EntityFrameworkCore.Design', version: '8.0.7' },
    { name: 'Npgsql.EntityFrameworkCore.PostgreSQL', version: '8.0.4' }
  ]);
});

function projectXml(targetFramework: string): string {
  return `<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><TargetFramework>${targetFramework}</TargetFramework></PropertyGroup></Project>`;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}
