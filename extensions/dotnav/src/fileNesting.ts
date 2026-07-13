import * as path from 'path';
import * as vscode from 'vscode';
import { TreeNode } from './models';

interface FileNestingRule {
  readonly parentPattern: string;
  readonly childPattern: string;
}

const defaultRules: FileNestingRule[] = [
  { parentPattern: '${base}.json', childPattern: '${base}.*.json' },
  { parentPattern: '${base}.cs', childPattern: '${base}.Designer.cs' },
  { parentPattern: '${base}.cs', childPattern: '${base}.g.cs' },
  { parentPattern: '${base}.cs', childPattern: '${base}.g.i.cs' },
  { parentPattern: '${base}.cs', childPattern: '${base}.generated.cs' },
  { parentPattern: '${base}.razor', childPattern: '${base}.razor.cs' },
  { parentPattern: '${base}.razor', childPattern: '${base}.razor.css' },
  { parentPattern: '${base}.xaml', childPattern: '${base}.xaml.cs' },
  { parentPattern: '${base}.ts', childPattern: '${base}.js' },
  { parentPattern: '${base}.ts', childPattern: '${base}.js.map' },
  { parentPattern: '${base}.ts', childPattern: '${base}.d.ts' },
  { parentPattern: '${base}.tsx', childPattern: '${base}.js' },
  { parentPattern: '${base}.tsx', childPattern: '${base}.js.map' },
  { parentPattern: '${base}.tsx', childPattern: '${base}.d.ts' },
  { parentPattern: 'package.json', childPattern: 'package-lock.json' },
  { parentPattern: 'docker-compose.yml', childPattern: 'docker-compose.*.yml' },
  { parentPattern: 'docker-compose.yaml', childPattern: 'docker-compose.*.yaml' },
  { parentPattern: '${base}.csproj', childPattern: '${base}.csproj.user' }
];

export function nestFiles(fileNodes: TreeNode[]): TreeNode[] {
  const rules = getRules();
  const parentByChild = new Map<string, TreeNode>();
  const childrenByParent = new Map<string, TreeNode[]>();

  for (const child of fileNodes) {
    const parent = findParent(child, fileNodes, rules);
    if (!parent || parent.resourcePath === child.resourcePath) {
      continue;
    }

    parentByChild.set(child.resourcePath!, parent);
    const children = childrenByParent.get(parent.resourcePath!) ?? [];
    children.push(child);
    childrenByParent.set(parent.resourcePath!, children);
  }

  return fileNodes
    .filter(node => !parentByChild.has(node.resourcePath!))
    .map(node => {
      const children = childrenByParent.get(node.resourcePath!);
      if (!children || children.length === 0) {
        return node;
      }

      return {
        ...node,
        children: children.sort(compareByLabel),
        collapsibleState: vscode.TreeItemCollapsibleState.Collapsed
      };
    });
}

function findParent(child: TreeNode, candidates: TreeNode[], rules: FileNestingRule[]): TreeNode | undefined {
  const childName = path.basename(child.resourcePath ?? child.label);
  const matches: TreeNode[] = [];

  for (const parent of candidates) {
    const parentName = path.basename(parent.resourcePath ?? parent.label);
    if (parentName === childName) {
      continue;
    }

    if (rules.some(rule => matchesRule(parentName, childName, rule))) {
      matches.push(parent);
    }
  }

  if (matches.length === 0) {
    return undefined;
  }

  return matches.sort((a, b) => {
    const aName = path.basename(a.resourcePath ?? a.label);
    const bName = path.basename(b.resourcePath ?? b.label);
    return specificityScore(bName) - specificityScore(aName) || aName.length - bName.length;
  })[0];
}

function matchesRule(parentName: string, childName: string, rule: FileNestingRule): boolean {
  const base = extractBase(parentName, rule.parentPattern);
  if (base === undefined) {
    return false;
  }

  return childMatches(childName, rule.childPattern, base);
}

function extractBase(parentName: string, parentPattern: string): string | undefined {
  if (!parentPattern.includes('${base}')) {
    return parentName === parentPattern ? '' : undefined;
  }

  const [prefix, suffix] = parentPattern.split('${base}');
  if (!parentName.startsWith(prefix) || !parentName.endsWith(suffix)) {
    return undefined;
  }

  return parentName.slice(prefix.length, parentName.length - suffix.length);
}

function childMatches(childName: string, childPattern: string, base: string): boolean {
  const resolvedPattern = childPattern.replace(/\$\{base\}/g, base);
  return globLikeMatch(childName, resolvedPattern);
}

function globLikeMatch(fileName: string, pattern: string): boolean {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  return new RegExp(`^${escaped}$`, 'i').test(fileName);
}

function specificityScore(parentName: string): number {
  if (parentName === 'appsettings.json') {
    return 1000;
  }

  if (parentName === 'package.json') {
    return 900;
  }

  return parentName.split('.').length;
}

function getRules(): FileNestingRule[] {
  const customRules = vscode.workspace
    .getConfiguration('dotnav')
    .get<FileNestingRule[]>('fileNestingRules', []);

  return [...defaultRules, ...customRules.filter(isValidRule)];
}

function isValidRule(rule: FileNestingRule): boolean {
  return typeof rule.parentPattern === 'string'
    && rule.parentPattern.length > 0
    && typeof rule.childPattern === 'string'
    && rule.childPattern.length > 0;
}

function compareByLabel(a: TreeNode, b: TreeNode): number {
  return a.label.localeCompare(b.label);
}
