import assert from 'node:assert/strict';
import test from 'node:test';
import Module from 'node:module';

type MessageListener = (message: Record<string, unknown>) => unknown;

class MockPanel {
  private messageListener: MessageListener | undefined;
  private disposeListener: (() => void) | undefined;
  readonly messages: Record<string, unknown>[] = [];
  disposed = false;
  readonly webview: {
    html: string;
    cspSource: string;
    postMessage: (message: Record<string, unknown>) => Promise<boolean>;
    onDidReceiveMessage: (listener: MessageListener) => { dispose(): void };
  };

  constructor() {
    this.webview = {
      html: '',
      cspSource: 'mock-csp',
      postMessage: async message => {
        this.messages.push(message);
        return true;
      },
      onDidReceiveMessage: listener => {
        this.messageListener = listener;
        return {
          dispose: () => {
            if (this.messageListener === listener) {
              this.messageListener = undefined;
            }
          }
        };
      }
    };
  }

  reveal(): void { /* noop */ }

  onDidDispose(listener: () => void): { dispose(): void } {
    this.disposeListener = listener;
    return {
      dispose: () => {
        if (this.disposeListener === listener) {
          this.disposeListener = undefined;
        }
      }
    };
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.disposeListener?.();
  }

  async receive(message: Record<string, unknown>): Promise<void> {
    await this.messageListener?.(message);
  }
}

const panels: MockPanel[] = [];
const vscodeMock = {
  ViewColumn: { Active: 1 },
  ConfigurationTarget: { Global: 1 },
  env: {
    language: 'en',
    clipboard: { writeText: async () => undefined }
  },
  workspace: {
    getConfiguration: () => ({
      get: (_key: string, fallback: unknown) => fallback,
      update: async () => undefined
    })
  },
  commands: { executeCommand: async () => undefined },
  window: {
    createWebviewPanel: () => {
      const panel = new MockPanel();
      panels.push(panel);
      return panel;
    }
  }
};

const moduleWithLoader = Module as unknown as { _load: (request: string, parent: unknown, isMain: boolean) => unknown };
const originalLoad = moduleWithLoader._load;
moduleWithLoader._load = function load(request, parent, isMain) {
  return request === 'vscode' ? vscodeMock : originalLoad(request, parent, isMain);
};

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { showEfDialog } = require('../ef/efDialog') as typeof import('../ef/efDialog');
import type { EfDialogSpec, EfDialogValues } from '../ef/efDialog';

function spec(actionId: string, connection = ''): EfDialogSpec {
  return {
    actionId,
    title: 'Test action',
    submitLabel: 'Run',
    fields: [
      { id: 'project', label: 'Project', type: 'text', value: '/repo/App.csproj' },
      { id: 'connection', label: 'Connection', type: 'password', value: connection },
      { id: 'flag', label: 'Flag', type: 'checkbox', value: false }
    ]
  };
}

test('persistent Center accepts another submit after the first action completes', async () => {
  let submissions = 0;
  let inlineActions = 0;
  const closed = showEfDialog(spec('dotnav.ef.test'), {
    preview: () => 'dotnet ef test',
    onAction: () => { inlineActions += 1; },
    onSubmit: async () => { submissions += 1; }
  });
  const panel = panels.at(-1)!;
  const values: EfDialogValues = { project: '/repo/App.csproj', connection: 'Password=secret', flag: false };

  await panel.receive({ type: 'ready', values });
  await panel.receive({ type: 'submit', values });
  await panel.receive({ type: 'submit', values });
  await panel.receive({ type: 'action', action: 'check', values });

  assert.equal(submissions, 2);
  assert.equal(inlineActions, 1);
  assert.equal(panel.disposed, false);
  assert.equal(panel.messages.filter(message => message.type === 'busy' && message.busy === false).length, 2);

  await panel.receive({ type: 'cancel' });
  await closed;
});

test('Center keeps form values in host memory across actions and clears them when closed', async () => {
  const first = showEfDialog(spec('dotnav.ef.first'), { preview: () => '' });
  const panel = panels.at(-1)!;
  const values: EfDialogValues = {
    project: '/repo/App.csproj',
    connection: 'Host=db;Password=secret',
    flag: true
  };
  await panel.receive({ type: 'change', values });

  const second = showEfDialog(spec('dotnav.ef.second'), { preview: () => '' });
  await first;
  await panel.receive({ type: 'ready', values: { project: '/repo/App.csproj', connection: '', flag: false } });
  const hydrated = panel.messages.filter(message => message.type === 'values').at(-1)?.values as EfDialogValues;
  assert.equal(hydrated.connection, values.connection);
  assert.equal(hydrated.flag, false, 'action-specific values do not leak into another action');

  await panel.receive({ type: 'cancel' });
  await second;

  const third = showEfDialog(spec('dotnav.ef.second'), { preview: () => '' });
  const newPanel = panels.at(-1)!;
  await newPanel.receive({ type: 'ready', values: {} });
  const afterClose = newPanel.messages.filter(message => message.type === 'values').at(-1)?.values as EfDialogValues;
  assert.equal(afterClose.connection, '');
  await newPanel.receive({ type: 'cancel' });
  await third;
});
