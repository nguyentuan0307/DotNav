import * as path from 'path';
import * as vscode from 'vscode';
import { ProjectModel, SolutionModel } from './models';
import { samePath } from './pathUtils';
import { ProcessManager } from './processManager';

export type SolutionOperation = 'build' | 'rebuild' | 'clean';

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
  processManager: ProcessManager
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
  const folderName = path.basename(folderPath);

  await vscode.window.withProgress({
    location: vscode.ProgressLocation.Notification,
    cancellable: true,
    title: `Build ${folderName} (${projects.length} projects)`
  }, async (progress, token) => {
    for (let index = 0; index < projects.length; index++) {
      if (token.isCancellationRequested) return;
      const project = projects[index];
      progress.report({ message: `${index + 1}/${projects.length} ${project.name}` });
      const task = new vscode.Task(
        { type: 'dotnet', task: 'build-folder', project: project.path, folder: folderPath },
        vscode.TaskScope.Workspace,
        `build ${project.name}`,
        '.NET Navigator',
        new vscode.ProcessExecution('dotnet', ['build', project.path, '--configuration', configuration], { cwd: project.directory }),
        ['$msCompile']
      );
      let execution: vscode.TaskExecution;
      try { execution = await vscode.tasks.executeTask(task); }
      catch (error) {
        vscode.window.showErrorMessage(`Could not build ${project.name}: ${error instanceof Error ? error.message : String(error)}`);
        return;
      }
      const binding = processManager.trackTask(project, 'build', execution);
      const cancellation = token.onCancellationRequested(() => { void processManager.stopRun(binding.runId); });
      try {
        const exitCode = await processManager.waitForTask(execution, timeoutMs);
        if (token.isCancellationRequested) return;
        if (exitCode !== 0) {
          vscode.window.showErrorMessage(`Build stopped: ${project.name} failed (${index + 1}/${projects.length}).`);
          return;
        }
      } catch (error) {
        processManager.terminateTimedOutTask(binding.runId, binding.targetId, execution, {
          code: 'build-timeout', message: `Build timed out for ${project.name}.`,
          cause: error instanceof Error ? error.message : String(error)
        });
        vscode.window.showErrorMessage(`Build timed out for ${project.name}.`);
        return;
      } finally { cancellation.dispose(); }
    }
    vscode.window.showInformationMessage(`Build succeeded for ${projects.length} project${projects.length === 1 ? '' : 's'} under ${folderName}.`);
  });
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
