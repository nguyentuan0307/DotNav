import * as fs from 'fs/promises';
import * as path from 'path';
import * as vscode from 'vscode';
import { nestFiles } from './fileNesting';
import { ProjectModel, TreeNode } from './models';

export async function readDirectoryNodes(directoryPath: string, projectRoot: string, project?: ProjectModel): Promise<TreeNode[]> {
  const entries = await fs.readdir(directoryPath, { withFileTypes: true });
  const hiddenFolders = getHiddenFolders();
  const hiddenFiles = getHiddenFiles();
  const showProjectFiles = vscode.workspace
    .getConfiguration('dotnetSolutionNavigator')
    .get<boolean>('showProjectFiles', true);
  const nodes: TreeNode[] = [];

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

    nodes.push({
      kind: entry.isDirectory() ? 'folder' : 'file',
      label: entry.name,
      resourcePath,
      project,
      collapsibleState: entry.isDirectory()
        ? vscode.TreeItemCollapsibleState.Collapsed
        : vscode.TreeItemCollapsibleState.None
    });
  }

  const folders = nodes.filter(node => node.kind === 'folder');
  const files = nodes.filter(node => node.kind === 'file');
  const enableFileNesting = vscode.workspace
    .getConfiguration('dotnetSolutionNavigator')
    .get<boolean>('enableFileNesting', true);

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
      collapsibleState: vscode.TreeItemCollapsibleState.None
    });
  }

  return nestFiles(nodes).sort(compareNodes);
}

function getHiddenFolders(): Set<string> {
  const values = vscode.workspace
    .getConfiguration('dotnetSolutionNavigator')
    .get<string[]>('hiddenFolders', []);

  return new Set(values.map(value => value.toLowerCase()));
}

function getHiddenFiles(): string[] {
  return vscode.workspace
    .getConfiguration('dotnetSolutionNavigator')
    .get<string[]>('hiddenFiles', []);
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
