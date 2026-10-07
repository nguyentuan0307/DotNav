import * as fs from 'fs/promises';
import * as path from 'path';
import * as vscode from 'vscode';
import { ProjectModel } from '../models';
import { referencesEfDesign } from './efDetection';
import { runProcess } from './efProcess';
import { waitForEfChoice } from './efCancellation';

export interface EfToolStatus {
  readonly installed: boolean;
  readonly version?: string;
}

/**
 * Checks and installs the dotnet-ef tool (design §3.4). `dotnet ef --version`
 * resolves local tool manifests first, then the global tool, which matches the
 * lookup order used when commands actually run.
 */
export class EfToolManager {
  private cache = new Map<string, EfToolStatus>();
  private warnedVersionMismatch = new Set<string>();

  constructor(private readonly output: (message: string) => void) {}

  invalidate(): void {
    this.cache.clear();
    this.warnedVersionMismatch.clear();
  }

  peekStatus(cwd: string): EfToolStatus | undefined {
    return this.cache.get(cwd);
  }

  async getStatus(cwd: string, signal?: AbortSignal): Promise<EfToolStatus> {
    if (signal?.aborted) {
      return { installed: false };
    }
    const cached = this.cache.get(cwd);
    if (cached) {
      return cached;
    }

    const result = await runProcess('dotnet', ['ef', '--version'], { cwd, signal });
    if (result.killed || signal?.aborted) {
      return { installed: false };
    }
    const lines = result.stdout.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    const version = lines.find(line => /^\d+\.\d+/.test(line));
    const status: EfToolStatus = result.exitCode === 0 && version
      ? { installed: true, version }
      : { installed: false };
    this.cache.set(cwd, status);
    return status;
  }

  /** Returns true when the tool is available, prompting to install if not. */
  async ensureTool(cwd: string, signal?: AbortSignal): Promise<boolean> {
    const status = await this.getStatus(cwd, signal);
    if (signal?.aborted) {
      return false;
    }
    if (status.installed) {
      return true;
    }

    const choice = await waitForEfChoice(vscode.window.showWarningMessage(
      'The dotnet-ef tool is not installed. EF Core commands need it.',
      'Install Local Tool',
      'Install Global Tool'
    ), signal);
    if (!choice || signal?.aborted) {
      return false;
    }

    const installed = await this.install(cwd, choice === 'Install Global Tool', signal);
    return installed;
  }

  async install(cwd: string, global: boolean, signal?: AbortSignal): Promise<boolean> {
    return vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'Installing dotnet-ef…' },
      async () => {
        if (signal?.aborted) {
          return false;
        }
        if (!global) {
          const manifestPath = path.join(cwd, '.config', 'dotnet-tools.json');
          const hasManifest = await fs.access(manifestPath).then(() => true, () => false);
          if (!hasManifest) {
            const manifestResult = await runProcess('dotnet', ['new', 'tool-manifest'], { cwd, signal });
            if (manifestResult.killed || signal?.aborted) {
              return false;
            }
            this.output(manifestResult.stdout + manifestResult.stderr);
            if (manifestResult.exitCode !== 0) {
              vscode.window.showErrorMessage('Could not create a dotnet tool manifest. See output for details.');
              return false;
            }
          }
        }

        const args = global
          ? ['tool', 'install', '--global', 'dotnet-ef']
          : ['tool', 'install', 'dotnet-ef'];
        const result = await runProcess('dotnet', args, { cwd, signal });
        this.output(result.stdout + result.stderr);
        this.invalidate();
        if (result.killed || signal?.aborted) {
          return false;
        }

        if (result.exitCode !== 0) {
          // `tool install` fails when already installed; try update instead.
          const updateArgs = global
            ? ['tool', 'update', '--global', 'dotnet-ef']
            : ['tool', 'update', 'dotnet-ef'];
          const updateResult = await runProcess('dotnet', updateArgs, { cwd, signal });
          if (updateResult.killed || signal?.aborted) {
            return false;
          }
          this.output(updateResult.stdout + updateResult.stderr);
          if (updateResult.exitCode !== 0) {
            vscode.window.showErrorMessage('Installing dotnet-ef failed. See output for details.');
            return false;
          }
        }

        vscode.window.showInformationMessage('dotnet-ef is ready.');
        return true;
      }
    );
  }

  /** Warns once per project when tool and runtime majors diverge (RK3). */
  async warnOnVersionMismatch(project: ProjectModel, cwd: string, signal?: AbortSignal): Promise<void> {
    if (this.warnedVersionMismatch.has(project.path) || !referencesEfDesign(project)) {
      return;
    }

    const designVersion = project.packageReferences
      .find(pkg => /^Microsoft\.EntityFrameworkCore\.(Design|Tools)$/i.test(pkg.name))?.version;
    const status = await this.getStatus(cwd, signal);
    if (!designVersion || !status.version) {
      return;
    }

    const designMajor = Number(designVersion.split('.')[0]);
    const toolMajor = Number(status.version.split('.')[0]);
    if (!Number.isInteger(designMajor) || !Number.isInteger(toolMajor) || designMajor === toolMajor) {
      return;
    }

    this.warnedVersionMismatch.add(project.path);
    const choice = await waitForEfChoice(vscode.window.showWarningMessage(
      `dotnet-ef ${status.version} does not match ${project.name}'s EF Core ${designVersion} (different major versions). ` +
      'Commands may fail or behave unexpectedly.',
      'Install Matching Local Tool'
    ), signal);
    if (choice === 'Install Matching Local Tool' && !signal?.aborted) {
      const result = await runProcess('dotnet', ['tool', 'install', 'dotnet-ef', '--version', `${designMajor}.*`], { cwd, signal });
      this.output(result.stdout + result.stderr);
      this.invalidate();
    }
  }
}
