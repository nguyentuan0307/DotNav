import * as fs from 'fs/promises';
import * as path from 'path';
import { loadLaunchProfiles } from './launchSettings';
import { PackageReference, ProjectKind, ProjectModel, ProjectReference } from './models';
import { normalizeSlashes, relativeOrName, resolveMsbuildPath } from './pathUtils';

const packageReferenceRegex = /<PackageReference\b([^>]*)>(?:[\s\S]*?<\/PackageReference>)?/gi;
const projectReferenceRegex = /<ProjectReference\b([^>]*)>/gi;

export async function parseProject(projectPath: string, rootPath: string): Promise<ProjectModel> {
  const xml = await fs.readFile(projectPath, 'utf8');
  const directory = path.dirname(projectPath);
  const name = path.basename(projectPath, path.extname(projectPath));
  const rootNamespace = readSingleTagValues(xml, 'RootNamespace')[0];
  const assemblyName = readSingleTagValues(xml, 'AssemblyName')[0];
  const targetFrameworks = parseTargetFrameworks(xml);
  const launchProfiles = await loadLaunchProfiles(directory);
  const packageReferences = parsePackageReferences(xml);
  const projectReferences = parseProjectReferences(xml, directory);
  const kind = classifyProject(projectPath, xml, packageReferences);

  return {
    name,
    path: projectPath,
    directory,
    relativePath: normalizeSlashes(relativeOrName(rootPath, projectPath)),
    kind,
    rootNamespace,
    assemblyName,
    targetFrameworks,
    launchProfiles,
    packageReferences,
    projectReferences
  };
}

function parseTargetFrameworks(xml: string): string[] {
  const values = [
    ...readSingleTagValues(xml, 'TargetFramework'),
    ...readSingleTagValues(xml, 'TargetFrameworks')
  ];

  return values.flatMap(value => value.split(';')).map(value => value.trim()).filter(Boolean);
}

function parsePackageReferences(xml: string): PackageReference[] {
  const packages: PackageReference[] = [];
  let match: RegExpExecArray | null;

  packageReferenceRegex.lastIndex = 0;
  while ((match = packageReferenceRegex.exec(xml)) !== null) {
    const attributes = parseAttributes(match[1]);
    const name = attributes.Include ?? attributes.Update ?? attributes.Remove;
    if (!name) {
      continue;
    }

    const elementText = match[0];
    const inlineVersion = readSingleTagValues(elementText, 'Version')[0];
    packages.push({ name, version: attributes.Version ?? inlineVersion });
  }

  return packages.sort((a, b) => a.name.localeCompare(b.name));
}

function parseProjectReferences(xml: string, projectDirectory: string): ProjectReference[] {
  const references: ProjectReference[] = [];
  let match: RegExpExecArray | null;

  projectReferenceRegex.lastIndex = 0;
  while ((match = projectReferenceRegex.exec(xml)) !== null) {
    const attributes = parseAttributes(match[1]);
    const include = attributes.Include;
    if (!include) {
      continue;
    }

    const referencePath = resolveMsbuildPath(projectDirectory, include);
    references.push({
      name: path.basename(referencePath, path.extname(referencePath)),
      path: referencePath
    });
  }

  return references.sort((a, b) => a.name.localeCompare(b.name));
}

function classifyProject(projectPath: string, xml: string, packages: PackageReference[]): ProjectKind {
  if (projectPath.toLowerCase().endsWith('.dcproj') || /Sdk\s*=\s*"[^"]*Microsoft\.Docker\.Sdk/i.test(xml)) {
    return 'docker';
  }

  if (/Sdk\s*=\s*"[^"]*Microsoft\.NET\.Sdk\.Web/i.test(xml)) {
    return 'web';
  }

  if (packages.some(pkg => /^(Microsoft\.NET\.Test\.Sdk|xunit|NUnit|MSTest\.TestFramework)$/i.test(pkg.name))) {
    return 'test';
  }

  const outputType = readSingleTagValues(xml, 'OutputType')[0]?.toLowerCase();
  if (outputType === 'exe' || outputType === 'winexe') {
    return 'console';
  }

  if (/Sdk\s*=\s*"[^"]*Microsoft\.NET\.Sdk/i.test(xml)) {
    return 'library';
  }

  return 'unknown';
}

function readSingleTagValues(xml: string, tagName: string): string[] {
  const regex = new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${tagName}>`, 'gi');
  const values: string[] = [];
  let match: RegExpExecArray | null;

  while ((match = regex.exec(xml)) !== null) {
    values.push(match[1].trim());
  }

  return values;
}

function parseAttributes(attributesText: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  const regex = /([:\w.-]+)\s*=\s*"([^"]*)"/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(attributesText)) !== null) {
    attributes[match[1]] = match[2];
  }

  return attributes;
}
