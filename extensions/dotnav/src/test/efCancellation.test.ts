import assert from 'node:assert/strict';
import test from 'node:test';
import Module from 'node:module';
import { Deferred } from './fixtures/efToolsHarness';
import type { RunProcessOptions, RunProcessResult } from '../ef/efProcess';

let run: (options: RunProcessOptions) => Promise<RunProcessResult>;
let notificationCancel: (() => void) | undefined;
let outputShows = 0;
let calls = 0;
let toolChoice = new Deferred<string | undefined>();
const vscodeMock = {
  EventEmitter: class {
    readonly event = () => ({ dispose() {} });
    fire(): void { /* noop */ }
    dispose(): void { /* noop */ }
  },
  ProgressLocation: { Notification: 15 },
  workspace: { getConfiguration: () => ({ get: (_key: string, fallback: unknown) => fallback }) },
  window: {
    createOutputChannel: () => ({ append() {}, appendLine() {}, show: () => { outputShows += 1; }, dispose() {} }),
    showErrorMessage: () => toolChoice.promise,
    showWarningMessage: () => toolChoice.promise,
    withProgress: async (_options: unknown, task: (progress: unknown, token: unknown) => Promise<unknown>) => task({}, {
      isCancellationRequested: false,
      onCancellationRequested: (listener: () => void) => {
        notificationCancel = listener;
        return { dispose: () => { notificationCancel = undefined; } };
      }
    })
  }
};
const loader = Module as unknown as { _load: (request: string, parent: unknown, isMain: boolean) => unknown };
const original = loader._load;
loader._load = (request, parent, isMain) => {
  if (request === 'vscode') { return vscodeMock; }
  if (request === './efProcess') {
    return { runProcess: async (_command: string, _args: string[], options: RunProcessOptions) => { calls += 1; return run(options); } };
  }
  return original(request, parent, isMain);
};
const { EfCli, reportEfFailure } = require('../ef/efCli') as typeof import('../ef/efCli');
const { EfToolManager } = require('../ef/efToolManager') as typeof import('../ef/efToolManager');
loader._load = original;
const project = {
  name: 'App', path: '/mock/App.csproj', directory: '/mock', relativePath: 'App.csproj',
  kind: 'library' as const, targetFrameworks: [], launchProfiles: [], packageReferences: [], projectReferences: []
};
const request = { title: 'Check', args: ['migrations', 'list'], project, startupProjectPath: project.path, write: false };
const success: RunProcessResult = { exitCode: 0, stdout: '[]', stderr: '', killed: false };
test.beforeEach(() => { calls = 0; toolChoice = new Deferred(); });

test('pre-aborted CLI request never starts a process', async () => {
  const cli = new EfCli();
  const controller = new AbortController();
  controller.abort();
  const result = await cli.run({ ...request, signal: controller.signal });
  assert.equal(result.kind, 'cancelled');
  assert.equal(calls, 0);
  cli.dispose();
});

test('CLI cancels only its queued request and leaves unrelated work queued', async () => {
  const cli = new EfCli();
  const first = new Deferred<RunProcessResult>();
  run = async () => calls === 1 ? first.promise : success;
  const running = cli.run(request);
  await new Promise(resolve => setImmediate(resolve));
  const controller = new AbortController();
  const cancelled = cli.run({ ...request, title: 'Cancelled', signal: controller.signal });
  const following = cli.run({ ...request, title: 'Following' });
  await new Promise(resolve => setImmediate(resolve));
  controller.abort();
  assert.equal((await cancelled).kind, 'cancelled');
  assert.equal(cli.queue.runningEntry?.label, 'Check');
  assert.deepEqual(cli.queue.snapshot.pending.map(entry => entry.label), ['Following']);
  first.resolve(success);
  await running;
  assert.equal((await following).kind, 'success');
  assert.equal(calls, 2);
  cli.dispose();
});

test('both Center signal and notification Cancel reach the running process', async () => {
  for (const source of ['center', 'notification']) {
    const cli = new EfCli();
    const controller = new AbortController();
    run = options => new Promise(resolve => options.signal!.addEventListener('abort', () => {
      resolve({ ...success, exitCode: undefined, killed: true });
    }));
    const running = cli.run({ ...request, signal: controller.signal });
    await new Promise(resolve => setImmediate(resolve));
    if (source === 'center') { controller.abort(); } else { notificationCancel!(); }
    assert.equal((await running).kind, 'cancelled');
    assert.equal(notificationCancel, undefined, 'subscription is disposed after termination');
    assert.equal(cli.busy, false);
    cli.dispose();
  }
});

test('a cancellation never retries a stale no-build result', async () => {
  const cli = new EfCli();
  const controller = new AbortController();
  run = async () => {
    controller.abort();
    return { ...success, exitCode: 1, stderr: 'Could not load file or assembly' };
  };
  assert.equal((await cli.run({ ...request, forceNoBuild: true, signal: controller.signal })).kind, 'cancelled');
  assert.equal(calls, 1);
  cli.dispose();
});

test('Cancel interrupts a tool-install choice and late clicks cannot start installation', async () => {
  const manager = new EfToolManager(() => undefined);
  const controller = new AbortController();
  run = async () => ({ ...success, exitCode: 1, stdout: '' });
  const preparing = manager.ensureTool('/mock', controller.signal);
  await new Promise(resolve => setImmediate(resolve));
  controller.abort();
  assert.equal(await preparing, false);
  toolChoice.resolve('Install Local Tool');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls, 1);
});

test('error reporting resolves before its notification, retaining the Show Output action', async () => {
  const cli = new EfCli();
  outputShows = 0;
  await reportEfFailure(cli, 'Check', { kind: 'error', stdout: '', stderr: '', durationMs: 1 });
  assert.equal(outputShows, 0);
  toolChoice.resolve('Show Output');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(outputShows, 1);
  cli.dispose();
});
