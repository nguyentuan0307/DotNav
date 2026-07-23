import * as fs from 'fs/promises';
import * as path from 'path';
import { ProjectModel } from '../models';
import { normalizePath } from '../pathUtils';
import {
  EfDbContextEntry,
  parseDbContextList,
  parseMigrationFileName,
  parseMigrationsList
} from './efJsonParser';
import { EfCommandRequest, EfCommandResult } from './efCli';
import { GenerationTracker } from './efQueue';

export type MigrationStatus = 'applied' | 'pending' | 'unknown';

export interface MigrationModel {
  readonly id: string;
  readonly name: string;
  readonly status: MigrationStatus;
  readonly filePath?: string;
}

export interface DbContextModel extends EfDbContextEntry {
  readonly projectPath: string;
  /** True when discovered via static regex scan instead of the CLI. */
  readonly unverified?: boolean;
}

export interface MigrationsSnapshot {
  readonly migrations: readonly MigrationModel[];
  /** 'db' when applied state came from the database, 'folder' when offline. */
  readonly source: 'db' | 'folder';
}

/** Minimal EfCli surface, injectable for unit tests. */
export interface EfCommandRunner {
  run(request: EfCommandRequest): Promise<EfCommandResult>;
  readonly busy: boolean;
}

interface ContextResolution {
  readonly project: ProjectModel;
  readonly startupProjectPath: string;
}

const skipDirectories = new Set(['bin', 'obj', 'node_modules', '.git', '.vs']);

/**
 * Caches DbContexts and migrations per project/context with generation
 * counters so stale async results can never overwrite fresher state (design
 * §7.3), and buffers watcher events while a command runs (design §7.4).
 */
export class EfMigrationStore {
  private readonly generations = new GenerationTracker();
  private readonly contextCache = new Map<string, DbContextModel[]>();
  private readonly migrationCache = new Map<string, MigrationsSnapshot>();
  private readonly changeListeners = new Set<() => void>();
  private readonly bufferedInvalidations = new Set<string>();

  constructor(private readonly cli: EfCommandRunner) {}

  onDidChange(listener: () => void): { dispose(): void } {
    this.changeListeners.add(listener);
    return { dispose: () => this.changeListeners.delete(listener) };
  }

  private fireChanged(): void {
    for (const listener of this.changeListeners) {
      listener();
    }
  }

  private contextsKey(projectPath: string): string {
    return `contexts:${normalizePath(projectPath)}`;
  }

  private migrationsKey(projectPath: string, contextName: string | undefined): string {
    return `migrations:${normalizePath(projectPath)}|${contextName ?? ''}`;
  }

  /** One generation per project so a bump also invalidates in-flight first fetches. */
  private generationKey(projectPath: string): string {
    return normalizePath(projectPath);
  }

  /** Marks all cached data for a project stale after a write command (§7.3). */
  invalidateProject(projectPath: string, options?: { silent?: boolean }): void {
    const normalized = normalizePath(projectPath);
    this.generations.bump(this.generationKey(projectPath));
    this.contextCache.delete(this.contextsKey(projectPath));
    for (const key of [...this.migrationCache.keys()]) {
      if (key.startsWith(`migrations:${normalized}|`)) {
        this.migrationCache.delete(key);
      }
    }

    if (!options?.silent) {
      this.fireChanged();
    }
  }

  invalidateAll(): void {
    this.generations.bumpAll();
    this.contextCache.clear();
    this.migrationCache.clear();
    this.bufferedInvalidations.clear();
    this.fireChanged();
  }

  /**
   * Watcher entry point. While an EF command is running the invalidation is
   * buffered and flushed after the queue drains (design §7.4).
   */
  handleFileEvent(projectPath: string): void {
    if (this.cli.busy) {
      this.bufferedInvalidations.add(projectPath);
      return;
    }

    this.invalidateProject(projectPath);
  }

  flushBufferedEvents(): void {
    if (this.bufferedInvalidations.size === 0) {
      return;
    }

    const paths = [...this.bufferedInvalidations];
    this.bufferedInvalidations.clear();
    for (const projectPath of paths) {
      this.invalidateProject(projectPath, { silent: true });
    }

    this.fireChanged();
  }

  getCachedContexts(project: ProjectModel): DbContextModel[] | undefined {
    return this.contextCache.get(this.contextsKey(project.path));
  }

  async getContexts(
    resolution: ContextResolution,
    options?: { refresh?: boolean; retriesLeft?: number }
  ): Promise<DbContextModel[]> {
    const key = this.contextsKey(resolution.project.path);
    if (!options?.refresh) {
      const cached = this.contextCache.get(key);
      if (cached) {
        return cached;
      }
    }

    const generationKey = this.generationKey(resolution.project.path);
    const generation = this.generations.current(generationKey);
    const result = await this.cli.run({
      args: ['dbcontext', 'list'],
      project: resolution.project,
      startupProjectPath: resolution.startupProjectPath,
      title: `Discovering DbContexts in ${resolution.project.name}`,
      write: false,
      json: true
    });

    let contexts: DbContextModel[];
    if (result.kind === 'success') {
      const entries = parseDbContextList(result.stdout) ?? [];
      contexts = entries.map(entry => ({ ...entry, projectPath: resolution.project.path }));
    } else if (result.kind === 'cancelled') {
      return this.contextCache.get(key) ?? [];
    } else {
      // CLI failed — degrade to a static scan so the tree still renders (§3.2).
      contexts = await scanForDbContexts(resolution.project);
    }

    if (!this.generations.isCurrent(generationKey, generation) && (options?.retriesLeft ?? 2) > 0) {
      // A write happened while we were fetching; discard and refetch.
      return this.getContexts(resolution, { ...options, retriesLeft: (options?.retriesLeft ?? 2) - 1 });
    }

    this.contextCache.set(key, contexts);
    return contexts;
  }

  getCachedMigrations(projectPath: string, contextName: string | undefined): MigrationsSnapshot | undefined {
    return this.migrationCache.get(this.migrationsKey(projectPath, contextName));
  }

  /**
   * Loads migrations for a context. `fresh: true` bypasses the cache — used
   * right before any destructive confirmation dialog (design §7.7).
   */
  async getMigrations(
    resolution: ContextResolution,
    contextName: string | undefined,
    options?: { refresh?: boolean; fresh?: boolean; retriesLeft?: number }
  ): Promise<MigrationsSnapshot> {
    const key = this.migrationsKey(resolution.project.path, contextName);
    if (!options?.refresh && !options?.fresh) {
      const cached = this.migrationCache.get(key);
      if (cached) {
        return cached;
      }
    }

    const generationKey = this.generationKey(resolution.project.path);
    const generation = this.generations.current(generationKey);
    const result = await this.cli.run({
      args: ['migrations', 'list'],
      project: resolution.project,
      startupProjectPath: resolution.startupProjectPath,
      contextName,
      title: `Listing migrations for ${contextName ?? resolution.project.name}`,
      write: false,
      json: true
    });

    let snapshot: MigrationsSnapshot;
    if (result.kind === 'success') {
      const entries = parseMigrationsList(result.stdout) ?? [];
      const files = await findMigrationFiles(resolution.project.directory);
      const hasAppliedInfo = entries.some(entry => entry.applied !== undefined);
      snapshot = {
        source: hasAppliedInfo ? 'db' : 'folder',
        migrations: entries.map(entry => ({
          id: entry.id,
          name: entry.name,
          status: entry.applied === true ? 'applied' : entry.applied === false ? 'pending' : 'unknown',
          filePath: files.get(entry.id)
        }))
      };
    } else if (result.kind === 'cancelled') {
      return this.migrationCache.get(key) ?? { migrations: [], source: 'folder' };
    } else {
      // Offline fallback: enumerate migration files on disk (§7.6 guard, F6).
      snapshot = await migrationsFromFolder(resolution.project.directory);
    }

    if (!this.generations.isCurrent(generationKey, generation) && (options?.retriesLeft ?? 2) > 0) {
      return this.getMigrations(resolution, contextName, { ...options, retriesLeft: (options?.retriesLeft ?? 2) - 1 });
    }

    this.migrationCache.set(key, snapshot);
    return snapshot;
  }
}

async function collectCsFiles(root: string, limit: number): Promise<string[]> {
  const results: string[] = [];
  const stack = [root];
  while (stack.length > 0 && results.length < limit) {
    const current = stack.pop()!;
    let entries;
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!skipDirectories.has(entry.name.toLowerCase())) {
          stack.push(path.join(current, entry.name));
        }
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.cs')) {
        results.push(path.join(current, entry.name));
        if (results.length >= limit) {
          break;
        }
      }
    }
  }

  return results;
}

/** Map of migration id → absolute file path, scanned from the project directory. */
export async function findMigrationFiles(projectDirectory: string): Promise<Map<string, string>> {
  const files = await collectCsFiles(projectDirectory, 5000);
  const map = new Map<string, string>();
  for (const filePath of files) {
    const parsed = parseMigrationFileName(path.basename(filePath));
    if (parsed) {
      map.set(parsed.id, filePath);
    }
  }

  return map;
}

async function migrationsFromFolder(projectDirectory: string): Promise<MigrationsSnapshot> {
  const files = await findMigrationFiles(projectDirectory);
  const migrations = [...files.entries()]
    .map(([id, filePath]) => ({
      id,
      name: parseMigrationFileName(path.basename(filePath))!.name,
      status: 'unknown' as const,
      filePath
    }))
    .sort((a, b) => a.id.localeCompare(b.id));

  return { migrations, source: 'folder' };
}

const dbContextClassPattern = /\bclass\s+([A-Za-z_][A-Za-z0-9_]*)\s*(?:<[^>]*>)?\s*:\s*(?:[A-Za-z_][A-Za-z0-9_.]*\.)?(\w*DbContext)\b/g;

/** Static fallback discovery when the CLI cannot run (design §3.2). */
export async function scanForDbContexts(project: ProjectModel): Promise<DbContextModel[]> {
  const files = await collectCsFiles(project.directory, 2000);
  const contexts: DbContextModel[] = [];
  const seen = new Set<string>();

  for (const filePath of files) {
    let content: string;
    try {
      content = await fs.readFile(filePath, 'utf8');
    } catch {
      continue;
    }

    if (!content.includes('DbContext')) {
      continue;
    }

    dbContextClassPattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = dbContextClassPattern.exec(content)) !== null) {
      const name = match[1];
      if (name.endsWith('DbContextFactory') || seen.has(name)) {
        continue;
      }

      seen.add(name);
      const namespaceMatch = /namespace\s+([A-Za-z_][A-Za-z0-9_.]*)/.exec(content);
      contexts.push({
        name,
        safeName: name,
        fullName: namespaceMatch ? `${namespaceMatch[1]}.${name}` : name,
        projectPath: project.path,
        unverified: true
      });
    }
  }

  return contexts.sort((a, b) => a.name.localeCompare(b.name));
}
