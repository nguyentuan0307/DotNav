/**
 * Folder names that are collapsed into a single folder node in the solution tree
 * when a project has no solution-folder information. This happens for `.slnx`
 * solutions, whose `<Folder>` elements are not available to this grouping path:
 * projects are then grouped by the first segment of their path relative to the
 * solution root.
 */
export const DEFAULT_CONTAINER_FOLDERS: readonly string[] = [
  'src',
  'source',
  'sources',
  'test',
  'tests',
  'tools'
];

/** Lower-cased set used to test a path segment against the configured folder names. */
export function containerFolderSet(folders: readonly string[] = DEFAULT_CONTAINER_FOLDERS): Set<string> {
  return new Set(folders.map(folder => folder.toLowerCase()));
}

/**
 * Returns the first path segment of `relativePath` when it names a container folder,
 * otherwise `undefined`. A project directly in the solution root (a single segment,
 * i.e. the project file itself) never becomes a folder.
 */
export function containerFolderOf(relativePath: string, folders: ReadonlySet<string>): string | undefined {
  const parts = relativePath.split('/').filter(Boolean);
  if (parts.length <= 1) {
    return undefined;
  }

  const first = parts[0];
  return folders.has(first.toLowerCase()) ? first : undefined;
}
