// Classifies solution projects for EF Core (design §3.1). Pure module — works
// on already-parsed ProjectModel metadata, no vscode imports.

import { ProjectModel, SolutionModel } from '../models';
import { normalizePath } from '../pathUtils';

export interface EfProjectDetection {
  readonly project: ProjectModel;
  /** References Microsoft.EntityFrameworkCore.Design or .Tools. */
  readonly hasDesignPackage: boolean;
  /** A Migrations folder with generated files exists on disk (design §3.1). */
  readonly hasMigrationsFolder: boolean;
  /** Executable projects (including the project itself) that can host design-time services. */
  readonly startupCandidates: readonly ProjectModel[];
}

const designPackagePattern = /^Microsoft\.EntityFrameworkCore\.(Design|Tools)$/i;
// Any EF-family package counts: Microsoft.EntityFrameworkCore.*, provider
// packages such as Npgsql.EntityFrameworkCore.PostgreSQL or
// Pomelo.EntityFrameworkCore.MySql, and third-party extensions.
const efPackagePattern = /EntityFrameworkCore/i;

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
export function detectEfProjects(
  solution: SolutionModel,
  extraEfProjectPaths?: ReadonlySet<string>
): EfProjectDetection[] {
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
    // Package reference is the primary signal; an existing Migrations folder
    // (design §3.1) covers projects that get EF transitively.
    if (!referencesEfCore(project) && !extraEfProjectPaths?.has(normalizePath(project.path))) {
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
      hasMigrationsFolder: extraEfProjectPaths?.has(projectPath) ?? false,
      startupCandidates
    });
  }

  return detections.sort((a, b) => a.project.name.localeCompare(b.project.name));
}

/**
 * The subset worth showing in the EF tree: projects that carry the design-time
 * package, already hold a Migrations folder, or — as a last resort — plain EF
 * projects reachable from an executable (single-project apps included).
 */
export function migrationProjectCandidates(detections: readonly EfProjectDetection[]): EfProjectDetection[] {
  const strong = detections.filter(detection => detection.hasDesignPackage || detection.hasMigrationsFolder);
  if (strong.length > 0) {
    return strong;
  }

  return detections.filter(detection => detection.startupCandidates.length > 0);
}
