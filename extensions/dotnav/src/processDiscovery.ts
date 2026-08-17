import { exec } from 'child_process';
import * as path from 'path';
import { ProjectModel, SolutionModel } from './models';

export interface DotnetProcessInfo {
  readonly pid: number;
  readonly commandLine: string;
  readonly matchingProject?: ProjectModel;
  readonly label: string;
  readonly description?: string;
  readonly detail?: string;
}

export async function listDotnetProcesses(solution?: SolutionModel): Promise<DotnetProcessInfo[]> {
  const rawList = await querySystemProcesses();
  const results: DotnetProcessInfo[] = [];
  const projects = solution?.projects ?? [];

  for (const raw of rawList) {
    if (!isLikelyDotnetProcess(raw.commandLine, raw.executablePath)) {
      continue;
    }

    const matchingProject = findMatchingProject(raw.commandLine, projects);
    const label = matchingProject
      ? `$(play) ${matchingProject.name}`
      : `$(symbol-event) ${extractProcessName(raw.commandLine, raw.executablePath)}`;
    const description = `PID: ${raw.pid}${matchingProject ? ' · (This Solution)' : ''}`;
    const detail = raw.commandLine;

    results.push({
      pid: raw.pid,
      commandLine: raw.commandLine,
      matchingProject,
      label,
      description,
      detail
    });
  }

  // Sort solution projects first, then by PID descending
  results.sort((a, b) => {
    if (a.matchingProject && !b.matchingProject) return -1;
    if (!a.matchingProject && b.matchingProject) return 1;
    return b.pid - a.pid;
  });

  return results;
}

export function createAttachConfiguration(pid: number, label?: string): { name: string; type: string; request: string; processId: number } {
  return {
    name: label ? `Attach: ${label} (${pid})` : `Attach to Process (${pid})`,
    type: 'coreclr',
    request: 'attach',
    processId: pid
  };
}

interface RawProcess {
  readonly pid: number;
  readonly commandLine: string;
  readonly executablePath?: string;
}

async function querySystemProcesses(): Promise<RawProcess[]> {
  return new Promise(resolve => {
    const isWindows = process.platform === 'win32';
    const command = isWindows
      ? 'powershell -NoProfile -Command "Get-CimInstance Win32_Process | Select-Object ProcessId, CommandLine, ExecutablePath | ConvertTo-Json -Compress"'
      : 'ps -eo pid,command';

    exec(command, { maxBuffer: 10 * 1024 * 1024, timeout: 5000 }, (error, stdout) => {
      if (error || !stdout) {
        resolve([]);
        return;
      }

      if (isWindows) {
        try {
          const parsed = JSON.parse(stdout);
          const list = Array.isArray(parsed) ? parsed : [parsed];
          const processes: RawProcess[] = list
            .filter((p: { ProcessId?: number }) => typeof p?.ProcessId === 'number')
            .map((p: { ProcessId: number; CommandLine?: string; ExecutablePath?: string }) => ({
              pid: p.ProcessId,
              commandLine: p.CommandLine || p.ExecutablePath || '',
              executablePath: p.ExecutablePath
            }));
          resolve(processes);
        } catch {
          resolve([]);
        }
      } else {
        const lines = stdout.split(/\r?\n/);
        const processes: RawProcess[] = [];
        for (const line of lines) {
          const match = line.trim().match(/^(\d+)\s+(.+)$/);
          if (match) {
            processes.push({
              pid: parseInt(match[1], 10),
              commandLine: match[2]
            });
          }
        }
        resolve(processes);
      }
    });
  });
}

export function isLikelyDotnetProcess(commandLine: string, executablePath?: string): boolean {
  if (!commandLine && !executablePath) return false;
  const lower = (commandLine + ' ' + (executablePath || '')).toLowerCase();
  if (lower.includes('dotnet') || lower.includes('.dll')) {
    if (lower.includes('omnisharp') || lower.includes('buildhost') || lower.includes('roslyn')) {
      return false;
    }
    return true;
  }
  return false;
}

export function findMatchingProject(commandLine: string, projects: readonly ProjectModel[]): ProjectModel | undefined {
  if (!commandLine || !projects.length) return undefined;
  const lowerCmd = commandLine.toLowerCase();

  for (const project of projects) {
    const assemblyName = (project.assemblyName ?? project.name).toLowerCase();
    const dllName = `${assemblyName}.dll`;
    const projDir = project.directory.toLowerCase();

    if (lowerCmd.includes(dllName) || (lowerCmd.includes(projDir) && lowerCmd.includes('dotnet'))) {
      return project;
    }
  }

  return undefined;
}

export function extractProcessName(commandLine: string, executablePath?: string): string {
  const target = executablePath || (commandLine.match(/([^\s"']+\.(?:dll|exe))/i)?.[1]);
  if (target) {
    return target.split(/[\\/]/).pop() ?? target;
  }
  return commandLine.slice(0, 40);
}
