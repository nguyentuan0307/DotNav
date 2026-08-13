import * as assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { BuildHostClient } from '../build/buildHostClient';

test('Build Host evaluates SDK inputs and restore configuration from the workspace', { timeout: 30_000 }, async () => {
  const root = await createTemporaryDirectory('dotnav-build-host-');
  const projectPath = path.join(root, 'Library.csproj');
  const sourcePath = path.join(root, 'Library.cs');
  const contentPath = path.join(root, 'wwwroot', 'site.css');
  await fs.mkdir(path.dirname(contentPath), { recursive: true });
  await fs.writeFile(projectPath, '<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><TargetFramework>net6.0</TargetFramework></PropertyGroup><ItemGroup><Content Include="wwwroot/site.css" /></ItemGroup></Project>');
  await fs.writeFile(sourcePath, 'public class Library { }');
  await fs.writeFile(contentPath, 'body {}');
  const packagesPath = path.join(root, 'Directory.Packages.props');
  const nugetPath = path.join(root, 'NuGet.config');
  await fs.writeFile(packagesPath, '<Project />');
  await fs.writeFile(nugetPath, '<configuration />');
  const extensionPath = path.resolve(__dirname, '..', '..');
  const client = new BuildHostClient({ extensionPath, workspaceRoot: root, requestTimeoutMs: 20_000 });
  try {
    const info = await client.start();
    assert.equal(info.protocolVersion, 2);
    assert.ok(info.msbuildPath.length > 0);
    const graph = await client.evaluate([projectPath], { Configuration: 'Debug', Platform: 'AnyCPU' });
    assert.equal(graph.projects.length, 1);
    assert.equal(graph.projects[0].projectPath, projectPath);
    assert.equal(graph.projects[0].targetFramework, 'net6.0');
    assert.ok(graph.projects[0].inputs.includes(sourcePath));
    assert.ok(graph.projects[0].inputs.includes(contentPath));
    assert.ok(graph.projects[0].inputs.includes(packagesPath));
    assert.ok(graph.projects[0].inputs.includes(nugetPath));
    assert.deepEqual(graph.projects[0].opaqueReasons, []);
  } finally {
    await client.dispose();
    await removeTemporaryDirectory(root);
  }
});

test('Build Host honors projects excluded from the active solution configuration', { timeout: 30_000 }, async () => {
  const root = await createTemporaryDirectory('dotnav-build-host-');
  const included = path.join(root, 'Included.csproj');
  const excluded = path.join(root, 'Excluded.csproj');
  const solution = path.join(root, 'Configured.sln');
  await fs.writeFile(included, '<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><TargetFramework>net6.0</TargetFramework></PropertyGroup></Project>');
  await fs.writeFile(excluded, '<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><TargetFramework>net6.0</TargetFramework></PropertyGroup></Project>');
  await fs.writeFile(solution, `Microsoft Visual Studio Solution File, Format Version 12.00
# Visual Studio Version 17
Project("{FAE04EC0-301F-11D3-BF4B-00C04F79EFBC}") = "Included", "Included.csproj", "{11111111-1111-1111-1111-111111111111}"
EndProject
Project("{FAE04EC0-301F-11D3-BF4B-00C04F79EFBC}") = "Excluded", "Excluded.csproj", "{22222222-2222-2222-2222-222222222222}"
EndProject
Global
  GlobalSection(SolutionConfigurationPlatforms) = preSolution
    Debug|Any CPU = Debug|Any CPU
  EndGlobalSection
  GlobalSection(ProjectConfigurationPlatforms) = postSolution
    {11111111-1111-1111-1111-111111111111}.Debug|Any CPU.ActiveCfg = Debug|Any CPU
    {11111111-1111-1111-1111-111111111111}.Debug|Any CPU.Build.0 = Debug|Any CPU
    {22222222-2222-2222-2222-222222222222}.Debug|Any CPU.ActiveCfg = Debug|Any CPU
  EndGlobalSection
EndGlobal
`);
  const client = new BuildHostClient({ extensionPath: path.resolve(__dirname, '..', '..'), workspaceRoot: root, requestTimeoutMs: 20_000 });
  try {
    const graph = await client.evaluate([], { Configuration: 'Debug', Platform: 'AnyCPU' }, solution);
    assert.deepEqual([...new Set(graph.projects.map(item => item.projectPath))], [included]);
    await fs.writeFile(included, '<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><TargetFramework>net6.0</TargetFramework></PropertyGroup><ItemGroup><ProjectReference Include="Excluded.csproj" /></ItemGroup></Project>');
    await assert.rejects(
      client.evaluate([], { Configuration: 'Debug', Platform: 'AnyCPU' }, solution),
      /references a project excluded/
    );
  } finally {
    await client.dispose();
    await removeTemporaryDirectory(root);
  }
});

test('Build Host resolves conditional project references and rejects custom build targets as opaque', { timeout: 30_000 }, async () => {
  const root = await createTemporaryDirectory('dotnav-build-host-');
  const dependency = path.join(root, 'Dependency.csproj');
  const application = path.join(root, 'Application.csproj');
  await fs.writeFile(dependency, '<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><TargetFramework>net6.0</TargetFramework></PropertyGroup></Project>');
  await fs.writeFile(application, `<Project Sdk="Microsoft.NET.Sdk">
    <PropertyGroup><TargetFramework>net6.0</TargetFramework></PropertyGroup>
    <ItemGroup><ProjectReference Include="Dependency.csproj" Condition="'$(Configuration)' == 'Debug'" /></ItemGroup>
    <Target Name="GenerateSomething" BeforeTargets="BeforeBuild"><WriteLinesToFile File="generated.txt" Lines="generated" /></Target>
  </Project>`);
  const client = new BuildHostClient({ extensionPath: path.resolve(__dirname, '..', '..'), workspaceRoot: root, requestTimeoutMs: 20_000 });
  try {
    const graph = await client.evaluate([application], { Configuration: 'Debug', Platform: 'AnyCPU' });
    const app = graph.projects.find(project => project.projectPath === application);
    assert.ok(app);
    assert.deepEqual(app.projectReferences, [dependency]);
    assert.equal(app.isOpaque, true);
    assert.ok(app.opaqueReasons.some(reason => reason.startsWith('custom-target:')));
  } finally {
    await client.dispose();
    await removeTemporaryDirectory(root);
  }
});

test('Build Host expands multi-targeted projects into independently fingerprinted variants', { timeout: 30_000 }, async () => {
  const root = await createTemporaryDirectory('dotnav-build-host-');
  const project = path.join(root, 'Multi.csproj');
  await fs.writeFile(project, '<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><TargetFrameworks>net6.0;netstandard2.0</TargetFrameworks></PropertyGroup></Project>');
  const client = new BuildHostClient({ extensionPath: path.resolve(__dirname, '..', '..'), workspaceRoot: root, requestTimeoutMs: 20_000 });
  try {
    const graph = await client.evaluate([project], { Configuration: 'Debug', Platform: 'AnyCPU' });
    assert.deepEqual(graph.projects.map(item => item.targetFramework).filter(Boolean).sort(), ['net6.0', 'netstandard2.0']);
    assert.equal(new Set(graph.projects.map(item => item.id)).size, graph.projects.length);
  } finally {
    await client.dispose();
    await removeTemporaryDirectory(root);
  }
});

test('Build Host refuses to evaluate with an unavailable global.json SDK', { timeout: 30_000 }, async () => {
  const root = await createTemporaryDirectory('dotnav-build-host-');
  await fs.writeFile(path.join(root, 'global.json'), '{"sdk":{"version":"99.0.100","rollForward":"disable"}}');
  const client = new BuildHostClient({ extensionPath: path.resolve(__dirname, '..', '..'), workspaceRoot: root, requestTimeoutMs: 5_000 });
  try {
    await assert.rejects(client.start(), /exited|dotnet --version failed/i);
  } finally {
    await client.dispose();
    await removeTemporaryDirectory(root);
  }
});

test('a retiring Build Host cannot reject requests owned by its replacement', { timeout: 30_000 }, async () => {
  const root = await createTemporaryDirectory('dotnav-build-host-restart-');
  const client = new BuildHostClient({
    extensionPath: path.resolve(__dirname, '..', '..'),
    workspaceRoot: root,
    requestTimeoutMs: 20_000
  });
  try {
    for (let index = 0; index < 4; index += 1) {
      const projectRoot = path.join(root, `project-${index}`);
      const projectPath = path.join(projectRoot, `Project${index}.csproj`);
      await fs.mkdir(projectRoot, { recursive: true });
      await fs.writeFile(projectPath, '<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><TargetFramework>net6.0</TargetFramework></PropertyGroup></Project>');
      await client.setWorkingDirectory(projectRoot);
      const graph = await client.evaluate([projectPath], { Configuration: 'Debug', Platform: 'AnyCPU' });
      assert.equal(graph.projects[0].projectPath, projectPath);
    }
  } finally {
    await client.dispose();
    await removeTemporaryDirectory(root);
  }
});

async function removeTemporaryDirectory(path: string): Promise<void> {
  // Windows can retain the Build Host's DLL or its stdout/stderr handles briefly
  // after its child-process `close` event.  `fs.rm` retries transient EPERM/EBUSY
  // failures, so allow that normal runner cleanup lag before failing the test.
  await fs.rm(path, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 });
}

async function createTemporaryDirectory(prefix: string): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  // Windows runners may expose TEMP through an 8.3 alias (RUNNER~1), while
  // MSBuild returns the expanded path. Canonicalize the fixture at its source.
  return fs.realpath(directory);
}
