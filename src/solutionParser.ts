import * as fs from 'fs/promises';
import * as path from 'path';
import * as vscode from 'vscode';
import { SolutionModel } from './models';
import { parseProject } from './projectParser';
import { resolveMsbuildPath, uniqueByPath } from './pathUtils';

const supportedProjectExtensions = 'csproj|fsproj|vbproj|dcproj';
const solutionFolderTypeGuid = '2150E333-8FDC-42A3-9474-1A3956D46DE8';
const solutionProjectRegex = new RegExp(
  `Project\\("[^"]+"\\)\\s*=\\s*"[^"]+"\\s*,\\s*"([^"]+\\.(?:${supportedProjectExtensions}))"\\s*,\\s*"\\{([^"]+)\\}"`,
  'gi'
);
const solutionFolderRegex = new RegExp(
  `Project\\("\\{${solutionFolderTypeGuid}\\}"\\)\\s*=\\s*"([^"]+)"\\s*,\\s*"[^"]*"\\s*,\\s*"\\{([^"]+)\\}"`,
  'gi'
);
const nestedProjectsSectionRegex = /GlobalSection\(NestedProjects\)\s*=\s*preSolution([\s\S]*?)EndGlobalSection/gi;
const nestedProjectRegex = /\{([^}]+)\}\s*=\s*\{([^}]+)\}/gi;
const slnxProjectRegex = new RegExp(`Path\\s*=\\s*"([^"]+\\.(?:${supportedProjectExtensions}))"`, 'gi');

interface SolutionProjectEntry {
  readonly path: string;
  readonly solutionFolder?: string[];
}

export interface SolutionSelection {
  readonly path: string;
  readonly label: string;
  readonly description: string;
}

export async function findSolutions(workspaceFolder: vscode.WorkspaceFolder): Promise<vscode.Uri[]> {
  return vscode.workspace.findFiles(
    new vscode.RelativePattern(workspaceFolder, '**/*.{sln,slnx}'),
    '**/{bin,obj,node_modules,.vs}/**',
    20
  );
}

export async function loadSolution(
  workspaceFolder: vscode.WorkspaceFolder,
  preferredSolutionPath?: string
): Promise<SolutionModel> {
  const rootPath = workspaceFolder.uri.fsPath;
  const solutions = await findSolutions(workspaceFolder);

  if (solutions.length > 0) {
    const selected = resolveSolution(solutions, rootPath, preferredSolutionPath);
    return parseSolutionFile(selected.fsPath, rootPath);
  }

  const projectFiles = await vscode.workspace.findFiles(
    new vscode.RelativePattern(workspaceFolder, '**/*.{csproj,fsproj,vbproj,dcproj}'),
    '**/{bin,obj,node_modules,.vs}/**',
    100
  );

  const projects = await parseProjects(projectFiles.map(uri => ({ path: uri.fsPath })), rootPath);
  return {
    name: workspaceFolder.name,
    rootPath,
    projects
  };
}

export async function pickSolution(workspaceFolder: vscode.WorkspaceFolder, currentSolutionPath?: string): Promise<vscode.Uri | undefined> {
  const solutions = await findSolutions(workspaceFolder);
  if (solutions.length === 0) {
    vscode.window.showInformationMessage('No .NET solution file found in this workspace.');
    return undefined;
  }

  const sorted = sortSolutions(solutions);
  const picked = await vscode.window.showQuickPick(
    sorted.map(uri => ({
      label: `${samePath(uri.fsPath, currentSolutionPath) ? '$(check) ' : ''}${path.basename(uri.fsPath)}`,
      description: uri.fsPath,
      uri
    })),
    {
      title: 'Select Active .NET Solution',
      placeHolder: 'Select active .NET solution'
    }
  );

  return picked?.uri;
}

async function parseProjects(projectEntries: SolutionProjectEntry[], rootPath: string): Promise<SolutionModel['projects']> {
  const results = await Promise.allSettled(projectEntries.map(entry => parseProject(entry.path, rootPath)));
  const projects = [];

  for (const [index, result] of results.entries()) {
    if (result.status === 'fulfilled') {
      const solutionFolder = projectEntries[index].solutionFolder;
      projects.push(solutionFolder && solutionFolder.length > 0
        ? { ...result.value, solutionFolder }
        : result.value);
    } else {
      console.warn(`Skipped project ${projectEntries[index].path}: ${result.reason}`);
    }
  }

  return uniqueByPath(projects).sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

function resolveSolution(solutions: vscode.Uri[], rootPath: string, preferredSolutionPath?: string): vscode.Uri {
  const sorted = sortSolutions(solutions);
  const preferred = preferredSolutionPath
    ? sorted.find(uri => samePath(uri.fsPath, preferredSolutionPath))
    : undefined;
  if (preferred) {
    return preferred;
  }

  const rootSolution = sorted.find(uri => samePath(path.dirname(uri.fsPath), rootPath));
  return rootSolution ?? sorted[0];
}

function sortSolutions(solutions: vscode.Uri[]): vscode.Uri[] {
  return [...solutions].sort((a, b) => a.fsPath.localeCompare(b.fsPath));
}

function samePath(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) {
    return false;
  }

  const normalize = (value: string) => process.platform === 'win32'
    ? path.resolve(value).toLowerCase()
    : path.resolve(value);

  return normalize(a) === normalize(b);
}

async function parseSolutionFile(solutionPath: string, rootPath: string): Promise<SolutionModel> {
  const content = await fs.readFile(solutionPath, 'utf8');
  const projectEntries = solutionPath.toLowerCase().endsWith('.slnx')
    ? readSlnxProjectEntries(content, path.dirname(solutionPath))
    : readSolutionProjectEntries(content, path.dirname(solutionPath));

  return {
    name: path.basename(solutionPath),
    path: solutionPath,
    rootPath,
    projects: await parseProjects(projectEntries, rootPath)
  };
}

function readSlnxProjectEntries(content: string, solutionDirectory: string): SolutionProjectEntry[] {
  const projectEntries: SolutionProjectEntry[] = [];
  let match: RegExpExecArray | null;

  slnxProjectRegex.lastIndex = 0;
  while ((match = slnxProjectRegex.exec(content)) !== null) {
    projectEntries.push({ path: resolveMsbuildPath(solutionDirectory, match[1]) });
  }

  return projectEntries;
}

function readSolutionProjectEntries(content: string, solutionDirectory: string): SolutionProjectEntry[] {
  const folders = readSolutionFolders(content);
  const nesting = readNestedProjects(content);
  const projectEntries: SolutionProjectEntry[] = [];
  let match: RegExpExecArray | null;

  solutionProjectRegex.lastIndex = 0;
  while ((match = solutionProjectRegex.exec(content)) !== null) {
    const projectPath = resolveMsbuildPath(solutionDirectory, match[1]);
    const guid = normalizeGuid(match[2]);
    const solutionFolder = resolveSolutionFolder(guid, folders, nesting);
    projectEntries.push({
      path: projectPath,
      solutionFolder: solutionFolder.length > 0 ? solutionFolder : undefined
    });
  }

  return projectEntries;
}

function readSolutionFolders(content: string): Map<string, string> {
  const folders = new Map<string, string>();
  let match: RegExpExecArray | null;

  solutionFolderRegex.lastIndex = 0;
  while ((match = solutionFolderRegex.exec(content)) !== null) {
    const name = match[1];
    if (name.toLowerCase() === 'solution items') {
      continue;
    }

    folders.set(normalizeGuid(match[2]), name);
  }

  return folders;
}

function readNestedProjects(content: string): Map<string, string> {
  const nesting = new Map<string, string>();
  let sectionMatch: RegExpExecArray | null;

  nestedProjectsSectionRegex.lastIndex = 0;
  while ((sectionMatch = nestedProjectsSectionRegex.exec(content)) !== null) {
    const sectionContent = sectionMatch[1];
    let nestingMatch: RegExpExecArray | null;

    nestedProjectRegex.lastIndex = 0;
    while ((nestingMatch = nestedProjectRegex.exec(sectionContent)) !== null) {
      nesting.set(normalizeGuid(nestingMatch[1]), normalizeGuid(nestingMatch[2]));
    }
  }

  return nesting;
}

function resolveSolutionFolder(
  guid: string,
  folders: Map<string, string>,
  nesting: Map<string, string>
): string[] {
  const folderPath: string[] = [];
  const visited = new Set<string>([guid]);
  let parentGuid = nesting.get(guid);

  while (parentGuid && !visited.has(parentGuid)) {
    visited.add(parentGuid);
    const folderName = folders.get(parentGuid);
    if (folderName) {
      folderPath.unshift(folderName);
    }

    parentGuid = nesting.get(parentGuid);
  }

  return folderPath;
}

function normalizeGuid(guid: string): string {
  return guid.replace(/[{}]/g, '').toUpperCase();
}
