import * as vscode from 'vscode';
import { ProjectModel } from '../models';
import { normalizePath } from '../pathUtils';
import { ProcessManager } from '../processManager';
import { isActivePhase } from '../runSessionState';
import {
  EfErrorKind,
  classifyEfError,
  extractJsonPayload,
  maskConnectionString,
  summarizeEfError
} from './efJsonParser';
import { runProcess } from './efProcess';
import { QueueCancelledError, QueueSnapshot, SerialQueue } from './efQueue';

export interface EfSettings {
  readonly configuration: string;
  readonly noBuild: 'auto' | 'always' | 'never';
  readonly verbose: boolean;
  readonly environmentVariables: Record<string, string>;
  readonly commandTimeoutSeconds: number;
}

export function readEfSettings(): EfSettings {
  const configuration = vscode.workspace.getConfiguration('dotnav.ef');
  return {
    configuration: configuration.get<string>('configuration', 'Debug'),
    noBuild: configuration.get<'auto' | 'always' | 'never'>('noBuild', 'auto'),
    verbose: configuration.get<boolean>('verbose', false),
    environmentVariables: configuration.get<Record<string, string>>('environmentVariables', {}),
    commandTimeoutSeconds: Math.max(30, configuration.get<number>('commandTimeout', 300))
  };
}

export interface EfCommandRequest {
  /** Arguments after `dotnet ef`, e.g. ['migrations', 'add', 'AddOrders']. */
  readonly args: readonly string[];
  readonly project: ProjectModel;
  readonly startupProjectPath: string;
  /** Passed as --context when set (multi-context solutions, design F15). */
  readonly contextName?: string;
  readonly title: string;
  /** Write commands mutate migrations or the database and bump generations. */
  readonly write: boolean;
  readonly json?: boolean;
  /** Commands such as `--version` that never build and skip project flags. */
  readonly raw?: boolean;
}

export interface EfCommandResult {
  readonly kind: 'success' | 'error' | 'cancelled';
  readonly errorKind?: EfErrorKind;
  readonly exitCode?: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly jsonPayload?: string;
  readonly errorSummary?: string;
  readonly durationMs: number;
}

export interface BuildEfArgsOptions {
  readonly settings: EfSettings;
  readonly noBuild: boolean;
}

/** Assembles the full `dotnet` argument vector for a request. Exported for tests. */
export function buildEfArgs(request: EfCommandRequest, options: BuildEfArgsOptions): string[] {
  const args: string[] = ['ef', ...request.args];
  if (request.raw) {
    return args;
  }

  args.push('--project', request.project.path);
  args.push('--startup-project', request.startupProjectPath);
  if (request.contextName) {
    args.push('--context', request.contextName);
  }

  args.push('--configuration', options.settings.configuration);
  if (options.noBuild) {
    args.push('--no-build');
  }

  if (request.json) {
    args.push('--json', '--prefix-output');
  }

  if (options.settings.verbose) {
    args.push('--verbose');
  }

  args.push('--no-color');
  return args;
}

/**
 * Tracks whether a project's build output can be assumed fresh, so `auto`
 * no-build mode can skip redundant builds (design §6.2). Exported for tests.
 */
export class FreshnessTracker {
  private readonly freshProjects = new Set<string>();

  markBuilt(projectPath: string): void {
    this.freshProjects.add(normalizePath(projectPath));
  }

  markDirty(projectPath: string): void {
    this.freshProjects.delete(normalizePath(projectPath));
  }

  markAllDirty(): void {
    this.freshProjects.clear();
  }

  isFresh(projectPath: string): boolean {
    return this.freshProjects.has(normalizePath(projectPath));
  }
}

const staleAssemblyPatterns = [
  /was not found/i,
  /could not load file or assembly/i,
  /no such file or directory/i,
  /startup project .* targets framework/i,
  /does not exist/i
];

export class EfCli implements vscode.Disposable {
  readonly queue = new SerialQueue();
  readonly freshness = new FreshnessTracker();
  private readonly output: vscode.OutputChannel;
  private readonly activityEmitter = new vscode.EventEmitter<QueueSnapshot>();
  readonly onDidChangeActivity = this.activityEmitter.event;
  private readonly queueSubscription: { dispose(): void };
  private disposed = false;

  constructor(private readonly processManager?: ProcessManager) {
    this.output = vscode.window.createOutputChannel('DotNav EF Core');
    this.queueSubscription = this.queue.onDidChange(snapshot => this.activityEmitter.fire(snapshot));
  }

  showOutput(): void {
    this.output.show(true);
  }

  appendOutput(message: string): void {
    if (message.trim().length > 0) {
      this.output.appendLine(maskConnectionString(message.trimEnd()));
    }
  }

  get busy(): boolean {
    return this.queue.busy;
  }

  /**
   * Runs an EF command through the serial queue. Handles the concurrency
   * guards from design §7.1/§7.2, the auto no-build retry from §6.2, progress
   * UI, timeout prompts, and output logging.
   */
  async run(request: EfCommandRequest): Promise<EfCommandResult> {
    const guard = await this.checkGuards(request);
    if (guard) {
      return guard;
    }

    try {
      return await this.queue.enqueue(request.title, request.write, () => this.execute(request));
    } catch (error) {
      if (error instanceof QueueCancelledError) {
        return {
          kind: 'cancelled', stdout: '', stderr: '', durationMs: 0,
          errorSummary: 'Command was cancelled before it started.'
        };
      }

      throw error;
    }
  }

  /** Cancels everything that has not started yet (design §7.9). */
  clearPending(): number {
    return this.queue.clearPending();
  }

  private async checkGuards(request: EfCommandRequest): Promise<EfCommandResult | undefined> {
    if (this.disposed) {
      return { kind: 'cancelled', stdout: '', stderr: '', durationMs: 0 };
    }

    // R2: refuse to run while DotNav is building/running the same project.
    if (!request.raw && this.processManager) {
      const phase = this.processManager.getProjectPhase(request.project);
      if (phase && isActivePhase(phase)) {
        const choice = await vscode.window.showWarningMessage(
          `${request.project.name} is currently ${phase === 'building' ? 'building' : 'running'} in DotNav. ` +
          'Running an EF command now can conflict with it.',
          { modal: true },
          'Stop It and Continue',
          'Continue Anyway'
        );
        if (choice === undefined) {
          return { kind: 'cancelled', stdout: '', stderr: '', durationMs: 0 };
        }

        if (choice === 'Stop It and Continue') {
          await this.processManager.stopProject(request.project);
        }
      }
    }

    // R1: warn instead of silently queueing a second write command.
    const running = this.queue.runningEntry;
    if (request.write && running?.write) {
      const choice = await vscode.window.showWarningMessage(
        `'${running.label}' is still running. Queue '${request.title}' to run after it finishes?`,
        { modal: true },
        'Queue'
      );
      if (choice !== 'Queue') {
        return { kind: 'cancelled', stdout: '', stderr: '', durationMs: 0 };
      }
    }

    return undefined;
  }

  private async execute(request: EfCommandRequest): Promise<EfCommandResult> {
    const settings = readEfSettings();
    const wantNoBuild = !request.raw && settings.noBuild !== 'never' && (
      settings.noBuild === 'always' || this.freshness.isFresh(request.project.path)
    );

    let result = await this.executeOnce(request, settings, wantNoBuild);

    // Auto retry with a build when --no-build hit a stale/missing assembly.
    if (
      result.kind === 'error' &&
      wantNoBuild &&
      settings.noBuild === 'auto' &&
      staleAssemblyPatterns.some(pattern => pattern.test(`${result.stderr}\n${result.stdout}`))
    ) {
      this.log(`retrying '${request.title}' with a full build (--no-build looked stale)`);
      this.freshness.markDirty(request.project.path);
      result = await this.executeOnce(request, settings, false);
    }

    if (!request.raw && result.kind === 'success' && !wantNoBuild) {
      this.freshness.markBuilt(request.project.path);
    }

    return result;
  }

  private async executeOnce(request: EfCommandRequest, settings: EfSettings, noBuild: boolean): Promise<EfCommandResult> {
    const args = buildEfArgs(request, { settings, noBuild });
    const cwd = request.project.directory;
    const started = Date.now();
    this.log(`── dotnet ${args.join(' ')} ──`);

    return vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: request.title,
        cancellable: true
      },
      async (_progress, token) => {
        let killProcess: (() => void) | undefined;
        let cancelled = false;
        let timedOut = false;
        let timeoutTimer: NodeJS.Timeout | undefined;

        const cancellationSubscription = token.onCancellationRequested(() => {
          cancelled = true;
          killProcess?.();
        });

        const armTimeout = () => {
          timeoutTimer = setTimeout(() => {
            void vscode.window.showWarningMessage(
              `'${request.title}' has been running for over ${settings.commandTimeoutSeconds}s.`,
              'Keep Waiting',
              'Kill Process'
            ).then(choice => {
              if (choice === 'Kill Process') {
                timedOut = true;
                killProcess?.();
              } else if (choice === 'Keep Waiting') {
                armTimeout();
              }
            });
          }, settings.commandTimeoutSeconds * 1000);
        };
        armTimeout();

        const processResult = await runProcess('dotnet', args, {
          cwd,
          env: { ...process.env, ...settings.environmentVariables },
          onStart: kill => { killProcess = kill; },
          onOutput: chunk => this.output.append(maskConnectionString(chunk))
        });

        if (timeoutTimer) {
          clearTimeout(timeoutTimer);
        }
        cancellationSubscription.dispose();

        const durationMs = Date.now() - started;
        this.log(`exit ${processResult.exitCode ?? 'none'} in ${(durationMs / 1000).toFixed(1)}s`);

        if (processResult.startError) {
          return {
            kind: 'error' as const,
            errorKind: 'toolMissing' as const,
            stdout: '',
            stderr: processResult.startError,
            errorSummary: `Could not start dotnet: ${processResult.startError}`,
            durationMs
          };
        }

        if (cancelled || timedOut || processResult.killed) {
          return {
            kind: 'cancelled' as const,
            exitCode: processResult.exitCode,
            stdout: processResult.stdout,
            stderr: processResult.stderr,
            errorSummary: timedOut ? 'Command timed out and was killed.' : 'Command was cancelled.',
            durationMs
          };
        }

        if (processResult.exitCode !== 0) {
          return {
            kind: 'error' as const,
            errorKind: classifyEfError(processResult.stderr, processResult.stdout),
            exitCode: processResult.exitCode,
            stdout: processResult.stdout,
            stderr: processResult.stderr,
            errorSummary: summarizeEfError(processResult.stderr, processResult.stdout),
            durationMs
          };
        }

        return {
          kind: 'success' as const,
          exitCode: processResult.exitCode,
          stdout: processResult.stdout,
          stderr: processResult.stderr,
          jsonPayload: request.json ? extractJsonPayload(processResult.stdout) : undefined,
          durationMs
        };
      }
    );
  }

  private log(message: string): void {
    this.output.appendLine(maskConnectionString(message));
  }

  dispose(): void {
    this.disposed = true;
    this.queue.clearPending();
    this.queueSubscription.dispose();
    this.activityEmitter.dispose();
    this.output.dispose();
  }
}

/** Shows the standard failure notification with a Show Output action. */
export async function reportEfFailure(cli: EfCli, title: string, result: EfCommandResult): Promise<void> {
  if (result.kind !== 'error') {
    return;
  }

  const hints: Partial<Record<EfErrorKind, string>> = {
    buildError: 'The project failed to build.',
    toolMissing: 'The dotnet-ef tool is not available. Run "EF Core: Install dotnet-ef Tool".',
    dbConnection: 'Could not reach the database.',
    startupProject: 'Check the EF startup project (EF Core: Select Startup Project).',
    pendingModelChanges: 'The model has changes that are not covered by a migration.'
  };

  const hint = result.errorKind ? hints[result.errorKind] : undefined;
  const summary = result.errorSummary ? maskConnectionString(result.errorSummary) : 'See output for details.';
  const choice = await vscode.window.showErrorMessage(
    `${title} failed. ${hint ? `${hint} ` : ''}${summary}`,
    'Show Output'
  );
  if (choice === 'Show Output') {
    cli.showOutput();
  }
}
