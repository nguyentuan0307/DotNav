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

export async function deleteItem(provider: DotnetTreeProvider, node: TreeNode): Promise<void> {
  const target = targetPathFor(node);
  if (!target) {
    return;
  }

  const label = path.basename(target);
  const choice = await vscode.window.showWarningMessage(
    `Delete "${label}"? The item will be moved to the recycle bin when possible.`,
    { modal: true },
    'Delete'
  );

  if (choice !== 'Delete') {
    return;
  }

  await vscode.workspace.fs.delete(vscode.Uri.file(target), {
    recursive: node.kind === 'folder',
    useTrash: true
  });
  await provider.refresh();
}

export async function moveItem(provider: DotnetTreeProvider, node: TreeNode): Promise<void> {
  const target = targetPathFor(node);
  if (!target) {
    return;
  }

  const picked = await vscode.window.showOpenDialog({
    canSelectFiles: false,
    canSelectFolders: true,
    canSelectMany: false,
    title: `Move "${path.basename(target)}" To Folder`
  });

  if (!picked || picked.length === 0) {
    return;
  }

  await moveItemToDirectory(provider, node, picked[0].fsPath);
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

export async function copyFullPath(node: TreeNode): Promise<void> {
  const target = resolveResourcePath(node);
  if (!target) {
    return;
  }

  await vscode.env.clipboard.writeText(target);
  vscode.window.showInformationMessage(`Copied path: ${target}`);
}

export async function copyRelativePath(node: TreeNode): Promise<void> {
  const target = resolveResourcePath(node);
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!target || !workspaceRoot) {
    return;
  }

  const relativePath = path.relative(workspaceRoot, target).replace(/\\/g, '/');
  await vscode.env.clipboard.writeText(relativePath);
  vscode.window.showInformationMessage(`Copied relative path: ${relativePath}`);
}

export async function revealInFileExplorer(node: TreeNode): Promise<void> {
  const target = resolveResourcePath(node);
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
