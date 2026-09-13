import type * as vscode from 'vscode';
import { ProjectModel } from '../models';
import { ScopePreset, ScopeTarget, SolutionScope } from './scopeModel';
import { filterProjectsByScope, resolveScopeProjectPaths } from './scopeResolver';
import { parseSlnfFile } from './slnfService';

const SCOPE_PRESETS_KEY = 'dotnav.solutionScope.presets';
const ACTIVE_SCOPE_TARGETS_KEY = 'dotnav.solutionScope.activeTargets';

type ScopeListener = (scope: SolutionScope | undefined) => void;

class ScopeEventEmitter {
  private readonly listeners: ScopeListener[] = [];

  readonly event = (listener: ScopeListener): { dispose: () => void } => {
    this.listeners.push(listener);
    return {
      dispose: () => {
        const idx = this.listeners.indexOf(listener);
        if (idx >= 0) {
          this.listeners.splice(idx, 1);
        }
      }
    };
  };

  fire(data: SolutionScope | undefined): void {
    for (const listener of [...this.listeners]) {
      listener(data);
    }
  }
}

export class ScopeManager {
  private activeScope: SolutionScope | undefined;
  private readonly _onDidChangeScope = new ScopeEventEmitter();
  readonly onDidChangeScope = this._onDidChangeScope.event;

  constructor(private readonly workspaceState: vscode.Memento) {}

  getActiveScope(): SolutionScope | undefined {
    return this.activeScope;
  }

  isScopeActive(): boolean {
    return this.activeScope !== undefined;
  }

  async setScope(scope: SolutionScope | undefined): Promise<void> {
    this.activeScope = scope;
    if (scope) {
      await this.workspaceState.update(ACTIVE_SCOPE_TARGETS_KEY, {
        name: scope.name,
        targets: scope.targets,
        includeDependencies: scope.includeDependencies,
        sourceSlnfPath: scope.sourceSlnfPath
      });
    } else {
      await this.workspaceState.update(ACTIVE_SCOPE_TARGETS_KEY, undefined);
    }
    this._onDidChangeScope.fire(this.activeScope);
  }

  async clearScope(): Promise<void> {
    await this.setScope(undefined);
  }

  async createAndApplyScope(
    name: string,
    targets: readonly ScopeTarget[],
    includeDependencies: boolean,
    allProjects: readonly ProjectModel[]
  ): Promise<SolutionScope> {
    const activeProjectPaths = resolveScopeProjectPaths(allProjects, targets, includeDependencies);
    const scope: SolutionScope = {
      id: `scope_${Date.now()}`,
      name,
      targets,
      includeDependencies,
      activeProjectPaths
    };

    await this.setScope(scope);
    return scope;
  }

  async applySlnfScope(slnfFilePath: string, allProjects: readonly ProjectModel[]): Promise<SolutionScope> {
    const parsed = await parseSlnfFile(slnfFilePath);
    const targets: ScopeTarget[] = parsed.projectAbsolutePaths.map(p => ({
      kind: 'project',
      value: p
    }));

    const scope: SolutionScope = {
      id: `slnf_${Date.now()}`,
      name: slnfFilePath.split(/[\\/]+/).pop()?.replace(/\.slnf$/i, '') ?? 'Solution Filter',
      targets,
      includeDependencies: false, // slnf explicitly defines its projects
      activeProjectPaths: parsed.projectAbsolutePaths,
      sourceSlnfPath: slnfFilePath
    };

    await this.setScope(scope);
    return scope;
  }

  filterProjects(allProjects: readonly ProjectModel[]): ProjectModel[] {
    if (!this.activeScope) {
      return [...allProjects];
    }
    return filterProjectsByScope(allProjects, this.activeScope.activeProjectPaths);
  }

  getPresets(): ScopePreset[] {
    return this.workspaceState.get<ScopePreset[]>(SCOPE_PRESETS_KEY, []);
  }

  async savePreset(
    name: string,
    targets: readonly ScopeTarget[],
    includeDependencies: boolean
  ): Promise<ScopePreset> {
    const presets = this.getPresets().filter(p => p.name.toLowerCase() !== name.toLowerCase());
    const newPreset: ScopePreset = {
      id: `preset_${Date.now()}`,
      name,
      targets,
      includeDependencies
    };

    presets.push(newPreset);
    await this.workspaceState.update(SCOPE_PRESETS_KEY, presets);
    return newPreset;
  }

  async deletePreset(id: string): Promise<void> {
    const presets = this.getPresets().filter(p => p.id !== id);
    await this.workspaceState.update(SCOPE_PRESETS_KEY, presets);
  }

  async applyPreset(presetId: string, allProjects: readonly ProjectModel[]): Promise<SolutionScope | undefined> {
    const preset = this.getPresets().find(p => p.id === presetId);
    if (!preset) {
      return undefined;
    }

    return this.createAndApplyScope(
      preset.name,
      preset.targets,
      preset.includeDependencies,
      allProjects
    );
  }

  async restoreActiveScopeIfAny(allProjects: readonly ProjectModel[]): Promise<void> {
    if (this.activeScope || allProjects.length === 0) {
      return;
    }

    const saved = this.workspaceState.get<{
      name: string;
      targets: ScopeTarget[];
      includeDependencies: boolean;
      sourceSlnfPath?: string;
    }>(ACTIVE_SCOPE_TARGETS_KEY);

    if (saved && saved.targets && saved.targets.length > 0) {
      try {
        if (saved.sourceSlnfPath) {
          await this.applySlnfScope(saved.sourceSlnfPath, allProjects);
        } else {
          await this.createAndApplyScope(
            saved.name,
            saved.targets,
            saved.includeDependencies,
            allProjects
          );
        }
      } catch (err) {
        console.warn(`Could not restore active solution scope: ${err}`);
      }
    }
  }
}
