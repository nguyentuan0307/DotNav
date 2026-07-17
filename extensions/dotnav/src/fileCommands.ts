import * as fs from 'fs/promises';
import * as path from 'path';
import * as vscode from 'vscode';
import { TreeNode } from './models';
import type { DotnetTreeProvider } from './treeProvider';

export async function renameItem(provider: DotnetTreeProvider, node: TreeNode): Promise<void> {
  const target = targetPathFor(node);
  if (!target) {
    return;
  }

  const currentName = path.basename(target);
  const nextName = await vscode.window.showInputBox({
    title: `Rename ${node.kind === 'folder' ? 'Folder' : 'File'}`,
    value: currentName,
    validateInput: validateName
  });

  if (!nextName || nextName === currentName) {
    return;
  }

  const destination = path.join(path.dirname(target), nextName.trim());
  if (await exists(destination)) {
    vscode.window.showErrorMessage(`Item already exists: ${destination}`);
    return;
  }

  await vscode.workspace.fs.rename(vscode.Uri.file(target), vscode.Uri.file(destination));
  if (node.kind === 'file') {
    await openFile(destination);
  }

  await provider.refresh();
}

export async function deleteItems(provider: DotnetTreeProvider, nodes: readonly TreeNode[]): Promise<void> {
  const entries = nodes
    .map(node => ({ node, target: targetPathFor(node) }))
    .filter((entry): entry is { node: TreeNode; target: string } => Boolean(entry.target));
  if (entries.length === 0) {
    return;
  }

  const message = entries.length === 1
    ? `Delete "${path.basename(entries[0].target)}"? The item will be moved to the recycle bin when possible.`
    : `Delete ${entries.length} items? They will be moved to the recycle bin when possible.\n\n${entries.map(entry => path.basename(entry.target)).join('\n')}`;

  const choice = await vscode.window.showWarningMessage(message, { modal: true }, 'Delete');
  if (choice !== 'Delete') {
    return;
  }

  for (const entry of entries) {
    await vscode.workspace.fs.delete(vscode.Uri.file(entry.target), {
      recursive: entry.node.kind === 'folder',
      useTrash: true
    });
  }

  await provider.refresh();
}

export async function moveItems(provider: DotnetTreeProvider, nodes: readonly TreeNode[]): Promise<void> {
  const entries = nodes.filter(node => targetPathFor(node));
  if (entries.length === 0) {
    return;
  }

  const title = entries.length === 1
    ? `Move "${path.basename(targetPathFor(entries[0])!)}" To Folder`
    : `Move ${entries.length} Items To Folder`;

  const picked = await vscode.window.showOpenDialog({
    canSelectFiles: false,
    canSelectFolders: true,
    canSelectMany: false,
    title
  });

  if (!picked || picked.length === 0) {
    return;
  }

  for (const node of entries) {
    await moveItemToDirectory(provider, node, picked[0].fsPath);
  }
}

export async function moveItemToDirectory(provider: DotnetTreeProvider, node: TreeNode, destinationDirectory: string): Promise<boolean> {
  const target = targetPathFor(node);
  if (!target) {
    return false;
  }

  const destination = path.join(destinationDirectory, path.basename(target));
  if (path.resolve(destination).toLowerCase() === path.resolve(target).toLowerCase()) {
    return false;
  }

  if (node.kind === 'folder' && isMovingFolderIntoItself(target, destination)) {
    vscode.window.showErrorMessage('Cannot move a folder into itself.');
    return false;
  }

  if (await exists(destination)) {
    vscode.window.showErrorMessage(`Item already exists: ${destination}`);
    return false;
  }

  await vscode.workspace.fs.rename(vscode.Uri.file(target), vscode.Uri.file(destination));
  if (node.kind === 'file') {
    await openFile(destination);
  }

  await provider.refresh();
  return true;
}

export async function copyFullPath(nodes: readonly TreeNode[]): Promise<void> {
  const targets = nodes.map(resolveResourcePath).filter((target): target is string => Boolean(target));
  if (targets.length === 0) {
    return;
  }

  await vscode.env.clipboard.writeText(targets.join('\n'));
  vscode.window.showInformationMessage(targets.length === 1 ? `Copied path: ${targets[0]}` : `Copied ${targets.length} paths.`);
}

export async function copyRelativePath(nodes: readonly TreeNode[]): Promise<void> {
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!workspaceRoot) {
    return;
  }

  const relativePaths = nodes
    .map(resolveResourcePath)
    .filter((target): target is string => Boolean(target))
    .map(target => path.relative(workspaceRoot, target).replace(/\\/g, '/'));
  if (relativePaths.length === 0) {
    return;
  }

  await vscode.env.clipboard.writeText(relativePaths.join('\n'));
  vscode.window.showInformationMessage(relativePaths.length === 1 ? `Copied relative path: ${relativePaths[0]}` : `Copied ${relativePaths.length} relative paths.`);
}

export async function revealInFileExplorer(nodes: readonly TreeNode[]): Promise<void> {
  const target = resolveResourcePath(nodes[0]);
  if (!target) {
    return;
  }

  await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(target));
}

function targetPathFor(node: TreeNode): string | undefined {
  if ((node.kind === 'file' || node.kind === 'folder') && node.resourcePath) {
    return node.resourcePath;
  }

  return undefined;
}

function resolveResourcePath(node: TreeNode): string | undefined {
  if ((node.kind === 'file' || node.kind === 'folder' || node.kind === 'project') && node.resourcePath) {
    return node.resourcePath;
  }

  return undefined;
}

function validateName(value: string): string | undefined {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return 'Name is required.';
  }

  if (/[<>:"|?*\\/]/.test(trimmed) || trimmed.endsWith('.') || trimmed.endsWith(' ')) {
    return 'Name contains invalid characters.';
  }

  return undefined;
}

function isMovingFolderIntoItself(source: string, destination: string): boolean {
  const relative = path.relative(source, destination);
  return relative.length > 0 && !relative.startsWith('..') && !path.isAbsolute(relative);
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function openFile(filePath: string): Promise<void> {
  await vscode.window.showTextDocument(vscode.Uri.file(filePath), { preview: false });
}
