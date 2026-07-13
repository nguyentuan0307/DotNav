import * as path from 'path';
import { ProjectModel } from './models';

export type CodeItemKind = 'class' | 'interface' | 'record' | 'enum';

export function computeNamespace(project: ProjectModel, targetDir: string): string {
  const root = sanitizeNamespace(project.rootNamespace ?? project.name);
  const relative = path.relative(project.directory, targetDir);
  const segments = relative
    .split(path.sep)
    .map(segment => segment.trim())
    .filter(Boolean)
    .map(sanitizeIdentifier);

  return [root, ...segments].filter(Boolean).join('.');
}

function sanitizeNamespace(value: string): string {
  return value
    .split('.')
    .map(segment => segment.trim())
    .filter(Boolean)
    .map(sanitizeIdentifier)
    .join('.');
}

export function sanitizeIdentifier(value: string): string {
  const sanitized = value.replace(/[^A-Za-z0-9_]/g, '_');
  if (sanitized.length === 0) {
    return '_';
  }

  return /^\d/.test(sanitized) ? `_${sanitized}` : sanitized;
}

export function useFileScoped(project?: ProjectModel): boolean {
  if (!project || project.targetFrameworks.length === 0) {
    return true;
  }

  return project.targetFrameworks.some(targetFramework => {
    const match = /^net(\d+)\./i.exec(targetFramework);
    return match ? Number(match[1]) >= 6 : false;
  });
}

export interface CodeItemTemplateOptions {
  readonly partial?: boolean;
}

export function renderTemplate(
  kind: CodeItemKind,
  name: string,
  namespaceName?: string,
  fileScoped = true,
  options: CodeItemTemplateOptions = {}
): string {
  const body = renderBody(kind, name, options);
  if (!namespaceName) {
    return `${body}\n`;
  }

  if (fileScoped) {
    return `namespace ${namespaceName};\n\n${body}\n`;
  }

  return `namespace ${namespaceName}\n{\n${indent(body)}\n}\n`;
}

function renderBody(kind: CodeItemKind, name: string, options: CodeItemTemplateOptions): string {
  const partial = options.partial && kind !== 'enum' ? ' partial' : '';

  switch (kind) {
    case 'class':
      return `public${partial} class ${name}\n{\n}`;
    case 'interface':
      return `public${partial} interface ${name}\n{\n}`;
    case 'record':
      return `public${partial} record ${name};`;
    case 'enum':
      return `public enum ${name}\n{\n}`;
  }
}

function indent(value: string): string {
  return value
    .split('\n')
    .map(line => line.length > 0 ? `    ${line}` : line)
    .join('\n');
}
