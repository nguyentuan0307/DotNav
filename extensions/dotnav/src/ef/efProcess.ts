// Child-process runner for EF commands with whole-tree kill and timeout
// support (design §7.5, RK10). No vscode imports.

import { spawn } from 'child_process';

export interface RunProcessOptions {
  readonly cwd: string;
  readonly env?: NodeJS.ProcessEnv;
  /** Called once the process has started, so callers can wire cancellation. */
  readonly onStart?: (kill: () => void) => void;
  readonly onOutput?: (chunk: string, stream: 'stdout' | 'stderr') => void;
}

export interface RunProcessResult {
  readonly exitCode: number | undefined;
  readonly stdout: string;
  readonly stderr: string;
  readonly killed: boolean;
  readonly startError?: string;
}

export function runProcess(command: string, args: readonly string[], options: RunProcessOptions): Promise<RunProcessResult> {
  return new Promise(resolve => {
    let stdout = '';
    let stderr = '';
    let killed = false;
    let settled = false;

    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      // Own process group on POSIX so the whole tree can be killed at once.
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    });

    const finish = (result: RunProcessResult) => {
      if (!settled) {
        settled = true;
        resolve(result);
      }
    };

    const kill = () => {
      killed = true;
      killProcessTree(child.pid);
    };

    child.on('error', error => {
      finish({ exitCode: undefined, stdout, stderr, killed, startError: error.message });
    });

    child.stdout.on('data', (data: Buffer) => {
      const text = data.toString('utf8');
      stdout += text;
      options.onOutput?.(text, 'stdout');
    });
    child.stderr.on('data', (data: Buffer) => {
      const text = data.toString('utf8');
      stderr += text;
      options.onOutput?.(text, 'stderr');
    });

    child.on('close', code => {
      finish({ exitCode: code ?? undefined, stdout, stderr, killed });
    });

    options.onStart?.(kill);
  });
}

export function killProcessTree(pid: number | undefined): void {
  if (!pid) {
    return;
  }

  if (process.platform === 'win32') {
    // taskkill terminates the whole tree; fire-and-forget.
    spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
      .on('error', () => undefined);
    return;
  }

  try {
    process.kill(-pid, 'SIGTERM');
  } catch {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      return;
    }
  }

  setTimeout(() => {
    try {
      process.kill(-pid, 'SIGKILL');
    } catch {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        // Process already exited.
      }
    }
  }, 2000).unref();
}
