import * as fs from 'fs';
import * as path from 'path';
import { ProjectModel, SolutionModel } from '../models';
import { EvaluatedProjectVariant } from './types';

export function createSmartBuildTraversal(
  projects: readonly EvaluatedProjectVariant[],
  includeRestore: boolean,
  fallbackProjectPaths: ReadonlySet<string> = new Set(),
  propagationProjectPaths: ReadonlySet<string> = new Set()
): string {
  const unique = [...new Map(projects.map(project => [project.projectPath, project])).values()];
  const levels = createDependencyLevels(unique);
  const allProjects = unique.map(project => renderItem('SmartBuildProject', project)).join('\n');
  const normalizedFallbacks = new Set([...fallbackProjectPaths].map(normalizePath));
  const normalizedPropagations = new Set([...propagationProjectPaths].map(normalizePath));
  const levelItems = levels.flatMap((level, index) => [
    ...level.filter(project => !normalizedFallbacks.has(normalizePath(project.projectPath))
      && !normalizedPropagations.has(normalizePath(project.projectPath)))
      .map(project => renderItem(`SmartBuildLevel${index}`, project)),
    ...level.filter(project => normalizedFallbacks.has(normalizePath(project.projectPath)))
      .map(project => renderItem(`SmartBuildFallbackLevel${index}`, project)),
    ...level.filter(project => normalizedPropagations.has(normalizePath(project.projectPath)))
      .map(project => renderItem(`SmartBuildPropagationLevel${index}`, project))
  ]).join('\n');
  const restore = includeRestore
    ? '    <MSBuild Projects="@(SmartBuildProject)" Targets="Restore" BuildInParallel="true" Properties="BuildProjectReferences=false" />\n'
    : '';
  const build = levels.flatMap((level, index) => {
    const tasks: string[] = [];
    if (level.some(project => !normalizedFallbacks.has(normalizePath(project.projectPath))
      && !normalizedPropagations.has(normalizePath(project.projectPath)))) {
      tasks.push(`    <MSBuild Projects="@(SmartBuildLevel${index})" Targets="Build" BuildInParallel="true" StopOnFirstFailure="true" Properties="BuildProjectReferences=false" />`);
    }
    if (level.some(project => normalizedFallbacks.has(normalizePath(project.projectPath)))) {
      tasks.push(`    <MSBuild Projects="@(SmartBuildFallbackLevel${index})" Targets="Build" BuildInParallel="true" StopOnFirstFailure="true" Properties="BuildProjectReferences=true" />`);
    }
    if (level.some(project => normalizedPropagations.has(normalizePath(project.projectPath)))) {
      tasks.push(`    <MSBuild Projects="@(SmartBuildPropagationLevel${index})" Targets="ResolveReferences;_CopyFilesMarkedCopyLocal" BuildInParallel="true" StopOnFirstFailure="true" Properties="BuildProjectReferences=false" />`);
    }
    return tasks;
  }).join('\n');
  return `<?xml version="1.0" encoding="utf-8"?>
<Project DefaultTargets="Build">
  <ItemGroup>
${allProjects}
${levelItems}
  </ItemGroup>
  <Target Name="Build">
${restore}${build}
  </Target>
</Project>
`;
}

export function scopeTransitiveUpstream(
  solution: SolutionModel,
  targets: readonly ProjectModel[]
): ProjectModel[] {
  const projectByPath = new Map<string, ProjectModel>();
  for (const project of solution.projects) {
    projectByPath.set(normalizePath(project.path), project);
  }
  const included = new Set<string>();
  const queue = targets.map(p => normalizePath(p.path));
  for (const path of queue) included.add(path);

  while (queue.length > 0) {
    const currentPath = queue.shift()!;
    const project = projectByPath.get(currentPath);
    if (!project) continue;
    for (const refPath of extractProjectReferences(project)) {
      const normRef = normalizePath(refPath);
      if (!included.has(normRef)) {
        included.add(normRef);
        queue.push(normRef);
      }
    }
  }
  return solution.projects.filter(p => included.has(normalizePath(p.path)));
}

function extractProjectReferences(project: ProjectModel): string[] {
  if (project.projectReferences && project.projectReferences.length > 0) {
    return project.projectReferences.map(ref => ref.path);
  }
  try {
    const xml = fs.readFileSync(project.path, 'utf8');
    const dir = project.directory || path.dirname(project.path);
    const regex = /<ProjectReference\b[^>]*?\bInclude=["']([^"']+)["']/gi;
    const refs: string[] = [];
    let match: RegExpExecArray | null;
    while ((match = regex.exec(xml)) !== null) {
      const inc = match[1].replace(/\\/g, '/');
      refs.push(path.resolve(dir, inc));
    }
    return refs;
  } catch {
    return [];
  }
}

function createDependencyLevels(projects: readonly EvaluatedProjectVariant[]): EvaluatedProjectVariant[][] {
  const key = (value: string) => process.platform === 'win32' ? value.toLowerCase() : value;
  const remaining = new Map(projects.map(project => [key(project.projectPath), project]));
  const levels: EvaluatedProjectVariant[][] = [];
  while (remaining.size > 0) {
    const level = [...remaining.values()].filter(project => project.projectReferences
      .every(reference => !remaining.has(key(reference))));
    // ProjectGraph rejects cycles; this fallback keeps a malformed external graph deterministic.
    if (level.length === 0) level.push(remaining.values().next().value as EvaluatedProjectVariant);
    levels.push(level);
    for (const project of level) remaining.delete(key(project.projectPath));
  }
  return levels;
}

function escapeXml(value: string): string {
  return value.replace(/[&<>'"]/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&apos;', '"': '&quot;'
  })[character]!);
}

function renderItem(itemName: string, project: EvaluatedProjectVariant): string {
  const properties = `Configuration=${escapeProperty(project.configuration)};Platform=${escapeProperty(project.platform)}`;
  return `    <${itemName} Include="${escapeXml(project.projectPath)}"><AdditionalProperties>${escapeXml(properties)}</AdditionalProperties></${itemName}>`;
}

function escapeProperty(value: string): string {
  return value.replace(/%/g, '%25').replace(/;/g, '%3B').replace(/=/g, '%3D');
}

function normalizePath(value: string): string {
  const resolved = path.resolve(value);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}
