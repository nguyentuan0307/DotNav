import assert from 'node:assert/strict';
import test from 'node:test';
import Module from 'node:module';
import * as path from 'path';

const vscodeMock = {
  EventEmitter: class {
    readonly event = () => ({ dispose: () => undefined });
    fire(): void { /* noop */ }
    dispose(): void { /* noop */ }
  },
  window: {
    createOutputChannel: () => ({
      append: () => undefined, appendLine: () => undefined,
      show: () => undefined, dispose: () => undefined
    }),
    createWebviewPanel: () => ({}),
    showErrorMessage: async () => undefined,
    showWarningMessage: async () => undefined,
    showInformationMessage: async () => undefined
  },
  workspace: {
    workspaceFolders: [{ uri: { fsPath: path.resolve('/repo') } }],
    getConfiguration: () => ({ get: (_key: string, fallback: unknown) => fallback })
  },
  commands: { registerCommand: () => ({ dispose: () => undefined }) },
  ProgressLocation: { Notification: 15 },
  ViewColumn: { Active: -1 }
};

const moduleWithLoader = Module as unknown as { _load: (request: string, parent: unknown, isMain: boolean) => unknown };
const originalLoad = moduleWithLoader._load;
moduleWithLoader._load = function load(request, parent, isMain) {
  return request === 'vscode' ? vscodeMock : originalLoad(request, parent, isMain);
};

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { formatPreview } = require('../ef/efCommands') as typeof import('../ef/efCommands');

const root = path.resolve('/repo');

test('shortens workspace paths so the preview stays readable', () => {
  const preview = formatPreview(
    [
      'ef', 'migrations', 'add', 'AddOrders',
      '--project', path.join(root, 'src', 'Data', 'Data.csproj'),
      '--startup-project', path.join(root, 'src', 'Web', 'Web.csproj'),
      '--no-color'
    ],
    root
  );

  assert.ok(!preview.includes(root), 'absolute workspace paths must be stripped');
  assert.ok(preview.includes(path.join('src', 'Data', 'Data.csproj')));
  assert.ok(preview.startsWith('dotnet ef migrations add AddOrders'));
});

test('leaves paths outside the workspace absolute', () => {
  const outside = path.resolve('/elsewhere/Other.csproj');
  assert.ok(formatPreview(['ef', '--project', outside], root).includes(outside));
});

test('quotes arguments containing spaces', () => {
  const preview = formatPreview(['ef', 'migrations', 'add', 'Add Orders'], root);
  assert.ok(preview.includes('"Add Orders"'));
});

test('masks credentials in the previewed connection string', () => {
  const preview = formatPreview(
    ['ef', 'database', 'update', '--connection', 'Host=db;Username=sa;Password=hunter2'],
    root
  );

  assert.ok(!preview.includes('hunter2'), 'the preview must never show a password');
  assert.ok(preview.includes('Password=***'));
  assert.ok(preview.includes('Host=db'));
});

test('works without a workspace root', () => {
  const absolute = path.join(root, 'Data.csproj');
  assert.ok(formatPreview(['ef', '--project', absolute], undefined).includes(absolute));
});
