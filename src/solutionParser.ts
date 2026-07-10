import * as fs from 'fs/promises';
import * as path from 'path';
import * as vscode from 'vscode';
import { SolutionModel } from './models';
import { parseProject } from './projectParser';
import { resolveMsbuildPath, uniqueByPath } from './pathUtils';

const supportedProjectExtensions = 'csproj|fsproj|vbproj|dcproj';
const solutionProjectRegex = new RegExp(
  `Project\\("[^"]+"\\)\\s*=\\s*"[^"]+"\\s*,\\s*"([^"]+\\.(?:${supportedProjectExtensions}))"\\s*,\\s*"\\{[^"]+\\}"`,
  'gi'
);
const slnxProjectRegex = new RegExp(`Path\\s*=\\s*"([^"]+\\.(?:${supportedProjectExtensions}))"`, 'gi');

export async function loadSolution(workspaceFolder: vscode.WorkspaceFolder): Promise<SolutionModel> {
  const rootPath = workspaceFolder.uri.fsPath;
  const solutions = await vscode.workspace.findFiles(
    new vscode.RelativePattern(workspaceFolder, '**/*.{sln,slnx}'),
    '**/{bin,obj,node_modules,.vs}/**',
    20
  );

  if (solutions.length > 0) {
    const selected = await selectSolutionIfNeeded(solutions);
    return parseSolutionFile(selected.fsPath, rootPath);
  }

  const projectFiles = await vscode.workspace.findFiles(
    new vscode.RelativePattern(workspaceFolder, '**/*.{csproj,fsproj,vbproj,dcproj}'),
    '**/{bin,obj,node_modules,.vs}/**',
    100
  );

  const projects = await parseProjects(projectFiles.map(uri => uri.fsPath), rootPath);
  return {
    name: workspaceFolder.name,
    rootPath,
    projects
  };
}

async function parseProjects(projectPaths: string[], rootPath: string): Promise<SolutionModel['projects']> {
  const results = await Promise.allSettled(projectPaths.map(projectPath => parseProject(projectPath, rootPath)));
  const projects = [];

  for (const [index, result] of results.entries()) {
    if (result.status === 'fulfilled') {
      projects.push(result.value);
    } else {
      console.warn(`Skipped project ${projectPaths[index]}: ${result.reason}`);
    }
  }

  return uniqueByPath(projects).sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

async function selectSolutionIfNeeded(solutions: vscode.Uri[]): Promise<vscode.Uri> {
  const sorted = [...solutions].sort((a, b) => a.fsPath.localeCompare(b.fsPath));
  if (sorted.length === 1) {
    return sorted[0];
  }

  const picked = await vscode.window.showQuickPick(
    sorted.map(uri => ({ label: path.basename(uri.fsPath), description: uri.fsPath, uri })),
    { placeHolder: 'Select active .NET solution' }
  );

  return picked?.uri ?? sorted[0];
}

async function parseSolutionFile(solutionPath: string, rootPath: string): Promise<SolutionModel> {
  const content = await fs.readFile(solutionPath, 'utf8');
  const projectPaths = solutionPath.toLowerCase().endsWith('.slnx')
    ? readProjectPaths(slnxProjectRegex, content, path.dirname(solutionPath))
    : readProjectPaths(solutionProjectRegex, content, path.dirname(solutionPath));

  return {
    name: path.basename(solutionPath),
    path: solutionPath,
    rootPath,
    projects: await parseProjects(projectPaths, rootPath)
  };
}

function readProjectPaths(regex: RegExp, content: string, solutionDirectory: string): string[] {
  const projectPaths: string[] = [];
  let match: RegExpExecArray | null;

  regex.lastIndex = 0;
  while ((match = regex.exec(content)) !== null) {
    projectPaths.push(resolveMsbuildPath(solutionDirectory, match[1]));
  }

  return projectPaths;
}
