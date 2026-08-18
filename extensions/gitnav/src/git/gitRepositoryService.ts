import * as path from 'path';
import * as vscode from 'vscode';
import { runGit } from './gitCli';
import { GitCommitDetail, GitCommitSummary, GitFileChange, GitFilterOptions, GitGraphSnapshot, GitLogFilter, GitLogPage, GitOperationState, GitRefInfo, GitRepositorySnapshot, GitStashInfo, GitWorktreeInfo } from './gitPanelModels';
import { logPrettyFormat, parseLog, parseNameStatusZ, parseNumstatZ, parseWorkingTreeStatus, parseWorkingTreeStatusV2 } from './gitPanelParsers';
import { computeGraphLayout } from './gitGraphLayout';
import { BoundedCache } from './boundedCache';
import { RepositoryDomainCache, RepositoryDomainCacheStats } from './repositoryDomainCache';

export class GitCommandError extends Error {
  constructor(readonly args: string[], readonly stderr: string, readonly exitCode: number) {
    super(stderr.trim() || `git ${args[0]} failed with exit code ${exitCode}.`);
  }
}

export class GitRepositoryReadResult {
  constructor(
    readonly repository: GitRepositorySnapshot,
    readonly uncommitted: GitFileChange[]
  ) {}
}

export type GitRepositoryStateDomain = 'status' | 'refs' | 'stashes' | 'worktrees';

interface GitStatusDomain {
  readonly head: string;
  readonly upstream?: string;
  readonly ahead: number;
  readonly behind: number;
  readonly operation?: GitOperationState;
  readonly uncommitted: GitFileChange[];
}

export class GitRepositoryService {
  private diagnosticLogger?: (message: string) => void;
  private readonly lastFetched = new Map<string, number>();
  private repositoryDiscoveryCache?: string[];
  private repositoryDiscoveryInFlight?: Promise<string[]>;
  private readonly statusCache = new RepositoryDomainCache<GitStatusDomain>(300);
  private readonly refsCache = new RepositoryDomainCache<string>(2_000);
  private readonly stashesCache = new RepositoryDomainCache<GitStashInfo[]>(2_000);
  private readonly worktreesCache = new RepositoryDomainCache<GitWorktreeInfo[]>(5_000);
  private readonly graphSnapshots = new BoundedCache<GitGraphSnapshot>(120);
  private readonly logCache = new BoundedCache<GitLogPage>(30);
  private readonly detailCache = new BoundedCache<GitCommitDetail>(80);
  private readonly filterOptionsCache = new Map<string, { expiresAt: number; value: GitFilterOptions }>();

  setDiagnosticLogger(logger: (message: string) => void): void {
    this.diagnosticLogger = logger;
  }

  async discoverRepositories(force = false): Promise<string[]> {
    const cached = this.repositoryDiscoveryCache;
    if (!force && cached) return cached;
    if (!force && this.repositoryDiscoveryInFlight) return this.repositoryDiscoveryInFlight;
    const discovery = this.discoverRepositoriesCore();
    this.repositoryDiscoveryInFlight = discovery;
    try {
      const roots = await discovery;
      this.repositoryDiscoveryCache = roots;
      return roots;
    } finally {
      if (this.repositoryDiscoveryInFlight === discovery) this.repositoryDiscoveryInFlight = undefined;
    }
  }

  private async discoverRepositoriesCore(): Promise<string[]> {
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

  async snapshot(root: string, token?: vscode.CancellationToken, force = false): Promise<GitRepositorySnapshot> {
    return (await this.repositoryState(root, token, force)).repository;
  }

  async repositoryState(root: string, token?: vscode.CancellationToken, force = false): Promise<GitRepositoryReadResult> {
    const cacheOptions = { force, shareInFlight: !token };
    const [status, refsOutput, stashes, worktrees] = await Promise.all([
      this.statusCache.read(root, () => this.readStatusDomain(root, token), cacheOptions),
      this.refsCache.read(root, async () =>
        (await this.git(root, ['for-each-ref', '--format=%(refname)%00%(refname:short)%00%(objectname)%00%(upstream:short)%00%(upstream:track)', 'refs/heads', 'refs/remotes', 'refs/tags'], token)).stdout,
      cacheOptions),
      this.stashesCache.read(root, async () =>
        parseStashes((await this.git(root, ['stash', 'list', '--format=%gd%x00%H%x00%gs%x00%ct%x00'], token)).stdout),
      cacheOptions),
      this.worktreesCache.read(root, async () =>
        parseWorktrees((await this.git(root, ['worktree', 'list', '--porcelain'], token)).stdout, root),
      cacheOptions)
    ]);
    const snapshot = {
      root,
      name: path.basename(root),
      head: status.head,
      detached: status.head === '(detached)',
      upstream: status.upstream,
      ahead: status.ahead,
      behind: status.behind,
      changedCount: status.uncommitted.length,
      lastFetchedAt: this.lastFetched.get(root),
      operation: status.operation,
      refs: parseRefs(refsOutput, status.head),
      stashes,
      worktrees
    };
    return new GitRepositoryReadResult(snapshot, status.uncommitted);
  }

  private async readStatusDomain(root: string, token?: vscode.CancellationToken): Promise<GitStatusDomain> {
    const result = await this.git(root, ['status', '--porcelain=v2', '--branch', '-z'], token);
    const fields = result.stdout.split('\0');
    const ab = readStatusHeader(fields, '# branch.ab ');
    const match = ab ? /\+(\d+)\s+-(\d+)/.exec(ab) : undefined;
    return {
      head: readStatusHeader(fields, '# branch.head ') || 'HEAD',
      upstream: readStatusHeader(fields, '# branch.upstream '),
      ahead: Number(match?.[1]) || 0,
      behind: Number(match?.[2]) || 0,
      operation: await detectOperation(root),
      uncommitted: parseWorkingTreeStatusV2(result.stdout)
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
    const records = await this.git(root, ['log', `--format=${logPrettyFormat}`, '--decorate=full', `--skip=${offset}`, `--max-count=${limit + 1}`, ...shared, ...tail], token);
    const parsedWithLookahead = parseLog(records.stdout);
    const hasMore = parsedWithLookahead.length > limit;
    const parsed = parsedWithLookahead.slice(0, limit);
    const graphKey = `${root}\0${JSON.stringify(effectiveFilter)}\0${revisions.join('\0')}`;
    if (offset === 0) this.graphSnapshots.deletePrefix(`${graphKey}\0`);
    const layout = computeGraphLayout(parsed, this.graphSnapshots.get(`${graphKey}\0${offset}`));
    this.graphSnapshots.set(`${graphKey}\0${offset + parsed.length}`, layout.snapshot);
    const commits = parsed.map(commit => ({ ...commit, lane: layout.lanes[commit.hash] }));
    const page = { commits, offset, hasMore };
    this.logCache.set(cacheKey, page);
    return page;
  }

  async filterOptions(root: string, token?: vscode.CancellationToken): Promise<GitFilterOptions> {
    const cached = this.filterOptionsCache.get(root);
    if (cached && cached.expiresAt > Date.now()) return cached.value;
    const [filesResult, deletedResult] = await Promise.all([
      this.git(root, ['ls-files', '-co', '--exclude-standard', '-z'], token),
      this.git(root, ['ls-files', '--deleted', '-z'], token)
    ]);
    const deleted = new Set(deletedResult.stdout.split('\0').filter(Boolean));
    const value = {
      authors: [],
      files: filesResult.stdout.split('\0').filter(file => file && !deleted.has(file)).sort()
    };
    this.filterOptionsCache.set(root, { value, expiresAt: Date.now() + 30_000 });
    return value;
  }

  async searchAuthors(root: string, query: string, token?: vscode.CancellationToken): Promise<GitFilterOptions['authors']> {
    const result = await this.git(root, [
      'log', '--all', '--max-count=200', `--author=${query}`, '--regexp-ignore-case', '--fixed-strings',
      '--format=%an%x00%ae%x00'
    ], token);
    return parseFilterAuthors(result.stdout);
  }

  async commitDetail(root: string, hash: string, parent?: number, token?: vscode.CancellationToken): Promise<GitCommitDetail> {
    const cacheKey = `${root}\0${hash}\0${parent ?? 1}`;
    const cached = this.detailCache.get(cacheKey);
    if (cached) return cached;
    const meta = await this.git(root, ['show', '-s', `--format=${logPrettyFormat}%x1f%B%x1f%cn%x1f%ce%x1f%ct%x1f%G?%x1f%GS`, hash], token);
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
      signature: signatureState(fields[12]),
      signatureSigner: fields[13]?.replace(/\x1e|\r?\n$/g, '') || undefined,
      files
    };
    this.detailCache.set(cacheKey, detail);
    return detail;
  }

  async publishedCommits(root: string, hashes: string[]): Promise<string[]> {
    const snapshot = await this.snapshot(root);
    const remoteBranch = `origin/${snapshot.head}`;
    if (snapshot.detached || !snapshot.refs.some(ref => ref.kind === 'remote' && ref.name === remoteBranch)) return [];
    const published: string[] = [];
    for (const hash of hashes) {
      const result = await runGit(root, ['merge-base', '--is-ancestor', hash, remoteBranch]);
      if (result.exitCode === 0) published.push(hash);
    }
    return published;
  }

  async worktreeChangedCount(worktreePath: string): Promise<number> {
    const result = await runGit(worktreePath, ['status', '--porcelain', '-z']);
    if (result.exitCode !== 0) throw new GitCommandError(['status', '--porcelain'], result.stderr, result.exitCode);
    return result.stdout.split('\0').filter(Boolean).length;
  }

  markFetched(root: string): void { this.lastFetched.set(root, Date.now()); }

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

  async filePatch(
    root: string,
    filePath: string,
    hash?: string,
    parent?: number,
    working?: boolean,
    token?: vscode.CancellationToken,
    from?: string,
    to?: string
  ): Promise<string> {
    try {
      if (from && to) {
        if (to === 'working tree') {
          const res = await runGit(root, ['diff', '-U3', from, '--', filePath], token);
          return res.exitCode === 0 ? res.stdout : '';
        }
        const res = await runGit(root, ['diff', '-U3', `${from}...${to}`, '--', filePath], token);
        if (res.exitCode === 0 && res.stdout.trim()) {
          return res.stdout;
        }
        const directRes = await runGit(root, ['diff', '-U3', from, to, '--', filePath], token);
        return directRes.exitCode === 0 ? directRes.stdout : '';
      }

      if (working) {
        const res = await runGit(root, ['diff', '-U3', '--', filePath], token);
        if (res.exitCode === 0 && res.stdout.trim()) {
          return res.stdout;
        }
        const stagedRes = await runGit(root, ['diff', '--cached', '-U3', '--', filePath], token);
        if (stagedRes.exitCode === 0 && stagedRes.stdout.trim()) {
          return stagedRes.stdout;
        }
        const untrackedRes = await runGit(root, ['diff', '--no-index', '--', '/dev/null', filePath], token);
        return untrackedRes.exitCode === 0 || untrackedRes.exitCode === 1 ? untrackedRes.stdout : '';
      }

      if (hash) {
        if (parent === 0) {
          const combinedRes = await runGit(root, ['show', '--format=', '--cc', '-U3', hash, '--', filePath], token);
          return combinedRes.exitCode === 0 ? combinedRes.stdout : '';
        }

        const parentNum = parent && parent >= 1 ? parent : 1;
        const diffRes = await runGit(root, ['diff', '-U3', `${hash}^${parentNum}`, hash, '--', filePath], token);
        if (diffRes.exitCode === 0 && diffRes.stdout.trim()) {
          return diffRes.stdout;
        }

        const rootRes = await runGit(root, ['diff-tree', '-p', '--root', '-U3', hash, '--', filePath], token);
        if (rootRes.exitCode === 0 && rootRes.stdout.trim()) {
          return rootRes.stdout;
        }

        const showRes = await runGit(root, ['show', '--format=', '-U3', hash, '--', filePath], token);
        return showRes.exitCode === 0 ? showRes.stdout : '';
      }
    } catch {
      // Ignored for graceful fallback
    }
    return '';
  }

  async workingTreeFiles(root: string, token?: vscode.CancellationToken): Promise<GitFileChange[]> {
    const result = await this.git(root, ['status', '--porcelain=v1', '-z'], token);
    return parseWorkingTreeStatus(result.stdout);
  }

  async git(root: string, args: string[], token?: vscode.CancellationToken): Promise<{ stdout: string; stderr: string }> {
    const startedAt = Date.now();
    try {
      const result = await runGit(root, args, token);
      if (result.exitCode !== 0 && !result.cancelled) {
        throw new GitCommandError(args, withAuthenticationHint(result.stderr), result.exitCode);
      }
      if (result.cancelled) throw new vscode.CancellationError();
      return result;
    } finally {
      const durationMs = Date.now() - startedAt;
      if (durationMs >= 100) this.diagnosticLogger?.(`Slow Git command: ${args[0] ?? 'unknown'} (${durationMs} ms)`);
    }
  }

  invalidateCaches(root: string): void {
    const prefix = `${root}\0`;
    this.invalidateRepositoryState(root);
    this.logCache.deletePrefix(prefix);
    this.graphSnapshots.deletePrefix(prefix);
  }

  invalidateRepositoryState(
    root: string,
    domains: readonly GitRepositoryStateDomain[] = ['status', 'refs', 'stashes', 'worktrees']
  ): void {
    for (const domain of domains) {
      if (domain === 'status') this.statusCache.invalidate(root);
      else if (domain === 'refs') this.refsCache.invalidate(root);
      else if (domain === 'stashes') this.stashesCache.invalidate(root);
      else this.worktreesCache.invalidate(root);
    }
  }

  repositoryStateCacheStats(): Record<GitRepositoryStateDomain, RepositoryDomainCacheStats> {
    return {
      status: this.statusCache.stats,
      refs: this.refsCache.stats,
      stashes: this.stashesCache.stats,
      worktrees: this.worktreesCache.stats
    };
  }

  invalidateRepositoryDiscovery(): void {
    this.repositoryDiscoveryCache = undefined;
  }
}

function withAuthenticationHint(stderr: string): string {
  if (process.env.SSH_AUTH_SOCK || !/permission denied \(publickey\)/i.test(stderr)) {
    return stderr;
  }
  return `${stderr.trim()}\nGitNav's VS Code extension host has no SSH_AUTH_SOCK. Restart VS Code from a terminal that can access the repository, then try again.`;
}

function signatureState(value?: string): GitCommitDetail['signature'] {
  if (!value || value === 'N') return 'unsigned';
  if (value === 'G' || value === 'U' || value === 'X' || value === 'Y') return 'good';
  if (value === 'B' || value === 'E' || value === 'R') return 'bad';
  return 'unknown';
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

export function parseWorktrees(output: string, currentRoot: string): GitWorktreeInfo[] {
  return output.trim().split(/\r?\n\r?\n/).filter(Boolean).map(record => {
    const values = new Map<string, string>();
    for (const line of record.split(/\r?\n/)) {
      const space = line.indexOf(' ');
      values.set(space < 0 ? line : line.slice(0, space), space < 0 ? '' : line.slice(space + 1));
    }
    const worktreePath = values.get('worktree') ?? '';
    return {
      path: worktreePath,
      head: values.get('HEAD') ?? '',
      branch: values.get('branch')?.replace(/^refs\/heads\//, ''),
      detached: values.has('detached'), bare: values.has('bare'),
      locked: values.get('locked') || undefined, prunable: values.get('prunable') || undefined,
      current: path.resolve(worktreePath) === path.resolve(currentRoot)
    };
  });
}

function buildFilterArgs(filter: GitLogFilter): string[] {
  const args: string[] = [];
  if (filter.text) args.push(`--grep=${filter.text}`);
  for (const author of filter.authors ?? []) args.push(`--author=<${author}>`);
  if (filter.text || filter.authors?.length) args.push('--regexp-ignore-case', '--fixed-strings');
  if (filter.since) args.push(`--since=${filter.since}`);
  if (filter.until) args.push(`--until=${filter.until}`);
  return args;
}

function parseFilterAuthors(output: string): GitFilterOptions['authors'] {
  const fields = output.split('\0');
  const authors = new Map<string, { name: string; email: string }>();
  for (let index = 0; index + 1 < fields.length; index += 2) {
    const name = fields[index].replace(/^\r?\n/, '').trim();
    const email = fields[index + 1].trim();
    if (email) authors.set(email.toLowerCase(), { name: name || email, email });
  }
  return [...authors.values()].sort((a, b) => a.name.localeCompare(b.name));
}

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
