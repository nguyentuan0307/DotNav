import * as path from 'path';
import { ProjectModel } from '../models';
import { ScopeTarget } from './scopeModel';

export function normalizeFsPath(filePath: string): string {
  return path.resolve(filePath).toLowerCase().replace(/\\/g, '/');
}

export function matchesSolutionFolder(
  projectFolder: readonly string[] | undefined,
  targetFolderValue: string
): boolean {
  if (!projectFolder || projectFolder.length === 0) {
    return false;
  }

  const targetSegments = targetFolderValue
    .split(/[\\/]+/)
    .map(s => s.trim().toLowerCase())
    .filter(Boolean);

  if (targetSegments.length === 0) {
    return false;
  }

  const projSegments = projectFolder.map(s => s.trim().toLowerCase());
  if (projSegments.length < targetSegments.length) {
    return false;
  }

  for (let i = 0; i < targetSegments.length; i++) {
    if (projSegments[i] !== targetSegments[i]) {
      return false;
    }
  }

  return true;
}

export function resolveScopeProjectPaths(
  allProjects: readonly ProjectModel[],
  targets: readonly ScopeTarget[],
  includeDependencies: boolean
): string[] {
  if (targets.length === 0) {
    return [];
  }

  const projectMap = new Map<string, ProjectModel>();
  for (const p of allProjects) {
    projectMap.set(normalizeFsPath(p.path), p);
  }

  const initialProjectPaths = new Set<string>();

  for (const target of targets) {
    if (target.kind === 'project') {
      const normTarget = normalizeFsPath(target.value);
      if (projectMap.has(normTarget)) {
        initialProjectPaths.add(normTarget);
      } else {
        // Fallback: match by basename if full path didn't hit
        const base = path.basename(target.value).toLowerCase();
        for (const [normPath, proj] of projectMap.entries()) {
          if (path.basename(proj.path).toLowerCase() === base) {
            initialProjectPaths.add(normPath);
          }
        }
      }
    } else if (target.kind === 'solutionFolder') {
      for (const [normPath, proj] of projectMap.entries()) {
        if (matchesSolutionFolder(proj.solutionFolder, target.value)) {
          initialProjectPaths.add(normPath);
        }
      }
    }
  }

  if (!includeDependencies) {
    return Array.from(initialProjectPaths);
  }

  // Auto-resolve Transitive Dependency Closure (BFS)
  const resolvedPaths = new Set<string>(initialProjectPaths);
  const queue: ProjectModel[] = [];

  for (const normPath of initialProjectPaths) {
    const proj = projectMap.get(normPath);
    if (proj) {
      queue.push(proj);
    }
  }

  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const ref of current.projectReferences) {
      const normRefPath = normalizeFsPath(ref.path);
      if (!resolvedPaths.has(normRefPath)) {
        resolvedPaths.add(normRefPath);
        const referencedProject = projectMap.get(normRefPath);
        if (referencedProject) {
          queue.push(referencedProject);
        }
      }
    }
  }

  return Array.from(resolvedPaths);
}

export function filterProjectsByScope(
  allProjects: readonly ProjectModel[],
  activeProjectPaths: readonly string[]
): ProjectModel[] {
  if (activeProjectPaths.length === 0) {
    return [];
  }

  const activeSet = new Set(activeProjectPaths.map(normalizeFsPath));
  return allProjects.filter(p => activeSet.has(normalizeFsPath(p.path)));
}
