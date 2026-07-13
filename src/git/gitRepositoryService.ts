import * as path from 'path';
import * as vscode from 'vscode';
import { runGit } from './gitCli';
import { GitCommitDetail, GitFileChange, GitLogFilter, GitLogPage, GitOperationState, GitRefInfo, GitRepositorySnapshot, GitStashInfo } from './gitPanelModels';
import { logPrettyFormat, parseLog, parseNameStatusZ, parseNumstatZ, parseWorkingTreeStatus } from './gitPanelParsers';

export class GitCommandError extends Error {
  constructor(readonly args: string[], readonly stderr: string, readonly exitCode: number) {
    super(stderr.trim() || `git ${args[0]} failed with exit code ${exitCode}.`);
  }
}

export class GitRepositoryService {
  async discoverRepositories(): Promise<string[]> {
    const roots = vscode.workspace.workspaceFolders ?? [];
    const repositories = new Set<string>();
    await Promise.all(roots.map(async folder => {
      const result = await runGit(folder.uri.fsPath, ['rev-parse', '--show-toplevel']);
      if (result.exitCode === 0) repositories.add(result.stdout.trim());
      const nested = await vscode.workspace.findFiles(new vscode.RelativePattern(folder, '*/.git'), '**/node_modules/**', 50);
      for (const gitPath of nested) repositories.add(path.dirname(gitPath.fsPath));
    }));
    return [...repositories].sort();
  }

  async snapshot(root: string): Promise<GitRepositorySnapshot> {
    const [status, refs, stashes] = await Promise.all([
      this.git(root, ['status', '--porcelain=v2', '--branch', '-z']),
      this.git(root, ['for-each-ref', '--format=%(refname)%00%(refname:short)%00%(objectname)%00%(upstream:short)%00%(upstream:track)', 'refs/heads', 'refs/remotes', 'refs/tags']),
      this.git(root, ['stash', 'list', '--format=%gd%x00%H%x00%gs%x00%ct%x00'])
    ]);
    const statusFields = status.stdout.split('\0');
    const branchHead = readStatusHeader(statusFields, '# branch.head ') || 'HEAD';
    const upstream = readStatusHeader(statusFields, '# branch.upstream ');
    const ab = readStatusHeader(statusFields, '# branch.ab ');
    const match = ab ? /\+(\d+)\s+-(\d+)/.exec(ab) : undefined;
    return {
      root,
      name: path.basename(root),
      head: branchHead,
      detached: branchHead === '(detached)',
      upstream,
      ahead: Number(match?.[1]) || 0,
      behind: Number(match?.[2]) || 0,
      changedCount: statusFields.filter(value => /^(1|2|u|\?) /.test(value)).length,
      operation: await detectOperation(root),
      refs: parseRefs(refs.stdout, branchHead),
      stashes: parseStashes(stashes.stdout)
    };
  }

  async log(root: string, offset: number, limit: number, filter: GitLogFilter): Promise<GitLogPage> {
    let effectiveFilter = filter;
    let revisions = filter.refs?.length ? filter.refs : ['--all'];
    if (filter.text && /^[0-9a-f]{4,40}$/i.test(filter.text)) {
      const resolved = await runGit(root, ['rev-parse', '--verify', `${filter.text}^{commit}`]);
      if (resolved.exitCode === 0) {
        revisions = [resolved.stdout.trim()];
        effectiveFilter = { ...filter, text: undefined };
      }
    }
    const shared = buildFilterArgs(effectiveFilter);
    const tail = [...revisions, ...(filter.path ? ['--', filter.path] : [])];
    const [records, count] = await Promise.all([
      this.git(root, ['log', '--graph', `--format=${logPrettyFormat}`, '--decorate=full', `--skip=${offset}`, `--max-count=${limit}`, ...shared, ...tail]),
      this.git(root, ['rev-list', '--count', ...shared, ...tail])
    ]);
    const commits = parseLog(records.stdout);
    const total = Number(count.stdout.trim()) || 0;
    return { commits, offset, total, hasMore: offset + commits.length < total };
  }

  async commitDetail(root: string, hash: string, parent?: number): Promise<GitCommitDetail> {
    const meta = await this.git(root, ['show', '-s', `--format=${logPrettyFormat}%x1f%B%x1f%cn%x1f%ce%x1f%ct`, hash]);
    const commit = parseLog(meta.stdout)[0];
    if (!commit) throw new Error(`Commit ${hash} was not found.`);
    const fields = meta.stdout.split('\x1f');
    const base = parent && commit.parents[parent - 1] ? commit.parents[parent - 1] : `${hash}^`;
    const files = await this.filesBetween(root, commit.parents.length ? base : emptyTreeHash, hash);
    return {
      ...commit,
      message: fields[8]?.replace(/\x1e|\r?\n$/g, '') || commit.subject,
      committer: fields[9] || commit.author,
      committerEmail: fields[10] || commit.authorEmail,
      committerTimestamp: Number(fields[11]) || commit.authorTimestamp,
      files
    };
  }

  async filesBetween(root: string, from: string, to: string): Promise<GitFileChange[]> {
    const [names, numbers] = await Promise.all([
      this.git(root, ['diff', '--name-status', '-z', '--find-renames', from, to]),
      this.git(root, ['diff', '--numstat', '-z', '--find-renames', from, to])
    ]);
    const stats = parseNumstatZ(numbers.stdout);
    return parseNameStatusZ(names.stdout).map(file => ({ ...file, ...(stats.get(file.path) ?? { additions: 0, deletions: 0 }) }));
  }

  async filesAgainstWorkingTree(root: string, ref: string): Promise<GitFileChange[]> {
    const result = await this.git(root, ['diff', '--name-status', '-z', '--find-renames', ref]);
    return parseNameStatusZ(result.stdout);
  }

  async stashFiles(root: string, ref: string): Promise<GitFileChange[]> {
    const result = await this.git(root, ['stash', 'show', '--name-status', '-z', '--include-untracked', ref]);
    return parseNameStatusZ(result.stdout);
  }

  async remoteWebUrl(root: string, hash: string): Promise<string | undefined> {
    const result = await runGit(root, ['remote', 'get-url', 'origin']);
    if (result.exitCode !== 0) return undefined;
    const normalized = result.stdout.trim()
      .replace(/^git@([^:]+):/, 'https://$1/')
      .replace(/^ssh:\/\/git@([^/]+)\//, 'https://$1/')
      .replace(/\.git$/, '');
    return /^https?:\/\/(github\.com|gitlab\.[^/]+|[^/]*gitlab[^/]*)\//i.test(normalized)
      ? `${normalized}/commit/${hash}` : undefined;
  }

  async workingTreeFiles(root: string): Promise<GitFileChange[]> {
    const result = await this.git(root, ['status', '--porcelain=v1', '-z']);
    return parseWorkingTreeStatus(result.stdout);
  }

  async git(root: string, args: string[], token?: vscode.CancellationToken): Promise<{ stdout: string; stderr: string }> {
    const result = await runGit(root, args, token);
    if (result.exitCode !== 0 && !result.cancelled) throw new GitCommandError(args, result.stderr, result.exitCode);
    if (result.cancelled) throw new vscode.CancellationError();
    return result;
  }
}

const emptyTreeHash = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

function readStatusHeader(fields: string[], prefix: string): string | undefined {
  return fields.find(value => value.startsWith(prefix))?.slice(prefix.length);
}

function parseRefs(output: string, head: string): GitRefInfo[] {
  const refs: GitRefInfo[] = [];
  for (const line of output.split(/\r?\n/)) {
    const [fullName, name, hash, upstream, track] = line.split('\0');
    if (!fullName) continue;
    const kind = fullName.startsWith('refs/heads/') ? 'local' : fullName.startsWith('refs/remotes/') ? 'remote' : 'tag';
    const ahead = /ahead (\d+)/.exec(track)?.[1];
    const behind = /behind (\d+)/.exec(track)?.[1];
    refs.push({ fullName, name, hash, upstream: upstream || undefined, kind, ahead: Number(ahead) || 0, behind: Number(behind) || 0, current: kind === 'local' && name === head });
  }
  return refs;
}

function parseStashes(output: string): GitStashInfo[] {
  const stashes: GitStashInfo[] = [];
  for (const line of output.split(/\r?\n/)) {
    const [ref, hash, message, timestamp] = line.split('\0');
    if (ref) stashes.push({ ref, hash, message, timestamp: Number(timestamp) || 0 });
  }
  return stashes;
}

function buildFilterArgs(filter: GitLogFilter): string[] {
  const args: string[] = [];
  if (filter.text) {
    args.push(`--grep=${filter.regex ? filter.text : escapeRegex(filter.text)}`);
    if (!filter.matchCase) args.push('--regexp-ignore-case');
    if (!filter.regex) args.push('--fixed-strings');
  }
  if (filter.author) args.push(`--author=${filter.author}`);
  if (filter.since) args.push(`--since=${filter.since}`);
  if (filter.until) args.push(`--until=${filter.until}`);
  return args;
}

function escapeRegex(value: string): string { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

async function detectOperation(root: string): Promise<GitOperationState | undefined> {
  const gitDirResult = await runGit(root, ['rev-parse', '--git-dir']);
  if (gitDirResult.exitCode !== 0) return undefined;
  const gitDir = path.resolve(root, gitDirResult.stdout.trim());
  const checks: Array<[string, GitOperationState]> = [
    ['MERGE_HEAD', 'MERGING'], ['rebase-merge', 'REBASING'], ['rebase-apply', 'REBASING'],
    ['CHERRY_PICK_HEAD', 'CHERRY-PICKING'], ['REVERT_HEAD', 'REVERTING']
  ];
  for (const [name, state] of checks) {
    try { await vscode.workspace.fs.stat(vscode.Uri.file(path.join(gitDir, name))); return state; } catch { /* absent */ }
  }
  return undefined;
}
