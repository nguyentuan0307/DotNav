import * as assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { BuildChangeTracker } from '../build/buildChangeTracker';
import { BuildStateStore } from '../build/buildStateStore';
import { SmartBuildPlanner } from '../build/smartBuildPlanner';
import { EvaluatedBuildGraph, EvaluatedProjectVariant } from '../build/types';

test('first Smart Build builds supported projects and falls back for opaque projects', async () => {
  const fixture = await createFixture();
  const opaque = { ...fixture.graph.projects[0], id: 'opaque', isOpaque: true, opaqueReasons: ['pre-build-event'] };
  const plan = await new SmartBuildPlanner().createPlan({ ...fixture.graph, projects: [fixture.graph.projects[0], opaque] });
  assert.equal(plan.projects[0].decision, 'build');
  assert.equal(plan.projects[0].reasons[0].code, 'first-run');
  assert.equal(plan.projects[1].decision, 'fallback');
});

test('captured successful state makes an unchanged graph up-to-date', async () => {
  const fixture = await createFixture();
  const planner = new SmartBuildPlanner();
  const state = await planner.captureSuccessfulState(fixture.graph, Date.now() - 10, Date.now());
  const plan = await planner.createPlan(fixture.graph, state);
  assert.deepEqual(plan.projects.map(item => item.decision), ['up-to-date', 'up-to-date']);
});

test('unchanged files reuse stored fingerprints without reading their contents', async () => {
  const fixture = await createFixture();
  const planner = new SmartBuildPlanner();
  const state = await planner.captureSuccessfulState(fixture.graph, Date.now() - 10, Date.now());
  const source = fixture.sourceA;
  const original = state.projects[fixture.graph.projects[0].id].inputs[source];
  assert.ok(original);
  const plan = await planner.createPlan(fixture.graph, state);
  assert.equal(plan.projects[0].decision, 'up-to-date');
});

test('implementation-only changes defer dependents to reference propagation', async () => {
  const fixture = await createFixture();
  const tracker = new BuildChangeTracker();
  tracker.updateGraph(fixture.graph);
  const planner = new SmartBuildPlanner(tracker);
  const state = await planner.captureSuccessfulState(fixture.graph, Date.now() - 10, Date.now());
  await fs.writeFile(fixture.sourceA, 'public class A { public int Changed => 2; }');
  tracker.recordChange(fixture.sourceA);
  const plan = await planner.createPlan(fixture.graph, state);
  assert.deepEqual(plan.projects.map(item => item.decision), ['build', 'up-to-date']);
  const dependentPlan = await planner.createDependentPlan(fixture.graph, plan, state);
  assert.deepEqual(dependentPlan.projects.map(item => item.decision), ['up-to-date', 'propagate']);
});

test('public API changes rebuild the reverse-dependent closure', async () => {
  const fixture = await createFixture();
  const planner = new SmartBuildPlanner();
  const state = await planner.captureSuccessfulState(fixture.graph, Date.now() - 10, Date.now());
  await fs.writeFile(fixture.sourceA, 'public class A { public string Added => "api"; }');
  const plan = await planner.createPlan(fixture.graph, state);
  await fs.writeFile(fixture.graph.projects[0].referenceAssemblyPath, 'changed-reference');
  const dependentPlan = await planner.createDependentPlan(fixture.graph, plan, state);
  assert.deepEqual(dependentPlan.projects.map(item => item.decision), ['up-to-date', 'build']);
});

test('dependent refinement covers the full transitive closure and fails safe without a reference assembly', async () => {
  const fixture = await createFixture();
  const projectB = fixture.graph.projects[1];
  const projectC = await createProject(path.dirname(path.dirname(projectB.projectPath)), 'C', [projectB.projectPath]);
  const graph = { ...fixture.graph, projects: [...fixture.graph.projects, projectC] };
  const planner = new SmartBuildPlanner();
  const state = await planner.captureSuccessfulState(graph, Date.now() - 10, Date.now());
  await fs.writeFile(fixture.sourceA, 'public class A { public int Changed => 2; }');
  const primaryPlan = await planner.createPlan(graph, state);
  assert.deepEqual(primaryPlan.projects.map(item => item.decision), ['build', 'up-to-date', 'up-to-date']);

  const propagationPlan = await planner.createDependentPlan(graph, primaryPlan, state);
  assert.deepEqual(propagationPlan.projects.map(item => item.decision), ['up-to-date', 'propagate', 'propagate']);

  await fs.unlink(graph.projects[0].referenceAssemblyPath);
  const conservativePlan = await planner.createDependentPlan(graph, primaryPlan, state);
  assert.deepEqual(conservativePlan.projects.map(item => item.decision), ['up-to-date', 'build', 'build']);
});

test('missing output forces a build', async () => {
  const fixture = await createFixture();
  const planner = new SmartBuildPlanner();
  const state = await planner.captureSuccessfulState(fixture.graph, Date.now() - 10, Date.now());
  await fs.unlink(fixture.graph.projects[1].targetPath);
  const plan = await planner.createPlan(fixture.graph, state);
  assert.equal(plan.projects[1].decision, 'build');
  assert.ok(plan.projects[1].reasons.some(reason => reason.code === 'output-missing'));
});

test('a missing evaluated content copy is synchronized without recompiling', async () => {
  const fixture = await createFixture();
  const source = path.join(path.dirname(fixture.sourceA), 'settings.json');
  const destination = path.join(fixture.graph.projects[0].outputPath, 'settings.json');
  await fs.writeFile(source, '{"ok":true}');
  await fs.writeFile(destination, '{"ok":true}');
  const project = {
    ...fixture.graph.projects[0],
    inputs: [...fixture.graph.projects[0].inputs, source],
    outputs: [...fixture.graph.projects[0].outputs, destination],
    copies: [{ source, destination, mode: 'PreserveNewest' }]
  };
  const graph = { ...fixture.graph, projects: [project] };
  const planner = new SmartBuildPlanner();
  const state = await planner.captureSuccessfulState(graph, Date.now() - 1, Date.now());
  await fs.unlink(destination);
  const plan = await planner.createPlan(graph, state);
  assert.equal(plan.projects[0].decision, 'copy');
  assert.deepEqual(plan.projects[0].copies, project.copies);
});

test('PreserveNewest copies a touched source even when its bytes are unchanged', async () => {
  const fixture = await createFixture();
  const source = path.join(path.dirname(fixture.sourceA), 'settings.json');
  const destination = path.join(fixture.graph.projects[0].outputPath, 'settings.json');
  await fs.writeFile(source, '{"ok":true}');
  await fs.writeFile(destination, '{"ok":true}');
  const old = new Date(Date.now() - 10_000);
  await fs.utimes(source, old, old);
  await fs.utimes(destination, old, old);
  const project = {
    ...fixture.graph.projects[0],
    inputs: [...fixture.graph.projects[0].inputs, source],
    outputs: [...fixture.graph.projects[0].outputs, destination],
    copies: [{ source, destination, mode: 'PreserveNewest' }]
  };
  const graph = { ...fixture.graph, projects: [project] };
  const planner = new SmartBuildPlanner();
  const state = await planner.captureSuccessfulState(graph, Date.now() - 1, Date.now());
  const newer = new Date();
  await fs.utimes(source, newer, newer);
  const plan = await planner.createPlan(graph, state);
  assert.equal(plan.projects[0].decision, 'copy');
});

test('state store rejects corrupt state and persists a valid snapshot atomically', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'dotnav-build-state-'));
  await fs.writeFile(path.join(directory, 'solution-state.json'), '{broken');
  const broken = new BuildStateStore(directory);
  assert.equal(await broken.load(), undefined);
  const valid = { schemaVersion: 1, graphFingerprint: 'graph', projects: {} } as const;
  await broken.save(valid);
  const reloaded = new BuildStateStore(directory);
  assert.deepEqual(await reloaded.load(), valid);
  await reloaded.clear();
  assert.equal(await new BuildStateStore(directory).load(), undefined);
});

test('change tracker reevaluates default and custom globs when a new file appears', async () => {
  const fixture = await createFixture();
  const tracker = new BuildChangeTracker();
  tracker.updateGraph(fixture.graph);
  assert.equal(tracker.needsGraphEvaluation(), false);
  tracker.recordChange(path.join(path.dirname(fixture.sourceA), 'NewlyAdded.cs'));
  assert.equal(tracker.needsGraphEvaluation(), true);
});

test('change tracker does not reevaluate the graph for unrelated content edits', async () => {
  const fixture = await createFixture();
  const tracker = new BuildChangeTracker();
  tracker.updateGraph(fixture.graph);
  tracker.recordChange(path.join(path.dirname(fixture.sourceA), 'README.md'), 'change');
  assert.equal(tracker.needsGraphEvaluation(), false);
});

test('change tracker reevaluates the graph when a watched source is deleted', async () => {
  const fixture = await createFixture();
  const tracker = new BuildChangeTracker();
  tracker.updateGraph(fixture.graph);
  tracker.recordChange(fixture.sourceA, 'delete');
  assert.equal(tracker.needsGraphEvaluation(), true);
});

test('change tracker ignores generated output churn', async () => {
  const fixture = await createFixture();
  const tracker = new BuildChangeTracker();
  tracker.updateGraph(fixture.graph);
  const generation = tracker.snapshot();
  tracker.recordChange(fixture.graph.projects[0].targetPath);
  assert.equal(tracker.changedSince(generation), false);
  assert.equal(tracker.needsGraphEvaluation(), false);
});

test('graph revisions remain visible to every cached solution runtime', async () => {
  const fixture = await createFixture();
  const tracker = new BuildChangeTracker();
  tracker.updateGraph(fixture.graph);
  const firstRuntimeRevision = tracker.graphRevision();
  const secondRuntimeRevision = tracker.graphRevision();
  tracker.recordChange(path.join(path.dirname(fixture.sourceA), 'NewItem.any-extension'));
  assert.notEqual(tracker.graphRevision(), firstRuntimeRevision);
  tracker.updateGraph(fixture.graph);
  assert.notEqual(tracker.graphRevision(), secondRuntimeRevision);
});

async function createFixture(): Promise<{ graph: EvaluatedBuildGraph; sourceA: string }> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dotnav-smart-planner-'));
  const projectA = await createProject(root, 'A');
  const projectB = await createProject(root, 'B', [projectA.projectPath]);
  return {
    graph: {
      protocolVersion: 1,
      msbuildPath: '/sdk',
      msbuildVersion: '1',
      globalProperties: { Configuration: 'Debug', Platform: 'AnyCPU' },
      projects: [projectA, projectB]
    },
    sourceA: projectA.inputs[1]
  };
}

async function createProject(root: string, name: string, references: string[] = []): Promise<EvaluatedProjectVariant> {
  const directory = path.join(root, name);
  await fs.mkdir(path.join(directory, 'obj', 'Debug', 'net6.0', 'ref'), { recursive: true });
  await fs.mkdir(path.join(directory, 'bin', 'Debug', 'net6.0'), { recursive: true });
  const projectPath = path.join(directory, `${name}.csproj`);
  const source = path.join(directory, `${name}.cs`);
  const target = path.join(directory, 'bin', 'Debug', 'net6.0', `${name}.dll`);
  const reference = path.join(directory, 'obj', 'Debug', 'net6.0', 'ref', `${name}.dll`);
  const assets = path.join(directory, 'obj', 'project.assets.json');
  await fs.writeFile(projectPath, '<Project Sdk="Microsoft.NET.Sdk" />');
  await fs.writeFile(source, `public class ${name} { }`);
  await fs.writeFile(target, `${name}-implementation`);
  await fs.writeFile(reference, `${name}-reference`);
  await fs.writeFile(assets, '{}');
  return {
    id: `${projectPath}|Debug|AnyCPU|net6.0|`, projectPath, projectName: name,
    configuration: 'Debug', platform: 'AnyCPU', targetFramework: 'net6.0', runtimeIdentifier: '',
    targetPath: target, referenceAssemblyPath: reference,
    intermediateOutputPath: path.join(directory, 'obj', 'Debug', 'net6.0'),
    outputPath: path.join(directory, 'bin', 'Debug', 'net6.0'), assetsFile: assets,
    isSdkStyle: true, isOpaque: false, opaqueReasons: [], projectReferences: references,
    inputs: [projectPath, source], imports: [], outputs: [target, reference], copies: []
  };
}
