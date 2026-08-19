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

  const project = target.project ? await provider.ensureProjectMetadata(target.project) : undefined;
  const namespaceName = project ? computeNamespace(project, target.dir) : undefined;
  const content = renderTemplate(
    kind,
    fileInfo.typeName,
    namespaceName,
    useFileScoped(project),
    { partial: fileInfo.partial }
  );

  await fs.writeFile(filePath, content, 'utf8');
  await openFile(filePath);
  provider.invalidateDirectory(target.dir);
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
  provider.invalidateDirectory(target.dir);
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
  provider.invalidateDirectory(target.dir);
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

  provider.invalidateDirectory(target.dir);
}

interface TemplateQuickPickItem extends vscode.QuickPickItem {
  readonly itemKind?: CodeItemKind | 'file' | 'folder' | 'existing';
}

export async function addNewItemInteractive(provider: DotnetTreeProvider, node?: TreeNode): Promise<void> {
  if (!node) {
    return;
  }

  const target = targetContextFor(node);
  if (!target) {
    return;
  }

  const items: TemplateQuickPickItem[] = [
    { label: '$(symbol-class) Class', description: 'C# class with namespace', itemKind: 'class' },
    { label: '$(symbol-interface) Interface', description: 'C# interface (public interface I...)', itemKind: 'interface' },
    { label: '$(symbol-structure) Record', description: 'C# positional record', itemKind: 'record' },
    { label: '$(server-process) API Controller', description: 'ASP.NET Core ApiController', itemKind: 'controller' },
    { label: '$(symbol-enum) Enum', description: 'C# enumeration', itemKind: 'enum' },
    { label: '$(symbol-struct) Struct', description: 'C# value struct', itemKind: 'struct' },
    { label: '$(symbol-struct) Record Struct', description: 'C# record struct', itemKind: 'recordStruct' },
    { label: '$(warning) Exception', description: 'C# custom Exception class', itemKind: 'exception' },
    { label: '$(file) New File...', description: 'Empty file with custom extension', itemKind: 'file' },
    { label: '$(folder) New Folder...', description: 'Subdirectory', itemKind: 'folder' },
    { label: '$(file-symlink-file) Existing Item...', description: 'Add existing file to folder', itemKind: 'existing' }
  ];

  const picked = await vscode.window.showQuickPick(items, {
    title: `Add New Item to ${path.basename(target.dir)}`,
    placeHolder: 'Select template or item type to create'
  });

  if (!picked || !picked.itemKind) {
    return;
  }

  switch (picked.itemKind) {
    case 'file':
      return addFile(provider, node);
    case 'folder':
      return addFolder(provider, node);
    case 'existing':
      return addExistingItem(provider, node);
    default:
      return addCodeItem(provider, node, picked.itemKind);
  }
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
    case 'recordStruct':
      return 'Add New Record Struct';
    case 'struct':
      return 'Add New Struct';
    case 'enum':
      return 'Add New Enum';
    case 'controller':
      return 'Add New API Controller';
    case 'exception':
      return 'Add New Exception';
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
