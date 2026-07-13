import * as path from 'path';
import * as vscode from 'vscode';
import { runGit } from './gitCli';
import { GitCommitDetail, GitCommitSummary, GitFileChange, GitGraphSnapshot, GitLogFilter, GitLogPage, GitOperationState, GitRefInfo, GitRepositorySnapshot, GitStashInfo } from './gitPanelModels';
import { logPrettyFormat, parseLog, parseNameStatusZ, parseNumstatZ, parseWorkingTreeStatus } from './gitPanelParsers';
import { computeGraphLayout } from './gitGraphLayout';
import { BoundedCache } from './boundedCache';

export class GitCommandError extends Error {
  constructor(readonly args: string[], readonly stderr: string, readonly exitCode: number) {
    super(stderr.trim() || `git ${args[0]} failed with exit code ${exitCode}.`);
  }
}

export class GitRepositoryService {
  private readonly graphSnapshots = new Map<string, GitGraphSnapshot>();
  private readonly logCache = new BoundedCache<GitLogPage>(30);
  private readonly detailCache = new BoundedCache<GitCommitDetail>(80);
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

  async snapshot(root: string, token?: vscode.CancellationToken): Promise<GitRepositorySnapshot> {
    const [status, refs, stashes] = await Promise.all([
      this.git(root, ['status', '--porcelain=v2', '--branch', '-z'], token),
      this.git(root, ['for-each-ref', '--format=%(refname)%00%(refname:short)%00%(objectname)%00%(upstream:short)%00%(upstream:track)', 'refs/heads', 'refs/remotes', 'refs/tags'], token),
      this.git(root, ['stash', 'list', '--format=%gd%x00%H%x00%gs%x00%ct%x00'], token)
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

  async log(root: string, offset: number, limit: number, filter: GitLogFilter, token?: vscode.CancellationToken): Promise<GitLogPage> {
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
    const cacheKey = `${root}\0${offset}\0${limit}\0${JSON.stringify(effectiveFilter)}\0${revisions.join('\0')}`;
    const cached = this.logCache.get(cacheKey);
    if (cached) return cached;
    const [records, count] = await Promise.all([
      this.git(root, ['log', `--format=${logPrettyFormat}`, '--decorate=full', `--skip=${offset}`, `--max-count=${limit}`, ...shared, ...tail], token),
      this.git(root, ['rev-list', '--count', ...shared, ...tail], token)
    ]);
    const parsed = parseLog(records.stdout);
    const graphKey = `${root}\0${JSON.stringify(effectiveFilter)}\0${revisions.join('\0')}`;
    if (offset === 0) {
      for (const key of [...this.graphSnapshots.keys()]) if (key.startsWith(`${graphKey}\0`)) this.graphSnapshots.delete(key);
    }
    const layout = computeGraphLayout(parsed, this.graphSnapshots.get(`${graphKey}\0${offset}`));
    this.graphSnapshots.set(`${graphKey}\0${offset + parsed.length}`, layout.snapshot);
    const commits = parsed.map(commit => ({ ...commit, lane: layout.lanes[commit.hash] }));
    const total = Number(count.stdout.trim()) || 0;
    const page = { commits, offset, total, hasMore: offset + commits.length < total };
    this.logCache.set(cacheKey, page);
    return page;
  }

  async commitDetail(root: string, hash: string, parent?: number, token?: vscode.CancellationToken): Promise<GitCommitDetail> {
    const cacheKey = `${root}\0${hash}\0${parent ?? 1}`;
    const cached = this.detailCache.get(cacheKey);
    if (cached) return cached;
    const meta = await this.git(root, ['show', '-s', `--format=${logPrettyFormat}%x1f%B%x1f%cn%x1f%ce%x1f%ct`, hash], token);
    const commit = parseLog(meta.stdout)[0];
    if (!commit) throw new Error(`Commit ${hash} was not found.`);
    const fields = meta.stdout.split('\x1f');
    const base = parent && commit.parents[parent - 1] ? commit.parents[parent - 1] : `${hash}^`;
    const files = parent === 0 && commit.parents.length > 1
      ? mergeFileChanges((await Promise.all(commit.parents.map(value => this.filesBetween(root, value, hash)))).flat())
      : await this.filesBetween(root, commit.parents.length ? base : emptyTreeHash, hash);
    const detail = {
      ...commit,
      message: fields[8]?.replace(/\x1e|\r?\n$/g, '') || commit.subject,
      committer: fields[9] || commit.author,
      committerEmail: fields[10] || commit.authorEmail,
      committerTimestamp: Number(fields[11]) || commit.authorTimestamp,
      files
    };
    this.detailCache.set(cacheKey, detail);
    return detail;
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

  async commitsInRange(root: string, range: string, limit = 100): Promise<GitCommitSummary[]> {
    const result = await this.git(root, ['log', `--max-count=${limit}`, `--format=${logPrettyFormat}`, range]);
    return parseLog(result.stdout);
  }

  async repositoryFiles(root: string, ref: string): Promise<string[]> {
    const result = await this.git(root, ['ls-tree', '-r', '--name-only', '-z', ref]);
    return result.stdout.split('\0').filter(Boolean);
  }

  async reverseFileChange(root: string, hash: string, filePath: string): Promise<void> {
    const commit = parseLog((await this.git(root, ['show', '-s', `--format=${logPrettyFormat}`, hash])).stdout)[0];
    if (!commit?.parents[0]) throw new Error('A root commit file cannot be reversed with a parent patch.');
    const patch = await this.git(root, ['diff', '--binary', commit.parents[0], hash, '--', filePath]);
    const result = await runGit(root, ['apply', '--reverse', '--index', '-'], undefined, patch.stdout);
    if (result.exitCode !== 0) throw new GitCommandError(['apply', '--reverse'], result.stderr, result.exitCode);
  }

  async workingTreeFiles(root: string, token?: vscode.CancellationToken): Promise<GitFileChange[]> {
    const result = await this.git(root, ['status', '--porcelain=v1', '-z'], token);
    return parseWorkingTreeStatus(result.stdout);
  }

  async git(root: string, args: string[], token?: vscode.CancellationToken): Promise<{ stdout: string; stderr: string }> {
    const result = await runGit(root, args, token);
    if (result.exitCode !== 0 && !result.cancelled) throw new GitCommandError(args, result.stderr, result.exitCode);
    if (result.cancelled) throw new vscode.CancellationError();
    return result;
  }

  invalidateCaches(root: string): void {
    const prefix = `${root}\0`;
    this.logCache.deletePrefix(prefix);
    this.detailCache.deletePrefix(prefix);
    for (const key of this.graphSnapshots.keys()) if (key.startsWith(prefix)) this.graphSnapshots.delete(key);
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

function mergeFileChanges(files: GitFileChange[]): GitFileChange[] {
  const merged = new Map<string, GitFileChange>();
  for (const file of files) {
    const current = merged.get(file.path);
    merged.set(file.path, current ? { ...file, additions: current.additions + file.additions, deletions: current.deletions + file.deletions } : file);
  }
  return [...merged.values()];
}
