import * as path from 'path';
import { LocalHistoryPolicy } from './localHistoryTypes';

export const defaultTrackedExtensions = [
  '.cs', '.fs', '.vb', '.csproj', '.fsproj', '.vbproj', '.dcproj',
  '.props', '.targets', '.json', '.jsonc', '.xml', '.config', '.sln',
  '.slnx', '.editorconfig', '.md', '.razor', '.cshtml'
];

export const defaultExcludedDirectoryNames = [
  '.git', '.vs', '.idea', 'bin', 'obj', 'node_modules', 'TestResults',
  'coverage', 'artifacts', 'packages'
];

export function createLocalHistoryPolicy(values: {
  enabled?: boolean;
  retentionDays?: number;
  maximumStorageMb?: number;
  maximumFileSizeMb?: number;
  maximumRevisionsPerFile?: number;
  snapshotCoalescingSeconds?: number;
  trackedExtensions?: readonly string[];
  excludedDirectoryNames?: readonly string[];
} = {}): LocalHistoryPolicy {
  return {
    enabled: values.enabled ?? false,
    retentionDays: Math.max(1, values.retentionDays ?? 5),
    maximumStorageBytes: Math.max(1, values.maximumStorageMb ?? 250) * 1024 * 1024,
    maximumFileBytes: Math.max(1, values.maximumFileSizeMb ?? 2) * 1024 * 1024,
    maximumRevisionsPerFile: Math.max(1, Math.floor(values.maximumRevisionsPerFile ?? 250)),
    snapshotCoalescingMs: Math.max(0, values.snapshotCoalescingSeconds ?? 5) * 1000,
    trackedExtensions: new Set((values.trackedExtensions ?? defaultTrackedExtensions).map(normalizeExtension)),
    excludedDirectoryNames: new Set(values.excludedDirectoryNames ?? defaultExcludedDirectoryNames)
  };
}

export function shouldTrackFile(filePath: string, workspaceRoots: readonly string[], policy: LocalHistoryPolicy): boolean {
  if (!policy.enabled || !workspaceRoots.some(root => isPathInside(root, filePath))) {
    return false;
  }

  const segments = path.resolve(filePath).split(path.sep);
  if (segments.some(segment => policy.excludedDirectoryNames.has(segment))) {
    return false;
  }

  const fileName = path.basename(filePath).toLowerCase();
  const extension = fileName === '.editorconfig' ? '.editorconfig' : path.extname(fileName);
  return policy.trackedExtensions.has(extension);
}

export function automaticCaptureDelay(now: number, lastCaptureAt: number, coalescingMs: number): number {
  return Math.max(0, lastCaptureAt + Math.max(0, coalescingMs) - now);
}

function normalizeExtension(value: string): string {
  const normalized = value.trim().toLowerCase();
  return normalized.startsWith('.') ? normalized : `.${normalized}`;
}

function isPathInside(rootPath: string, candidatePath: string): boolean {
  const relative = path.relative(path.resolve(rootPath), path.resolve(candidatePath));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}
