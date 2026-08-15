import { createHash } from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as vscode from 'vscode';
import { runDotnetForProject, runDotnetForProjects, runDotnetForSolution } from '../dotnetCli';
import { ProjectModel, SolutionModel } from '../models';
import { ProcessManager } from '../processManager';
import { BuildChangeTracker } from './buildChangeTracker';
import { BuildHostClient } from './buildHostClient';
import { BuildStateStore, StoredBuildState } from './buildStateStore';
import { SmartBuildExecutionResult, SmartBuildExecutor } from './smartBuildExecutor';
import { SmartBuildMetrics, metricsSummary, planSummary } from './smartBuildDiagnostics';
import { SmartBuildPlanner } from './smartBuildPlanner';
import { scopeTransitiveUpstream } from './smartBuildTraversal';
import { EvaluatedBuildGraph, SmartBuildPlan } from './types';
import { isSmartBuildEnabled, requestSmartBuildEnabled } from './smartBuildFeature';
import { SmartBuildStatusBar } from './smartBuildStatusBar';

interface SolutionRuntime {
  graph?: EvaluatedBuildGraph;
  graphRevision?: number;
  readonly store: BuildStateStore;
  readonly rootPath: string;
}

interface PreparedPlan {
  readonly graph: EvaluatedBuildGraph;
  readonly plan: SmartBuildPlan;
  readonly runtime: SolutionRuntime;
  readonly state?: StoredBuildState;
  readonly evaluationMs: number;
  readonly planningMs: number;
}

export class SmartBuildCoordinator implements vscode.Disposable {
  private readonly output = vscode.window.createOutputChannel('DotNav Smart Build');
  private readonly host: BuildHostClient;
  private readonly changes = new BuildChangeTracker();
  private readonly planner = new SmartBuildPlanner(this.changes);
  private readonly executor = new SmartBuildExecutor();
  private readonly runtimes = new Map<string, SolutionRuntime>();
  private readonly activeProjectPaths = new Set<string>();
  private readonly statusBar = new SmartBuildStatusBar();
  private prewarmTimer?: NodeJS.Timeout;
  private lastSolution?: SolutionModel;

  constructor(private readonly context: vscode.ExtensionContext) {
    this.host = new BuildHostClient({
      extensionPath: context.extensionPath,
      workspaceRoot: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
      requestTimeoutMs: 60_000,
      onDiagnostic: message => this.log(`[host] ${message}`)
    });
    this.statusBar.show();
  }

  getStatusBar(): SmartBuildStatusBar {
    return this.statusBar;
  }

  recordFileChange(filePath: string, eventKind: 'create' | 'change' | 'delete' = 'change'): void {
    if (!isSmartBuildEnabled()) return;
    this.changes.recordChange(filePath, eventKind);
    this.updateStatusBar();
    if (this.changes.isGraphInvalidated() && this.lastSolution) {
      clearTimeout(this.prewarmTimer);
      this.prewarmTimer = setTimeout(() => {
        if (this.lastSolution) void this.prewarm(this.lastSolution);
      }, 500);
    }
  }

  async prewarm(solution: SolutionModel, useSolutionConfiguration = true): Promise<void> {
    if (!isSmartBuildEnabled()) return;
    this.lastSolution = solution;
    const runtime = this.runtimeFor(solution, useSolutionConfiguration);
    if (runtime.graph && runtime.graphRevision === this.changes.graphRevision()) {
      this.updateStatusBar();
      return;
    }
    try {
      this.statusBar.setState('evaluating');
      if (runtime.graph) await this.host.restart();
      const started = Date.now();
      runtime.graph = await this.evaluate(solution, useSolutionConfiguration);
      runtime.graphRevision = this.changes.graphRevision();
      this.log(`Pre-warmed Project Graph for ${solution.name} in ${Date.now() - started} ms (${runtime.graph.projects.length} project variants).`);
    } catch (error) {
      this.log(`Pre-warm diagnostic: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.updateStatusBar();
    }
  }

  async buildSolution(solution: SolutionModel, processManager: ProcessManager): Promise<boolean> {
    if (!await requestSmartBuildEnabled()) return false;
    this.lastSolution = solution;
    return this.buildScope(solution, processManager, true);
  }

  async buildProjects(solution: SolutionModel, projects: readonly ProjectModel[], processManager: ProcessManager, label?: string): Promise<boolean> {
    if (!await requestSmartBuildEnabled()) return false;
    if (projects.length === 0) return true;
    this.lastSolution = solution;
    const scopedProjects = scopeTransitiveUpstream(solution, projects);
    return this.buildScope({ ...solution, name: label ?? projects[0].name, projects: scopedProjects }, processManager, false);
  }

  private async buildScope(solution: SolutionModel, processManager: ProcessManager, useSolutionConfiguration: boolean): Promise<boolean> {
    const projectPaths = solution.projects.map(project => normalizedPath(project.path));
    if (projectPaths.some(projectPath => this.activeProjectPaths.has(projectPath))) {
      vscode.window.showInformationMessage('A Smart Build is already active for one or more selected projects.');
      return false;
    }
    for (const projectPath of projectPaths) this.activeProjectPaths.add(projectPath);
    this.statusBar.setState('building');
    const buildStart = Date.now();
    const generation = this.changes.snapshot();
    try {
      const { graph, plan, runtime, state, evaluationMs, planningMs } = await this.preparePlan(solution, useSolutionConfiguration);
      this.logPlan(solution, plan);
      if (vscode.workspace.getConfiguration('dotnav').get<string>('smartBuild.mode', 'execute') === 'shadow') {
        this.log('Shadow mode: the Smart Build plan was not executed; running standard Build.');
        return this.runStandardScope(solution, processManager, useSolutionConfiguration);
      }
      if (plan.projects.every(item => item.decision === 'up-to-date')) {
        this.logMetrics({
          evaluationMs, planningMs, copyMs: 0, msbuildMs: 0, stateCaptureMs: 0,
          totalMs: Date.now() - buildStart, builtProjects: 0, copiedFiles: 0, copyFailures: 0,
          stateFound: Boolean(state), restoreRequired: plan.requiresRestore
        });
        vscode.window.showInformationMessage(`Smart Build: ${solution.name} is up-to-date.`);
        return true;
      }
      const fallbackCount = plan.projects.filter(item => item.decision === 'fallback').length;
      if (fallbackCount > 0) {
        this.log(`Scoped fallback: ${fallbackCount} opaque project(s) will retain recursive MSBuild semantics; proven-current projects remain skipped.`);
      }
      const binaryLogPath = await this.createBinaryLogPath(solution);
      const primaryResult = await this.executor.execute(plan, solution, processManager, {
        workingDirectory: buildWorkingDirectory(solution, useSolutionConfiguration),
        binaryLogPath
      });
      if (!primaryResult.success) {
        this.logMetrics({
          evaluationMs, planningMs, copyMs: primaryResult.copyMs, msbuildMs: primaryResult.msbuildMs,
          stateCaptureMs: 0, totalMs: Date.now() - buildStart, builtProjects: primaryResult.builtProjects,
          copiedFiles: primaryResult.copiedFiles, copyFailures: primaryResult.copyFailures,
          stateFound: Boolean(state), restoreRequired: plan.requiresRestore, binaryLogPath: primaryResult.binaryLogPath
        });
        if (!primaryResult.cancelled) vscode.window.showErrorMessage(`Smart Build failed for ${solution.name}.`);
        return false;
      }
      const refinementStart = Date.now();
      const dependentPlan = await this.planner.createDependentPlan(graph, plan, state);
      const refinedPlanningMs = planningMs + Date.now() - refinementStart;
      this.logPlan(solution, dependentPlan, 'dependent phase');
      const followUpBinaryLogPath = binaryLogPath?.replace(/\.binlog$/i, '-dependents.binlog');
      const dependentResult = await this.executor.execute(dependentPlan, solution, processManager, {
        workingDirectory: buildWorkingDirectory(solution, useSolutionConfiguration),
        binaryLogPath: followUpBinaryLogPath
      });
      const result = combineExecutionResults(primaryResult, dependentResult, binaryLogPath);
      if (!dependentResult.success) {
        this.logMetrics({
          evaluationMs, planningMs: refinedPlanningMs, copyMs: result.copyMs, msbuildMs: result.msbuildMs,
          stateCaptureMs: 0, totalMs: Date.now() - buildStart, builtProjects: result.builtProjects,
          copiedFiles: result.copiedFiles, copyFailures: result.copyFailures,
          stateFound: Boolean(state), restoreRequired: plan.requiresRestore, binaryLogPath
        });
        if (!dependentResult.cancelled) vscode.window.showErrorMessage(`Smart Build dependent phase failed for ${solution.name}.`);
        return false;
      }
      const buildEnd = Date.now();
      if (this.changes.changedSince(generation)) {
        this.log('State was not committed because workspace inputs changed during the build.');
        vscode.window.showWarningMessage('Smart Build succeeded, but files changed during the build; the next build will validate them again.');
        return false;
      }
      const captureStart = Date.now();
      const captured = await this.planner.captureSuccessfulState(graph, buildStart, buildEnd);
      const stateCaptureMs = Date.now() - captureStart;
      this.logReferenceAssemblyEffect(state, captured, plan);
      await runtime.store.save(captured);
      this.changes.consumeChanges();
      this.logMetrics({
        evaluationMs, planningMs: refinedPlanningMs, copyMs: result.copyMs, msbuildMs: result.msbuildMs,
        stateCaptureMs, totalMs: Date.now() - buildStart, builtProjects: result.builtProjects,
        copiedFiles: result.copiedFiles, copyFailures: result.copyFailures,
        stateFound: Boolean(state), restoreRequired: plan.requiresRestore, binaryLogPath: result.binaryLogPath
      });
      vscode.window.showInformationMessage(summaryMessage(solution, plan, dependentPlan, buildEnd - buildStart));
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.log(`Smart Build unavailable: ${message}`);
      vscode.window.showWarningMessage(`Smart Build could not safely plan this build. Continuing with standard Build. ${message}`);
      return this.runStandardScope(solution, processManager, useSolutionConfiguration);
    } finally {
      for (const projectPath of projectPaths) this.activeProjectPaths.delete(projectPath);
      this.updateStatusBar();
    }
  }

  updateStatusBar(): void {
    const count = this.changes.getPendingChangeCount();
    this.statusBar.setState(count > 0 ? 'idle-changed' : 'idle-uptodate', count);
  }

  async explainPlan(solution: SolutionModel): Promise<void> {
    if (!await requestSmartBuildEnabled()) return;
    try {
      const started = Date.now();
      const { plan, state, evaluationMs, planningMs } = await this.preparePlan(solution, true);
      this.logPlan(solution, plan);
      const metrics: SmartBuildMetrics = {
        evaluationMs, planningMs, copyMs: 0, msbuildMs: 0, stateCaptureMs: 0,
        totalMs: Date.now() - started, builtProjects: 0, copiedFiles: 0, copyFailures: 0,
        stateFound: Boolean(state), restoreRequired: plan.requiresRestore
      };
      this.logMetrics(metrics);
      const picked = await vscode.window.showQuickPick([
        {
          label: '$(pulse) Smart Build summary',
          description: planSummary(plan),
          detail: metricsSummary(metrics)
        },
        ...plan.projects.map(item => ({
          label: `${decisionIcon(item.decision)} ${item.project.projectName}`,
          description: `${item.decision} · ${item.project.targetFramework || 'default'}`,
          detail: item.reasons.length > 0
            ? item.reasons.map(reason => `${reason.code}${reason.detail ? `: ${reason.detail}` : ''}`).join('; ')
            : 'All evaluated inputs and required outputs are current.'
        }))
      ], {
        title: `Smart Build Plan — ${solution.name}`,
        placeHolder: 'Select any row to open the detailed output log',
        matchOnDescription: true,
        matchOnDetail: true
      });
      if (picked) this.output.show(true);
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
    this.updateStatusBar();
    if (notify) vscode.window.showInformationMessage('DotNav Smart Build cache was invalidated.');
  }

  dispose(): void {
    if (this.prewarmTimer) clearTimeout(this.prewarmTimer);
    this.statusBar.dispose();
    this.output.dispose();
    void this.host.dispose();
  }

  private async preparePlan(solution: SolutionModel, useSolutionConfiguration: boolean): Promise<PreparedPlan> {
    const runtime = this.runtimeFor(solution, useSolutionConfiguration);
    let evaluationMs = 0;
    if (!runtime.graph || runtime.graphRevision !== this.changes.graphRevision()) {
      if (runtime.graph) await this.host.restart();
      const evaluationStart = Date.now();
      runtime.graph = await this.evaluate(solution, useSolutionConfiguration);
      evaluationMs += Date.now() - evaluationStart;
      runtime.graphRevision = this.changes.graphRevision();
    }
    let state = await runtime.store.load();
    const planningStart = Date.now();
    let plan = await this.planner.createPlan(runtime.graph, state);
    let planningMs = Date.now() - planningStart;
    if (plan.projects.some(item => item.reasons.some(reason => reason.detail && isGraphFile(reason.detail)))) {
      const evaluationStart = Date.now();
      runtime.graph = await this.evaluate(solution, useSolutionConfiguration);
      evaluationMs += Date.now() - evaluationStart;
      runtime.graphRevision = this.changes.graphRevision();
      state = await runtime.store.load();
      const replanningStart = Date.now();
      plan = await this.planner.createPlan(runtime.graph, state);
      planningMs += Date.now() - replanningStart;
    }
    return { graph: runtime.graph, plan, runtime, state, evaluationMs, planningMs };
  }

  private async createBinaryLogPath(solution: SolutionModel): Promise<string | undefined> {
    const configuration = vscode.workspace.getConfiguration('dotnav');
    if (!configuration.get<boolean>('smartBuild.generateBinaryLog', false)) return undefined;
    const configured = configuration.get<string>('smartBuild.binaryLogDirectory', '').trim();
    const storageRoot = this.context.storageUri?.fsPath ?? this.context.globalStorageUri.fsPath;
    const directory = configured
      ? (path.isAbsolute(configured) ? configured : path.resolve(solution.rootPath, configured))
      : path.join(storageRoot, 'smart-build', 'binlogs');
    await fs.mkdir(directory, { recursive: true });
    const safeName = solution.name.replace(/[^a-z0-9_.-]+/gi, '-');
    return path.join(directory, `${safeName}-${new Date().toISOString().replace(/[:.]/g, '-')}.binlog`);
  }

  private logMetrics(metrics: SmartBuildMetrics): void {
    this.log(`Metrics: ${metricsSummary(metrics)}`);
    if (metrics.binaryLogPath) this.log(`Binary log: ${metrics.binaryLogPath}`);
  }

  private async runStandardScope(solution: SolutionModel, processManager: ProcessManager, useSolutionConfiguration: boolean): Promise<boolean> {
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

  private logPlan(solution: SolutionModel, plan: SmartBuildPlan, phase = 'initial phase'): void {
    const counts = countDecisions(plan);
    this.log(`Plan ${solution.name} (${phase}): build=${counts.build}, copy=${counts.copy}, propagate=${counts.propagate}, fallback=${counts.fallback}, up-to-date=${counts['up-to-date']}`);
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

function countDecisions(plan: SmartBuildPlan): Record<'build' | 'copy' | 'propagate' | 'fallback' | 'up-to-date', number> {
  const result = { build: 0, copy: 0, propagate: 0, fallback: 0, 'up-to-date': 0 };
  for (const item of plan.projects) result[item.decision] += 1;
  return result;
}

function summaryMessage(
  solution: SolutionModel,
  primaryPlan: SmartBuildPlan,
  dependentPlan: SmartBuildPlan,
  elapsedMs: number
): string {
  const primary = countDecisions(primaryPlan);
  const dependent = countDecisions(dependentPlan);
  const processed = primary.build + primary.fallback + primary.copy
    + dependent.build + dependent.fallback + dependent.copy + dependent.propagate;
  return `Smart Build succeeded for ${solution.name}: ${processed} processed, ${primaryPlan.projects.length - processed} up-to-date (${elapsedMs} ms).`;
}

function decisionIcon(decision: 'build' | 'copy' | 'propagate' | 'fallback' | 'up-to-date'): string {
  switch (decision) {
    case 'build': return '$(tools)';
    case 'copy': return '$(files)';
    case 'propagate': return '$(references)';
    case 'fallback': return '$(warning)';
    case 'up-to-date': return '$(check)';
  }
}

function combineExecutionResults(
  primary: SmartBuildExecutionResult,
  dependent: SmartBuildExecutionResult,
  binaryLogPath?: string
): SmartBuildExecutionResult {
  return {
    success: primary.success && dependent.success,
    cancelled: primary.cancelled || dependent.cancelled,
    exitCode: dependent.exitCode ?? primary.exitCode,
    copiedFiles: primary.copiedFiles + dependent.copiedFiles,
    copyFailures: primary.copyFailures + dependent.copyFailures,
    builtProjects: primary.builtProjects + dependent.builtProjects,
    copyMs: primary.copyMs + dependent.copyMs,
    msbuildMs: primary.msbuildMs + dependent.msbuildMs,
    binaryLogPath
  };
}

