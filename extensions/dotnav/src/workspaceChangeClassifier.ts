import * as path from 'path';

export type WorkspaceFileEventKind = 'create' | 'change' | 'delete';
export type WorkspaceChangeKind = 'ignored' | 'solution' | 'projectMetadata' | 'directory';

export interface WorkspaceChange {
  readonly kind: WorkspaceChangeKind;
  readonly filePath: string;
  readonly directoryPath?: string;
}

const projectFilePattern = /\.(csproj|fsproj|vbproj|dcproj)$/i;
const solutionFilePattern = /\.(sln|slnx)$/i;

export function classifyWorkspaceChange(
  filePath: string,
  eventKind: WorkspaceFileEventKind
): WorkspaceChange {
  const normalized = filePath.replace(/\\/g, '/');
  if (/\/(bin|obj|node_modules|\.vs|\.git)\//i.test(normalized)) {
    return { kind: 'ignored', filePath };
  }

  const fileName = path.basename(filePath);
  if (solutionFilePattern.test(fileName)
    || fileName.toLowerCase() === 'global.json'
    || /^directory\.(build|packages)\.(props|targets)$/i.test(fileName)) {
    return { kind: 'solution', filePath };
  }

  if (projectFilePattern.test(fileName)) {
    return { kind: eventKind === 'change' ? 'projectMetadata' : 'solution', filePath };
  }

  if (fileName.toLowerCase() === 'launchsettings.json') {
    return { kind: 'projectMetadata', filePath };
  }

  if (eventKind === 'change') {
    return { kind: 'ignored', filePath };
  }

  return { kind: 'directory', filePath, directoryPath: path.dirname(filePath) };
}
