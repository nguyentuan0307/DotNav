import * as assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { BuildHostClient } from '../build/buildHostClient';
import { SmartBuildPlanner } from '../build/smartBuildPlanner';
import { createSmartBuildTraversal } from '../build/smartBuildTraversal';

test('Smart Build output matches a clean MSBuild graph after a dependency edit', { timeout: 60_000 }, async () => {
  const root = await createTemporaryDirectory('dotnav-differential-');
  const libraryDirectory = path.join(root, 'Library');
  const appDirectory = path.join(root, 'App');
  await fs.mkdir(libraryDirectory, { recursive: true });
  await fs.mkdir(appDirectory, { recursive: true });
  const libraryProject = path.join(libraryDirectory, 'Library.csproj');
  const appProject = path.join(appDirectory, 'App.csproj');
  const librarySource = path.join(libraryDirectory, 'Value.cs');
  await fs.writeFile(libraryProject, '<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><TargetFramework>net6.0</TargetFramework></PropertyGroup></Project>');
  await fs.writeFile(librarySource, 'public static class Value { public static string Text => "before"; }');
  await fs.writeFile(appProject, '<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><OutputType>Exe</OutputType><TargetFramework>net6.0</TargetFramework></PropertyGroup><ItemGroup><ProjectReference Include="../Library/Library.csproj" /></ItemGroup></Project>');
  await fs.writeFile(path.join(appDirectory, 'Program.cs'), 'System.Console.Write(Value.Text);');

  const client = new BuildHostClient({
    extensionPath: path.resolve(__dirname, '..', '..'), workspaceRoot: root, requestTimeoutMs: 20_000
  });
  try {
    await run('dotnet', ['build', appProject, '--configuration', 'Debug', '--nologo'], root);
    const graph = await client.evaluate([appProject], { Configuration: 'Debug', Platform: 'AnyCPU' });
    const planner = new SmartBuildPlanner();
    const initialState = await planner.captureSuccessfulState(graph, Date.now() - 1, Date.now());
    const unchangedPlan = await planner.createPlan(graph, initialState);
    assert.deepEqual(unchangedPlan.projects.map(item => ({ decision: item.decision, reasons: item.reasons })),
      unchangedPlan.projects.map(() => ({ decision: 'up-to-date', reasons: [] })));
    const library = graph.projects.find(project => project.projectPath === libraryProject);
    const app = graph.projects.find(project => project.projectPath === appProject);
    assert.ok(library?.targetPath && library.referenceAssemblyPath && app?.targetPath);
    const beforeImplementation = await sha256(library.targetPath);
    const beforeReference = await sha256(library.referenceAssemblyPath);
    const beforeApp = await sha256(app.targetPath);

    await fs.writeFile(librarySource, 'public static class Value { public static string Text => "after"; }');
    const changedPlan = await planner.createPlan(graph, initialState);
    assert.deepEqual(changedPlan.projects.map(item => item.decision), ['build', 'up-to-date']);
    const traversal = path.join(root, 'smart-build.proj');
    await fs.writeFile(traversal, createSmartBuildTraversal(
      changedPlan.projects.filter(item => item.decision === 'build').map(item => item.project),
      changedPlan.requiresRestore
    ));
    const binaryLog = path.join(root, 'smart-build.binlog');
    await run('dotnet', [
      'msbuild', traversal, '-p:Configuration=Debug', '-p:Platform=AnyCPU', '-nologo', `-binaryLogger:${binaryLog}`
    ], root);
    assert.ok((await fs.stat(binaryLog)).size > 0, 'optional Smart Build binary log must be generated');

    const dependentPlan = await planner.createDependentPlan(graph, changedPlan, initialState);
    assert.deepEqual(dependentPlan.projects.map(item => item.decision), ['up-to-date', 'propagate']);
    const dependentTraversal = path.join(root, 'smart-build-dependents.proj');
    const propagationPaths = new Set(dependentPlan.projects
      .filter(item => item.decision === 'propagate').map(item => item.project.projectPath));
    await fs.writeFile(dependentTraversal, createSmartBuildTraversal(
      dependentPlan.projects.filter(item => item.decision !== 'up-to-date').map(item => item.project),
      false,
      new Set(),
      propagationPaths
    ));
    await run('dotnet', [
      'msbuild', dependentTraversal, '-p:Configuration=Debug', '-p:Platform=AnyCPU', '-nologo'
    ], root);

    assert.equal((await run('dotnet', [app.targetPath], root)).stdout, 'after');
    assert.notEqual(await sha256(library.targetPath), beforeImplementation);
    assert.equal(await sha256(library.referenceAssemblyPath), beforeReference, 'implementation-only edits must preserve the reference assembly');
    assert.equal(await sha256(app.targetPath), beforeApp, 'the dependent compiler should remain incremental when the public API is unchanged');
    assert.equal(
      await sha256(path.join(path.dirname(app.targetPath), path.basename(library.targetPath))),
      await sha256(library.targetPath),
      'MSBuild must propagate the changed implementation assembly to the dependent output'
    );
    const finalState = await planner.captureSuccessfulState(graph, Date.now() - 1, Date.now());
    assert.ok((await planner.createPlan(graph, finalState)).projects.every(item => item.decision === 'up-to-date'));
  } finally {
    await client.dispose();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('Smart Build recompiles dependents when a reference assembly changes', { timeout: 60_000 }, async () => {
  const root = await createTemporaryDirectory('dotnav-public-api-differential-');
  const libraryDirectory = path.join(root, 'Library');
  const appDirectory = path.join(root, 'App');
  await fs.mkdir(libraryDirectory, { recursive: true });
  await fs.mkdir(appDirectory, { recursive: true });
  const libraryProject = path.join(libraryDirectory, 'Library.csproj');
  const appProject = path.join(appDirectory, 'App.csproj');
  const librarySource = path.join(libraryDirectory, 'Value.cs');
  await fs.writeFile(libraryProject, '<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><TargetFramework>net6.0</TargetFramework></PropertyGroup></Project>');
  await fs.writeFile(librarySource, 'public static class Value { public const string Text = "before"; }');
  await fs.writeFile(appProject, '<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><OutputType>Exe</OutputType><TargetFramework>net6.0</TargetFramework></PropertyGroup><ItemGroup><ProjectReference Include="../Library/Library.csproj" /></ItemGroup></Project>');
  await fs.writeFile(path.join(appDirectory, 'Program.cs'), 'System.Console.Write(Value.Text);');

  const client = new BuildHostClient({
    extensionPath: path.resolve(__dirname, '..', '..'), workspaceRoot: root, requestTimeoutMs: 20_000
  });
  try {
    await run('dotnet', ['build', appProject, '--configuration', 'Debug', '--nologo'], root);
    const graph = await client.evaluate([appProject], { Configuration: 'Debug', Platform: 'AnyCPU' });
    const planner = new SmartBuildPlanner();
    const initialState = await planner.captureSuccessfulState(graph, Date.now() - 1, Date.now());
    const app = graph.projects.find(project => project.projectPath === appProject);
    assert.ok(app?.targetPath);
    const beforeApp = await sha256(app.targetPath);

    await fs.writeFile(librarySource, 'public static class Value { public const string Text = "after"; }');
    const primaryPlan = await planner.createPlan(graph, initialState);
    assert.deepEqual(primaryPlan.projects.map(item => item.decision), ['build', 'up-to-date']);
    await executeTraversal(root, primaryPlan, 'smart-build-primary.proj');

    const dependentPlan = await planner.createDependentPlan(graph, primaryPlan, initialState);
    assert.deepEqual(dependentPlan.projects.map(item => item.decision), ['up-to-date', 'build']);
    assert.equal(dependentPlan.projects[1].reasons[0]?.code, 'public-api-changed');
    await executeTraversal(root, dependentPlan, 'smart-build-dependent.proj');

    assert.equal((await run('dotnet', [app.targetPath], root)).stdout, 'after');
    assert.notEqual(await sha256(app.targetPath), beforeApp, 'public const changes must be recompiled into the dependent');
  } finally {
    await client.dispose();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('Smart Build mutation matrix remains equivalent to a clean build', { timeout: 90_000 }, async () => {
  const root = await createTemporaryDirectory('dotnav-mutation-matrix-');
  const project = path.join(root, 'Matrix.csproj');
  const program = path.join(root, 'Program.cs');
  const feature = path.join(root, 'Feature.cs');
  await fs.writeFile(project, '<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><OutputType>Exe</OutputType><TargetFramework>net6.0</TargetFramework></PropertyGroup></Project>');
  await fs.writeFile(program, 'System.Console.Write(Feature.Value);');
  await fs.writeFile(feature, 'public static class Feature { public static string Value => "base"; }');
  const client = new BuildHostClient({
    extensionPath: path.resolve(__dirname, '..', '..'), workspaceRoot: root, requestTimeoutMs: 20_000
  });
  try {
    await run('dotnet', ['build', project, '--configuration', 'Debug', '--nologo'], root);
    let graph = await client.evaluate([project], { Configuration: 'Debug', Platform: 'AnyCPU' });
    const planner = new SmartBuildPlanner();
    let state = await planner.captureSuccessfulState(graph, Date.now() - 1, Date.now());
    const target = () => graph.projects.find(item => item.projectPath === project)!.targetPath;
    assert.equal((await run('dotnet', [target()], root)).stdout, 'base');

    // Project-wide property mutation.
    await fs.writeFile(path.join(root, 'Directory.Build.props'), '<Project><PropertyGroup><DefineConstants>$(DefineConstants);FEATURE</DefineConstants></PropertyGroup></Project>');
    await fs.writeFile(feature, '#if FEATURE\npublic static class Feature { public static string Value => "feature"; }\n#else\npublic static class Feature { public static string Value => "base"; }\n#endif');
    graph = await client.evaluate([project], { Configuration: 'Debug', Platform: 'AnyCPU' });
    state = await executeSmartPlan(root, graph, planner, state);
    assert.equal((await run('dotnet', [target()], root)).stdout, 'feature');

    // Required output deletion.
    await fs.unlink(target());
    state = await executeSmartPlan(root, graph, planner, state);
    assert.equal((await run('dotnet', [target()], root)).stdout, 'feature');

    // New default-glob source plus a dependent source edit.
    await fs.writeFile(path.join(root, 'Added.cs'), 'public static class Added { public static string Value => "-added"; }');
    await fs.writeFile(program, 'System.Console.Write(Feature.Value + Added.Value);');
    graph = await client.evaluate([project], { Configuration: 'Debug', Platform: 'AnyCPU' });
    state = await executeSmartPlan(root, graph, planner, state);
    assert.equal((await run('dotnet', [target()], root)).stdout, 'feature-added');
    const smartHash = await sha256(target());

    await run('dotnet', ['clean', project, '--configuration', 'Debug', '--nologo'], root);
    await run('dotnet', ['build', project, '--configuration', 'Debug', '--nologo'], root);
    assert.equal((await run('dotnet', [target()], root)).stdout, 'feature-added');
    assert.equal(await sha256(target()), smartHash, 'final Smart Build artifact must equal a clean deterministic build');
    assert.ok(state.projects[graph.projects[0].id]);
  } finally {
    await client.dispose();
    await fs.rm(root, { recursive: true, force: true });
  }
});

async function executeSmartPlan(
  root: string,
  graph: Awaited<ReturnType<BuildHostClient['evaluate']>>,
  planner: SmartBuildPlanner,
  state: Awaited<ReturnType<SmartBuildPlanner['captureSuccessfulState']>>
) {
  const plan = await planner.createPlan(graph, state);
  assert.ok(plan.projects.some(item => item.decision !== 'up-to-date'), 'mutation must invalidate at least one project');
  const selected = plan.projects.filter(item => item.decision === 'build' || item.decision === 'fallback').map(item => item.project);
  const traversal = path.join(root, 'smart-build.proj');
  await fs.writeFile(traversal, createSmartBuildTraversal(selected, plan.requiresRestore,
    new Set(plan.projects.filter(item => item.decision === 'fallback').map(item => item.project.projectPath))));
  await run('dotnet', ['msbuild', traversal, '-p:Configuration=Debug', '-p:Platform=AnyCPU', '-nologo'], root);
  return planner.captureSuccessfulState(graph, Date.now() - 1, Date.now());
}

async function executeTraversal(root: string, plan: Awaited<ReturnType<SmartBuildPlanner['createPlan']>>, fileName: string): Promise<void> {
  const selected = plan.projects.filter(item => item.decision !== 'up-to-date').map(item => item.project);
  const traversal = path.join(root, fileName);
  await fs.writeFile(traversal, createSmartBuildTraversal(
    selected,
    plan.requiresRestore,
    new Set(plan.projects.filter(item => item.decision === 'fallback').map(item => item.project.projectPath)),
    new Set(plan.projects.filter(item => item.decision === 'propagate').map(item => item.project.projectPath))
  ));
  await run('dotnet', ['msbuild', traversal, '-p:Configuration=Debug', '-p:Platform=AnyCPU', '-nologo'], root);
}

async function sha256(filePath: string): Promise<string> {
  return createHash('sha256').update(await fs.readFile(filePath)).digest('hex');
}

async function createTemporaryDirectory(prefix: string): Promise<string> {
  return fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), prefix)));
}

async function run(command: string, args: string[], cwd: string): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', value => { stdout += String(value); });
    child.stderr.on('data', value => { stderr += String(value); });
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve({ stdout, stderr })
      : reject(new Error(`${command} exited ${code}: ${stderr || stdout}`)));
  });
}
