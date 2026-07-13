import * as fs from 'fs/promises';
import * as path from 'path';
import * as vscode from 'vscode';
import { ProjectModel, TreeNode } from './models';
import { CodeItemKind, computeNamespace, renderTemplate, sanitizeIdentifier, useFileScoped } from './templates';
import type { DotnetTreeProvider } from './treeProvider';

interface TargetContext {
  readonly dir: string;
  readonly project?: ProjectModel;
}

interface CodeItemFileInfo {
  readonly fileName: string;
  readonly typeName: string;
  readonly partial: boolean;
}

export async function addCodeItem(provider: DotnetTreeProvider, node: TreeNode, kind: CodeItemKind): Promise<void> {
  const target = targetContextFor(node);
  if (!target) {
    return;
  }

  const input = await vscode.window.showInputBox({
    title: addTitle(kind),
    prompt: 'Enter file name. The .cs extension is added when omitted.',
    validateInput: value => validateCodeItemFileName(value, kind)
  });

  if (!input) {
    return;
  }

  const fileInfo = codeItemFileInfo(input.trim());
  const filePath = path.join(target.dir, fileInfo.fileName);
  if (await exists(filePath)) {
    vscode.window.showErrorMessage(`File already exists: ${filePath}`);
    return;
  }

  const namespaceName = target.project ? computeNamespace(target.project, target.dir) : undefined;
  const content = renderTemplate(
    kind,
    fileInfo.typeName,
    namespaceName,
    useFileScoped(target.project),
    { partial: fileInfo.partial }
  );

  await fs.writeFile(filePath, content, 'utf8');
  await openFile(filePath);
  await provider.refresh();
}

export async function addFile(provider: DotnetTreeProvider, node: TreeNode): Promise<void> {
  const target = targetContextFor(node);
  if (!target) {
    return;
  }

  const fileName = await vscode.window.showInputBox({
    title: 'Add New File',
    prompt: 'Enter file name with extension',
    validateInput: validateFileName
  });

  if (!fileName) {
    return;
  }

  const filePath = path.join(target.dir, fileName.trim());
  if (await exists(filePath)) {
    vscode.window.showErrorMessage(`File already exists: ${filePath}`);
    return;
  }

  await fs.writeFile(filePath, '', 'utf8');
  await openFile(filePath);
  await provider.refresh();
}

export async function addFolder(provider: DotnetTreeProvider, node: TreeNode): Promise<void> {
  const target = targetContextFor(node);
  if (!target) {
    return;
  }

  const folderName = await vscode.window.showInputBox({
    title: 'Add New Folder',
    prompt: 'Enter folder name',
    validateInput: validatePathSegment
  });

  if (!folderName) {
    return;
  }

  const folderPath = path.join(target.dir, folderName.trim());
  if (await exists(folderPath)) {
    vscode.window.showErrorMessage(`Folder already exists: ${folderPath}`);
    return;
  }

  await fs.mkdir(folderPath, { recursive: true });
  await provider.refresh();
}

export async function addExistingItem(provider: DotnetTreeProvider, node: TreeNode): Promise<void> {
  const target = targetContextFor(node);
  if (!target) {
    return;
  }

  const selectedFiles = await vscode.window.showOpenDialog({
    canSelectFiles: true,
    canSelectFolders: false,
    canSelectMany: true,
    title: 'Add Existing Item'
  });

  if (!selectedFiles || selectedFiles.length === 0) {
    return;
  }

  const copied: string[] = [];
  for (const file of selectedFiles) {
    const destination = path.join(target.dir, path.basename(file.fsPath));
    if (await exists(destination)) {
      vscode.window.showErrorMessage(`File already exists: ${destination}`);
      continue;
    }

    await fs.copyFile(file.fsPath, destination);
    copied.push(destination);
  }

  if (copied.length === 1) {
    await openFile(copied[0]);
  }

  await provider.refresh();
}

function targetContextFor(node: TreeNode): TargetContext | undefined {
  if (node.kind === 'project' && node.project) {
    return { dir: node.project.directory, project: node.project };
  }

  if (node.kind === 'folder' && node.resourcePath) {
    return { dir: node.resourcePath, project: node.project };
  }

  return undefined;
}

function addTitle(kind: CodeItemKind): string {
  switch (kind) {
    case 'class':
      return 'Add New Class';
    case 'interface':
      return 'Add New Interface';
    case 'record':
      return 'Add New Record';
    case 'enum':
      return 'Add New Enum';
  }
}

function validateCodeItemFileName(value: string, kind: CodeItemKind): string | undefined {
  const trimmed = value.trim();
  const fileError = validateFileName(trimmed);
  if (fileError) {
    return fileError;
  }

  if (/[\\/]/.test(trimmed)) {
    return 'Enter a file name, not a path.';
  }

  if (!canNormalizeCodeItemFileName(trimmed)) {
    return 'C# item files must use the .cs extension.';
  }

  const fileInfo = codeItemFileInfo(trimmed);
  if (kind === 'enum' && fileInfo.partial) {
    return 'Enums cannot be partial in C#.';
  }

  if (fileInfo.typeName === '_') {
    return 'File name must produce a valid C# type name.';
  }

  return undefined;
}

function codeItemFileInfo(input: string): CodeItemFileInfo {
  const fileName = normalizeCodeItemFileName(input);
  const baseName = path.basename(fileName, '.cs');
  const normalizedBaseName = baseName.toLowerCase();
  const partial = isPartialCodeFileBaseName(normalizedBaseName);
  const typeBaseName = stripCodeFileSuffixes(baseName);

  return {
    fileName,
    typeName: sanitizeIdentifier(typeBaseName),
    partial
  };
}

function normalizeCodeItemFileName(input: string): string {
  return input.toLowerCase().endsWith('.cs') ? input : `${input}.cs`;
}

function canNormalizeCodeItemFileName(input: string): boolean {
  if (input.toLowerCase().endsWith('.cs')) {
    return true;
  }

  const extension = path.extname(input);
  return extension.length === 0 || isPartialCodeFileBaseName(input.toLowerCase());
}

function stripCodeFileSuffixes(baseName: string): string {
  const suffixes = ['.Designer', '.generated', '.partial', '.g.i', '.g'];
  let result = baseName;
  let stripped = true;

  while (stripped) {
    stripped = false;
    for (const suffix of suffixes) {
      if (result.toLowerCase().endsWith(suffix.toLowerCase()) && result.length > suffix.length) {
        result = result.slice(0, -suffix.length);
        stripped = true;
      }
    }
  }

  return result;
}

function isPartialCodeFileBaseName(baseName: string): boolean {
  return ['.designer', '.generated', '.partial', '.g.i', '.g']
    .some(suffix => baseName.endsWith(suffix));
}

function validateFileName(value: string): string | undefined {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return 'File name is required.';
  }

  if (/[<>:"|?*]/.test(trimmed) || trimmed.endsWith('.') || trimmed.endsWith(' ')) {
    return 'File name contains invalid characters.';
  }

  return undefined;
}

function validatePathSegment(value: string): string | undefined {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return 'Folder name is required.';
  }

  if (/[<>:"|?*\\/]/.test(trimmed) || trimmed.endsWith('.') || trimmed.endsWith(' ')) {
    return 'Folder name contains invalid characters.';
  }

  return undefined;
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
