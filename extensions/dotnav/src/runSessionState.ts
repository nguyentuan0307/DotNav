export type RunMode = 'run' | 'debug' | 'build';

export type RunPhase =
  | 'queued'
  | 'building'
  | 'starting'
  | 'running'
  | 'stopping'
  | 'succeeded'
  | 'failed'
  | 'stopped';

export type RunErrorCode =
  | 'build-failed'
  | 'build-timeout'
  | 'start-rejected'
  | 'start-timeout'
  | 'start-error'
  | 'stop-timeout'
  | 'target-not-found'
  | 'unexpected-exit';

export interface RunFailure {
  readonly code: RunErrorCode;
  readonly message: string;
  readonly cause?: string;
}

export interface RunTargetState {
  readonly targetId: string;
  readonly projectPath: string;
  readonly projectName: string;
  readonly profileName?: string;
  phase: RunPhase;
  exitCode?: number;
  error?: RunFailure;
}

export interface RunSessionState {
  readonly runId: string;
  readonly configId: string;
  readonly configLabel: string;
  readonly mode: RunMode;
  phase: RunPhase;
  readonly targets: RunTargetState[];
  readonly startedAt: number;
  finishedAt?: number;
  stopRequestedAt?: number;
  error?: RunFailure;
}

const terminalPhases = new Set<RunPhase>(['succeeded', 'failed', 'stopped']);

const allowedTransitions: Readonly<Record<RunPhase, ReadonlySet<RunPhase>>> = {
  queued: new Set(['building', 'starting', 'stopping', 'failed', 'stopped']),
  building: new Set(['starting', 'stopping', 'succeeded', 'failed', 'stopped']),
  starting: new Set(['running', 'stopping', 'failed', 'stopped']),
  running: new Set(['stopping', 'succeeded', 'failed', 'stopped']),
  stopping: new Set(['stopped', 'failed']),
  succeeded: new Set(),
  failed: new Set(),
  stopped: new Set()
};

export function isTerminalPhase(phase: RunPhase): boolean {
  return terminalPhases.has(phase);
}

export function isActivePhase(phase: RunPhase): boolean {
  return !isTerminalPhase(phase);
}

export function transitionTarget(target: RunTargetState, next: RunPhase): void {
  if (target.phase === next) {
    return;
  }

  if (!allowedTransitions[target.phase].has(next)) {
    throw new Error(`Invalid run target transition: ${target.phase} -> ${next}`);
  }

  target.phase = next;
}

export function completionPhaseForTarget(target: RunTargetState, exitCode?: number): RunPhase {
  if (target.phase === 'stopping') {
    return target.error ? 'failed' : 'stopped';
  }
  return exitCode === undefined || exitCode === 0 ? 'succeeded' : 'failed';
}

export function deriveSessionPhase(targets: readonly RunTargetState[]): RunPhase {
  if (targets.length === 0) {
    return 'failed';
  }

  const phases = targets.map(target => target.phase);
  if (phases.includes('failed')) {
    return 'failed';
  }

  if (phases.includes('stopping')) {
    return 'stopping';
  }

  if (phases.includes('building')) {
    return 'building';
  }

  if (phases.includes('starting') || phases.includes('queued')) {
    return phases.includes('starting') ? 'starting' : 'queued';
  }

  if (phases.includes('running')) {
    return 'running';
  }

  if (phases.every(phase => phase === 'stopped')) {
    return 'stopped';
  }

  if (phases.every(phase => phase === 'succeeded' || phase === 'stopped')) {
    return phases.includes('stopped') ? 'stopped' : 'succeeded';
  }

  return 'failed';
}

export function syncSessionPhase(session: RunSessionState, now = Date.now()): void {
  session.phase = deriveSessionPhase(session.targets);
  session.error = session.targets.find(target => target.error)?.error;
  if (isTerminalPhase(session.phase)) {
    session.finishedAt ??= now;
  }
}
