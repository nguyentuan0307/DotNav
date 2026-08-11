import { createHash } from 'crypto';
import * as path from 'path';
import * as vscode from 'vscode';
import { runDotnetForProject, runDotnetForProjects, runDotnetForSolution } from '../dotnetCli';
import { ProjectModel, SolutionModel } from '../models';
import { ProcessManager } from '../processManager';
import { BuildChangeTracker } from './buildChangeTracker';
import { BuildHostClient } from './buildHostClient';
import { BuildStateStore, StoredBuildState } from './buildStateStore';
import { SmartBuildExecutor } from './smartBuildExecutor';
import { SmartBuildPlanner } from './smartBuildPlanner';
import { EvaluatedBuildGraph, SmartBuildPlan } from './types';

interface SolutionRuntime {
  graph?: EvaluatedBuildGraph;
  graphRevision?: number;
  readonly store: BuildStateStore;
  readonly rootPath: string;
}

export class SmartBuildCoordinator implements vscode.Disposable {
  private readonly output = vscode.window.createOutputChannel('DotNav Smart Build');
  private readonly host: BuildHostClient;
  private readonly changes = new BuildChangeTracker();
  private readonly planner = new SmartBuildPlanner(this.changes);
  private readonly executor = new SmartBuildExecutor();
  private readonly runtimes = new Map<string, SolutionRuntime>();
  private readonly activeProjectPaths = new Set<string>();

  constructor(private readonly context: vscode.ExtensionContext) {
    this.host = new BuildHostClient({
      extensionPath: context.extensionPath,
      workspaceRoot: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
      requestTimeoutMs: 60_000,
      onDiagnostic: message => this.log(`[host] ${message}`)
    });
  }

  recordFileChange(filePath: string): void {
    this.changes.recordChange(filePath);
  }

  async buildSolution(solution: SolutionModel, processManager: ProcessManager): Promise<void> {
    await this.buildScope(solution, processManager, true);
  }

  async buildProjects(solution: SolutionModel, projects: readonly ProjectModel[], processManager: ProcessManager, label?: string): Promise<void> {
    if (projects.length === 0) return;
    await this.buildScope({ ...solution, name: label ?? projects[0].name, projects: [...projects] }, processManager, false);
  }

  private async buildScope(solution: SolutionModel, processManager: ProcessManager, useSolutionConfiguration: boolean): Promise<void> {
    const projectPaths = solution.projects.map(project => normalizedPath(project.path));
    if (projectPaths.some(projectPath => this.activeProjectPaths.has(projectPath))) {
      vscode.window.showInformationMessage('A Smart Build is already active for one or more selected projects.');
      return;
    }
    for (const projectPath of projectPaths) this.activeProjectPaths.add(projectPath);
    const buildStart = Date.now();
    const generation = this.changes.snapshot();
    try {
      const { graph, plan, runtime, state } = await this.preparePlan(solution, useSolutionConfiguration);
      this.logPlan(solution, plan);
      if (vscode.workspace.getConfiguration('dotnav').get<string>('smartBuild.mode', 'execute') === 'shadow') {
        this.log('Shadow mode: the Smart Build plan was not executed; running standard Build.');
        await this.runStandardScope(solution, processManager, useSolutionConfiguration);
        return;
      }
      if (plan.projects.every(item => item.decision === 'up-to-date')) {
        vscode.window.showInformationMessage(`Smart Build: ${solution.name} is up-to-date.`);
        return;
      }
      if (useSolutionConfiguration && plan.projects.some(item => item.decision === 'fallback')) {
        this.log('The active solution contains opaque build logic; preserving exact solution semantics with standard Build.');
        await this.runStandardScope(solution, processManager, true);
        return;
      }
      const result = await this.executor.execute(plan, solution, processManager, buildWorkingDirectory(solution, useSolutionConfiguration));
      if (!result.success) {
        if (!result.cancelled) vscode.window.showErrorMessage(`Smart Build failed for ${solution.name}.`);
        return;
      }
      const buildEnd = Date.now();
      if (this.changes.changedSince(generation)) {
        this.log('State was not committed because workspace inputs changed during the build.');
        vscode.window.showWarningMessage('Smart Build succeeded, but files changed during the build; the next build will validate them again.');
        return;
      }
      const captured = await this.planner.captureSuccessfulState(graph, buildStart, buildEnd);
      this.logReferenceAssemblyEffect(state, captured, plan);
      await runtime.store.save(captured);
      this.changes.consumeChanges();
      vscode.window.showInformationMessage(summaryMessage(solution, plan, buildEnd - buildStart));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.log(`Smart Build unavailable: ${message}`);
      vscode.window.showWarningMessage(`Smart Build could not safely plan this build. Continuing with standard Build. ${message}`);
      await this.runStandardScope(solution, processManager, useSolutionConfiguration);
    } finally {
      for (const projectPath of projectPaths) this.activeProjectPaths.delete(projectPath);
    }
  }

  async explainPlan(solution: SolutionModel): Promise<void> {
    try {
      const { plan } = await this.preparePlan(solution, true);
      this.logPlan(solution, plan);
      this.output.show(true);
    } catch (error) {
      vscode.window.showErrorMessage(`Could not create Smart Build plan: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async invalidate(solution?: SolutionModel, notify = true): Promise<void> {
    if (solution) {
      const runtimes = [...this.runtimes.values()].filter(runtime => normalizedPath(runtime.rootPath) === normalizedPath(solution.rootPath));
      await Promise.all(runtimes.map(runtime => runtime.store.clear()));
      for (const runtime of runtimes) runtime.graph = undefined;
    } else {
      await Promise.all([...this.runtimes.values()].map(runtime => runtime.store.clear()));
      for (const runtime of this.runtimes.values()) runtime.graph = undefined;
    }
    this.changes.invalidateGraph();
    if (notify) vscode.window.showInformationMessage('DotNav Smart Build cache was invalidated.');
  }

  dispose(): void {
    this.output.dispose();
    void this.host.dispose();
  }

  private async preparePlan(solution: SolutionModel, useSolutionConfiguration: boolean): Promise<{ graph: EvaluatedBuildGraph; plan: SmartBuildPlan; runtime: SolutionRuntime; state?: StoredBuildState }> {
    const runtime = this.runtimeFor(solution, useSolutionConfiguration);
    if (!runtime.graph || runtime.graphRevision !== this.changes.graphRevision()) {
      if (runtime.graph) await this.host.restart();
      runtime.graph = await this.evaluate(solution, useSolutionConfiguration);
      runtime.graphRevision = this.changes.graphRevision();
    }
    let state = await runtime.store.load();
    let plan = await this.planner.createPlan(runtime.graph, state);
    if (plan.projects.some(item => item.reasons.some(reason => reason.detail && isGraphFile(reason.detail)))) {
      runtime.graph = await this.evaluate(solution, useSolutionConfiguration);
      runtime.graphRevision = this.changes.graphRevision();
      state = await runtime.store.load();
      plan = await this.planner.createPlan(runtime.graph, state);
    }
    return { graph: runtime.graph, plan, runtime, state };
  }

  private async runStandardScope(solution: SolutionModel, processManager: ProcessManager, useSolutionConfiguration: boolean): Promise<void> {
    if (useSolutionConfiguration && solution.path) return runDotnetForSolution(solution, 'build', processManager);
    if (solution.projects.length === 1) return runDotnetForProject(solution.projects[0], 'build', processManager);
    return runDotnetForProjects(
      solution.projects,
      buildWorkingDirectory(solution, useSolutionConfiguration),
      processManager,
      solution.name
    );
  }

  private logReferenceAssemblyEffect(previous: StoredBuildState | undefined, current: StoredBuildState, plan: SmartBuildPlan): void {
    if (!previous) return;
    let stableReferences = 0;
    for (const item of plan.projects.filter(entry => entry.decision === 'build')) {
      const before = previous.projects[item.project.id];
      const after = current.projects[item.project.id];
      if (before?.implementationAssemblySha256 && after?.implementationAssemblySha256
        && before.implementationAssemblySha256 !== after.implementationAssemblySha256
        && before.referenceAssemblySha256 && before.referenceAssemblySha256 === after.referenceAssemblySha256) {
        stableReferences += 1;
      }
    }
    if (stableReferences > 0) this.log(`Reference assembly optimization: ${stableReferences} changed implementation(s) preserved their public API.`);
  }

  private async evaluate(solution: SolutionModel, useSolutionConfiguration: boolean): Promise<EvaluatedBuildGraph> {
    const configuration = vscode.workspace.getConfiguration('dotnav').get<string>('buildConfiguration', 'Debug');
    const platform = vscode.workspace.getConfiguration('dotnav').get<string>('buildPlatform', 'AnyCPU');
    await this.host.setWorkingDirectory(buildWorkingDirectory(solution, useSolutionConfiguration));
    const graph = await this.host.evaluate(
      solution.projects.map(project => project.path),
      { Configuration: configuration, Platform: platform },
      useSolutionConfiguration ? solution.path : undefined
    );
    this.changes.updateGraph(graph);
    return graph;
  }

  private runtimeFor(solution: SolutionModel, useSolutionConfiguration: boolean): SolutionRuntime {
    const key = solutionKey(solution, useSolutionConfiguration);
    let runtime = this.runtimes.get(key);
    if (!runtime) {
      const storageRoot = this.context.storageUri?.fsPath ?? this.context.globalStorageUri.fsPath;
      runtime = { store: new BuildStateStore(path.join(storageRoot, 'smart-build', key)), rootPath: solution.rootPath };
      this.runtimes.set(key, runtime);
    }
    return runtime;
  }

  private logPlan(solution: SolutionModel, plan: SmartBuildPlan): void {
    const counts = countDecisions(plan);
    this.log(`Plan ${solution.name}: build=${counts.build}, copy=${counts.copy}, fallback=${counts.fallback}, up-to-date=${counts['up-to-date']}`);
    for (const item of plan.projects.filter(item => item.decision !== 'up-to-date')) {
      this.log(`  ${item.project.projectName} [${item.project.targetFramework || 'default'}]: ${item.decision} (${item.reasons.map(reason => `${reason.code}${reason.detail ? `: ${reason.detail}` : ''}`).join('; ')})`);
    }
  }

  private log(message: string): void {
    this.output.appendLine(`[${new Date().toISOString()}] ${message}`);
  }
}

function solutionKey(solution: SolutionModel, useSolutionConfiguration: boolean): string {
  const scope = solution.projects.map(project => path.resolve(project.path)).sort().join('\n');
  return createHash('sha256').update(`${useSolutionConfiguration ? 'solution' : 'projects'}\n${path.resolve(solution.path ?? solution.rootPath)}\n${scope}`).digest('hex').slice(0, 24);
}

function normalizedPath(value: string): string {
  const resolved = path.resolve(value);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function buildWorkingDirectory(solution: SolutionModel, useSolutionConfiguration: boolean): string {
  if (useSolutionConfiguration && solution.path) return path.dirname(solution.path);
  if (solution.projects.length === 1) return solution.projects[0].directory;
  if (solution.projects.length === 0) return solution.rootPath;
  const directories = solution.projects.map(project => path.resolve(project.directory).split(path.sep));
  const common: string[] = [];
  for (let index = 0; index < Math.min(...directories.map(parts => parts.length)); index += 1) {
    const candidate = directories[0][index];
    if (!directories.every(parts => process.platform === 'win32'
      ? parts[index].toLowerCase() === candidate.toLowerCase()
      : parts[index] === candidate)) break;
    common.push(candidate);
  }
  const result = common.join(path.sep) || path.parse(solution.rootPath).root;
  return path.isAbsolute(result) ? result : path.sep + result;
}

function isGraphFile(value: string): boolean {
  return /\.(sln|slnx|csproj|fsproj|vbproj|props|targets)$/i.test(value) || /(?:^|[/\\])(global\.json|nuget\.config)$/i.test(value);
}

function countDecisions(plan: SmartBuildPlan): Record<'build' | 'copy' | 'fallback' | 'up-to-date', number> {
  const result = { build: 0, copy: 0, fallback: 0, 'up-to-date': 0 };
  for (const item of plan.projects) result[item.decision] += 1;
  return result;
}

function summaryMessage(solution: SolutionModel, plan: SmartBuildPlan, elapsedMs: number): string {
  const counts = countDecisions(plan);
  return `Smart Build succeeded for ${solution.name}: ${counts.build + counts.fallback + counts.copy} processed, ${counts['up-to-date']} up-to-date (${elapsedMs} ms).`;
}
