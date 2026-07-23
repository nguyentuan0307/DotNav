// Classifies solution projects for EF Core (design §3.1). Pure module — works
// on already-parsed ProjectModel metadata, no vscode imports.

import { ProjectModel, SolutionModel } from '../models';
import { normalizePath } from '../pathUtils';

export interface EfProjectDetection {
  readonly project: ProjectModel;
  /** References Microsoft.EntityFrameworkCore.Design or .Tools. */
  readonly hasDesignPackage: boolean;
  /** Executable projects (including the project itself) that can host design-time services. */
  readonly startupCandidates: readonly ProjectModel[];
}

const designPackagePattern = /^Microsoft\.EntityFrameworkCore\.(Design|Tools)$/i;
const efPackagePattern = /^Microsoft\.EntityFrameworkCore($|\.)/i;

export function referencesEfCore(project: ProjectModel): boolean {
  return project.packageReferences.some(pkg => efPackagePattern.test(pkg.name));
}

export function referencesEfDesign(project: ProjectModel): boolean {
  return project.packageReferences.some(pkg => designPackagePattern.test(pkg.name));
}

function isExecutable(project: ProjectModel): boolean {
  return project.kind === 'web' || project.kind === 'console';
}

/**
 * Detects EF migration project candidates and, for each, the executable
 * projects whose transitive reference closure contains it.
 */
export function detectEfProjects(solution: SolutionModel): EfProjectDetection[] {
  const byPath = new Map<string, ProjectModel>();
  for (const project of solution.projects) {
    byPath.set(normalizePath(project.path), project);
  }

  const closureCache = new Map<string, Set<string>>();
  const closureOf = (project: ProjectModel): Set<string> => {
    const key = normalizePath(project.path);
    const cached = closureCache.get(key);
    if (cached) {
      return cached;
    }

    const visited = new Set<string>();
    closureCache.set(key, visited);
    const stack = [project];
    while (stack.length > 0) {
      const current = stack.pop()!;
      for (const reference of current.projectReferences) {
        const referencePath = normalizePath(reference.path);
        if (visited.has(referencePath)) {
          continue;
        }

        visited.add(referencePath);
        const referenced = byPath.get(referencePath);
        if (referenced) {
          stack.push(referenced);
        }
      }
    }

    return visited;
  };

  const executables = solution.projects.filter(isExecutable);
  const detections: EfProjectDetection[] = [];

  for (const project of solution.projects) {
    if (!referencesEfCore(project)) {
      continue;
    }

    const projectPath = normalizePath(project.path);
    const startupCandidates: ProjectModel[] = [];
    if (isExecutable(project)) {
      startupCandidates.push(project);
    }

    for (const executable of executables) {
      if (normalizePath(executable.path) === projectPath) {
        continue;
      }

      if (closureOf(executable).has(projectPath)) {
        startupCandidates.push(executable);
      }
    }

    detections.push({
      project,
      hasDesignPackage: referencesEfDesign(project),
      startupCandidates
    });
  }

  return detections.sort((a, b) => a.project.name.localeCompare(b.project.name));
}

/**
 * The subset worth showing in the EF tree: projects that either carry the
 * design-time package themselves or are plain EF projects reachable from an
 * executable (single-project apps included).
 */
export function migrationProjectCandidates(detections: readonly EfProjectDetection[]): EfProjectDetection[] {
  const withDesign = detections.filter(detection => detection.hasDesignPackage);
  if (withDesign.length > 0) {
    return withDesign;
  }

  return detections.filter(detection => detection.startupCandidates.length > 0);
}
