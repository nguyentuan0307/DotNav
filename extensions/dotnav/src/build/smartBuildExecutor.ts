import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { normalizeMaxParallelBuilds } from '../folderBuild';
import { ProjectModel, SolutionModel } from '../models';
import { ProcessManager } from '../processManager';
import { createProjectStub } from '../projectParser';
import { synchronizeCopies } from './artifactSynchronizer';
import { createSmartBuildTraversal } from './smartBuildTraversal';
import { SmartBuildPlan } from './types';

export interface SmartBuildExecutionResult {
  readonly success: boolean;
  readonly cancelled: boolean;
  readonly exitCode?: number;
  readonly copiedFiles: number;
  readonly copyFailures: number;
  readonly builtProjects: number;
  readonly copyMs: number;
  readonly msbuildMs: number;
  readonly binaryLogPath?: string;
}

export interface SmartBuildExecutionOptions {
  readonly workingDirectory?: string;
  readonly binaryLogPath?: string;
}

export class SmartBuildExecutor {
  async execute(
    plan: SmartBuildPlan,
    solution: SolutionModel,
    processManager: ProcessManager,
    options: SmartBuildExecutionOptions = {}
  ): Promise<SmartBuildExecutionResult> {
    const workingDirectory = options.workingDirectory ?? solution.rootPath;
    const affectedVariants = plan.projects.filter(item => item.decision !== 'up-to-date').map(item => item.project);
    const affectedProjects = uniqueProjects(affectedVariants.map(variant =>
      solution.projects.find(project => samePath(project.path, variant.projectPath))
      ?? createProjectStub(variant.projectPath, solution.rootPath)));
    const busy = affectedProjects.find(project => processManager.getProjectPhase(project));
    if (busy) {
      vscode.window.showInformationMessage(`${busy.name} already has an active operation.`);
      return emptyResult(false, options.binaryLogPath);
    }

    const copyStart = Date.now();
    const copyPlans = plan.projects.filter(item => item.decision === 'copy');
    const synchronization = await synchronizeCopies(copyPlans.flatMap(item => item.copies));
    const copyMs = Date.now() - copyStart;
    const failedCopyProjects = new Set(synchronization.failed.map(failure => normalize(failure.copy.destination)));
    const selectedVariants = plan.projects
      .filter(item => item.decision === 'build' || item.decision === 'fallback' || item.decision === 'propagate'
        || (item.decision === 'copy' && item.copies.some(copy => failedCopyProjects.has(normalize(copy.destination)))))
      .map(item => item.project);
    if (selectedVariants.length === 0) return {
      success: true, cancelled: false, exitCode: 0,
      copiedFiles: synchronization.copied.length, copyFailures: synchronization.failed.length,
      builtProjects: 0, copyMs, msbuildMs: 0, binaryLogPath: options.binaryLogPath
    };

    const selectedProjects = uniqueProjects(selectedVariants.map(variant =>
      solution.projects.find(project => samePath(project.path, variant.projectPath))
      ?? createProjectStub(variant.projectPath, solution.rootPath)));

    const configuration = vscode.workspace.getConfiguration('dotnav').get<string>('buildConfiguration', 'Debug');
    const platform = vscode.workspace.getConfiguration('dotnav').get<string>('buildPlatform', 'AnyCPU');
    const maxParallelBuilds = normalizeMaxParallelBuilds(vscode.workspace
      .getConfiguration('dotnav').get<number>('smartBuild.maxParallelBuilds', 4));
    const timeoutMs = Math.max(1, vscode.workspace.getConfiguration('dotnav')
      .get<number>('buildTimeoutSeconds', 600)) * 1000;
    const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'dotnav-smart-build-'));
    const traversalPath = path.join(temporaryDirectory, 'smart-build.proj');
    const fallbackPaths = new Set(plan.projects
      .filter(item => item.decision === 'fallback')
      .map(item => item.project.projectPath));
    const propagationPaths = new Set(plan.projects
      .filter(item => item.decision === 'propagate')
      .map(item => item.project.projectPath));
    await fs.writeFile(traversalPath, createSmartBuildTraversal(
      selectedVariants, plan.requiresRestore, fallbackPaths, propagationPaths
    ), 'utf8');

    try {
      const msbuildStart = Date.now();
      const result = await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        cancellable: true,
        title: `Smart Build ${solution.name} (${selectedProjects.length}/${solution.projects.length} projects)`
      }, async (progress, token) => {
        progress.report({ message: `${configuration} · up to ${maxParallelBuilds} workers` });
        const task = new vscode.Task(
          { type: 'dotnet', task: 'smart-build', solution: solution.path, projects: selectedProjects.map(project => project.path) },
          vscode.TaskScope.Workspace,
          `smart build ${solution.name}`,
          '.NET Navigator',
          new vscode.ProcessExecution('dotnet', [
            'msbuild', traversalPath, `-maxCpuCount:${maxParallelBuilds}`,
            `-p:Configuration=${configuration}`, `-p:Platform=${platform}`,
            '-p:UseSharedCompilation=true', '-nologo',
            ...(options.binaryLogPath ? [`-binaryLogger:${options.binaryLogPath}`] : [])
          ], { cwd: workingDirectory }),
          ['$msCompile']
        );
        const session = processManager.beginRun(
          `smart-build:${solution.path ?? solution.rootPath}`,
          `Smart Build ${solution.name}`,
          'build',
          selectedProjects.map(project => ({ project }))
        );
        let execution: vscode.TaskExecution;
        try {
          execution = await vscode.tasks.executeTask(task);
        } catch (error) {
          processManager.failRun(session.runId, { code: 'unexpected-exit', message: String(error) });
          throw error;
        }
        const binding = processManager.trackTaskGroup(selectedProjects, 'build', execution, session.runId);
        const cancellation = token.onCancellationRequested(() => { void processManager.stopRun(binding.runId); });
        try {
          const exitCode = await processManager.waitForTask(execution, timeoutMs);
          return { success: exitCode === 0 && !token.isCancellationRequested, cancelled: token.isCancellationRequested, exitCode };
        } catch (error) {
          processManager.terminateTimedOutRunTask(binding.runId, execution, {
            code: 'build-timeout', message: `Smart Build timed out for ${solution.name}.`,
            cause: error instanceof Error ? error.message : String(error)
          });
          return { success: false, cancelled: false };
        } finally {
          cancellation.dispose();
        }
      });
      return {
        ...result,
        copiedFiles: synchronization.copied.length,
        copyFailures: synchronization.failed.length,
        builtProjects: selectedProjects.length,
        copyMs,
        msbuildMs: Date.now() - msbuildStart,
        binaryLogPath: options.binaryLogPath
      };
    } finally {
      await fs.rm(temporaryDirectory, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}

function emptyResult(success: boolean, binaryLogPath?: string): SmartBuildExecutionResult {
  return {
    success, cancelled: false, copiedFiles: 0, copyFailures: 0,
    builtProjects: 0, copyMs: 0, msbuildMs: 0, binaryLogPath
  };
}

function uniqueProjects(projects: ProjectModel[]): ProjectModel[] {
  return [...new Map(projects.map(project => [normalize(project.path), project])).values()];
}

function samePath(left: string, right: string): boolean { return normalize(left) === normalize(right); }
function normalize(value: string): string {
  const resolved = path.resolve(value);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}
