import * as assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { test } from 'node:test';
import { BuildChangeTracker } from '../build/buildChangeTracker';
import { mapConcurrent } from '../build/fingerprints';
import { SmartBuildPlanner } from '../build/smartBuildPlanner';
import { scopeTransitiveUpstream } from '../build/smartBuildTraversal';
import { EvaluatedBuildGraph, EvaluatedProjectVariant } from '../build/types';
import { ProjectModel, SolutionModel } from '../models';

function sampleVariant(id: string, projectPath: string, projectReferences: string[] = []): EvaluatedProjectVariant {
  return {
    id,
    projectPath,
    projectName: path.basename(projectPath, path.extname(projectPath)),
    configuration: 'Debug',
    platform: 'AnyCPU',
    targetFramework: 'net8.0',
    runtimeIdentifier: '',
    targetPath: projectPath.replace(/\.csproj$/, '.dll'),
    referenceAssemblyPath: projectPath.replace(/\.csproj$/, '.ref.dll'),
    intermediateOutputPath: '/obj',
    outputPath: '/bin',
    assetsFile: '/obj/project.assets.json',
    isSdkStyle: true,
    isOpaque: false,
    opaqueReasons: [],
    projectReferences,
    inputs: [projectPath, projectPath.replace(/\.csproj$/, '.cs')],
    imports: [],
    outputs: [projectPath.replace(/\.csproj$/, '.dll')],
    copies: []
  };
}

test('BuildChangeTracker tracks pending changes and graph invalidation accurately', () => {
  const tracker = new BuildChangeTracker();
  assert.equal(tracker.hasPendingChanges(), true); // Initially graph is invalidated
  assert.equal(tracker.needsGraphEvaluation(), true);
  assert.equal(tracker.isGraphInvalidated(), true);
  assert.equal(tracker.getPendingChangeCount(), 0);

  const graph: EvaluatedBuildGraph = {
    protocolVersion: 2,
    msbuildPath: 'msbuild',
    msbuildVersion: '17.0',
    globalProperties: {},
    projects: [sampleVariant('p1', '/repo/App.csproj')]
  };

  tracker.updateGraph(graph);
  assert.equal(tracker.hasPendingChanges(), false);
  assert.equal(tracker.needsGraphEvaluation(), false);
  assert.equal(tracker.getPendingChangeCount(), 0);

  // Content change to tracked input
  tracker.recordChange('/repo/App.cs', 'change');
  assert.equal(tracker.hasPendingChanges(), true);
  assert.equal(tracker.getPendingChangeCount(), 1);
  assert.ok(tracker.hasChanged('/repo/App.cs'));
  assert.equal(tracker.isGraphInvalidated(), false); // C# content change does not invalidate project graph

  // Graph structural change
  tracker.recordChange('/repo/App.csproj', 'change');
  assert.equal(tracker.isGraphInvalidated(), true); // .csproj change invalidates graph

  tracker.consumeChanges();
  assert.equal(tracker.getPendingChangeCount(), 0);
});

test('mapConcurrent throttles execution while preserving order and results', async () => {
  let activeWorkers = 0;
  let maxActiveWorkers = 0;
  const items = Array.from({ length: 50 }, (_, i) => i);

  const results = await mapConcurrent(items, 8, async (item) => {
    activeWorkers += 1;
    maxActiveWorkers = Math.max(maxActiveWorkers, activeWorkers);
    await new Promise(resolve => setTimeout(resolve, 5));
    activeWorkers -= 1;
    return item * 2;
  });

  assert.equal(maxActiveWorkers <= 8, true);
  assert.equal(results.length, 50);
  assert.deepEqual(results, items.map(i => i * 2));
});

function createProject(name: string, projectPath: string, refPaths: string[] = []): ProjectModel {
  return {
    name,
    path: projectPath,
    directory: path.dirname(projectPath),
    relativePath: name + '.csproj',
    kind: 'library',
    targetFrameworks: ['net8.0'],
    launchProfiles: [],
    packageReferences: [],
    projectReferences: refPaths.map(ref => ({ name: path.basename(ref, '.csproj'), path: ref }))
  };
}

test('scopeTransitiveUpstream extracts only transitive dependencies of target projects', () => {
  const pA = createProject('App', '/repo/App/App.csproj', ['/repo/Lib/Lib.csproj', '/repo/Core/Core.csproj']);
  const pLib = createProject('Lib', '/repo/Lib/Lib.csproj', ['/repo/Core/Core.csproj']);
  const pCore = createProject('Core', '/repo/Core/Core.csproj', []);
  const pAdmin = createProject('Admin', '/repo/Admin/Admin.csproj', ['/repo/Core/Core.csproj']);
  const pTests = createProject('Tests', '/repo/Tests/Tests.csproj', ['/repo/App/App.csproj']);

  const solution: SolutionModel = {
    name: 'MySolution',
    rootPath: '/repo',
    path: '/repo/MySolution.sln',
    projects: [pA, pLib, pCore, pAdmin, pTests]
  };

  // Scoping Lib -> should only include Lib and Core
  const libScope = scopeTransitiveUpstream(solution, [pLib]);
  assert.deepEqual(libScope.map(p => p.name).sort(), ['Core', 'Lib'].sort());

  // Scoping Admin -> should only include Admin and Core
  const adminScope = scopeTransitiveUpstream(solution, [pAdmin]);
  assert.deepEqual(adminScope.map(p => p.name).sort(), ['Admin', 'Core'].sort());

  // Scoping App -> should include App, Lib, and Core (excludes Admin and Tests)
  const appScope = scopeTransitiveUpstream(solution, [pA]);
  assert.deepEqual(appScope.map(p => p.name).sort(), ['App', 'Core', 'Lib'].sort());
});

test('smartBuildExecutor enables Roslyn shared compiler daemon reuse', () => {
  const executorCode = readFileSync(path.join(__dirname, '..', '..', 'src', 'build', 'smartBuildExecutor.ts'), 'utf8');
  assert.match(executorCode, /-p:UseSharedCompilation=true/);
});

test('tryFastPathPlan returns immediately when there are no changes', async () => {
  const tracker = new BuildChangeTracker();
  const planner = new SmartBuildPlanner(tracker);
  const project = sampleVariant('p1', '/repo/App.csproj');
  const graph: EvaluatedBuildGraph = {
    protocolVersion: 2,
    msbuildPath: 'msbuild',
    msbuildVersion: '17.0',
    globalProperties: {},
    projects: [project]
  };
  tracker.updateGraph(graph);

  // When no state exists, fast path returns undefined
  const noStatePlan = await planner.tryFastPathPlan(graph, undefined);
  assert.equal(noStatePlan, undefined);

  // When pending changes exist, fast path returns undefined
  tracker.recordChange('/repo/App.cs', 'change');
  const pendingPlan = await planner.tryFastPathPlan(graph, undefined);
  assert.equal(pendingPlan, undefined);
});
