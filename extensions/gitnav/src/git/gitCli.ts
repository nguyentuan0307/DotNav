import { spawn } from 'child_process';
import * as path from 'path';
import * as vscode from 'vscode';

export interface GitResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
  readonly cancelled: boolean;
}

const repoRootCache = new Map<string, string | undefined>();

export async function runGit(
  cwd: string,
  args: string[],
  token?: vscode.CancellationToken,
  stdin?: string,
  env?: NodeJS.ProcessEnv
): Promise<GitResult> {
  return new Promise(resolve => {
    const child = spawn('git', args, { cwd, shell: false, env: env ? { ...process.env, ...env } : undefined });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let settled = false;
    let cancelled = false;

    const finish = (exitCode: number) => {
      if (settled) {
        return;
      }

      settled = true;
      cancellation?.dispose();
      resolve({
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
        exitCode,
        cancelled
      });
    };

    const cancellation = token?.onCancellationRequested(() => {
      cancelled = true;
      if (!child.killed) {
        child.kill();
      }
    });

    child.stdout.on('data', chunk => stdout.push(Buffer.from(chunk)));
    child.stderr.on('data', chunk => stderr.push(Buffer.from(chunk)));
    child.on('error', error => {
      stderr.push(Buffer.from(error.message));
      finish(1);
    });
    child.on('close', code => finish(code ?? 1));
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
