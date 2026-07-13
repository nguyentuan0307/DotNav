import * as path from 'path';
import { ProjectModel, SolutionModel } from './models';

export function projectsUnderFolder(solution: SolutionModel, folderPath: string): ProjectModel[] {
  const folder = path.resolve(folderPath);
  const projects = solution.projects.filter(project => isPathInside(folder, project.path));
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

function isPathInside(folder: string, candidate: string): boolean {
  const relative = path.relative(folder, path.resolve(candidate));
  return relative !== '' && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative);
}

function normalize(value: string): string { return path.resolve(value).toLowerCase(); }
