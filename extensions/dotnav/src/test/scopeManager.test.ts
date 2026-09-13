import * as assert from 'assert';
import { describe, it, beforeEach } from 'node:test';
import * as path from 'path';
import type * as vscode from 'vscode';
import { ProjectModel } from '../models';
import { ScopeManager } from '../scope/scopeManager';
import { ScopeTarget } from '../scope/scopeModel';

class MockMemento implements vscode.Memento {
  private store = new Map<string, any>();

  get<T>(key: string): T | undefined;
  get<T>(key: string, defaultValue: T): T;
  get<T>(key: string, defaultValue?: T): T | undefined {
    return this.store.has(key) ? this.store.get(key) : defaultValue;
  }

  async update(key: string, value: any): Promise<void> {
    if (value === undefined) {
      this.store.delete(key);
    } else {
      this.store.set(key, value);
    }
  }

  keys(): readonly string[] {
    return Array.from(this.store.keys());
  }
}

function createTestProject(name: string, folder?: string[]): ProjectModel {
  const root = path.resolve('/workspace');
  const projPath = path.resolve(root, `src/${name}/${name}.csproj`);
  return {
    name,
    path: projPath,
    directory: path.dirname(projPath),
    relativePath: `src/${name}/${name}.csproj`,
    metadataLoaded: true,
    kind: 'library',
    targetFrameworks: ['net8.0'],
    launchProfiles: [],
    packageReferences: [],
    projectReferences: [],
    solutionFolder: folder
  };
}

describe('ScopeManager', () => {
  let memento: MockMemento;
  let manager: ScopeManager;
  const projectA = createTestProject('ProjectA', ['Services', 'A']);
  const projectB = createTestProject('ProjectB', ['Services', 'B']);
  const allProjects = [projectA, projectB];

  beforeEach(() => {
    memento = new MockMemento();
    manager = new ScopeManager(memento);
  });

  it('initially has no active scope', () => {
    assert.strictEqual(manager.isScopeActive(), false);
    assert.strictEqual(manager.getActiveScope(), undefined);
    assert.strictEqual(manager.filterProjects(allProjects).length, 2);
  });

  it('creates and applies a new scope and filters projects', async () => {
    let fired = false;
    manager.onDidChangeScope(scope => {
      fired = true;
      assert.strictEqual(scope?.name, 'Only A');
    });

    const target: ScopeTarget = { kind: 'project', value: projectA.path };
    const scope = await manager.createAndApplyScope('Only A', [target], false, allProjects);

    assert.strictEqual(fired, true);
    assert.strictEqual(manager.isScopeActive(), true);
    assert.strictEqual(scope.activeProjectPaths.length, 1);

    const filtered = manager.filterProjects(allProjects);
    assert.strictEqual(filtered.length, 1);
    assert.strictEqual(filtered[0].name, 'ProjectA');
  });

  it('clears active scope and fires event', async () => {
    const target: ScopeTarget = { kind: 'project', value: projectA.path };
    await manager.createAndApplyScope('Only A', [target], false, allProjects);
    assert.strictEqual(manager.isScopeActive(), true);

    let clearFired = false;
    manager.onDidChangeScope(scope => {
      if (scope === undefined) {
        clearFired = true;
      }
    });

    await manager.clearScope();
    assert.strictEqual(manager.isScopeActive(), false);
    assert.strictEqual(clearFired, true);
    assert.strictEqual(manager.filterProjects(allProjects).length, 2);
  });

  it('manages scope presets correctly', async () => {
    assert.strictEqual(manager.getPresets().length, 0);

    const targetA: ScopeTarget = { kind: 'project', value: projectA.path };
    const preset = await manager.savePreset('Preset A', [targetA], true);

    assert.strictEqual(manager.getPresets().length, 1);
    assert.strictEqual(manager.getPresets()[0].name, 'Preset A');

    const applied = await manager.applyPreset(preset.id, allProjects);
    assert.ok(applied);
    assert.strictEqual(applied?.name, 'Preset A');
    assert.strictEqual(manager.isScopeActive(), true);

    await manager.deletePreset(preset.id);
    assert.strictEqual(manager.getPresets().length, 0);
  });
});
