import * as path from 'path';
import { ProjectModel } from '../models';
import { ScopeResolutionOptions, ScopeTarget } from './scopeModel';

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
  optionsOrIncludeDependencies?: boolean | ScopeResolutionOptions
): string[] {
  if (targets.length === 0) {
    return [];
  }

  const options: ScopeResolutionOptions =
    typeof optionsOrIncludeDependencies === 'boolean'
      ? { includeDependencies: optionsOrIncludeDependencies, includeDependents: false }
      : {
          includeDependencies: optionsOrIncludeDependencies?.includeDependencies ?? true,
          includeDependents: optionsOrIncludeDependencies?.includeDependents ?? false
        };

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

  const resolvedPaths = new Set<string>(initialProjectPaths);

  // 1. Downstream: Dependencies (projects referenced by targets)
  if (options.includeDependencies) {
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
  }

  // 2. Upstream: Dependents / Reverse References (projects that reference targets)
  if (options.includeDependents) {
    const reverseMap = new Map<string, ProjectModel[]>();
    for (const p of allProjects) {
      for (const ref of p.projectReferences) {
        const normRef = normalizeFsPath(ref.path);
        let list = reverseMap.get(normRef);
        if (!list) {
          list = [];
          reverseMap.set(normRef, list);
        }
        list.push(p);
      }
    }

    const queue: string[] = Array.from(initialProjectPaths);
    const visitedUpstream = new Set<string>(initialProjectPaths);

    while (queue.length > 0) {
      const currentPath = queue.shift()!;
      const referencingProjects = reverseMap.get(currentPath);
      if (referencingProjects) {
        for (const parentProj of referencingProjects) {
          const normParentPath = normalizeFsPath(parentProj.path);
          if (!resolvedPaths.has(normParentPath)) {
            resolvedPaths.add(normParentPath);
          }
          if (!visitedUpstream.has(normParentPath)) {
            visitedUpstream.add(normParentPath);
            queue.push(normParentPath);
          }
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
