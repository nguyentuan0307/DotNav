import { ChildProcessWithoutNullStreams, spawn } from 'child_process';
import * as path from 'path';
import * as readline from 'readline';
import { BuildHostInfo, EvaluatedBuildGraph, smartBuildProtocolVersion } from './types';

interface HostEnvelope<T> {
  readonly id?: string;
  readonly result?: T;
  readonly error?: { readonly code: string; readonly message: string; readonly detail?: string };
}

interface PendingRequest {
  readonly resolve: (value: unknown) => void;
  readonly reject: (reason: Error) => void;
  readonly timer: NodeJS.Timeout;
  readonly owner: ChildProcessWithoutNullStreams;
}

export interface BuildHostClientOptions {
  readonly extensionPath: string;
  readonly workspaceRoot?: string;
  readonly dotnetPath?: string;
  readonly requestTimeoutMs?: number;
  readonly onDiagnostic?: (message: string) => void;
}

export class BuildHostClient {
  private process?: ChildProcessWithoutNullStreams;
  private nextRequestId = 1;
  private readonly pending = new Map<string, PendingRequest>();
  private disposed = false;
  private startPromise?: Promise<BuildHostInfo>;
  private operation = Promise.resolve();
  private workingDirectory: string;

  constructor(private readonly options: BuildHostClientOptions) {
    this.workingDirectory = options.workspaceRoot ?? path.dirname(path.join(options.extensionPath, 'build-host', 'out', 'DotNav.BuildHost.dll'));
  }

  async start(): Promise<BuildHostInfo> {
    if (!this.startPromise) {
      this.startPromise = this.startCore().catch(error => {
        this.startPromise = undefined;
        throw error;
      });
    }
    return this.startPromise;
  }

  async evaluate(
    entryProjects: readonly string[],
    globalProperties: Readonly<Record<string, string>>,
    solutionPath?: string
  ): Promise<EvaluatedBuildGraph> {
    return this.enqueue(async () => {
      await this.start();
      const graph = await this.request<EvaluatedBuildGraph>('evaluate', { entryProjects, solutionPath, globalProperties });
      if (graph.protocolVersion !== smartBuildProtocolVersion) {
        throw new Error(`Unsupported Smart Build graph protocol ${graph.protocolVersion}.`);
      }
      return graph;
    });
  }

  async evaluateCSharp(expression: string): Promise<any> {
    return this.enqueue(async () => {
      await this.start();
      return this.request<any>('evaluate-csharp', { expression });
    });
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    await this.stop();
    this.rejectAll(new Error('Smart Build host was disposed.'));
  }

  async restart(): Promise<void> {
    if (this.disposed) throw new Error('Smart Build host client is disposed.');
    await this.enqueue(() => this.stop());
  }

  async setWorkingDirectory(directory: string): Promise<void> {
    const resolved = path.resolve(directory);
    if (samePath(resolved, this.workingDirectory)) return;
    await this.enqueue(async () => {
      if (samePath(resolved, this.workingDirectory)) return;
      await this.stop();
      this.workingDirectory = resolved;
    });
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.operation.then(operation, operation);
    this.operation = result.then(() => undefined, () => undefined);
    return result;
  }

  private async stop(): Promise<void> {
    const child = this.process;
    if (child && !child.killed) {
      const closed = waitForClose(child, 1_000);
      try {
        await this.request('shutdown', {}, 1_000);
      } catch {
        child.kill();
      }
      if (!await closed) {
        child.kill();
        await waitForClose(child, 1_000);
      }
    }
    if (this.process === child) {
      this.process = undefined;
      this.startPromise = undefined;
    }
  }

  private async startCore(): Promise<BuildHostInfo> {
    if (this.disposed) throw new Error('Smart Build host client is disposed.');
    const assemblyPath = path.join(this.options.extensionPath, 'build-host', 'out', 'DotNav.BuildHost.dll');
    const child = spawn(this.options.dotnetPath ?? 'dotnet', [assemblyPath], {
      cwd: this.workingDirectory,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true
    });
    this.process = child;
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', data => this.options.onDiagnostic?.(String(data).trimEnd()));
    child.on('error', error => this.handleTermination(child, new Error(`Could not start Smart Build host: ${error.message}`)));
    child.on('exit', (code, signal) => {
      this.handleTermination(child, new Error(`Smart Build host exited (${code ?? signal ?? 'unknown'}).`));
    });
    const lines = readline.createInterface({ input: child.stdout });
    lines.on('line', line => this.handleLine(child, line));

    const info = await this.request<BuildHostInfo>('ping', {});
    if (info.protocolVersion !== smartBuildProtocolVersion) {
      child.kill();
      throw new Error(`Smart Build host protocol ${info.protocolVersion} is incompatible with extension protocol ${smartBuildProtocolVersion}.`);
    }
    return info;
  }

  private request<T>(method: string, params: unknown, timeoutMs = this.options.requestTimeoutMs ?? 30_000): Promise<T> {
    const process = this.process;
    if (!process || process.killed || !process.stdin.writable) {
      return Promise.reject(new Error('Smart Build host is not running.'));
    }
    const id = String(this.nextRequestId++);
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Smart Build host request '${method}' timed out.`));
      }, timeoutMs);
      this.pending.set(id, { resolve: value => resolve(value as T), reject, timer, owner: process });
      process.stdin.write(`${JSON.stringify({ id, method, params })}\n`, error => {
        if (!error) return;
        const pending = this.pending.get(id);
        if (!pending || pending.owner !== process) return;
        clearTimeout(pending.timer);
        this.pending.delete(id);
        pending.reject(error);
      });
    });
  }

  private handleLine(owner: ChildProcessWithoutNullStreams, line: string): void {
    let envelope: HostEnvelope<unknown>;
    try {
      envelope = JSON.parse(line) as HostEnvelope<unknown>;
    } catch {
      this.options.onDiagnostic?.(`Ignored malformed Smart Build host response: ${line}`);
      return;
    }
    if (!envelope.id) return;
    const pending = this.pending.get(envelope.id);
    if (!pending || pending.owner !== owner) return;
    clearTimeout(pending.timer);
    this.pending.delete(envelope.id);
    if (envelope.error) {
      pending.reject(new Error(`${envelope.error.code}: ${envelope.error.message}${envelope.error.detail ? `\n${envelope.error.detail}` : ''}`));
    } else {
      pending.resolve(envelope.result);
    }
  }

  private rejectAll(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }

  private handleTermination(owner: ChildProcessWithoutNullStreams, error: Error): void {
    if (this.process === owner) {
      this.process = undefined;
      this.startPromise = undefined;
    }
    for (const [id, pending] of this.pending) {
      if (pending.owner !== owner) continue;
      clearTimeout(pending.timer);
      pending.reject(error);
      this.pending.delete(id);
    }
  }
}

function samePath(left: string, right: string): boolean {
  return process.platform === 'win32'
    ? path.resolve(left).toLowerCase() === path.resolve(right).toLowerCase()
    : path.resolve(left) === path.resolve(right);
}

function waitForClose(child: ChildProcessWithoutNullStreams, timeoutMs: number): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true);
  return new Promise(resolve => {
    const timer = setTimeout(() => {
      child.off('close', onClose);
      resolve(false);
    }, timeoutMs);
    const onClose = () => {
      clearTimeout(timer);
      resolve(true);
    };
    child.once('close', onClose);
  });
}
