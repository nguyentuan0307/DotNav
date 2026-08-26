import * as path from 'path';
import { ProjectModel, SolutionModel } from './models';

export function projectsUnderFolder(solution: SolutionModel, folderPath: string): ProjectModel[] {
  const folder = path.resolve(folderPath);
  const projects = solution.projects.filter(project => isPathInside(folder, project.path));
  return sortProjectsByReferences(projects);
}

export function projectsUnderSolutionFolder(solution: SolutionModel, logicalPath: string[]): ProjectModel[] {
  const prefix = logicalPath.map(normalizeLogicalPart);
  const projects = solution.projects.filter(project => {
    const candidate = project.solutionFolder?.map(normalizeLogicalPart);
    return candidate !== undefined
      && candidate.length >= prefix.length
      && prefix.every((part, index) => candidate[index] === part);
  });
  return sortProjectsByReferences(projects);
}

export function sortProjectsByReferences(projects: ProjectModel[]): ProjectModel[] {
  const byPath = new Map(projects.map(project => [normalize(project.path), project]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const result: ProjectModel[] = [];

  const visit = (project: ProjectModel) => {
    const key = normalize(project.path);
    if (visited.has(key) || visiting.has(key)) return;
    visiting.add(key);
    for (const reference of project.projectReferences) {
      const dependency = byPath.get(normalize(reference.path));
      if (dependency) visit(dependency);
    }
    visiting.delete(key);
    visited.add(key);
    result.push(project);
  };

  [...projects].sort((a, b) => a.name.localeCompare(b.name)).forEach(visit);
  return result;
}

export function createFolderBuildProject(projects: readonly ProjectModel[]): string {
  const items = projects
    .map(project => `    <FolderBuildProject Include="${escapeXml(project.path)}" />`)
    .join('\n');
  return `<?xml version="1.0" encoding="utf-8"?>
<Project DefaultTargets="Build">
  <ItemGroup>
${items}
  </ItemGroup>
  <Target Name="Restore">
    <MSBuild Projects="@(FolderBuildProject)" Targets="Restore" BuildInParallel="true" StopOnFirstFailure="true" />
  </Target>
  <Target Name="Build" DependsOnTargets="Restore">
    <MSBuild Projects="@(FolderBuildProject)" Targets="Build" BuildInParallel="true" Properties="Configuration=$(Configuration)" StopOnFirstFailure="true" />
  </Target>
</Project>
`;
}

export function normalizeMaxParallelBuilds(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(1, Math.floor(value))
    : 6;
}

function escapeXml(value: string): string {
  return value.replace(/[&<>'"]/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&apos;', '"': '&quot;'
  })[character]!);
}

function isPathInside(folder: string, candidate: string): boolean {
  const relative = path.relative(folder, path.resolve(candidate));
  return relative !== '' && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative);
}

function normalize(value: string): string { return path.resolve(value).toLowerCase(); }
function normalizeLogicalPart(value: string): string { return value.trim().toLocaleLowerCase(); }
