import * as path from 'path';
import * as os from 'os';
import { spawn, ChildProcessWithoutNullStreams } from 'child_process';
import { promises as fs } from 'fs';
import * as vscode from 'vscode';
import { ProjectModel, SolutionModel } from './models';
import { samePath } from './pathUtils';
import { ProcessManager } from './processManager';
import { createFolderBuildProject, normalizeMaxParallelBuilds } from './folderBuild';

export type SolutionOperation = 'build' | 'rebuild' | 'clean';

export interface DotnetPackageCommandResult {
  readonly exitCode: number | undefined;
  readonly stdout: string;
  readonly stderr: string;
}

export async function runDotnetPackageCommand(
  cwd: string,
  args: string[],
  title: string
): Promise<DotnetPackageCommandResult> {
  return vscode.window.withProgress({
    location: vscode.ProgressLocation.Notification,
    cancellable: true,
    title
  }, async (_progress, token) => {
    let terminal: CapturingDotnetTerminal | undefined;
    const task = new vscode.Task(
      { type: 'dotnet', task: 'package', args },
      vscode.TaskScope.Workspace,
      title,
      '.NET Navigator',
      new vscode.CustomExecution(async () => {
        terminal = new CapturingDotnetTerminal(cwd, args);
        return terminal;
      })
    );

    let taskEndSubscription: vscode.Disposable | undefined;
    const completion = new Promise<number | undefined>(resolve => {
      taskEndSubscription = vscode.tasks.onDidEndTaskProcess(event => {
        if (event.execution.task === task) {
          taskEndSubscription?.dispose();
          resolve(event.exitCode);
        }
      });
    });

    let execution: vscode.TaskExecution;
    try {
      execution = await vscode.tasks.executeTask(task);
    } catch (error) {
      taskEndSubscription?.dispose();
      const message = `Could not start dotnet: ${error instanceof Error ? error.message : String(error)}`;
      vscode.window.showErrorMessage(message);
      return { exitCode: undefined, stdout: '', stderr: message };
    }

    const cancellation = token.onCancellationRequested(() => {
      terminal?.close();
      execution.terminate();
    });
    const exitCode = await completion;
    cancellation.dispose();

    const result = {
      exitCode,
      stdout: terminal?.stdout ?? '',
      stderr: terminal?.stderr ?? ''
    };
    if (!token.isCancellationRequested && exitCode !== 0) {
      const detail = result.stderr.trim().split(/\r?\n/).pop();
      vscode.window.showErrorMessage(
        `${title} failed${exitCode === undefined ? '' : ` (exit code ${exitCode})`}${detail ? `: ${detail}` : '.'}`
      );
    }
    return result;
  });
}

class CapturingDotnetTerminal implements vscode.Pseudoterminal {
  private readonly writeEmitter = new vscode.EventEmitter<string>();
  readonly onDidWrite = this.writeEmitter.event;
  private readonly closeEmitter = new vscode.EventEmitter<number>();
  readonly onDidClose = this.closeEmitter.event;
  private process?: ChildProcessWithoutNullStreams;
  private didClose = false;
  stdout = '';
  stderr = '';

  constructor(private readonly cwd: string, private readonly args: string[]) {}

  open(): void {
    this.process = spawn('dotnet', this.args, { cwd: this.cwd, windowsHide: true });
    this.process.stdout.on('data', chunk => {
      const text = chunk.toString();
      this.stdout += text;
      this.writeEmitter.fire(toTerminalText(text));
    });
    this.process.stderr.on('data', chunk => {
      const text = chunk.toString();
      this.stderr += text;
      this.writeEmitter.fire(toTerminalText(text));
    });
    this.process.on('error', error => {
      const text = `${error.message}\n`;
      this.stderr += text;
      this.writeEmitter.fire(toTerminalText(text));
      this.finish(1);
    });
    this.process.on('close', code => {
      this.finish(code ?? 1);
    });
  }

  close(): void {
    if (this.process && !this.process.killed) {
      this.process.kill();
    }
  }

  private finish(exitCode: number): void {
    if (!this.didClose) {
      this.didClose = true;
      this.closeEmitter.fire(exitCode);
    }
  }
}

function toTerminalText(value: string): string {
  return value.replace(/\r?\n/g, '\r\n');
}

export async function runDotnetForProject(
  project: ProjectModel,
  verb: 'build' | 'rebuild' | 'test' | 'clean',
  processManager?: ProcessManager
): Promise<void> {
  const command = verb === 'rebuild'
    ? `dotnet build "${project.path}" --no-incremental`
    : `dotnet ${verb} "${project.path}"`;
  const task = new vscode.Task(
    { type: 'dotnet', task: verb, project: project.path },
    vscode.TaskScope.Workspace,
    `${verb} ${project.name}`,
    '.NET Navigator',
    new vscode.ShellExecution(command, { cwd: project.directory }),
    ['$msCompile']
  );

  if (!processManager) {
    await vscode.tasks.executeTask(task);
    return;
  }
  if (processManager.getProjectPhase(project)) {
    vscode.window.showInformationMessage(`${project.name} already has an active operation.`);
    return;
  }

  await vscode.window.withProgress({
    location: vscode.ProgressLocation.Notification,
    cancellable: true,
    title: `${operationLabel(verb)} ${project.name}`
  }, async (_progress, token) => {
    let execution: vscode.TaskExecution;
    try {
      execution = await vscode.tasks.executeTask(task);
    } catch (error) {
      vscode.window.showErrorMessage(
        `Could not start ${verb}: ${error instanceof Error ? error.message : String(error)}`
      );
      return;
    }
    const binding = processManager.trackTask(project, verb, execution);
    const cancellation = token.onCancellationRequested(() => {
      void processManager.stopRun(binding.runId);
    });
    const timeoutMs = Math.max(1, vscode.workspace
      .getConfiguration('dotnav')
      .get<number>('buildTimeoutSeconds', 600)) * 1000;
    try {
      await processManager.waitForTask(execution, timeoutMs);
    } catch (error) {
      processManager.terminateTimedOutTask(binding.runId, binding.targetId, execution, {
        code: 'build-timeout',
        message: `${operationLabel(verb)} timed out for ${project.name}.`,
        cause: error instanceof Error ? error.message : String(error)
      });
      vscode.window.showErrorMessage(`${operationLabel(verb)} timed out for ${project.name}.`);
    } finally {
      cancellation.dispose();
    }
  });
}

export async function runDotnetForSolution(
  solution: SolutionModel,
  operation: SolutionOperation,
  processManager: ProcessManager
): Promise<void> {
  if (!solution.path) {
    vscode.window.showInformationMessage('Open a .sln or .slnx file before running a solution operation.');
    return;
  }
  const solutionPath = solution.path;
  if (processManager.getActiveSessions().some(session =>
    session.targets.some(target => samePath(target.projectPath, solutionPath))
  )) {
    vscode.window.showInformationMessage(`${path.basename(solutionPath)} already has an active operation.`);
    return;
  }

  const configuration = vscode.workspace
    .getConfiguration('dotnav')
    .get<string>('buildConfiguration', 'Debug');
  const args = operation === 'rebuild'
    ? ['build', solutionPath, '--configuration', configuration, '--no-incremental']
    : [operation, solutionPath, '--configuration', configuration];
  const target = solutionTaskTarget(solution);
  const task = new vscode.Task(
    { type: 'dotnet', task: operation, solution: solutionPath },
    vscode.TaskScope.Workspace,
    `${operation} ${path.basename(solutionPath)}`,
    '.NET Navigator',
    new vscode.ProcessExecution('dotnet', args, { cwd: path.dirname(solutionPath) }),
    ['$msCompile']
  );

  await vscode.window.withProgress({
    location: vscode.ProgressLocation.Notification,
    cancellable: true,
    title: `${operationLabel(operation)} ${path.basename(solutionPath)}`
  }, async (progress, token) => {
    progress.report({ message: configuration });
    let execution: vscode.TaskExecution;
    try {
      execution = await vscode.tasks.executeTask(task);
    } catch (error) {
      vscode.window.showErrorMessage(
        `Could not start ${operation}: ${error instanceof Error ? error.message : String(error)}`
      );
      return;
    }

    const binding = processManager.trackTask(target, operation, execution);
    const cancellation = token.onCancellationRequested(() => {
      void processManager.stopRun(binding.runId);
    });
    const timeoutMs = Math.max(1, vscode.workspace
      .getConfiguration('dotnav')
      .get<number>('buildTimeoutSeconds', 600)) * 1000;
    try {
      const exitCode = await processManager.waitForTask(execution, timeoutMs);
      if (token.isCancellationRequested) {
        return;
      }

      if (exitCode === 0) {
        vscode.window.showInformationMessage(`${operationLabel(operation)} succeeded for ${path.basename(solutionPath)}.`);
      } else {
        vscode.window.showErrorMessage(`${operationLabel(operation)} failed for ${path.basename(solutionPath)}.`);
      }
    } catch (error) {
      processManager.terminateTimedOutTask(binding.runId, binding.targetId, execution, {
        code: 'build-timeout',
        message: `${operationLabel(operation)} timed out for ${path.basename(solutionPath)}.`,
        cause: error instanceof Error ? error.message : String(error)
      });
      vscode.window.showErrorMessage(`${operationLabel(operation)} timed out for ${path.basename(solutionPath)}.`);
    } finally {
      cancellation.dispose();
    }
  });
}

export async function runDotnetForProjects(
  projects: ProjectModel[],
  folderPath: string,
  processManager: ProcessManager,
  folderLabel?: string
): Promise<void> {
  const busy = projects.find(project => processManager.getProjectPhase(project));
  if (busy) {
    vscode.window.showInformationMessage(`${busy.name} already has an active operation.`);
    return;
  }
  const configuration = vscode.workspace
    .getConfiguration('dotnav')
    .get<string>('buildConfiguration', 'Debug');
  const timeoutMs = Math.max(1, vscode.workspace
    .getConfiguration('dotnav')
    .get<number>('buildTimeoutSeconds', 600)) * 1000;
  const folderName = folderLabel ?? path.basename(folderPath);
  const maxParallelBuilds = normalizeMaxParallelBuilds(vscode.workspace
    .getConfiguration('dotnav')
    .get<number>('maxParallelBuilds', 6));
  let tempDirectory: string | undefined;

  try {
    tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'dotnav-build-'));
    const orchestrationPath = path.join(tempDirectory, 'folder-build.proj');
    await fs.writeFile(orchestrationPath, createFolderBuildProject(projects), 'utf8');

    await vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      cancellable: true,
      title: `Build ${folderName} (${projects.length} projects, ${maxParallelBuilds} workers)`
    }, async (progress, token) => {
      progress.report({ message: `${configuration} · up to ${maxParallelBuilds} parallel workers` });
      const task = new vscode.Task(
        { type: 'dotnet', task: 'build-folder', projects: projects.map(project => project.path), folder: folderPath },
        vscode.TaskScope.Workspace,
        `build ${folderName} (${projects.length} projects)`,
        '.NET Navigator',
        new vscode.ProcessExecution('dotnet', [
          'msbuild', orchestrationPath, `-maxCpuCount:${maxParallelBuilds}`, `-p:Configuration=${configuration}`
        ], { cwd: folderPath }),
        ['$msCompile']
      );
      const session = processManager.beginRun(
        `folder-build:${path.resolve(folderPath)}`,
        `build ${folderName}`,
        'build',
        projects.map(project => ({ project }))
      );
      let execution: vscode.TaskExecution;
      try {
        execution = await vscode.tasks.executeTask(task);
      }
      catch (error) {
        const message = `Could not start folder build: ${error instanceof Error ? error.message : String(error)}`;
        processManager.failRun(session.runId, { code: 'unexpected-exit', message });
        vscode.window.showErrorMessage(message);
        return;
      }
      const binding = processManager.trackTaskGroup(projects, 'build', execution, session.runId);
      const cancellation = token.onCancellationRequested(() => { void processManager.stopRun(binding.runId); });
      try {
        const exitCode = await processManager.waitForTask(execution, timeoutMs);
        if (token.isCancellationRequested) return;
        if (exitCode === 0) vscode.window.showInformationMessage(`Build succeeded for ${projects.length} project${projects.length === 1 ? '' : 's'} under ${folderName}.`);
        else if (exitCode === undefined) vscode.window.showErrorMessage(`Build ended without an exit code for ${folderName}.`);
        else vscode.window.showErrorMessage(`Build failed for projects under ${folderName} (exit code ${exitCode}).`);
      } catch (error) {
        processManager.terminateTimedOutRunTask(binding.runId, execution, {
          code: 'build-timeout', message: `Folder build timed out for ${folderName}.`,
          cause: error instanceof Error ? error.message : String(error)
        });
        vscode.window.showErrorMessage(`Folder build timed out for ${folderName}.`);
      } finally { cancellation.dispose(); }
    });
  } catch (error) {
    vscode.window.showErrorMessage(`Could not prepare folder build: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    if (tempDirectory) await fs.rm(tempDirectory, { recursive: true, force: true }).catch(() => undefined);
  }
}

function solutionTaskTarget(solution: SolutionModel): ProjectModel {
  return {
    name: path.basename(solution.path!),
    path: solution.path!,
    directory: path.dirname(solution.path!),
    relativePath: path.basename(solution.path!),
    kind: 'unknown',
    targetFrameworks: [],
    launchProfiles: [],
    packageReferences: [],
    projectReferences: []
  };
}

function operationLabel(operation: SolutionOperation | 'test'): string {
  switch (operation) {
    case 'build': return 'Build';
    case 'rebuild': return 'Rebuild';
    case 'clean': return 'Clean';
    case 'test': return 'Test';
  }
}

export function openTerminalAt(directory: string): void {
  const terminal = vscode.window.createTerminal({
    name: `.NET: ${path.basename(directory)}`,
    cwd: directory
  });
  terminal.show();
}
