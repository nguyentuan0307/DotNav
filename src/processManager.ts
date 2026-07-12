import { randomUUID } from 'crypto';
import * as vscode from 'vscode';
import { ProjectModel } from './models';
import { normalizePath, samePath } from './pathUtils';
import {
  RunFailure,
  RunMode,
  RunPhase,
  RunSessionState,
  RunTargetState,
  isActivePhase,
  syncSessionPhase,
  transitionTarget
} from './runSessionState';

type TaskVerb = 'build' | 'test' | 'clean';

export interface RunTargetDescriptor {
  readonly project: ProjectModel;
  readonly profileName?: string;
}

interface TaskBinding {
  readonly projectPath: string;
  readonly verb: TaskVerb;
  readonly execution: vscode.TaskExecution;
  readonly runId: string;
  readonly targetId: string;
  exitCode?: number;
}

interface PendingDebugTarget {
  readonly project: ProjectModel;
  readonly sessionName: string;
  readonly runId: string;
  readonly targetId: string;
}

interface CompletionWaiter {
  readonly resolve: (exitCode: number | undefined) => void;
  readonly timer: NodeJS.Timeout;
}

export interface RunSessionChange {
  readonly session: RunSessionState;
}

const defaultStopTimeoutMs = 10_000;

export class ProcessManager implements vscode.Disposable {
  private readonly onDidChangeRunningStateEmitter = new vscode.EventEmitter<boolean>();
  readonly onDidChangeRunningState = this.onDidChangeRunningStateEmitter.event;
  private readonly onDidChangeSessionEmitter = new vscode.EventEmitter<RunSessionChange>();
  readonly onDidChangeSession = this.onDidChangeSessionEmitter.event;

  private readonly sessionsById = new Map<string, RunSessionState>();
  private readonly taskBindings = new Map<vscode.TaskExecution, TaskBinding>();
  private readonly debugBindings = new Map<string, { runId: string; targetId: string; session: vscode.DebugSession }>();
  private readonly pendingDebugTargets: PendingDebugTarget[] = [];
  private readonly taskExitCodes = new WeakMap<vscode.TaskExecution, number | undefined>();
  private readonly completedTasks = new WeakSet<vscode.TaskExecution>();
  private readonly completionWaiters = new Map<vscode.TaskExecution, Set<CompletionWaiter>>();
  private readonly stopTimers = new Map<string, NodeJS.Timeout>();
  private readonly output = vscode.window.createOutputChannel('.NET Navigator');
  private readonly disposables: vscode.Disposable[] = [];

  constructor() {
    this.disposables.push(vscode.debug.onDidStartDebugSession(session => this.trackNextDebugSession(session)));
    this.disposables.push(vscode.debug.onDidTerminateDebugSession(session => this.finishDebugSession(session)));
    this.disposables.push(vscode.tasks.onDidEndTaskProcess(event => this.recordTaskExit(event.execution, event.exitCode)));
    this.disposables.push(vscode.tasks.onDidEndTask(event => {
      // VS Code can emit the task-level event just before the process-level
      // event. Give the latter a short window to supply the exit code while
      // still guaranteeing cleanup for tasks that never emit process events.
      setTimeout(() => this.finishTaskExecution(event.execution), 250);
    }));
  }

  beginRun(configId: string, configLabel: string, mode: RunMode, targets: readonly RunTargetDescriptor[]): RunSessionState {
    const existing = this.getActiveSessionForConfig(configId);
    if (existing) {
      throw new Error(`Run configuration "${configLabel}" is already ${existing.phase}.`);
    }

    const runId = randomUUID();
    const session: RunSessionState = {
      runId,
      configId,
      configLabel,
      mode,
      phase: 'queued',
      startedAt: Date.now(),
      targets: targets.map((target, index) => ({
        targetId: `${runId}:${index}`,
        projectPath: target.project.path,
        projectName: target.project.name,
        profileName: target.profileName,
        phase: 'queued'
      }))
    };

    this.sessionsById.set(runId, session);
    this.emitSession(session);
    return session;
  }

  getSession(runId: string): RunSessionState | undefined {
    return this.sessionsById.get(runId);
  }

  getActiveSessionForConfig(configId: string): RunSessionState | undefined {
    return [...this.sessionsById.values()].find(session => session.configId === configId && sessionHasActiveTargets(session));
  }

  getLatestSessionForConfig(configId: string): RunSessionState | undefined {
    return [...this.sessionsById.values()]
      .filter(session => session.configId === configId)
      .sort((a, b) => b.startedAt - a.startedAt)[0];
  }

  getActiveSessions(): RunSessionState[] {
    return [...this.sessionsById.values()].filter(sessionHasActiveTargets);
  }

  getConfigPhase(configId: string): RunPhase | undefined {
    return this.getActiveSessionForConfig(configId)?.phase;
  }

  getProjectPhase(project: ProjectModel): RunPhase | undefined {
    const targets = this.getActiveSessions()
      .flatMap(session => session.targets)
      .filter(target => samePath(target.projectPath, project.path));
    return highestPriorityPhase(targets.map(target => target.phase));
  }

  setTargetPhase(runId: string, targetId: string, phase: RunPhase): void {
    const { session, target } = this.requireTarget(runId, targetId);
    transitionTarget(target, phase);
    syncSessionPhase(session);
    this.emitSession(session);
  }

  failTarget(runId: string, targetId: string, failure: RunFailure): void {
    const { session, target } = this.requireTarget(runId, targetId);
    if (isActivePhase(target.phase)) {
      transitionTarget(target, 'failed');
    }
    target.error = failure;
    syncSessionPhase(session);
    this.emitSession(session);
  }

  expectDebugSession(project: ProjectModel, sessionName: string, runId?: string, targetId?: string): void {
    if (!runId || !targetId) {
      const synthetic = this.beginRun(`project:${normalizePath(project.path)}`, sessionName, 'debug', [{ project }]);
      runId = synthetic.runId;
      targetId = synthetic.targets[0].targetId;
      this.setTargetPhase(runId, targetId, 'starting');
    }

    this.pendingDebugTargets.push({ project, sessionName, runId, targetId });
  }

  cancelExpectedDebugSession(project: ProjectModel, runId?: string, targetId?: string): void {
    const index = this.pendingDebugTargets.findIndex(candidate =>
      samePath(candidate.project.path, project.path)
      && (!runId || candidate.runId === runId)
      && (!targetId || candidate.targetId === targetId)
    );
    if (index >= 0) {
      this.pendingDebugTargets.splice(index, 1);
    }
  }

  trackTask(
    project: ProjectModel,
    verb: TaskVerb,
    execution: vscode.TaskExecution,
    runId?: string,
    targetId?: string
  ): { runId: string; targetId: string } {
    if (!runId || !targetId) {
      const synthetic = this.beginRun(
        `operation:${verb}:${normalizePath(project.path)}`,
        `${verb} ${project.name}`,
        'build',
        [{ project }]
      );
      runId = synthetic.runId;
      targetId = synthetic.targets[0].targetId;
    }

    const binding: TaskBinding = { projectPath: project.path, verb, execution, runId, targetId };
    this.taskBindings.set(execution, binding);
    const phase = this.requireTarget(runId, targetId).target.phase;
    if (phase === 'queued') {
      this.setTargetPhase(runId, targetId, 'building');
    }

    if (this.completedTasks.has(execution)) {
      queueMicrotask(() => this.finishTaskExecution(execution));
    }

    return { runId, targetId };
  }

  waitForTask(execution: vscode.TaskExecution, timeoutMs: number): Promise<number | undefined> {
    if (this.completedTasks.has(execution)) {
      return Promise.resolve(this.taskExitCodes.get(execution));
    }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.removeCompletionWaiter(execution, waiter);
        reject(new Error(`Task did not finish within ${Math.ceil(timeoutMs / 1000)} seconds.`));
      }, timeoutMs);
      const waiter: CompletionWaiter = { resolve, timer };
      const waiters = this.completionWaiters.get(execution) ?? new Set<CompletionWaiter>();
      waiters.add(waiter);
      this.completionWaiters.set(execution, waiters);
    });
  }

  async stopConfig(configId: string): Promise<void> {
    const session = this.getActiveSessionForConfig(configId);
    if (session) {
      await this.stopSession(session);
    }
  }

  async stopRun(runId: string): Promise<void> {
    const session = this.sessionsById.get(runId);
    if (session && sessionHasActiveTargets(session)) {
      await this.stopSession(session);
    }
  }

  async stopProject(project: ProjectModel): Promise<void> {
    const sessions = this.getActiveSessions().filter(session =>
      session.targets.some(target => samePath(target.projectPath, project.path) && isActivePhase(target.phase))
    );
    await Promise.all(sessions.map(session => this.stopSession(session, project.path)));
  }

  async stopAll(): Promise<void> {
    await Promise.all(this.getActiveSessions().map(session => this.stopSession(session)));
  }

  hasRunningProcesses(): boolean {
    return this.getActiveSessions().length > 0;
  }

  hasRunningProject(project: ProjectModel): boolean {
    return Boolean(this.getProjectPhase(project));
  }

  async shutdown(): Promise<void> {
    await this.stopAll();
    await Promise.all(this.getActiveSessions().map(session => this.waitForTerminalSession(session, defaultStopTimeoutMs)));
  }

  showOutput(): void {
    this.output.show(true);
  }

  dispose(): void {
    for (const timer of this.stopTimers.values()) {
      clearTimeout(timer);
    }
    for (const waiters of this.completionWaiters.values()) {
      for (const waiter of waiters) {
        clearTimeout(waiter.timer);
      }
    }
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
    this.onDidChangeRunningStateEmitter.dispose();
    this.onDidChangeSessionEmitter.dispose();
    this.output.dispose();
  }

  private async stopSession(session: RunSessionState, projectPath?: string): Promise<void> {
    const targets = session.targets.filter(target =>
      isActivePhase(target.phase) && (!projectPath || samePath(target.projectPath, projectPath))
    );
    if (targets.length === 0) {
      return;
    }

    session.stopRequestedAt ??= Date.now();
    for (const target of targets) {
      if (target.phase !== 'stopping') {
        transitionTarget(target, 'stopping');
      }
    }
    syncSessionPhase(session);
    this.emitSession(session);

    const targetIds = new Set(targets.map(target => target.targetId));
    for (const binding of this.taskBindings.values()) {
      if (binding.runId === session.runId && targetIds.has(binding.targetId)) {
        binding.execution.terminate();
      }
    }

    const debugStops: Thenable<void>[] = [];
    for (const binding of this.debugBindings.values()) {
      if (binding?.runId === session.runId && targetIds.has(binding.targetId)) {
        debugStops.push(vscode.debug.stopDebugging(binding.session));
      }
    }
    await Promise.allSettled(debugStops);

    for (const target of targets) {
      const hasRuntime = [...this.taskBindings.values()].some(binding => binding.runId === session.runId && binding.targetId === target.targetId)
        || [...this.debugBindings.values()].some(binding => binding.runId === session.runId && binding.targetId === target.targetId);
      if (!hasRuntime) {
        transitionTarget(target, 'stopped');
      } else {
        this.armStopTimeout(session, target);
      }
    }
    syncSessionPhase(session);
    this.emitSession(session);
  }

  private trackNextDebugSession(debugSession: vscode.DebugSession): void {
    const runId = debugSession.configuration.dotnetSolutionNavigatorRunId;
    const targetId = debugSession.configuration.dotnetSolutionNavigatorTargetId;
    const index = this.pendingDebugTargets.findIndex(candidate => candidate.runId === runId && candidate.targetId === targetId);
    if (index < 0) {
      return;
    }

    const [pending] = this.pendingDebugTargets.splice(index, 1);
    this.debugBindings.set(debugSession.id, { runId: pending.runId, targetId: pending.targetId, session: debugSession });
    const target = this.requireTarget(pending.runId, pending.targetId).target;
    if (target.phase === 'starting') {
      this.setTargetPhase(pending.runId, pending.targetId, 'running');
    }
  }

  private finishDebugSession(debugSession: vscode.DebugSession): void {
    const binding = this.debugBindings.get(debugSession.id);
    if (!binding) {
      return;
    }
    this.debugBindings.delete(debugSession.id);
    this.finishRuntimeTarget(binding.runId, binding.targetId);
  }

  private recordTaskExit(execution: vscode.TaskExecution, exitCode: number | undefined): void {
    this.taskExitCodes.set(execution, exitCode);
    const binding = this.taskBindings.get(execution);
    if (binding) {
      binding.exitCode = exitCode;
    }
  }

  private finishTaskExecution(execution: vscode.TaskExecution): void {
    if (this.completedTasks.has(execution)) {
      this.resolveCompletionWaiters(execution);
      return;
    }
    this.completedTasks.add(execution);
    const binding = this.taskBindings.get(execution);
    if (binding) {
      this.taskBindings.delete(execution);
      const session = this.sessionsById.get(binding.runId);
      const target = session?.targets.find(candidate => candidate.targetId === binding.targetId);
      if (target?.phase === 'stopping') {
        this.finishRuntimeTarget(binding.runId, binding.targetId, binding.exitCode);
      } else if (binding.verb === 'build' && session && session.mode !== 'build' && binding.exitCode === 0) {
        this.emitSession(session);
      } else if (binding.exitCode === undefined) {
        this.failTarget(binding.runId, binding.targetId, {
          code: 'unexpected-exit',
          message: `Could not determine the exit code for ${binding.verb}.`
        });
      } else {
        this.finishRuntimeTarget(binding.runId, binding.targetId, binding.exitCode);
      }
    }
    this.resolveCompletionWaiters(execution);
  }

  private finishRuntimeTarget(runId: string, targetId: string, exitCode?: number): void {
    const found = this.findTarget(runId, targetId);
    if (!found || !isActivePhase(found.target.phase)) {
      return;
    }
    found.target.exitCode = exitCode;
    const next: RunPhase = found.target.phase === 'stopping'
      ? 'stopped'
      : exitCode === undefined || exitCode === 0
        ? 'succeeded'
        : 'failed';
    transitionTarget(found.target, next);
    if (next === 'failed') {
      found.target.error = {
        code: 'unexpected-exit',
        message: `${found.target.projectName} exited with code ${exitCode}.`
      };
    }
    this.clearStopTimeout(runId, targetId);
    syncSessionPhase(found.session);
    this.emitSession(found.session);
  }

  private armStopTimeout(session: RunSessionState, target: RunTargetState): void {
    const key = `${session.runId}:${target.targetId}`;
    this.clearStopTimeout(session.runId, target.targetId);
    const timeout = setTimeout(() => {
      this.stopTimers.delete(key);
      if (target.phase !== 'stopping') {
        return;
      }
      target.error = {
        code: 'stop-timeout',
        message: `Could not confirm that ${target.projectName} stopped.`
      };
      transitionTarget(target, 'failed');
      syncSessionPhase(session);
      this.emitSession(session);
      vscode.window.showErrorMessage(target.error.message);
    }, defaultStopTimeoutMs);
    this.stopTimers.set(key, timeout);
  }

  private clearStopTimeout(runId: string, targetId: string): void {
    const key = `${runId}:${targetId}`;
    const timer = this.stopTimers.get(key);
    if (timer) {
      clearTimeout(timer);
      this.stopTimers.delete(key);
    }
  }

  private waitForTerminalSession(session: RunSessionState, timeoutMs: number): Promise<void> {
    if (!sessionHasActiveTargets(session)) {
      return Promise.resolve();
    }
    return new Promise(resolve => {
      const timer = setTimeout(() => {
        disposable.dispose();
        resolve();
      }, timeoutMs);
      const disposable = this.onDidChangeSession(event => {
        if (event.session.runId === session.runId && !sessionHasActiveTargets(event.session)) {
          clearTimeout(timer);
          disposable.dispose();
          resolve();
        }
      });
    });
  }

  private resolveCompletionWaiters(execution: vscode.TaskExecution): void {
    const waiters = this.completionWaiters.get(execution);
    if (!waiters) {
      return;
    }
    this.completionWaiters.delete(execution);
    for (const waiter of waiters) {
      clearTimeout(waiter.timer);
      waiter.resolve(this.taskExitCodes.get(execution));
    }
  }

  private removeCompletionWaiter(execution: vscode.TaskExecution, waiter: CompletionWaiter): void {
    const waiters = this.completionWaiters.get(execution);
    waiters?.delete(waiter);
    if (waiters?.size === 0) {
      this.completionWaiters.delete(execution);
    }
  }

  private requireTarget(runId: string, targetId: string): { session: RunSessionState; target: RunTargetState } {
    const found = this.findTarget(runId, targetId);
    if (!found) {
      throw new Error(`Unknown run target: ${runId}/${targetId}`);
    }
    return found;
  }

  private findTarget(runId: string, targetId: string): { session: RunSessionState; target: RunTargetState } | undefined {
    const session = this.sessionsById.get(runId);
    const target = session?.targets.find(candidate => candidate.targetId === targetId);
    return session && target ? { session, target } : undefined;
  }

  private emitSession(session: RunSessionState): void {
    const detail = session.error ? ` — ${session.error.message}` : '';
    this.output.appendLine(`[${new Date().toISOString()}] [run ${session.runId}] ${session.configLabel}: ${session.phase}${detail}`);
    this.onDidChangeSessionEmitter.fire({ session });
    this.onDidChangeRunningStateEmitter.fire(this.hasRunningProcesses());
  }
}

function highestPriorityPhase(phases: readonly RunPhase[]): RunPhase | undefined {
  const priority: RunPhase[] = ['stopping', 'building', 'starting', 'running', 'queued'];
  return priority.find(phase => phases.includes(phase));
}

function sessionHasActiveTargets(session: RunSessionState): boolean {
  return session.targets.some(target => isActivePhase(target.phase));
}
