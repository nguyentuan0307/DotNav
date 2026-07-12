import * as fs from 'fs/promises';
import type { Dirent } from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { LaunchProfile, ProjectModel, RunConfig, SolutionModel } from './models';
import { samePath } from './pathUtils';
import { ProcessManager } from './processManager';

interface StartOptions {
  readonly debug: boolean;
  readonly processManager?: ProcessManager;
  readonly runId?: string;
  readonly targetId?: string;
}

export async function pickProfile(project: ProjectModel): Promise<LaunchProfile | undefined | null> {
  if (project.launchProfiles.length === 0) {
    return undefined;
  }

  if (project.launchProfiles.length === 1) {
    return project.launchProfiles[0];
  }

  const picked = await vscode.window.showQuickPick(
    project.launchProfiles.map(profile => ({
      label: profile.name,
      description: profile.applicationUrl,
      profile
    })),
    { title: `Select launch profile for ${project.name}` }
  );

  return picked?.profile ?? null;
}

export async function startTarget(project: ProjectModel, profile: LaunchProfile | undefined, options: StartOptions): Promise<boolean> {
  let runId = options.runId;
  let targetId = options.targetId;
  if (options.processManager && (!runId || !targetId)) {
    try {
      const session = options.processManager.beginRun(
        `single:${project.path}::${profile?.name ?? 'Default'}`,
        `${project.name}: ${profile?.name ?? 'Default'}`,
        options.debug ? 'debug' : 'run',
        [{ project, profileName: profile?.name }]
      );
      runId = session.runId;
      targetId = session.targets[0].targetId;
    } catch (error) {
      vscode.window.showWarningMessage(error instanceof Error ? error.message : String(error));
      return false;
    }
  }

  if (shouldBuildBeforeRun()) {
    const built = await buildProject(project, options.processManager, runId, targetId);
    if (!built) {
      return false;
    }
  }

  let program: string;
  try {
    program = await resolveProgramPath(project);
  } catch (error) {
    if (options.processManager && runId && targetId) {
      options.processManager.failTarget(runId, targetId, {
        code: 'start-error',
        message: error instanceof Error ? error.message : String(error)
      });
    }
    vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error));
    return false;
  }

  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  const launchSettingsPath = path.join(project.directory, 'Properties', 'launchSettings.json');
  const name = `${options.debug ? 'Debug' : 'Run'} ${project.name}${profile ? ` (${profile.name})` : ''}`;
  const configuration: vscode.DebugConfiguration = {
    name,
    type: 'coreclr',
    request: 'launch',
    program,
    cwd: project.directory,
    args: parseCommandLineArgs(profile?.commandLineArgs),
    console: 'internalConsole',
    noDebug: !options.debug,
    dotnetSolutionNavigatorProjectPath: project.path,
    dotnetSolutionNavigatorRunId: runId,
    dotnetSolutionNavigatorTargetId: targetId
  };

  if (profile && await exists(launchSettingsPath)) {
    configuration.launchSettingsFilePath = launchSettingsPath;
    configuration.launchSettingsProfile = profile.name;
  }

  if (options.processManager && runId && targetId) {
    const currentTarget = options.processManager.getSession(runId)?.targets.find(target => target.targetId === targetId);
    if (!currentTarget || currentTarget.phase === 'stopped' || currentTarget.phase === 'stopping') {
      return false;
    }
    options.processManager.setTargetPhase(runId, targetId, 'starting');
    options.processManager.expectDebugSession(project, name, runId, targetId);
  }

  let started = false;
  try {
    started = await vscode.debug.startDebugging(workspaceFolder, configuration);
    if (!started) {
      if (options.processManager && runId && targetId) {
        options.processManager.failTarget(runId, targetId, {
          code: 'start-rejected',
          message: `Could not start ${project.name}.`
        });
      }
      vscode.window.showErrorMessage('Could not start .NET debugging. Install or enable C# Dev Kit / C# extension, then try again.');
    }
  } catch (error) {
    if (options.processManager && runId && targetId) {
      options.processManager.failTarget(runId, targetId, {
        code: 'start-error',
        message: `Could not start ${project.name}.`,
        cause: error instanceof Error ? error.message : String(error)
      });
    }
    vscode.window.showErrorMessage(`Could not start ${project.name}: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    if (!started) {
      options.processManager?.cancelExpectedDebugSession(project, runId, targetId);
    }
  }

  if (started && options.processManager && runId && targetId) {
    const currentTarget = options.processManager.getSession(runId)?.targets.find(target => target.targetId === targetId);
    if (currentTarget?.phase === 'stopping' || currentTarget?.phase === 'stopped') {
      return false;
    }
  }

  return started;
}

export async function resolveProgramPath(project: ProjectModel): Promise<string> {
  const configuration = buildConfiguration();
  const assemblyName = project.assemblyName ?? project.name;

  for (const targetFramework of project.targetFrameworks) {
    const candidate = path.join(project.directory, 'bin', configuration, targetFramework, `${assemblyName}.dll`);
    if (await exists(candidate)) {
      return candidate;
    }
  }

  const binDir = path.join(project.directory, 'bin', configuration);
  const fallback = await findFile(binDir, `${assemblyName}.dll`);
  if (fallback) {
    return fallback;
  }

  throw new Error(`Could not find ${assemblyName}.dll. Build ${project.name} first or check its output path.`);
}

export async function buildProject(
  project: ProjectModel,
  processManager?: ProcessManager,
  runId?: string,
  targetId?: string
): Promise<boolean> {
  const configuration = buildConfiguration();
  const task = new vscode.Task(
    { type: 'dotnet', task: 'build', project: project.path },
    vscode.TaskScope.Workspace,
    `build ${project.name}`,
    '.NET Navigator',
    new vscode.ShellExecution(`dotnet build "${project.path}" --configuration ${configuration}`, { cwd: project.directory }),
    ['$msCompile']
  );

  let execution: vscode.TaskExecution;
  try {
    execution = await vscode.tasks.executeTask(task);
  } catch (error) {
    if (processManager && runId && targetId) {
      processManager.failTarget(runId, targetId, {
        code: 'build-failed',
        message: `Could not start the build for ${project.name}.`,
        cause: error instanceof Error ? error.message : String(error)
      });
    }
    vscode.window.showErrorMessage(`Could not start the build for ${project.name}: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
  const binding = processManager?.trackTask(project, 'build', execution, runId, targetId);
  if (!processManager) {
    return waitForUnmanagedTask(execution, project.name);
  }

  const timeoutMs = Math.max(1, vscode.workspace
    .getConfiguration('dotnetSolutionNavigator')
    .get<number>('buildTimeoutSeconds', 600)) * 1000;
  try {
    const exitCode = await processManager.waitForTask(execution, timeoutMs);
    const currentTarget = binding
      ? processManager.getSession(binding.runId)?.targets.find(target => target.targetId === binding.targetId)
      : undefined;
    if (currentTarget?.phase === 'stopped' || currentTarget?.phase === 'stopping') {
      return false;
    }
    const ok = exitCode === 0;
    if (!ok) {
      if (binding) {
        processManager.failTarget(binding.runId, binding.targetId, {
          code: 'build-failed',
          message: `Build failed for ${project.name}${exitCode === undefined ? '' : ` with exit code ${exitCode}`}.`
        });
      }
      vscode.window.showErrorMessage(`Build failed for ${project.name}.`);
    }
    return ok;
  } catch (error) {
    if (binding) {
      processManager.failTarget(binding.runId, binding.targetId, {
        code: 'build-timeout',
        message: `Build timed out for ${project.name}.`,
        cause: error instanceof Error ? error.message : String(error)
      });
    }
    execution.terminate();
    vscode.window.showErrorMessage(`Build timed out for ${project.name}.`);
    return false;
  }
}

export async function runConfig(
  solution: SolutionModel,
  config: RunConfig,
  options: { debug: boolean; processManager?: ProcessManager }
): Promise<void> {
  const resolvedTargets = config.targets.map(target => resolveTarget(solution, target.projectPath, target.profileName));
  const missingTarget = resolvedTargets.findIndex(target => !target.project);
  if (missingTarget >= 0) {
    vscode.window.showWarningMessage(`Project not found: ${config.targets[missingTarget].projectPath}`);
    return;
  }

  let session: ReturnType<ProcessManager['beginRun']> | undefined;
  if (options.processManager) {
    try {
      session = options.processManager.beginRun(
        config.id,
        config.label,
        options.debug ? 'debug' : 'run',
        resolvedTargets.map(target => ({ project: target.project!, profileName: target.profile?.name }))
      );
    } catch (error) {
      const choice = await vscode.window.showWarningMessage(
        error instanceof Error ? error.message : String(error),
        'Stop existing run'
      );
      if (choice === 'Stop existing run') {
        await options.processManager.stopConfig(config.id);
      }
      return;
    }
  }

  for (const [index, target] of config.targets.entries()) {
    const resolved = resolvedTargets[index];
    if (!resolved.project) {
      return;
    }

    const started = await startTarget(resolved.project, resolved.profile, {
      debug: options.debug,
      processManager: options.processManager,
      runId: session?.runId,
      targetId: session?.targets[index].targetId
    });

    if (!started) {
      if (session) {
        await options.processManager?.stopRun(session.runId);
      }
      break;
    }
  }
}

function waitForUnmanagedTask(execution: vscode.TaskExecution, projectName: string): Promise<boolean> {
  return new Promise(resolve => {
    const processDisposable = vscode.tasks.onDidEndTaskProcess(event => {
      if (event.execution === execution) {
        processDisposable.dispose();
        taskDisposable.dispose();
        resolve(event.exitCode === 0);
      }
    });
    const taskDisposable = vscode.tasks.onDidEndTask(event => {
      if (event.execution === execution) {
        setTimeout(() => {
          processDisposable.dispose();
          taskDisposable.dispose();
          vscode.window.showErrorMessage(`Could not determine build result for ${projectName}.`);
          resolve(false);
        }, 1000);
      }
    });
  });
}

export async function buildConfig(
  solution: SolutionModel,
  config: RunConfig,
  processManager?: ProcessManager
): Promise<void> {
  const resolvedTargets = config.targets.map(target => resolveTarget(solution, target.projectPath, target.profileName));
  const missingTarget = resolvedTargets.findIndex(target => !target.project);
  if (missingTarget >= 0) {
    vscode.window.showWarningMessage(`Project not found: ${config.targets[missingTarget].projectPath}`);
    return;
  }

  let session: ReturnType<ProcessManager['beginRun']> | undefined;
  if (processManager) {
    try {
      session = processManager.beginRun(
        config.id,
        config.label,
        'build',
        resolvedTargets.map(target => ({ project: target.project!, profileName: target.profile?.name }))
      );
    } catch (error) {
      vscode.window.showWarningMessage(error instanceof Error ? error.message : String(error));
      return;
    }
  }

  for (const [index, resolved] of resolvedTargets.entries()) {
    const built = await buildProject(
      resolved.project!,
      processManager,
      session?.runId,
      session?.targets[index].targetId
    );
    if (!built) {
      if (session) {
        await processManager?.stopRun(session.runId);
      }
      return;
    }
  }
}

function resolveTarget(solution: SolutionModel, projectPath: string, profileName?: string): { project?: ProjectModel; profile?: LaunchProfile } {
  const project = solution.projects.find(candidate => samePath(candidate.path, projectPath));
  const profile = project && profileName
    ? project.launchProfiles.find(candidate => candidate.name === profileName)
    : undefined;

  return { project, profile };
}

function shouldBuildBeforeRun(): boolean {
  return vscode.workspace
    .getConfiguration('dotnetSolutionNavigator')
    .get<boolean>('buildBeforeRun', true);
}

function buildConfiguration(): string {
  return vscode.workspace
    .getConfiguration('dotnetSolutionNavigator')
    .get<string>('buildConfiguration', 'Debug');
}

async function findFile(directory: string, fileName: string): Promise<string | undefined> {
  let entries: Dirent[];
  try {
    entries = await fs.readdir(directory, { withFileTypes: true });
  } catch {
    return undefined;
  }

  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isFile() && entry.name.toLowerCase() === fileName.toLowerCase()) {
      return fullPath;
    }

    if (entry.isDirectory()) {
      const found = await findFile(fullPath, fileName);
      if (found) {
        return found;
      }
    }
  }

  return undefined;
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function parseCommandLineArgs(value: string | undefined): string[] {
  if (!value) {
    return [];
  }

  const args: string[] = [];
  const regex = /"([^"]*)"|'([^']*)'|[^\s]+/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(value)) !== null) {
    args.push(match[1] ?? match[2] ?? match[0]);
  }

  return args;
}
