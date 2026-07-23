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

const vscodeMock = {
  EventEmitter: MockEventEmitter,
  window: {
    createOutputChannel: () => ({
      append: () => undefined,
      appendLine: () => undefined,
      show: () => undefined,
      dispose: () => undefined
    }),
    showErrorMessage: async () => undefined,
    showWarningMessage: async () => undefined,
    withProgress: async (_options: unknown, task: (progress: unknown, token: unknown) => Promise<unknown>) =>
      task({}, { onCancellationRequested: () => ({ dispose: () => undefined }), isCancellationRequested: false })
  },
  workspace: {
    getConfiguration: () => ({ get: (_key: string, fallback: unknown) => fallback })
  },
  ProgressLocation: { Notification: 15 }
};

const moduleWithLoader = Module as unknown as { _load: (request: string, parent: unknown, isMain: boolean) => unknown };
const originalLoad = moduleWithLoader._load;
moduleWithLoader._load = function load(request, parent, isMain) {
  return request === 'vscode' ? vscodeMock : originalLoad(request, parent, isMain);
};

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { buildEfArgs, FreshnessTracker, readEfSettings } = require('../ef/efCli') as typeof import('../ef/efCli');

const project = {
  name: 'Data',
  path: '/repo/Data/Data.csproj',
  directory: '/repo/Data',
  relativePath: 'Data/Data.csproj',
  kind: 'library' as const,
  targetFrameworks: ['net8.0'],
  launchProfiles: [],
  packageReferences: [],
  projectReferences: []
};

const settings = readEfSettings();

test('buildEfArgs includes project, startup project, and configuration', () => {
  const args = buildEfArgs(
    {
      args: ['migrations', 'add', 'AddOrders'],
      project,
      startupProjectPath: '/repo/Web/Web.csproj',
      title: 'x',
      write: true
    },
    { settings, noBuild: false }
  );

  assert.deepEqual(args, [
    'ef', 'migrations', 'add', 'AddOrders',
    '--project', '/repo/Data/Data.csproj',
    '--startup-project', '/repo/Web/Web.csproj',
    '--configuration', 'Debug',
    '--no-color'
  ]);
});

test('buildEfArgs adds context, json, and no-build flags when requested', () => {
  const args = buildEfArgs(
    {
      args: ['migrations', 'list'],
      project,
      startupProjectPath: '/repo/Web/Web.csproj',
      contextName: 'AppDbContext',
      title: 'x',
      write: false,
      json: true
    },
    { settings, noBuild: true }
  );

  assert.ok(args.includes('--context'));
  assert.equal(args[args.indexOf('--context') + 1], 'AppDbContext');
  assert.ok(args.includes('--no-build'));
  assert.ok(args.includes('--json'));
  assert.ok(args.includes('--prefix-output'));
});

test('buildEfArgs raw mode skips every project flag', () => {
  const args = buildEfArgs(
    { args: ['--version'], project, startupProjectPath: '', title: 'x', write: false, raw: true },
    { settings, noBuild: true }
  );
  assert.deepEqual(args, ['ef', '--version']);
});

test('freshness tracker marks and clears build freshness per project', () => {
  const tracker = new FreshnessTracker();
  assert.equal(tracker.isFresh(project.path), false);

  tracker.markBuilt(project.path);
  assert.equal(tracker.isFresh(project.path), true);
  assert.equal(tracker.isFresh('/repo/Other/Other.csproj'), false);

  tracker.markDirty(project.path);
  assert.equal(tracker.isFresh(project.path), false);

  tracker.markBuilt(project.path);
  tracker.markAllDirty();
  assert.equal(tracker.isFresh(project.path), false);
});
