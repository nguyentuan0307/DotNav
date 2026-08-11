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
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dotnav-differential-'));
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
    assert.deepEqual(changedPlan.projects.map(item => item.decision), ['build', 'build']);
    const traversal = path.join(root, 'smart-build.proj');
    await fs.writeFile(traversal, createSmartBuildTraversal(
      changedPlan.projects.filter(item => item.decision === 'build').map(item => item.project),
      changedPlan.requiresRestore
    ));
    await run('dotnet', ['msbuild', traversal, '-p:Configuration=Debug', '-p:Platform=AnyCPU', '-nologo'], root);

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

async function sha256(filePath: string): Promise<string> {
  return createHash('sha256').update(await fs.readFile(filePath)).digest('hex');
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
