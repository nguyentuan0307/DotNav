import * as path from 'path';

export function normalizeSlashes(value: string): string {
  return value.replace(/\\/g, '/');
}

/**
 * MSBuild and .sln files store paths with backslashes regardless of host OS.
 * On POSIX a backslash is a valid filename character, so path.resolve would
 * treat the whole segment as one name instead of a directory chain.
 */
export function resolveMsbuildPath(baseDirectory: string, msbuildPath: string): string {
  return path.resolve(baseDirectory, msbuildPath.replace(/\\/g, path.sep));
}

export function pathExistsLabel(filePath: string): string {
  return path.basename(filePath);
}

export function uniqueByPath<T extends { path: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  const result: T[] = [];

  for (const item of items) {
    const key = path.resolve(item.path).toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      result.push(item);
    }
  }

  return result;
}

export function relativeOrName(rootPath: string, itemPath: string): string {
  const relative = path.relative(rootPath, itemPath);
  return relative.length > 0 ? relative : path.basename(itemPath);
}
