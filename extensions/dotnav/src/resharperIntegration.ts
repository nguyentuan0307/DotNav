import * as path from 'path';
import * as vscode from 'vscode';
import { RESHARPER_EXTENSION_ID, setReSharperReady } from './engineDetector';

export type ReSharperBuildTarget = 'Build' | 'Rebuild' | 'Clean';

export class ReSharperBuildRequest {
  constructor(
    readonly target: ReSharperBuildTarget,
    readonly projectFiles: string[],
    readonly label: string
  ) {}
}

interface StoredBuildBeforeLaunchSetting {
  readonly hasGlobalValue: boolean;
  readonly globalValue?: boolean;
}

const buildBeforeLaunchSetting = 'buildBeforeLaunch';
const ownershipStateKey = 'dotnav.resharper.buildBeforeLaunch.previous';
const defaultReadinessTimeoutMs = 10_000;
const defaultReadinessPollMs = 250;

let activeIntegration: ReSharperIntegration | undefined;

export function initializeReSharperIntegration(context: vscode.ExtensionContext): ReSharperIntegration {
  activeIntegration?.dispose();
  activeIntegration = new ReSharperIntegration(context);
  return activeIntegration;
}

export function getReSharperIntegration(): ReSharperIntegration {
  if (!activeIntegration) {
    throw new Error('DotNav ReSharper integration has not been initialized. Reload the extension host and try again.');
  }
  return activeIntegration;
}

export async function disposeReSharperIntegration(): Promise<void> {
  const integration = activeIntegration;
  activeIntegration = undefined;
  if (integration) {
    await integration.restoreBuildOwnership();
    integration.dispose();
  }
}

export class ReSharperIntegration implements vscode.Disposable {
  private readonly output = vscode.window.createOutputChannel('DotNav ReSharper');
  private disposed = false;
  private ready = false;
  private ownershipQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly readinessTimeoutMs = defaultReadinessTimeoutMs,
    private readonly readinessPollMs = defaultReadinessPollMs
  ) {}

  async refreshReadiness(): Promise<boolean> {
    try {
      await this.ensureBuildTaskAvailable('Build');
      const commands = await vscode.commands.getCommands();
      const ready = ['build', 'rebuild', 'clean'].every(target => commands.includes(`resharper.solution.${target}`));
      this.ready = ready;
      setReSharperReady(ready);
      this.log(new ReSharperBuildRequest('Build', [], 'readiness'), ready ? 'integration ready' : 'solution commands unavailable');
      return ready;
    } catch (error) {
      this.ready = false;
      setReSharperReady(false);
      this.log(new ReSharperBuildRequest('Build', [], 'readiness'), `readiness failed: ${errorMessage(error)}`);
      return false;
    }
  }

  async executeSolutionBuild(request: ReSharperBuildRequest): Promise<vscode.TaskExecution> {
    await this.ensureBuildTaskAvailable(request.target);
    const commandId = `resharper.solution.${request.target.toLowerCase()}`;
    const commands = await vscode.commands.getCommands();
    if (!commands.includes(commandId)) {
      this.ready = false;
      setReSharperReady(false);
      throw this.failure(request, `ReSharper command '${commandId}' is not available. Ensure the selected solution is open in ReSharper.`);
    }

    this.log(request, 'starting native solution command');
    let subscription: vscode.Disposable | undefined;
    let timer: NodeJS.Timeout | undefined;
    const started = new Promise<vscode.TaskExecution>((resolve, reject) => {
      subscription = vscode.tasks.onDidStartTask(event => {
        const definition = event.execution.task.definition;
        if (definition.type !== 'resharper-build'
          || String(definition.target).toLowerCase() !== request.target.toLowerCase()) {
          return;
        }
        if (timer) clearTimeout(timer);
        subscription?.dispose();
        resolve(event.execution);
      });
      timer = setTimeout(() => {
        subscription?.dispose();
        reject(this.failure(request, 'ReSharper command did not start a build task within 10 seconds. Ensure the same solution is open in ReSharper.'));
      }, this.readinessTimeoutMs);
    });
    try {
      await vscode.commands.executeCommand(commandId);
      return await started;
    } catch (error) {
      this.ready = false;
      setReSharperReady(false);
      throw this.failure(request, `ReSharper could not start the solution operation: ${errorMessage(error)}`);
    } finally {
      if (timer) clearTimeout(timer);
      subscription?.dispose();
    }
  }

  async executeBuild(request: ReSharperBuildRequest): Promise<vscode.TaskExecution> {
    const template = await this.ensureBuildTaskAvailable(request.target);
    if (!template.execution) {
      throw this.failure(request, `ReSharper returned an unresolved ${request.target} task.`);
    }

    const projectFiles = uniqueAbsolutePaths(request.projectFiles);
    const definition: vscode.TaskDefinition = {
      ...template.definition,
      type: 'resharper-build',
      target: request.target,
      projectFiles
    };
    const task = new vscode.Task(
      definition,
      vscode.TaskScope.Workspace,
      request.label,
      'ReSharper',
      template.execution,
      template.problemMatchers
    );
    task.group = template.group;
    this.log(new ReSharperBuildRequest(request.target, projectFiles, request.label), 'starting resolved build task');
    try {
      return await vscode.tasks.executeTask(task);
    } catch (error) {
      this.ready = false;
      setReSharperReady(false);
      throw this.failure(request, `ReSharper could not start the build task: ${errorMessage(error)}`);
    }
  }

  syncBuildOwnership(isReSharperActive: boolean): Promise<void> {
    return this.queueOwnership(() => isReSharperActive
      ? this.takeBuildOwnership()
      : this.restoreBuildOwnershipCore());
  }

  restoreBuildOwnership(): Promise<void> {
    return this.queueOwnership(() => this.restoreBuildOwnershipCore());
  }

  private async takeBuildOwnership(): Promise<void> {
    const configuration = vscode.workspace.getConfiguration('resharper.runAndDebug.dotnet');
    if (configuration.inspect<boolean>(buildBeforeLaunchSetting)?.workspaceValue !== undefined) {
      await configuration.update(buildBeforeLaunchSetting, undefined, vscode.ConfigurationTarget.Workspace);
    }
    const stored = this.context.globalState.get<StoredBuildBeforeLaunchSetting>(ownershipStateKey);
    if (!stored) {
      const inspected = configuration.inspect<boolean>(buildBeforeLaunchSetting);
      await this.context.globalState.update(ownershipStateKey, {
        hasGlobalValue: inspected?.globalValue !== undefined,
        globalValue: inspected?.globalValue
      } satisfies StoredBuildBeforeLaunchSetting);
    }
    if (configuration.inspect<boolean>(buildBeforeLaunchSetting)?.globalValue !== false) {
      await configuration.update(buildBeforeLaunchSetting, false, vscode.ConfigurationTarget.Global);
    }
  }

  private async restoreBuildOwnershipCore(): Promise<void> {
    const stored = this.context.globalState.get<StoredBuildBeforeLaunchSetting>(ownershipStateKey);
    if (!stored) {
      return;
    }

    const configuration = vscode.workspace.getConfiguration('resharper.runAndDebug.dotnet');
    const currentGlobalValue = configuration.inspect<boolean>(buildBeforeLaunchSetting)?.globalValue;
    if (currentGlobalValue === false) {
      await configuration.update(
        buildBeforeLaunchSetting,
        stored.hasGlobalValue ? stored.globalValue : undefined,
        vscode.ConfigurationTarget.Global
      );
    }
    await this.context.globalState.update(ownershipStateKey, undefined);
  }

  private queueOwnership(action: () => Promise<void>): Promise<void> {
    const queued = this.ownershipQueue.then(action, action);
    this.ownershipQueue = queued.catch(() => undefined);
    return queued;
  }

  async openExplorerForReload(): Promise<void> {
    await this.activateExtension();
    const commands = await vscode.commands.getCommands();
    if (!commands.includes('resharper.solutionExplorer.focus')) {
      throw new Error('ReSharper Solution Explorer is not ready. Open the ReSharper solution and try again.');
    }
    await vscode.commands.executeCommand('resharper.solutionExplorer.focus');
    vscode.window.showInformationMessage('Select the solution or project in ReSharper Solution Explorer, then run its native Reload command.');
  }

  showOutput(): void {
    this.output.show(true);
  }

  dispose(): void {
    if (!this.disposed) {
      this.disposed = true;
      this.output.dispose();
    }
  }

  private async ensureBuildTaskAvailable(target: ReSharperBuildTarget): Promise<vscode.Task> {
    try {
      await this.activateExtension();
    } catch (error) {
      this.log(new ReSharperBuildRequest(target, [], 'readiness'), `activation failed: ${errorMessage(error)}`);
      throw error;
    }
    const deadline = Date.now() + this.readinessTimeoutMs;
    let lastError: unknown;
    while (Date.now() < deadline) {
      try {
        const tasks = await vscode.tasks.fetchTasks({ type: 'resharper-build' });
        const task = tasks.find(candidate =>
          candidate.definition.type === 'resharper-build'
          && String(candidate.definition.target).toLowerCase() === target.toLowerCase()
          && Boolean(candidate.execution)
        );
        if (task) {
          this.ready = true;
          setReSharperReady(true);
          return task;
        }
      } catch (error) {
        lastError = error;
      }
      await delay(this.readinessPollMs);
    }

    this.ready = false;
    setReSharperReady(false);
    const detail = lastError ? ` Last error: ${errorMessage(lastError)}` : '';
    const message = `ReSharper Build is not ready. Ensure the same solution is open in ReSharper.${detail}`;
    this.log(new ReSharperBuildRequest(target, [], 'readiness'), message);
    throw new Error(message);
  }

  private async activateExtension(): Promise<void> {
    const extension = vscode.extensions.getExtension(RESHARPER_EXTENSION_ID);
    if (!extension) {
      this.ready = false;
      setReSharperReady(false);
      throw new Error(`JetBrains ReSharper (${RESHARPER_EXTENSION_ID}) is not installed.`);
    }
    try {
      if (!extension.isActive) {
        await extension.activate();
      }
    } catch (error) {
      this.ready = false;
      setReSharperReady(false);
      throw new Error(`Could not activate JetBrains ReSharper: ${errorMessage(error)}`);
    }
  }

  private failure(request: ReSharperBuildRequest, message: string): Error {
    this.log(request, message);
    return new Error(message);
  }

  private log(request: ReSharperBuildRequest, message: string): void {
    const projects = request.projectFiles.length > 0
      ? uniqueAbsolutePaths(request.projectFiles).join(', ')
      : '<whole solution>';
    const extension = vscode.extensions.getExtension(RESHARPER_EXTENSION_ID);
    this.output.appendLine(
      `[${new Date().toISOString()}] ${message}; target=${request.target}; projects=${projects}; installed=${Boolean(extension)}; active=${Boolean(extension?.isActive)}; ready=${this.ready}`
    );
  }
}

function uniqueAbsolutePaths(projectFiles: readonly string[]): string[] {
  const paths = new Map<string, string>();
  for (const projectFile of projectFiles) {
    const absolute = path.resolve(projectFile);
    const key = process.platform === 'win32' ? absolute.toLowerCase() : absolute;
    if (!paths.has(key)) {
      paths.set(key, absolute);
    }
  }
  return [...paths.values()];
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function delay(milliseconds: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}
