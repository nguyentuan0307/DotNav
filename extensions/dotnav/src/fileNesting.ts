import * as path from 'path';
import type * as vscode from 'vscode';
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
  if (fileNodes.length <= 1) {
    return fileNodes;
  }

  const rules = getRules();
  const fileMap = new Map<string, TreeNode>();
  for (const node of fileNodes) {
    const name = path.basename(node.resourcePath ?? node.label).toLowerCase();
    fileMap.set(name, node);
  }

  const parentByChild = new Map<string, TreeNode>();
  const childrenByParent = new Map<string, TreeNode[]>();

  for (const child of fileNodes) {
    const childName = path.basename(child.resourcePath ?? child.label);
    const childLower = childName.toLowerCase();

    for (const rule of rules) {
      if (!rule.childPattern.includes('${base}')) {
        if (rule.childPattern.includes('*')) {
          const [prefix, suffix] = rule.childPattern.split('*');
          if (childLower.startsWith(prefix.toLowerCase()) && childLower.endsWith(suffix.toLowerCase())) {
            const parentNode = fileMap.get(rule.parentPattern.toLowerCase());
            if (parentNode && parentNode.resourcePath !== child.resourcePath) {
              parentByChild.set(child.resourcePath!, parentNode);
              const children = childrenByParent.get(parentNode.resourcePath!) ?? [];
              children.push(child);
              childrenByParent.set(parentNode.resourcePath!, children);
              break;
            }
          }
        } else if (childLower === rule.childPattern.toLowerCase()) {
          const parentNode = fileMap.get(rule.parentPattern.toLowerCase());
          if (parentNode && parentNode.resourcePath !== child.resourcePath) {
            parentByChild.set(child.resourcePath!, parentNode);
            const children = childrenByParent.get(parentNode.resourcePath!) ?? [];
            children.push(child);
            childrenByParent.set(parentNode.resourcePath!, children);
            break;
          }
        }
        continue;
      }

      const [childPrefix, childSuffix] = rule.childPattern.split('${base}');
      if (childPrefix !== undefined && childSuffix !== undefined) {
        if (childSuffix.includes('*')) {
          const [starPrefix, starSuffix] = childSuffix.split('*');
          if (childLower.startsWith(childPrefix.toLowerCase()) && childLower.endsWith(starSuffix.toLowerCase())) {
            const startIdx = childPrefix.length;
            const endIdx = childLower.lastIndexOf(starSuffix.toLowerCase());
            const middle = childLower.slice(startIdx, endIdx);
            const starPrefixIdx = middle.indexOf(starPrefix.toLowerCase());
            if (starPrefixIdx >= 0) {
              const base = childName.slice(startIdx, startIdx + starPrefixIdx);
              if (base.length > 0) {
                const parentCandidateName = rule.parentPattern.replace('${base}', base).toLowerCase();
                const parentNode = fileMap.get(parentCandidateName);
                if (parentNode && parentNode.resourcePath !== child.resourcePath) {
                  parentByChild.set(child.resourcePath!, parentNode);
                  const children = childrenByParent.get(parentNode.resourcePath!) ?? [];
                  children.push(child);
                  childrenByParent.set(parentNode.resourcePath!, children);
                  break;
                }
              }
            }
          }
        } else if (childLower.startsWith(childPrefix.toLowerCase()) && childLower.endsWith(childSuffix.toLowerCase())) {
          const base = childName.slice(childPrefix.length, childName.length - childSuffix.length);
          if (base.length > 0) {
            const parentCandidateName = rule.parentPattern.replace('${base}', base).toLowerCase();
            const parentNode = fileMap.get(parentCandidateName);
            if (parentNode && parentNode.resourcePath !== child.resourcePath) {
              parentByChild.set(child.resourcePath!, parentNode);
              const children = childrenByParent.get(parentNode.resourcePath!) ?? [];
              children.push(child);
              childrenByParent.set(parentNode.resourcePath!, children);
              break;
            }
          }
        }
      }
    }
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
        collapsibleState: 1 // Collapsed
      };
    });
}

function getRules(): FileNestingRule[] {
  let customRules: FileNestingRule[] = [];
  try {
    const vscodeModule = require('vscode') as typeof import('vscode') | undefined;
    customRules = vscodeModule?.workspace?.getConfiguration('dotnav')?.get<FileNestingRule[]>('fileNestingRules', []) ?? [];
  } catch {
    customRules = [];
  }

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
