import { EvaluatedProjectVariant } from './types';

export function createSmartBuildTraversal(
  projects: readonly EvaluatedProjectVariant[],
  includeRestore: boolean,
  fallbackProjectPaths: ReadonlySet<string> = new Set()
): string {
  const unique = [...new Map(projects.map(project => [project.projectPath, project])).values()];
  const levels = createDependencyLevels(unique);
  const allProjects = unique.map(project => renderItem('SmartBuildProject', project)).join('\n');
  const normalizedFallbacks = new Set([...fallbackProjectPaths].map(normalizePath));
  const levelItems = levels.flatMap((level, index) => [
    ...level.filter(project => !normalizedFallbacks.has(normalizePath(project.projectPath)))
      .map(project => renderItem(`SmartBuildLevel${index}`, project)),
    ...level.filter(project => normalizedFallbacks.has(normalizePath(project.projectPath)))
      .map(project => renderItem(`SmartBuildFallbackLevel${index}`, project))
  ]).join('\n');
  const restore = includeRestore
    ? '    <MSBuild Projects="@(SmartBuildProject)" Targets="Restore" BuildInParallel="true" Properties="BuildProjectReferences=false" />\n'
    : '';
  const build = levels.flatMap((level, index) => {
    const tasks: string[] = [];
    if (level.some(project => !normalizedFallbacks.has(normalizePath(project.projectPath)))) {
      tasks.push(`    <MSBuild Projects="@(SmartBuildLevel${index})" Targets="Build" BuildInParallel="true" StopOnFirstFailure="true" Properties="BuildProjectReferences=false" />`);
    }
    if (level.some(project => normalizedFallbacks.has(normalizePath(project.projectPath)))) {
      tasks.push(`    <MSBuild Projects="@(SmartBuildFallbackLevel${index})" Targets="Build" BuildInParallel="true" StopOnFirstFailure="true" Properties="BuildProjectReferences=true" />`);
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
  return process.platform === 'win32' ? value.toLowerCase() : value;
}
