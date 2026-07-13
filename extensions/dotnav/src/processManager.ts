import { randomUUID } from 'crypto';
import { execFile } from 'child_process';
import * as vscode from 'vscode';
import { ProjectModel } from './models';
import { normalizePath, samePath } from './pathUtils';
import {
  RunFailure,
  RunMode,
  RunPhase,
  RunSessionState,
  RunTargetState,
  completionPhaseForTarget,
  isActivePhase,
  syncSessionPhase,
  transitionTarget
} from './runSessionState';

type TaskVerb = 'build' | 'rebuild' | 'test' | 'clean';

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
const retainedCompletedSessions = 50;

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
  private readonly taskProcessIds = new WeakMap<vscode.TaskExecution, number>();
  private readonly completedTasks = new WeakSet<vscode.TaskExecution>();
  private readonly completionWaiters = new Map<vscode.TaskExecution, Set<CompletionWaiter>>();
  private readonly taskEndTimers = new Map<vscode.TaskExecution, NodeJS.Timeout>();
  private readonly stopTimers = new Map<string, NodeJS.Timeout>();
  private readonly stopRequests = new Set<string>();
  private readonly startedDebugTargets = new Set<string>();
  private readonly lateDebugTombstones = new Set<string>();
  private readonly output = vscode.window.createOutputChannel('.NET Navigator');
  private readonly disposables: vscode.Disposable[] = [];

  constructor() {
    this.disposables.push(vscode.debug.onDidStartDebugSession(session => this.trackNextDebugSession(session)));
    this.disposables.push(vscode.debug.onDidTerminateDebugSession(session => this.finishDebugSession(session)));
    this.disposables.push(vscode.tasks.onDidEndTaskProcess(event => this.recordTaskExit(event.execution, event.exitCode)));
    this.disposables.push(vscode.tasks.onDidStartTaskProcess(event => this.taskProcessIds.set(event.execution, event.processId)));
    this.disposables.push(vscode.tasks.onDidEndTask(event => this.observeTaskEnd(event.execution)));
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
    return [...this.sessionsById.values()].reverse()
      .find(session => session.configId === configId && this.sessionIsBusy(session));
  }

  getLatestSessionForConfig(configId: string): RunSessionState | undefined {
    return [...this.sessionsById.values()].reverse().find(session => session.configId === configId);
  }

  getActiveSessions(): RunSessionState[] {
    return [...this.sessionsById.values()].filter(session => this.sessionIsBusy(session));
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

  terminateTimedOutTask(
    runId: string,
    targetId: string,
    execution: vscode.TaskExecution,
    failure: RunFailure
  ): void {
    const { session, target } = this.requireTarget(runId, targetId);
    target.error = failure;
    if (isActivePhase(target.phase) && target.phase !== 'stopping') {
      transitionTarget(target, 'stopping');
    }
    this.stopRequests.add(debugTargetKey(runId, targetId));
    this.requestTaskTermination(execution, session, target);
    this.armStopTimeout(session, target);
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
      const [pending] = this.pendingDebugTargets.splice(index, 1);
      const found = this.findTarget(pending.runId, pending.targetId);
      if (found?.target.phase === 'stopping' && !this.targetHasRuntime(pending.runId, pending.targetId)) {
        transitionTarget(found.target, found.target.error ? 'failed' : 'stopped');
        this.clearStopTimeout(pending.runId, pending.targetId);
        this.stopRequests.delete(debugTargetKey(pending.runId, pending.targetId));
        syncSessionPhase(found.session);
        this.emitSession(found.session);
      }
    }
  }

  waitForTargetRunning(runId: string, targetId: string, timeoutMs: number): Promise<boolean> {
    const key = debugTargetKey(runId, targetId);
    if (this.startedDebugTargets.has(key)) {
      return Promise.resolve(true);
    }
    const current = this.requireTarget(runId, targetId).target;
    if (current.phase === 'running') {
      return Promise.resolve(true);
    }
    if (current.phase !== 'starting') {
      return Promise.resolve(false);
    }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        disposable.dispose();
        reject(new Error(`Debug session did not start within ${Math.ceil(timeoutMs / 1000)} seconds.`));
      }, timeoutMs);
      const disposable = this.onDidChangeSession(event => {
        if (event.session.runId !== runId) {
          return;
        }
        const target = event.session.targets.find(candidate => candidate.targetId === targetId);
        if (!target || target.phase === 'starting') {
          return;
        }
        clearTimeout(timer);
        disposable.dispose();
        resolve(this.startedDebugTargets.has(key));
      });
    });
  }

  expireExpectedDebugSession(project: ProjectModel, runId: string, targetId: string, message: string): void {
    const index = this.pendingDebugTargets.findIndex(candidate =>
      candidate.runId === runId && candidate.targetId === targetId && samePath(candidate.project.path, project.path)
    );
    if (index >= 0) {
      this.pendingDebugTargets.splice(index, 1);
    }

    this.addLateDebugTombstone(runId, targetId);

    const found = this.findTarget(runId, targetId);
    if (found && isActivePhase(found.target.phase)) {
      this.failTarget(runId, targetId, { code: 'start-timeout', message });
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

    const binding: TaskBinding = {
      projectPath: project.path,
      verb,
      execution,
      runId,
      targetId,
      exitCode: this.taskExitCodes.get(execution)
    };
    this.taskBindings.set(execution, binding);
    const phase = this.requireTarget(runId, targetId).target.phase;
    if (phase === 'queued') {
      this.setTargetPhase(runId, targetId, 'building');
    } else if (phase === 'stopping' || !isActivePhase(phase)) {
      this.stopRequests.add(debugTargetKey(runId, targetId));
      const found = this.requireTarget(runId, targetId);
      this.requestTaskTermination(execution, found.session, found.target);
      if (phase === 'stopping') {
        this.armStopTimeout(found.session, found.target);
      }
      this.emitSession(found.session);
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
    if (session && this.sessionIsBusy(session)) {
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
    for (const session of this.getActiveSessions()) {
      this.output.appendLine(
        `[${new Date().toISOString()}] [run ${session.runId}] shutdown ended without termination confirmation; runtime ownership remains uncertain`
      );
    }
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
    for (const timer of this.taskEndTimers.values()) {
      clearTimeout(timer);
    }
    this.taskEndTimers.clear();
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
    this.onDidChangeRunningStateEmitter.dispose();
    this.onDidChangeSessionEmitter.dispose();
    this.output.dispose();
  }

  private async stopSession(session: RunSessionState, projectPath?: string): Promise<void> {
    const targets = session.targets.filter(target =>
      (isActivePhase(target.phase) || this.targetHasRuntime(session.runId, target.targetId))
      && (!projectPath || samePath(target.projectPath, projectPath))
    );
    if (targets.length === 0) {
      return;
    }

    session.stopRequestedAt ??= Date.now();
    for (const target of targets) {
      if (isActivePhase(target.phase) && target.phase !== 'stopping') {
        transitionTarget(target, 'stopping');
      }
    }
    syncSessionPhase(session);
    this.emitSession(session);

    for (const target of targets) {
      const pendingIndex = this.pendingDebugTargets.findIndex(candidate =>
        candidate.runId === session.runId && candidate.targetId === target.targetId
      );
      if (pendingIndex >= 0) {
        this.pendingDebugTargets.splice(pendingIndex, 1);
        this.addLateDebugTombstone(session.runId, target.targetId);
      }
    }

    const newlyRequestedTargetIds = new Set<string>();
    for (const target of targets) {
      const key = debugTargetKey(session.runId, target.targetId);
      if (!this.stopRequests.has(key)) {
        this.stopRequests.add(key);
        newlyRequestedTargetIds.add(target.targetId);
      }
    }
    for (const binding of this.taskBindings.values()) {
      if (binding.runId === session.runId && newlyRequestedTargetIds.has(binding.targetId)) {
        const found = this.findTarget(binding.runId, binding.targetId);
        if (found) {
          this.requestTaskTermination(binding.execution, found.session, found.target);
        }
      }
    }

    for (const binding of this.debugBindings.values()) {
      if (binding?.runId === session.runId && newlyRequestedTargetIds.has(binding.targetId)) {
        this.requestDebugTermination(binding.session, binding.runId, binding.targetId);
      }
    }

    for (const target of targets) {
      const hasRuntime = this.targetHasRuntime(session.runId, target.targetId);
      if (!hasRuntime) {
        transitionTarget(target, 'stopped');
        this.stopRequests.delete(debugTargetKey(session.runId, target.targetId));
      } else {
        this.armStopTimeout(session, target);
      }
    }
    syncSessionPhase(session);
    this.emitSession(session);
  }

  private trackNextDebugSession(debugSession: vscode.DebugSession): void {
    const runId = debugSession.configuration.dotnavRunId;
    const targetId = debugSession.configuration.dotnavTargetId;
    if (typeof runId === 'string' && typeof targetId === 'string') {
      const key = debugTargetKey(runId, targetId);
      if (this.lateDebugTombstones.has(key)) {
        this.lateDebugTombstones.delete(key);
        this.output.appendLine(`[${new Date().toISOString()}] [run ${runId}] stopping a debug session that arrived after start timeout`);
        this.debugBindings.set(debugSession.id, { runId, targetId, session: debugSession });
        this.stopRequests.add(key);
        this.armLateDebugStopWarning(debugSession, runId, targetId);
        const found = this.findTarget(runId, targetId);
        if (found) {
          this.emitSession(found.session);
        }
        this.requestDebugTermination(debugSession, runId, targetId);
        return;
      }
    }
    const index = this.pendingDebugTargets.findIndex(candidate => candidate.runId === runId && candidate.targetId === targetId);
    if (index < 0) {
      return;
    }

    const [pending] = this.pendingDebugTargets.splice(index, 1);
    this.startedDebugTargets.add(debugTargetKey(pending.runId, pending.targetId));
    this.debugBindings.set(debugSession.id, { runId: pending.runId, targetId: pending.targetId, session: debugSession });
    const target = this.requireTarget(pending.runId, pending.targetId).target;
    if (target.phase === 'starting') {
      this.setTargetPhase(pending.runId, pending.targetId, 'running');
    } else if (target.phase === 'stopping') {
      this.requestDebugTermination(debugSession, pending.runId, pending.targetId);
    }
  }

  private finishDebugSession(debugSession: vscode.DebugSession): void {
    const binding = this.debugBindings.get(debugSession.id);
    if (!binding) {
      return;
    }
    const lateTimerKey = `late:${debugTargetKey(binding.runId, binding.targetId)}`;
    const lateTimer = this.stopTimers.get(lateTimerKey);
    if (lateTimer) {
      clearTimeout(lateTimer);
      this.stopTimers.delete(lateTimerKey);
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
    const taskEndTimer = this.taskEndTimers.get(execution);
    if (taskEndTimer) {
      clearTimeout(taskEndTimer);
      this.taskEndTimers.delete(execution);
      this.finishTaskExecution(execution);
    }
  }

  private observeTaskEnd(execution: vscode.TaskExecution): void {
    if (this.taskExitCodes.has(execution)) {
      this.finishTaskExecution(execution);
      return;
    }
    const existing = this.taskEndTimers.get(execution);
    if (existing) {
      clearTimeout(existing);
    }
    // Tasks without an underlying process never emit a process-end event.
    // Keep a short grace period for a process result that follows task-end,
    // then finalize with an unknown exit code so state cannot hang forever.
    const timer = setTimeout(() => {
      this.taskEndTimers.delete(execution);
      this.finishTaskExecution(execution);
    }, 250);
    this.taskEndTimers.set(execution, timer);
  }

  private finishTaskExecution(execution: vscode.TaskExecution): void {
    if (!this.completedTasks.has(execution)) {
      this.completedTasks.add(execution);
    }

    // A very short task can finish before executeTask() resolves and before
    // trackTask() installs its binding. In that case trackTask() calls this
    // method again; always consume a newly-added binding even when the task
    // completion itself was already observed.
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
    if (!found) {
      return;
    }
    if (!isActivePhase(found.target.phase)) {
      this.clearStopTimeout(runId, targetId);
      this.stopRequests.delete(debugTargetKey(runId, targetId));
      syncSessionPhase(found.session);
      this.emitSession(found.session);
      return;
    }
    found.target.exitCode = exitCode;
    const next = completionPhaseForTarget(found.target, exitCode);
    transitionTarget(found.target, next);
    if (next === 'failed' && !found.target.error) {
      found.target.error = {
        code: 'unexpected-exit',
        message: `${found.target.projectName} exited with code ${exitCode}.`
      };
    }
    this.clearStopTimeout(runId, targetId);
    this.stopRequests.delete(debugTargetKey(runId, targetId));
    syncSessionPhase(found.session);
    this.emitSession(found.session);
  }

  private armStopTimeout(session: RunSessionState, target: RunTargetState): void {
    const key = `${session.runId}:${target.targetId}`;
    this.clearStopTimeout(session.runId, target.targetId);
    const timeout = setTimeout(() => {
      this.stopTimers.delete(key);
      this.stopRequests.delete(debugTargetKey(session.runId, target.targetId));
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
      void this.forceKillTrackedTask(session, target);
      vscode.window.showErrorMessage(
        `${target.error.message} The run remains blocked; a tracked task force-stop will be attempted when available.`
      );
    }, defaultStopTimeoutMs);
    this.stopTimers.set(key, timeout);
  }

  private armLateDebugStopWarning(debugSession: vscode.DebugSession, runId: string, targetId: string): void {
    const key = `late:${debugTargetKey(runId, targetId)}`;
    const timer = setTimeout(() => {
      this.stopTimers.delete(key);
      if (!this.debugBindings.has(debugSession.id)) {
        return;
      }
      const projectName = this.findTarget(runId, targetId)?.target.projectName ?? 'debug';
      void vscode.window.showErrorMessage(
        `Could not confirm that late ${projectName} session stopped. It remains blocked to prevent overlapping processes.`
      );
    }, defaultStopTimeoutMs);
    this.stopTimers.set(key, timer);
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
    if (!this.sessionIsBusy(session)) {
      return Promise.resolve();
    }
    return new Promise(resolve => {
      const timer = setTimeout(() => {
        disposable.dispose();
        resolve();
      }, timeoutMs);
      const disposable = this.onDidChangeSession(event => {
        if (event.session.runId === session.runId && !this.sessionIsBusy(event.session)) {
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
    this.pruneCompletedSessions();
  }

  private pruneCompletedSessions(): void {
    const completed = [...this.sessionsById.values()]
      .filter(session => !this.sessionIsBusy(session) && !this.sessionHasTombstone(session))
      .sort((a, b) => b.startedAt - a.startedAt);
    for (const session of completed.slice(retainedCompletedSessions)) {
      for (const target of session.targets) {
        this.startedDebugTargets.delete(debugTargetKey(session.runId, target.targetId));
      }
      this.sessionsById.delete(session.runId);
    }
  }

  private targetHasRuntime(runId: string, targetId: string): boolean {
    return [...this.taskBindings.values()].some(binding => binding.runId === runId && binding.targetId === targetId)
      || [...this.debugBindings.values()].some(binding => binding.runId === runId && binding.targetId === targetId)
      || this.pendingDebugTargets.some(binding => binding.runId === runId && binding.targetId === targetId);
  }

  private addLateDebugTombstone(runId: string, targetId: string): void {
    // Keep the tombstone for the lifetime of the extension. A debug adapter
    // can respond arbitrarily late; expiring this guard could let an orphaned
    // application start after the UI already reported a timeout or Stop.
    this.lateDebugTombstones.add(debugTargetKey(runId, targetId));
  }

  private requestTaskTermination(
    execution: vscode.TaskExecution,
    session: RunSessionState,
    target: RunTargetState
  ): void {
    try {
      execution.terminate();
    } catch (error) {
      const message = `Could not request termination for ${target.projectName}: ${error instanceof Error ? error.message : String(error)}`;
      this.output.appendLine(`[${new Date().toISOString()}] [run ${session.runId}] ${message}`);
      void vscode.window.showErrorMessage(message);
    }
  }

  private requestDebugTermination(
    debugSession: vscode.DebugSession,
    runId: string,
    targetId: string
  ): void {
    const handleFailure = (error: unknown) => {
      if (!this.debugBindings.has(debugSession.id)) {
        return;
      }
      const found = this.findTarget(runId, targetId);
      const projectName = found?.target.projectName ?? 'debug';
      const message = `Could not request termination for ${projectName}: ${error instanceof Error ? error.message : String(error)}`;
      this.stopRequests.delete(debugTargetKey(runId, targetId));
      this.output.appendLine(`[${new Date().toISOString()}] [run ${runId}] ${message}`);
      if (found?.target.phase === 'stopping') {
        found.target.error = { code: 'stop-timeout', message };
        transitionTarget(found.target, 'failed');
        syncSessionPhase(found.session);
        this.emitSession(found.session);
      }
      void vscode.window.showErrorMessage(`${message}. Retry Stop.`);
    };

    try {
      void vscode.debug.stopDebugging(debugSession).then(undefined, handleFailure);
    } catch (error) {
      handleFailure(error);
    }
  }

  private async forceKillTrackedTask(session: RunSessionState, target: RunTargetState): Promise<void> {
    if (!vscode.workspace
      .getConfiguration('dotnav')
      .get<boolean>('forceKillTaskOnStopTimeout', true)) {
      return;
    }
    const binding = [...this.taskBindings.values()].find(candidate =>
      candidate.runId === session.runId && candidate.targetId === target.targetId
    );
    if (!binding || !vscode.tasks.taskExecutions.includes(binding.execution)) {
      return;
    }
    const processId = this.taskProcessIds.get(binding.execution);
    if (!processId) {
      this.output.appendLine(`[${new Date().toISOString()}] [run ${session.runId}] force-stop unavailable: task PID was not reported`);
      return;
    }

    try {
      if (process.platform === 'win32') {
        await executeFile('taskkill.exe', ['/PID', String(processId), '/T', '/F']);
      } else {
        process.kill(processId, 'SIGKILL');
      }
      this.output.appendLine(`[${new Date().toISOString()}] [run ${session.runId}] force-stop sent to tracked PID ${processId}`);
    } catch (error) {
      const message = `Force-stop failed for tracked PID ${processId}: ${error instanceof Error ? error.message : String(error)}`;
      this.output.appendLine(`[${new Date().toISOString()}] [run ${session.runId}] ${message}`);
      void vscode.window.showErrorMessage(message);
    }
  }

  private sessionIsBusy(session: RunSessionState): boolean {
    return session.targets.some(target => isActivePhase(target.phase) || this.targetHasRuntime(session.runId, target.targetId));
  }

  private sessionHasTombstone(session: RunSessionState): boolean {
    return session.targets.some(target => this.lateDebugTombstones.has(debugTargetKey(session.runId, target.targetId)));
  }
}

function highestPriorityPhase(phases: readonly RunPhase[]): RunPhase | undefined {
  const priority: RunPhase[] = ['stopping', 'building', 'starting', 'running', 'queued', 'failed', 'stopped'];
  return priority.find(phase => phases.includes(phase));
}

function debugTargetKey(runId: string, targetId: string): string {
  return `${runId}\0${targetId}`;
}

function executeFile(file: string, args: readonly string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(file, [...args], { windowsHide: true }, error => error ? reject(error) : resolve());
  });
}
