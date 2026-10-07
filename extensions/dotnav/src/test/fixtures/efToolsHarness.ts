import Module from 'node:module';
import * as path from 'node:path';
import type { EfCommandRequest, EfCommandResult } from '../../ef/efCli';
import type { EfDialogValues } from '../../ef/efDialog';
import type { EfFeature } from '../../ef/efMain';
import type { EfProjectDetection } from '../../ef/efDetection';
import type { ProjectEfModel } from '../../ef/efModel';
import type { ProjectModel } from '../../models';

export class Deferred<T> {
  resolve!: (value: T) => void;
  readonly promise = new Promise<T>(resolve => { this.resolve = resolve; });
}

export async function flushEfMessages(): Promise<void> {
  await new Promise<void>(resolve => setImmediate(resolve));
}

export class EfTestPanel {
  readonly messages: Record<string, unknown>[] = [];
  disposed = false;
  private listener?: (message: Record<string, unknown>) => unknown;
  private disposeListener?: () => void;
  readonly webview = {
    html: '', cspSource: 'mock-csp',
    postMessage: async (message: Record<string, unknown>) => {
      this.messages.push(message);
      return true;
    },
    onDidReceiveMessage: (listener: (message: Record<string, unknown>) => unknown) => {
      this.listener = listener;
      return { dispose: () => { if (this.listener === listener) { this.listener = undefined; } } };
    }
  };
  reveal(): void { /* noop */ }
  onDidDispose(listener: () => void): { dispose(): void } {
    this.disposeListener = listener;
    return { dispose: () => { if (this.disposeListener === listener) { this.disposeListener = undefined; } } };
  }
  dispose(): void {
    if (!this.disposed) { this.disposed = true; this.disposeListener?.(); }
  }
  async receive(message: Record<string, unknown>): Promise<void> { await this.listener?.(message); }
  last(type: string): Record<string, unknown> | undefined {
    return this.messages.filter(message => message.type === type).at(-1);
  }
}

/** Real EF commands/dialog, with source discovery and every CLI request mocked. */
export class EfToolsHarness {
  readonly panels: EfTestPanel[] = [];
  readonly commands = new Map<string, (...args: unknown[]) => unknown>();
  readonly requests: EfCommandRequest[] = [];
  readonly notification = new Deferred<string | undefined>();
  invalidations = 0;
  outputShows = 0;
  readonly project: ProjectModel = {
    name: 'App', path: path.resolve('/mock/App.csproj'), directory: path.resolve('/mock'), relativePath: 'App.csproj',
    kind: 'library', targetFrameworks: ['net11.0'], launchProfiles: [], projectReferences: [],
    packageReferences: [{ name: 'Microsoft.EntityFrameworkCore.Design', version: '11.0.0' }]
  };
  readonly model: ProjectEfModel = {
    contexts: [{ name: 'AppContext', fullName: 'App.AppContext', filePath: '/mock/AppContext.cs' }],
    migrations: [
      { id: '20260101000000_Init', name: 'Init', filePath: '/mock/Migrations/Init.cs' },
      { id: '20260201000000_Orders', name: 'Orders', filePath: '/mock/Migrations/Orders.cs' }
    ],
    migrationsByContext: new Map()
  };
  readonly projects: ProjectModel[] = [this.project];
  readonly models = new Map<string, ProjectEfModel>([[this.project.path, this.model]]);
  modelLoader: (projectPath: string) => Promise<ProjectEfModel | undefined> = async projectPath => this.models.get(projectPath);
  startupResolver: (detection: EfProjectDetection) => Promise<string | undefined> = async detection => detection.project.path;
  run: (request: EfCommandRequest) => Promise<EfCommandResult> = async () => this.migrations(false);
  private readonly dialog: typeof import('../../ef/efDialog');
  private opened?: Promise<unknown>;

  constructor() {
    const vscodeMock = {
      EventEmitter: class {
        readonly event = () => ({ dispose() {} });
        fire(): void { /* noop */ }
        dispose(): void { /* noop */ }
      },
      ViewColumn: { Active: 1 }, ConfigurationTarget: { Global: 1 },
      Uri: { file: (fsPath: string) => ({ fsPath }) },
      env: { language: 'en', clipboard: { writeText: async () => undefined } },
      workspace: {
        getConfiguration: () => ({ get: (_key: string, fallback: unknown) => fallback, update: async () => undefined }),
        getWorkspaceFolder: () => undefined
      },
      window: {
        createWebviewPanel: () => { const panel = new EfTestPanel(); this.panels.push(panel); return panel; },
        createOutputChannel: () => ({ append() {}, appendLine() {}, show() {}, dispose() {} }),
        showErrorMessage: () => this.notification.promise,
        showWarningMessage: async () => undefined,
        showInformationMessage: () => this.notification.promise
      },
      commands: {
        registerCommand: (id: string, handler: (...args: unknown[]) => unknown) => {
          this.commands.set(id, handler);
          return { dispose() {} };
        },
        executeCommand: async (id: string, ...args: unknown[]) => this.commands.get(id)?.(...args)
      }
    };
    const loader = Module as unknown as { _load: (request: string, parent: unknown, isMain: boolean) => unknown };
    const originalLoad = loader._load;
    loader._load = (request, parent, isMain) => {
      if (request === 'vscode') { return vscodeMock; }
      if (request === './diagram/efDiagramPanel') { return { openEfDiagramPanel: async () => undefined }; }
      if (request === './efModel') {
        return { loadEfModel: async () => this.model, migrationsForContext: (model: ProjectEfModel) => model.migrations, invalidateEfModel() {} };
      }
      return originalLoad(request, parent, isMain);
    };
    // All product modules used below retain their mock dependencies after loading.
    const { registerEfCommands } = require('../../ef/efCommands') as typeof import('../../ef/efCommands');
    this.dialog = require('../../ef/efDialog') as typeof import('../../ef/efDialog');
    loader._load = originalLoad;
    const feature = {
      getDetections: async () => this.projects.map(project => ({ project, startupCandidates: [project], hasDesignPackage: true, hasMigrationsFolder: true })),
      resolveStartupProject: (detection: EfProjectDetection) => this.startupResolver(detection),
      modelForProjectPath: (projectPath: string) => this.modelLoader(projectPath),
      findProject: (projectPath: string) => this.projects.find(project => project.path === projectPath),
      toolManager: {
        peekStatus: () => ({ installed: true, version: '11.0.0' }), ensureTool: async () => true,
        warnOnVersionMismatch: async () => undefined
      },
      configStore: { getLastContext: () => 'AppContext', setLastContext: async () => undefined, setStartupProject: async () => undefined },
      invalidateModel: () => { this.invalidations += 1; },
      cli: {
        run: async (request: EfCommandRequest) => { this.requests.push(request); return this.run(request); },
        showOutput: () => { this.outputShows += 1; }
      }
    };
    registerEfCommands({ subscriptions: [] } as unknown as import('vscode').ExtensionContext, feature as unknown as EfFeature);
  }

  migrations(applied: boolean | null): EfCommandResult {
    return { kind: 'success', stdout: JSON.stringify(this.model.migrations.map(m => ({ ...m, applied }))), stderr: '', durationMs: 1 };
  }
  values(patch: EfDialogValues = {}): EfDialogValues {
    return { project: this.project.path, startup: this.project.path, context: 'AppContext', connection: '',
      configuration: 'Debug', noBuild: false, extraArgs: '', target: '', add: false, ...patch };
  }
  async open(action = 'dotnav.ef.updateDatabase'): Promise<EfTestPanel> {
    this.opened = Promise.resolve(this.commands.get(action)!(this.project.path));
    await flushEfMessages();
    const panel = this.panels.at(-1)!;
    await panel.receive({ type: 'ready' });
    return panel;
  }
  async close(): Promise<void> {
    this.dialog.disposeEfCenter();
    await this.opened;
  }
}
