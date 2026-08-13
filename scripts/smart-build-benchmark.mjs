import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const extensionPath = path.resolve('extensions/dotnav');
const { BuildHostClient } = require(path.join(extensionPath, 'out/build/buildHostClient.js'));
const { SmartBuildPlanner } = require(path.join(extensionPath, 'out/build/smartBuildPlanner.js'));

const projectCount = normalizeCount(process.argv[2] ?? '50');
const root = await mkdtemp(path.join(tmpdir(), 'dotnav-smart-build-bench-'));
const solutionPath = path.join(root, 'Benchmark.sln');

await run('dotnet', ['new', 'sln', '--name', 'Benchmark'], root);
const projectPaths = [];
for (let index = 0; index < projectCount; index += 1) {
  const name = `Project${String(index).padStart(4, '0')}`;
  const directory = path.join(root, name);
  await mkdir(directory, { recursive: true });
  const reference = index === 0
    ? ''
    : `  <ItemGroup><ProjectReference Include="../Project${String(index - 1).padStart(4, '0')}/Project${String(index - 1).padStart(4, '0')}.csproj" /></ItemGroup>\n`;
  await writeFile(path.join(directory, `${name}.csproj`),
    `<Project Sdk="Microsoft.NET.Sdk">\n  <PropertyGroup><TargetFramework>net6.0</TargetFramework></PropertyGroup>\n${reference}</Project>\n`);
  await writeFile(path.join(directory, 'Library.cs'),
    `namespace Benchmark; public static class ${name} { public static int Value => ${index}; }\n`);
  projectPaths.push(path.join(directory, `${name}.csproj`));
}
await run('dotnet', ['sln', solutionPath, 'add', ...projectPaths], root);

const cold = await timedBuild(solutionPath);
const warm = await timedBuild(solutionPath);
const host = new BuildHostClient({ extensionPath, workspaceRoot: root, requestTimeoutMs: 120_000 });
const evaluationStart = performance.now();
const graph = await host.evaluate(projectPaths, { Configuration: 'Debug', Platform: 'AnyCPU' }, solutionPath);
const evaluation = performance.now() - evaluationStart;
const planner = new SmartBuildPlanner();
const state = await planner.captureSuccessfulState(graph, Date.now() - 1, Date.now());
const smartStart = performance.now();
const plan = await planner.createPlan(graph, state);
const smartWarm = performance.now() - smartStart;
await host.dispose();
if (!plan.projects.every(item => item.decision === 'up-to-date')) throw new Error('Smart Build benchmark graph was not up-to-date.');
process.stdout.write(`${JSON.stringify({
  projectCount,
  root,
  coldMs: round(cold),
  msbuildWarmMs: round(warm),
  graphEvaluationMs: round(evaluation),
  smartWarmPlanMs: round(smartWarm),
  warmSpeedupPercent: round((1 - smartWarm / warm) * 100)
}, null, 2)}\n`);

function normalizeCount(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1 || parsed > 500) {
    throw new Error('Project count must be between 1 and 500.');
  }
  return parsed;
}

async function timedBuild(target) {
  const start = performance.now();
  await run('dotnet', ['build', target, '--configuration', 'Debug', '--nologo'], root);
  return performance.now() - start;
}

function round(value) { return Math.round(value * 100) / 100; }

function run(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', code => code === 0
      ? resolve()
      : reject(new Error(`${command} ${args.join(' ')} failed (${code}): ${stderr}`)));
  });
}
