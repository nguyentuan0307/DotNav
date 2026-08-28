import { spawn } from 'child_process';
import * as path from 'path';
import * as vscode from 'vscode';

export interface GitResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
  readonly cancelled: boolean;
  readonly timedOut?: boolean;
}

export const DEFAULT_GIT_TIMEOUT_MS = 25_000;

const repoRootCache = new Map<string, string | undefined>();

export async function runGit(
  cwd: string,
  args: string[],
  token?: vscode.CancellationToken,
  stdin?: string,
  env?: NodeJS.ProcessEnv,
  timeoutMs: number = DEFAULT_GIT_TIMEOUT_MS
): Promise<GitResult> {
  return new Promise(resolve => {
    const child = spawn('git', args, { cwd, shell: false, env: env ? { ...process.env, ...env } : undefined });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let settled = false;
    let cancelled = false;
    let timedOut = false;
    let timeoutTimer: NodeJS.Timeout | undefined;
    let killTimer: NodeJS.Timeout | undefined;

    const finish = (exitCode: number) => {
      if (settled) {
        return;
      }

      settled = true;
      if (timeoutTimer) clearTimeout(timeoutTimer);
      if (killTimer) clearTimeout(killTimer);
      cancellation?.dispose();
      resolve({
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
        exitCode,
        cancelled,
        timedOut
      });
    };

    const cancellation = token?.onCancellationRequested(() => {
      cancelled = true;
      if (!child.killed) {
        child.kill();
      }
    });

    if (timeoutMs > 0) {
      timeoutTimer = setTimeout(() => {
        if (!settled) {
          timedOut = true;
          stderr.push(Buffer.from(`Git operation timed out after ${timeoutMs}ms (high CPU load or repository lock): git ${args.slice(0, 2).join(' ')}\n`));
          try {
            child.kill('SIGTERM');
          } catch {}
          killTimer = setTimeout(() => {
            if (!settled) {
              try {
                child.kill('SIGKILL');
              } catch {}
              finish(124);
            }
          }, 1500);
        }
      }, timeoutMs);
    }

    child.stdout.on('data', chunk => stdout.push(Buffer.from(chunk)));
    child.stderr.on('data', chunk => stderr.push(Buffer.from(chunk)));
    child.on('error', error => {
      stderr.push(Buffer.from(error.message));
      finish(1);
    });
    child.on('close', code => finish(code ?? (timedOut ? 124 : 1)));
    if (stdin !== undefined) child.stdin.end(stdin);
  });
}

export async function findRepoRoot(fileFsPath: string, token?: vscode.CancellationToken): Promise<string | undefined> {
  const directory = path.dirname(fileFsPath);
  const cacheKey = path.resolve(directory);
  if (repoRootCache.has(cacheKey)) {
    return repoRootCache.get(cacheKey);
  }

  const result = await runGit(directory, ['rev-parse', '--show-toplevel'], token);
  const repoRoot = result.exitCode === 0 ? result.stdout.trim() : undefined;
  repoRootCache.set(cacheKey, repoRoot);
  return repoRoot;
}

export function toGitRelativePath(repoRoot: string, fsPath: string): string {
  return path.relative(repoRoot, fsPath).replace(/\\/g, '/');
}
