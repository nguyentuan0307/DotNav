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
  if (shouldBuildBeforeRun()) {
    const built = await buildProject(project, options.processManager);
    if (!built) {
      return false;
    }
  }

  let program: string;
  try {
    program = await resolveProgramPath(project);
  } catch (error) {
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
    dotnetSolutionNavigatorProjectPath: project.path
  };

  if (profile && await exists(launchSettingsPath)) {
    configuration.launchSettingsFilePath = launchSettingsPath;
    configuration.launchSettingsProfile = profile.name;
  }

  options.processManager?.expectDebugSession(project, name);
  const started = await vscode.debug.startDebugging(workspaceFolder, configuration);
  if (!started) {
    options.processManager?.cancelExpectedDebugSession(project);
    vscode.window.showErrorMessage('Could not start .NET debugging. Install or enable C# Dev Kit / C# extension, then try again.');
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

export async function buildProject(project: ProjectModel, processManager?: ProcessManager): Promise<boolean> {
  const configuration = buildConfiguration();
  const task = new vscode.Task(
    { type: 'dotnet', task: 'build', project: project.path },
    vscode.TaskScope.Workspace,
    `build ${project.name}`,
    '.NET Navigator',
    new vscode.ShellExecution(`dotnet build "${project.path}" --configuration ${configuration}`, { cwd: project.directory }),
    ['$msCompile']
  );

  const execution = await vscode.tasks.executeTask(task);
  processManager?.trackTask(project, 'build', execution);

  return new Promise(resolve => {
    let finished = false;
    let fallbackTimer: NodeJS.Timeout | undefined;
    const finish = (ok: boolean) => {
      if (finished) {
        return;
      }

      finished = true;
      if (fallbackTimer) {
        clearTimeout(fallbackTimer);
      }

      processDisposable.dispose();
      taskDisposable.dispose();
      if (!ok) {
        vscode.window.showErrorMessage(`Build failed for ${project.name}.`);
      }

      resolve(ok);
    };

    const processDisposable = vscode.tasks.onDidEndTaskProcess(event => {
      if (event.execution === execution) {
        finish(event.exitCode === 0);
      }
    });

    const taskDisposable = vscode.tasks.onDidEndTask(event => {
      if (event.execution === execution) {
        fallbackTimer = setTimeout(() => finish(false), 1000);
      }
    });
  });
}

export async function runConfig(
  solution: SolutionModel,
  config: RunConfig,
  options: { debug: boolean; processManager?: ProcessManager }
): Promise<void> {
  for (const target of config.targets) {
    const resolved = resolveTarget(solution, target.projectPath, target.profileName);
    if (!resolved.project) {
      vscode.window.showWarningMessage(`Project not found: ${target.projectPath}`);
      continue;
    }

    const started = await startTarget(resolved.project, resolved.profile, {
      debug: options.debug,
      processManager: options.processManager
    });

    if (!started) {
      break;
    }
  }
}

export async function buildConfig(
  solution: SolutionModel,
  config: RunConfig,
  processManager?: ProcessManager
): Promise<void> {
  for (const target of config.targets) {
    const resolved = resolveTarget(solution, target.projectPath, target.profileName);
    if (resolved.project) {
      await buildProject(resolved.project, processManager);
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
