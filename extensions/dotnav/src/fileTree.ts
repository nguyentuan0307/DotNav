import * as fs from 'fs/promises';
import * as path from 'path';
import type * as vscode from 'vscode';
import { nestFiles } from './fileNesting';
import { ProjectModel, TreeNode } from './models';

function getVsCode(): typeof import('vscode') | undefined {
  try {
    return require('vscode');
  } catch {
    return undefined;
  }
}

export async function hasMatchingFileDescendant(
  directoryPath: string,
  filter: string,
  depth: number = 0
): Promise<boolean> {
  if (depth > 6) return false;
  try {
    const entries = await fs.readdir(directoryPath, { withFileTypes: true });
    const hiddenFolders = getHiddenFolders();
    const hiddenFiles = getHiddenFiles();

    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (hiddenFolders.has(entry.name.toLowerCase()) || entry.name.startsWith('.')) continue;
        if (entry.name.toLowerCase().includes(filter)) return true;
        const sub = await hasMatchingFileDescendant(path.join(directoryPath, entry.name), filter, depth + 1);
        if (sub) return true;
      } else if (entry.isFile()) {
        if (isHiddenFile(entry.name, hiddenFiles)) continue;
        if (entry.name.toLowerCase().includes(filter)) return true;
      }
    }
  } catch {
    return false;
  }
  return false;
}

export async function readDirectoryNodes(
  directoryPath: string,
  projectRoot: string,
  project?: ProjectModel,
  filterText?: string
): Promise<TreeNode[]> {
  const entries = await fs.readdir(directoryPath, { withFileTypes: true });
  const hiddenFolders = getHiddenFolders();
  const hiddenFiles = getHiddenFiles();
  const showProjectFiles = getDotnavConfig<boolean>('showProjectFiles', true);
  const nodes: TreeNode[] = [];
  const filter = filterText?.trim().toLowerCase();

  for (const entry of entries) {
    if (entry.isDirectory() && hiddenFolders.has(entry.name.toLowerCase())) {
      continue;
    }

    if (entry.isFile() && isHiddenFile(entry.name, hiddenFiles)) {
      continue;
    }

    const resourcePath = path.join(directoryPath, entry.name);
    if (!showProjectFiles && project?.path && path.resolve(resourcePath).toLowerCase() === path.resolve(project.path).toLowerCase()) {
      continue;
    }

    if (!isInside(projectRoot, resourcePath)) {
      continue;
    }

    if (filter) {
      const nameMatches = entry.name.toLowerCase().includes(filter);
      if (entry.isDirectory()) {
        const hasDescendant = nameMatches || await hasMatchingFileDescendant(resourcePath, filter);
        if (!hasDescendant) {
          continue;
        }
        nodes.push({
          kind: 'folder',
          label: entry.name,
          resourcePath,
          project,
          collapsibleState: 2 // Expanded
        });
      } else if (entry.isFile()) {
        if (!nameMatches) {
          continue;
        }
        nodes.push({
          kind: 'file',
          label: entry.name,
          resourcePath,
          project,
          collapsibleState: 0 // None
        });
      }
      continue;
    }

    nodes.push({
      kind: entry.isDirectory() ? 'folder' : 'file',
      label: entry.name,
      resourcePath,
      project,
      collapsibleState: entry.isDirectory() ? 1 : 0
    });
  }

  const folders = nodes.filter(node => node.kind === 'folder');
  const files = nodes.filter(node => node.kind === 'file');
  const enableFileNesting = getDotnavConfig<boolean>('enableFileNesting', true);

  return [...folders, ...(enableFileNesting ? nestFiles(files) : files)].sort(compareNodes);
}

export async function readDockerProjectNodes(project: ProjectModel): Promise<TreeNode[]> {
  const entries = await fs.readdir(project.directory, { withFileTypes: true });
  const nodes: TreeNode[] = [];

  for (const entry of entries) {
    if (!entry.isFile() || !isDockerProjectFile(project, entry.name)) {
      continue;
    }

    const resourcePath = path.join(project.directory, entry.name);
    nodes.push({
      kind: 'file',
      label: entry.name,
      resourcePath,
      project,
      collapsibleState: 0 // None
    });
  }

  return nestFiles(nodes).sort(compareNodes);
}

function getDotnavConfig<T>(key: string, defaultValue: T): T {
  try {
    return getVsCode()?.workspace?.getConfiguration?.('dotnav')?.get<T>(key, defaultValue) ?? defaultValue;
  } catch {
    return defaultValue;
  }
}

function getHiddenFolders(): Set<string> {
  const values = getDotnavConfig<string[]>('hiddenFolders', []);
  return new Set(values.map(value => value.toLowerCase()));
}

function getHiddenFiles(): string[] {
  return getDotnavConfig<string[]>('hiddenFiles', []);
}

function isHiddenFile(fileName: string, hiddenFiles: string[]): boolean {
  return hiddenFiles.some(pattern => globLikeMatch(fileName, pattern));
}

function globLikeMatch(fileName: string, pattern: string): boolean {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp(`^${escaped}$`, 'i').test(fileName);
}

function compareNodes(a: TreeNode, b: TreeNode): number {
  if (a.kind !== b.kind) {
    return a.kind === 'folder' ? -1 : 1;
  }

  return a.label.localeCompare(b.label);
}

export function isInside(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function isDockerProjectFile(_project: ProjectModel, fileName: string): boolean {
  const normalized = fileName.toLowerCase();

  return normalized === '.dockerignore'
    || /^docker-compose(?:\..*)?\.ya?ml$/i.test(fileName);
}
