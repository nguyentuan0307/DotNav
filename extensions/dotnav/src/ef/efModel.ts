// Instant, build-free discovery of DbContexts and migrations by reading source
// files, mirroring how Rider populates its EF dialogs from the IDE code model.
// A `dotnet ef` round trip costs ~54s on a large solution; this costs ~50ms.
// No vscode imports so the module is directly unit-testable.

import * as fs from 'fs/promises';
import * as path from 'path';
import { normalizePath } from '../pathUtils';
import { parseMigrationFileName } from './efJsonParser';

export interface DiscoveredDbContext {
  readonly name: string;
  readonly fullName: string;
  /** Absolute path of the file declaring the class. */
  readonly filePath: string;
}

export interface DiscoveredMigration {
  readonly id: string;
  readonly name: string;
  readonly filePath: string;
}

export interface ProjectEfModel {
  readonly contexts: readonly DiscoveredDbContext[];
  readonly migrations: readonly DiscoveredMigration[];
  /** Migrations grouped by the DbContext their folder belongs to, when detectable. */
  readonly migrationsByContext: ReadonlyMap<string, readonly DiscoveredMigration[]>;
}

const skipDirectories = new Set(['bin', 'obj', 'node_modules', '.git', '.vs', 'wwwroot', 'packages']);

const classDeclarationPattern =
  /\bclass\s+([A-Za-z_][A-Za-z0-9_]*)\s*(?:<[^>{]*>)?\s*(?::\s*([^{]+))?/g;
const namespacePattern = /^\s*namespace\s+([A-Za-z_][A-Za-z0-9_.]*)/m;
// `[DbContext(typeof(AppDbContext))]` in generated *.Designer.cs and snapshots.
// EF writes this itself, so it is the authoritative name of the context.
const designerContextAttributePattern = /\[DbContext\(typeof\(([A-Za-z_][A-Za-z0-9_.]*)\)\)\]/;

interface CachedModel {
  readonly signature: string;
  readonly model: ProjectEfModel;
}

const modelCache = new Map<string, CachedModel>();

export function invalidateEfModel(projectDirectory?: string): void {
  if (!projectDirectory) {
    modelCache.clear();
    return;
  }

  modelCache.delete(normalizePath(projectDirectory));
}

/**
 * Scans a project directory for DbContext classes and migration files.
 * Results are cached until the directory's newest .cs mtime changes.
 */
export async function loadEfModel(projectDirectory: string): Promise<ProjectEfModel> {
  const key = normalizePath(projectDirectory);
  const files = await collectCsFiles(projectDirectory);
  const signature = await modelSignature(files);
  const cached = modelCache.get(key);
  if (cached?.signature === signature) {
    return cached.model;
  }

  const model = await buildModel(files);
  modelCache.set(key, { signature, model });
  return model;
}

async function modelSignature(files: readonly string[]): Promise<string> {
  // Cheap fingerprint: file count plus the newest mtime across candidates.
  let newest = 0;
  await Promise.all(files.map(async filePath => {
    try {
      const stat = await fs.stat(filePath);
      if (stat.mtimeMs > newest) {
        newest = stat.mtimeMs;
      }
    } catch {
      // Deleted between listing and stat; the count already changed.
    }
  }));

  return `${files.length}:${newest}`;
}

interface ClassDeclaration {
  readonly name: string;
  readonly namespaceName?: string;
  readonly filePath: string;
  readonly derivesFromDbContext: boolean;
}

async function buildModel(files: readonly string[]): Promise<ProjectEfModel> {
  const migrations: DiscoveredMigration[] = [];
  const declarations = new Map<string, ClassDeclaration>();
  // migration id -> DbContext name, read from generated designer files.
  const migrationContextById = new Map<string, string>();
  // Names EF itself recorded in designers/snapshots; authoritative.
  const attributeContexts = new Set<string>();

  await Promise.all(files.map(async filePath => {
    const fileName = path.basename(filePath);
    const migration = parseMigrationFileName(fileName);
    if (migration) {
      migrations.push({ ...migration, filePath });
      return;
    }

    const content = await readSourceHead(filePath);
    if (content === undefined) {
      return;
    }

    const owner = content.includes('[DbContext(')
      ? designerContextAttributePattern.exec(content)?.[1]
      : undefined;
    if (owner) {
      attributeContexts.add(owner.split('.').pop()!);
      const designerMigration = parseMigrationFileName(fileName.replace(/\.Designer\.cs$/i, '.cs'));
      if (designerMigration) {
        migrationContextById.set(designerMigration.id, owner);
      }
    }

    if (/\.Designer\.cs$/i.test(fileName)) {
      return;
    }

    const namespaceName = namespacePattern.exec(content)?.[1];
    classDeclarationPattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = classDeclarationPattern.exec(content)) !== null) {
      const [, className, baseList] = match;
      const derivesFromDbContext = derivesFromDbContextBase(baseList);
      const existing = declarations.get(className);
      // Partial classes split the base list across files; keep the half that
      // actually names a base type.
      if (!existing || (derivesFromDbContext && !existing.derivesFromDbContext)) {
        declarations.set(className, { name: className, namespaceName, filePath, derivesFromDbContext });
      }
    }
  }));

  const contexts: DiscoveredDbContext[] = [];
  const seenContexts = new Set<string>();
  const addContext = (name: string) => {
    if (seenContexts.has(name)) {
      return;
    }

    seenContexts.add(name);
    const declaration = declarations.get(name);
    contexts.push({
      name,
      fullName: declaration?.namespaceName ? `${declaration.namespaceName}.${name}` : name,
      filePath: declaration?.filePath ?? ''
    });
  };

  for (const declaration of declarations.values()) {
    if (declaration.derivesFromDbContext) {
      addContext(declaration.name);
    }
  }

  for (const name of attributeContexts) {
    addContext(name);
  }

  migrations.sort((a, b) => a.id.localeCompare(b.id));
  contexts.sort((a, b) => a.name.localeCompare(b.name));

  const migrationsByContext = new Map<string, DiscoveredMigration[]>();
  for (const migration of migrations) {
    const owner = migrationContextById.get(migration.id);
    const contextName = owner ? owner.split('.').pop()! : undefined;
    const key = contextName && seenContexts.has(contextName) ? contextName : '';
    const bucket = migrationsByContext.get(key) ?? [];
    bucket.push(migration);
    migrationsByContext.set(key, bucket);
  }

  return { contexts, migrations, migrationsByContext };
}

/** Migrations owned by a context, falling back to every migration when unknown. */
export function migrationsForContext(model: ProjectEfModel, contextName?: string): readonly DiscoveredMigration[] {
  if (!contextName) {
    return model.migrations;
  }

  const owned = model.migrationsByContext.get(contextName);
  if (owned && owned.length > 0) {
    return owned;
  }

  // Single-context projects never carry an owner mapping worth splitting on.
  return model.migrationsByContext.size <= 1 ? model.migrations : [];
}

/**
 * True when the first entry of a C# base list is a DbContext-derived type.
 *
 * Only the first entry matters: C# requires the base class before any
 * interfaces. Checking the whole list would misread
 * `Repository<Entity, AppDbContext>` — where the context is a type argument —
 * as a context itself. Matching is case-insensitive and suffix-based so custom
 * intermediates like `AuditlogDBContext` are recognised.
 */
export function derivesFromDbContextBase(baseList: string | undefined): boolean {
  const first = firstBaseType(baseList);
  return first !== undefined && /dbcontext$/i.test(first);
}

function firstBaseType(baseList: string | undefined): string | undefined {
  if (!baseList) {
    return undefined;
  }

  let depth = 0;
  let end = baseList.length;
  for (let index = 0; index < baseList.length; index += 1) {
    const character = baseList[index];
    if (character === '<') {
      depth += 1;
    } else if (character === '>') {
      depth -= 1;
    } else if ((character === ',' || character === '{') && depth === 0) {
      end = index;
      break;
    }
  }

  const name = baseList
    .slice(0, end)
    .replace(/<[\s\S]*$/, '')
    .replace(/\bwhere\b[\s\S]*$/, '')
    .trim()
    .split('.')
    .pop()
    ?.trim();
  return name && name.length > 0 ? name : undefined;
}

/** Class names in `content` whose base class derives from DbContext. */
export function findDbContextClasses(content: string): string[] {
  const found: string[] = [];
  classDeclarationPattern.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = classDeclarationPattern.exec(content)) !== null) {
    if (derivesFromDbContextBase(match[2])) {
      found.push(match[1]);
    }
  }

  return found;
}

// Generated designers and model snapshots run to hundreds of KB each; their
// namespace, [DbContext] attribute, and class header all sit in the first few
// KB, so large files are only read at the head.
const largeFileThresholdBytes = 128 * 1024;
const largeFileHeadBytes = 16 * 1024;

async function readSourceHead(filePath: string): Promise<string | undefined> {
  let handle;
  try {
    handle = await fs.open(filePath, 'r');
    const stat = await handle.stat();
    if (stat.size <= largeFileThresholdBytes) {
      return await handle.readFile('utf8');
    }

    const buffer = Buffer.alloc(largeFileHeadBytes);
    const { bytesRead } = await handle.read(buffer, 0, largeFileHeadBytes, 0);
    return buffer.subarray(0, bytesRead).toString('utf8');
  } catch {
    return undefined;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

async function collectCsFiles(root: string): Promise<string[]> {
  const results: string[] = [];
  const stack = [root];

  while (stack.length > 0) {
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
      }
    }
  }

  return results.sort();
}
