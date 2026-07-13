import assert from 'node:assert/strict';
import test from 'node:test';
import Module from 'node:module';

type Listener<T> = (event: T) => unknown;

class MockEventEmitter<T> {
  private readonly listeners = new Set<Listener<T>>();
  readonly event = (listener: Listener<T>) => {
    this.listeners.add(listener);
    return { dispose: () => this.listeners.delete(listener) };
  };
  fire(event: T): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }
  dispose(): void {
    this.listeners.clear();
  }
}

const debugStarted = new MockEventEmitter<unknown>();
const debugTerminated = new MockEventEmitter<unknown>();
const taskProcessEnded = new MockEventEmitter<{ execution: unknown; exitCode?: number }>();
const taskProcessStarted = new MockEventEmitter<{ execution: unknown; processId: number }>();
const taskEnded = new MockEventEmitter<{ execution: unknown }>();
let debugStopCalls = 0;
let debugStopShouldReject = false;

const vscodeMock = {
  EventEmitter: MockEventEmitter,
  debug: {
    onDidStartDebugSession: debugStarted.event,
    onDidTerminateDebugSession: debugTerminated.event,
    stopDebugging: async () => {
      debugStopCalls += 1;
      if (debugStopShouldReject) {
        throw new Error('debug stop failed');
      }
    }
  },
  tasks: {
    taskExecutions: [] as unknown[],
    onDidStartTaskProcess: taskProcessStarted.event,
    onDidEndTaskProcess: taskProcessEnded.event,
    onDidEndTask: taskEnded.event
  },
  window: {
    createOutputChannel: () => ({ appendLine: () => undefined, show: () => undefined, dispose: () => undefined }),
    showErrorMessage: async () => undefined
  },
  workspace: {
    getConfiguration: () => ({ get: (_key: string, fallback: unknown) => fallback })
  }
};

const moduleWithLoader = Module as unknown as { _load: (request: string, parent: unknown, isMain: boolean) => unknown };
const originalLoad = moduleWithLoader._load;
moduleWithLoader._load = function load(request, parent, isMain) {
  return request === 'vscode' ? vscodeMock : originalLoad(request, parent, isMain);
};

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { ProcessManager } = require('../processManager') as typeof import('../processManager');

const project = {
  name: 'App',
  path: 'C:\\repo\\App.csproj',
  directory: 'C:\\repo',
  relativePath: 'App.csproj',
  kind: 'console' as const,
  targetFrameworks: ['net8.0'],
  launchProfiles: [],
  packageReferences: [],
  projectReferences: []
};

function delay(milliseconds: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

test('rejects a duplicate active configuration before the UI refreshes', () => {
  const manager = new ProcessManager();
  manager.beginRun('single:app', 'App', 'run', [{ project }]);
  assert.throws(
    () => manager.beginRun('single:app', 'App', 'run', [{ project }]),
    /already queued/
  );
  manager.dispose();
});

test('keeps a stopped task busy until VS Code confirms task completion', async () => {
  const manager = new ProcessManager();
  const session = manager.beginRun('single:app', 'App', 'run', [{ project }]);
  let terminateCalls = 0;
  const execution = { terminate: () => { terminateCalls += 1; } };
  manager.trackTask(project, 'build', execution as never, session.runId, session.targets[0].targetId);

  await manager.stopConfig('single:app');
  assert.equal(terminateCalls, 1);
  assert.equal(session.targets[0].phase, 'stopping');
  assert.equal(manager.hasRunningProcesses(), true);

  taskProcessEnded.fire({ execution, exitCode: 1 });
  taskEnded.fire({ execution });
  await delay(300);

  assert.equal(session.targets[0].phase, 'stopped');
  assert.equal(manager.hasRunningProcesses(), false);
  manager.dispose();
});

test('tracks a rebuild task as a cancellable build operation', async () => {
  const manager = new ProcessManager();
  const execution = { terminate: () => undefined };
  vscodeMock.tasks.taskExecutions.push(execution);

  const binding = manager.trackTask(project, 'rebuild', execution as never);
  assert.equal(manager.getSession(binding.runId)?.phase, 'building');

  taskProcessEnded.fire({ execution, exitCode: 0 });
  taskEnded.fire({ execution });
  await delay(0);

  assert.equal(manager.getSession(binding.runId)?.phase, 'succeeded');
  vscodeMock.tasks.taskExecutions.splice(vscodeMock.tasks.taskExecutions.indexOf(execution), 1);
  manager.dispose();
});

test('cleans up a task even when no process-end event is emitted', async () => {
  const manager = new ProcessManager();
  const session = manager.beginRun('operation:build:app', 'Build App', 'build', [{ project }]);
  const execution = { terminate: () => undefined };
  manager.trackTask(project, 'build', execution as never, session.runId, session.targets[0].targetId);
  const completion = manager.waitForTask(execution as never, 2_000);

  taskEnded.fire({ execution });
  assert.equal(await completion, undefined);
  assert.equal(session.targets[0].phase, 'failed');
  assert.equal(manager.hasRunningProcesses(), false);
  manager.dispose();
});

test('reconciles a process-end event that arrives shortly after task-end', async () => {
  const manager = new ProcessManager();
  const session = manager.beginRun('operation:build:app', 'Build App', 'build', [{ project }]);
  const execution = { terminate: () => undefined };
  manager.trackTask(project, 'build', execution as never, session.runId, session.targets[0].targetId);
  const completion = manager.waitForTask(execution as never, 2_000);

  taskEnded.fire({ execution });
  await delay(25);
  taskProcessEnded.fire({ execution, exitCode: 0 });

  assert.equal(await completion, 0);
  assert.equal(session.targets[0].phase, 'succeeded');
  manager.dispose();
});

test('cancels delayed task finalization when the manager is disposed', async () => {
  const manager = new ProcessManager();
  const session = manager.beginRun('operation:build:app', 'Build App', 'build', [{ project }]);
  const execution = { terminate: () => undefined };
  manager.trackTask(project, 'build', execution as never, session.runId, session.targets[0].targetId);

  taskEnded.fire({ execution });
  manager.dispose();
  await delay(300);

  assert.equal(session.targets[0].phase, 'building');
});

test('finalizes a task that completed before executeTask returned its binding', async () => {
  const manager = new ProcessManager();
  const session = manager.beginRun('operation:build:app', 'Build App', 'build', [{ project }]);
  const execution = { terminate: () => undefined };

  taskProcessEnded.fire({ execution, exitCode: 0 });
  taskEnded.fire({ execution });
  await delay(300);

  manager.trackTask(project, 'build', execution as never, session.runId, session.targets[0].targetId);
  await delay(0);

  assert.equal(session.targets[0].phase, 'succeeded');
  assert.equal(manager.hasRunningProcesses(), false);
  manager.dispose();
});

test('terminates a task whose execution handle arrives after Stop completed', async () => {
  const manager = new ProcessManager();
  const session = manager.beginRun('single:app', 'App', 'run', [{ project }]);
  await manager.stopConfig('single:app');
  assert.equal(session.targets[0].phase, 'stopped');

  let terminateCalls = 0;
  const execution = { terminate: () => { terminateCalls += 1; } };
  manager.trackTask(project, 'build', execution as never, session.runId, session.targets[0].targetId);

  assert.equal(terminateCalls, 1);
  assert.equal(manager.hasRunningProcesses(), true);
  taskProcessEnded.fire({ execution, exitCode: 1 });
  taskEnded.fire({ execution });
  await delay(300);
  assert.equal(manager.hasRunningProcesses(), false);
  manager.dispose();
});

test('matches debug sessions by run identity and confirms stop on termination', async () => {
  debugStopCalls = 0;
  debugStopShouldReject = false;
  const manager = new ProcessManager();
  const session = manager.beginRun('single:app', 'App', 'debug', [{ project }]);
  const targetId = session.targets[0].targetId;
  manager.setTargetPhase(session.runId, targetId, 'starting');
  manager.expectDebugSession(project, 'Debug App', session.runId, targetId);

  const debugSession = {
    id: 'debug-1',
    configuration: {
      dotnavRunId: session.runId,
      dotnavTargetId: targetId
    }
  };
  debugStarted.fire(debugSession);
  assert.equal(session.targets[0].phase, 'running');

  await manager.stopConfig('single:app');
  assert.equal(debugStopCalls, 1);
  assert.equal(session.targets[0].phase, 'stopping');

  debugTerminated.fire(debugSession);
  assert.equal(session.targets[0].phase, 'stopped');
  assert.equal(manager.hasRunningProcesses(), false);
  manager.dispose();
});

test('finishes a stopped pending debug target when start is rejected', async () => {
  debugStopCalls = 0;
  debugStopShouldReject = false;
  const manager = new ProcessManager();
  const session = manager.beginRun('single:app', 'App', 'run', [{ project }]);
  const targetId = session.targets[0].targetId;
  manager.setTargetPhase(session.runId, targetId, 'starting');
  manager.expectDebugSession(project, 'Run App', session.runId, targetId);

  await manager.stopConfig('single:app');
  assert.equal(session.targets[0].phase, 'stopped');
  manager.cancelExpectedDebugSession(project, session.runId, targetId);

  assert.equal(session.targets[0].phase, 'stopped');
  assert.equal(manager.hasRunningProcesses(), false);

  const lateSession = {
    id: 'late-after-stop',
    configuration: {
      dotnavRunId: session.runId,
      dotnavTargetId: targetId
    }
  };
  debugStarted.fire(lateSession);
  await delay(0);
  assert.equal(debugStopCalls, 1);
  assert.equal(manager.hasRunningProcesses(), true);
  debugTerminated.fire(lateSession);
  assert.equal(manager.hasRunningProcesses(), false);
  manager.dispose();
});

test('stops a late debug session after the start request timed out', async () => {
  debugStopCalls = 0;
  debugStopShouldReject = false;
  const manager = new ProcessManager();
  const session = manager.beginRun('single:app', 'App', 'run', [{ project }]);
  const targetId = session.targets[0].targetId;
  manager.setTargetPhase(session.runId, targetId, 'starting');
  manager.expectDebugSession(project, 'Run App', session.runId, targetId);

  await assert.rejects(manager.waitForTargetRunning(session.runId, targetId, 10), /did not start/);
  manager.expireExpectedDebugSession(project, session.runId, targetId, 'Start timed out.');
  assert.equal(session.targets[0].phase, 'failed');

  const lateSession = {
    id: 'late-debug',
    configuration: {
      dotnavRunId: session.runId,
      dotnavTargetId: targetId
    }
  };
  debugStarted.fire(lateSession);
  await delay(0);
  assert.equal(debugStopCalls, 1);
  assert.equal(manager.hasRunningProcesses(), true);
  debugTerminated.fire(lateSession);
  assert.equal(manager.hasRunningProcesses(), false);
  manager.dispose();
});

test('handles a debug session that starts and terminates in the same turn', async () => {
  const manager = new ProcessManager();
  const session = manager.beginRun('single:app', 'App', 'debug', [{ project }]);
  const targetId = session.targets[0].targetId;
  manager.setTargetPhase(session.runId, targetId, 'starting');
  manager.expectDebugSession(project, 'Debug App', session.runId, targetId);
  const debugSession = {
    id: 'instant-debug',
    configuration: {
      dotnavRunId: session.runId,
      dotnavTargetId: targetId
    }
  };

  debugStarted.fire(debugSession);
  debugTerminated.fire(debugSession);

  assert.equal(session.targets[0].phase, 'succeeded');
  assert.equal(await manager.waitForTargetRunning(session.runId, targetId, 100), true);
  assert.equal(manager.hasRunningProcesses(), false);
  manager.dispose();
});

test('keeps a debug session busy and retryable when stopDebugging rejects', async () => {
  debugStopCalls = 0;
  debugStopShouldReject = true;
  const manager = new ProcessManager();
  const session = manager.beginRun('single:app', 'App', 'debug', [{ project }]);
  const targetId = session.targets[0].targetId;
  manager.setTargetPhase(session.runId, targetId, 'starting');
  manager.expectDebugSession(project, 'Debug App', session.runId, targetId);
  const debugSession = {
    id: 'rejecting-debug',
    configuration: {
      dotnavRunId: session.runId,
      dotnavTargetId: targetId
    }
  };
  debugStarted.fire(debugSession);

  await manager.stopConfig('single:app');
  await delay(0);
  assert.equal(session.targets[0].phase, 'failed');
  assert.equal(manager.hasRunningProcesses(), true);

  debugStopShouldReject = false;
  await manager.stopConfig('single:app');
  assert.equal(debugStopCalls, 2);
  debugTerminated.fire(debugSession);
  assert.equal(manager.hasRunningProcesses(), false);
  manager.dispose();
});

test('coalesces concurrent stop requests for the same task', async () => {
  const manager = new ProcessManager();
  const session = manager.beginRun('single:app', 'App', 'run', [{ project }]);
  let terminateCalls = 0;
  const execution = { terminate: () => { terminateCalls += 1; } };
  manager.trackTask(project, 'build', execution as never, session.runId, session.targets[0].targetId);

  await Promise.all([manager.stopConfig('single:app'), manager.stopConfig('single:app')]);
  assert.equal(terminateCalls, 1);

  taskProcessEnded.fire({ execution, exitCode: 1 });
  taskEnded.fire({ execution });
  await delay(300);
  manager.dispose();
});

test('keeps ownership when TaskExecution.terminate throws', async () => {
  const manager = new ProcessManager();
  const session = manager.beginRun('single:app', 'App', 'run', [{ project }]);
  const execution = { terminate: () => { throw new Error('terminate failed'); } };
  manager.trackTask(project, 'build', execution as never, session.runId, session.targets[0].targetId);

  await manager.stopConfig('single:app');
  assert.equal(session.targets[0].phase, 'stopping');
  assert.equal(manager.hasRunningProcesses(), true);

  taskProcessEnded.fire({ execution, exitCode: 1 });
  taskEnded.fire({ execution });
  assert.equal(session.targets[0].phase, 'stopped');
  manager.dispose();
});

test('stopping one configuration does not stop another configuration for the same project', async () => {
  const manager = new ProcessManager();
  const first = manager.beginRun('config:a', 'A', 'run', [{ project }]);
  const second = manager.beginRun('config:b', 'B', 'run', [{ project }]);
  let firstStops = 0;
  let secondStops = 0;
  const firstExecution = { terminate: () => { firstStops += 1; } };
  const secondExecution = { terminate: () => { secondStops += 1; } };
  manager.trackTask(project, 'build', firstExecution as never, first.runId, first.targets[0].targetId);
  manager.trackTask(project, 'build', secondExecution as never, second.runId, second.targets[0].targetId);

  await manager.stopConfig('config:a');
  assert.equal(firstStops, 1);
  assert.equal(secondStops, 0);
  assert.equal(manager.getActiveSessionForConfig('config:b')?.runId, second.runId);

  taskProcessEnded.fire({ execution: firstExecution, exitCode: 1 });
  taskEnded.fire({ execution: firstExecution });
  taskProcessEnded.fire({ execution: secondExecution, exitCode: 0 });
  taskEnded.fire({ execution: secondExecution });
  await delay(300);
  manager.dispose();
});

test.after(() => {
  moduleWithLoader._load = originalLoad;
});
