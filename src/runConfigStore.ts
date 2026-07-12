import * as vscode from 'vscode';
import { LaunchProfile, ProjectModel, RunConfig, SolutionModel } from './models';
import { isRunnableProject } from './projectCapabilities';

const compoundsKey = 'runCompounds';
const addedSinglesKey = 'addedSingleConfigIds';
const activeKey = 'activeRunConfigId';

export function configLabelFor(project: ProjectModel, profile?: LaunchProfile): string {
  return `${project.name}: ${profile?.name ?? 'Default'}`;
}

export function listSingles(solution: SolutionModel): RunConfig[] {
  const configs: RunConfig[] = [];

  for (const project of solution.projects.filter(isRunnableProject)) {
    if (project.launchProfiles.length === 0) {
      configs.push(singleConfig(project));
      continue;
    }

    for (const profile of project.launchProfiles) {
      configs.push(singleConfig(project, profile));
    }
  }

  return configs;
}

export function getCompounds(context: vscode.ExtensionContext): RunConfig[] {
  return context.workspaceState.get<RunConfig[]>(compoundsKey, []);
}

export function getAddedSingleIds(context: vscode.ExtensionContext): string[] {
  return context.workspaceState.get<string[]>(addedSinglesKey, []);
}

export function listConfigs(solution: SolutionModel, context: vscode.ExtensionContext): RunConfig[] {
  const singlesById = new Map(listSingles(solution).map(config => [config.id, config]));
  const singles = getAddedSingleIds(context)
    .map(id => singlesById.get(id))
    .filter((config): config is RunConfig => Boolean(config));

  return [...singles, ...getCompounds(context)];
}

export function getActive(solution: SolutionModel, context: vscode.ExtensionContext): RunConfig | undefined {
  const activeId = context.workspaceState.get<string>(activeKey);
  const configs = listConfigs(solution, context);
  return configs.find(config => config.id === activeId) ?? configs[0];
}

export async function setActive(context: vscode.ExtensionContext, id: string): Promise<void> {
  await context.workspaceState.update(activeKey, id);
}

export async function setAddedSingleIds(context: vscode.ExtensionContext, ids: string[]): Promise<void> {
  const nextIds = uniqueIds(ids);
  await context.workspaceState.update(addedSinglesKey, nextIds);

  const activeId = context.workspaceState.get<string>(activeKey);
  if (activeId?.startsWith('single:') && !nextIds.includes(activeId)) {
    await context.workspaceState.update(activeKey, undefined);
  }
}

export async function removeAddedSingle(context: vscode.ExtensionContext, id: string): Promise<void> {
  await context.workspaceState.update(addedSinglesKey, getAddedSingleIds(context).filter(candidate => candidate !== id));
  if (context.workspaceState.get<string>(activeKey) === id) {
    await context.workspaceState.update(activeKey, undefined);
  }
}

export async function saveCompound(context: vscode.ExtensionContext, config: RunConfig): Promise<void> {
  const configs = getCompounds(context).filter(candidate => candidate.id !== config.id);
  configs.push(config);
  await context.workspaceState.update(compoundsKey, configs);
}

export async function deleteCompound(context: vscode.ExtensionContext, id: string): Promise<void> {
  await context.workspaceState.update(compoundsKey, getCompounds(context).filter(config => config.id !== id));
  if (context.workspaceState.get<string>(activeKey) === id) {
    await context.workspaceState.update(activeKey, undefined);
  }
}

function singleConfig(project: ProjectModel, profile?: LaunchProfile): RunConfig {
  return {
    id: singleId(project.path, profile?.name),
    label: configLabelFor(project, profile),
    kind: 'single',
    targets: [{ projectPath: project.path, profileName: profile?.name }]
  };
}

function singleId(projectPath: string, profileName?: string): string {
  return `single:${projectPath}::${profileName ?? 'Default'}`;
}

function uniqueIds(ids: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const id of ids) {
    if (!seen.has(id)) {
      seen.add(id);
      result.push(id);
    }
  }

  return result;
}
