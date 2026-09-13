import * as path from 'path';
import * as vscode from 'vscode';
import { TreeNode } from '../models';
import type { DotnetTreeProvider } from '../treeProvider';
import { ScopeManager } from './scopeManager';
import { ScopeTarget } from './scopeModel';
import { showScopeQuickPick } from './scopeQuickPick';
import { writeSlnfFile } from './slnfService';

export function registerScopeCommands(
  context: vscode.ExtensionContext,
  provider: DotnetTreeProvider,
  scopeManager: ScopeManager
): void {
  const register = (id: string, handler: (...args: any[]) => any) => {
    context.subscriptions.push(vscode.commands.registerCommand(id, handler));
  };

  const getSolutionOrWarn = () => {
    const solution = provider.getSolution();
    if (!solution || solution.projects.length === 0) {
      vscode.window.showInformationMessage('No active .NET solution with projects found.');
      return undefined;
    }
    return solution;
  };

  const refreshTree = async () => {
    await provider.refresh();
  };

  // 1. Open Scope Multi-Select QuickPick
  register('dotnav.scope.configure', async () => {
    const solution = getSolutionOrWarn();
    if (!solution) return;
    await showScopeQuickPick(solution.projects, scopeManager, refreshTree);
  });

  // 2. Clear Scope (Restore Full Solution)
  register('dotnav.scope.clear', async () => {
    if (!scopeManager.isScopeActive()) {
      vscode.window.showInformationMessage('No solution scope is currently active.');
      return;
    }
    await scopeManager.clearScope();
    await refreshTree();
    vscode.window.showInformationMessage('Solution Scope cleared. Showing full solution.');
  });

  // 3. Open Scope Menu (from Status Bar or toolbar)
  register('dotnav.scope.openMenu', async () => {
    const solution = getSolutionOrWarn();
    if (!solution) return;

    const activeScope = scopeManager.getActiveScope();
    const presets = scopeManager.getPresets();

    interface ScopeMenuItem extends vscode.QuickPickItem {
      readonly action: 'clear' | 'configure' | 'applyPreset' | 'savePreset' | 'exportSlnf' | 'deletePreset';
      readonly presetId?: string;
    }

    const items: ScopeMenuItem[] = [];

    if (activeScope) {
      items.push({
        label: `$(clear-all) Show Full Solution (${solution.projects.length} projects)`,
        description: `Currently focused on: ${activeScope.name}`,
        action: 'clear'
      });
      items.push({
        label: '$(edit) Edit Current Scope...',
        description: `${activeScope.activeProjectPaths.length} projects active`,
        action: 'configure'
      });
      items.push({
        label: '$(save) Export Current Scope to .slnf File...',
        action: 'exportSlnf'
      });
      items.push({
        label: '$(bookmark) Save Current Scope as Preset...',
        action: 'savePreset'
      });
    } else {
      items.push({
        label: '$(layers) Configure Focus Scope (Multi-Select)...',
        description: 'Choose specific services, folders or projects to focus on',
        action: 'configure'
      });
    }

    if (presets.length > 0) {
      items.push({
        label: 'SAVED SCOPE PRESETS',
        kind: vscode.QuickPickItemKind.Separator,
        action: 'configure'
      });

      for (const preset of presets) {
        const isCurrent = activeScope?.name === preset.name;
        items.push({
          label: `${isCurrent ? '$(check) ' : '$(bookmark) '}${preset.name}`,
          description: `${preset.targets.length} target(s)`,
          action: 'applyPreset',
          presetId: preset.id
        });
      }

      items.push({
        label: '$(trash) Delete a Preset...',
        action: 'deletePreset'
      });
    }

    const picked = await vscode.window.showQuickPick(items, {
      title: 'DotNav Solution Scope & Focus Manager',
      placeHolder: 'Select an action or preset...'
    });

    if (!picked) return;

    switch (picked.action) {
      case 'clear':
        await scopeManager.clearScope();
        await refreshTree();
        break;
      case 'configure':
        await showScopeQuickPick(solution.projects, scopeManager, refreshTree);
        break;
      case 'applyPreset':
        if (picked.presetId) {
          const applied = await scopeManager.applyPreset(picked.presetId, solution.projects);
          if (applied) {
            await refreshTree();
            vscode.window.showInformationMessage(`Applied preset: ${applied.name}.`);
          }
        }
        break;
      case 'savePreset':
        if (activeScope) {
          const name = await vscode.window.showInputBox({
            title: 'Save Scope Preset',
            prompt: 'Enter a name for this preset',
            value: activeScope.name
          });
          if (name && name.trim()) {
            await scopeManager.savePreset(name.trim(), activeScope.targets, {
              includeDependencies: activeScope.includeDependencies,
              includeDependents: activeScope.includeDependents ?? false
            });
            vscode.window.showInformationMessage(`Saved preset "${name.trim()}".`);
          }
        }
        break;
      case 'exportSlnf':
        await vscode.commands.executeCommand('dotnav.scope.exportSlnf');
        break;
      case 'deletePreset':
        const toDelete = await vscode.window.showQuickPick(
          presets.map(p => ({ label: p.name, id: p.id })),
          { title: 'Select Preset to Delete' }
        );
        if (toDelete) {
          await scopeManager.deletePreset(toDelete.id);
          vscode.window.showInformationMessage(`Deleted preset "${toDelete.label}".`);
        }
        break;
    }
  });

  // 4. Focus on Project (from Tree Context Menu)
  register('dotnav.scope.focusProject', async (node?: TreeNode) => {
    const solution = getSolutionOrWarn();
    if (!solution || !node?.project) return;

    const scopeConfig = vscode.workspace.getConfiguration('dotnav.scope');
    const includeDeps = scopeConfig.get<boolean>('autoIncludeDependencies', true);
    const includeDependents = scopeConfig.get<boolean>('autoIncludeDependents', false);
    const target: ScopeTarget = {
      kind: 'project',
      value: node.project.path,
      label: node.project.name
    };

    const scope = await scopeManager.createAndApplyScope(
      node.project.name,
      [target],
      { includeDependencies: includeDeps, includeDependents },
      solution.projects
    );

    await refreshTree();
    vscode.window.showInformationMessage(
      `Focused on project "${node.project.name}" (${scope.activeProjectPaths.length} project(s) active).`
    );
  });

  // 5. Focus on Solution Folder (from Tree Context Menu)
  register('dotnav.scope.focusFolder', async (node?: TreeNode) => {
    const solution = getSolutionOrWarn();
    if (!solution || !node?.resourcePath) return;

    // Determine folder path key e.g. "Services/CustomApp"
    const relFolder = path.relative(solution.rootPath, node.resourcePath).replace(/\\/g, '/');
    const folderName = node.label || path.basename(relFolder);
    const scopeConfig = vscode.workspace.getConfiguration('dotnav.scope');
    const includeDeps = scopeConfig.get<boolean>('autoIncludeDependencies', true);
    const includeDependents = scopeConfig.get<boolean>('autoIncludeDependents', false);

    const target: ScopeTarget = {
      kind: 'solutionFolder',
      value: relFolder,
      label: folderName
    };

    const scope = await scopeManager.createAndApplyScope(
      folderName,
      [target],
      { includeDependencies: includeDeps, includeDependents },
      solution.projects
    );

    await refreshTree();
    vscode.window.showInformationMessage(
      `Focused on folder "${folderName}" (${scope.activeProjectPaths.length} project(s) active).`
    );
  });

  // 6. Add to Current Scope (from Tree Context Menu)
  register('dotnav.scope.addToScope', async (node?: TreeNode) => {
    const solution = getSolutionOrWarn();
    if (!solution) return;

    let target: ScopeTarget | undefined;
    if (node?.project) {
      target = { kind: 'project', value: node.project.path, label: node.project.name };
    } else if (node?.resourcePath) {
      const relFolder = path.relative(solution.rootPath, node.resourcePath).replace(/\\/g, '/');
      target = { kind: 'solutionFolder', value: relFolder, label: node.label || path.basename(relFolder) };
    }

    if (!target) return;

    const active = scopeManager.getActiveScope();
    const existingTargets = active ? [...active.targets] : [];
    const includeDeps = active ? active.includeDependencies : true;

    // Check if already in targets
    const alreadyExists = existingTargets.some(
      t => t.kind === target!.kind && t.value.toLowerCase() === target!.value.toLowerCase()
    );

    if (alreadyExists) {
      vscode.window.showInformationMessage(`"${target.label ?? target.value}" is already in the active scope.`);
      return;
    }

    existingTargets.push(target);
    const names = existingTargets.map(t => t.label || t.value);
    const scopeName = names.length <= 2 ? names.join(' + ') : `${names.slice(0, 2).join(' + ')} (+${names.length - 2})`;

    const scope = await scopeManager.createAndApplyScope(
      scopeName,
      existingTargets,
      {
        includeDependencies: includeDeps,
        includeDependents: active?.includeDependents ?? false
      },
      solution.projects
    );

    await refreshTree();
    vscode.window.showInformationMessage(
      `Added "${target.label}" to scope (${scope.activeProjectPaths.length} projects active).`
    );
  });

  // 7. Remove from Current Scope (from Tree Context Menu)
  register('dotnav.scope.removeFromScope', async (node?: TreeNode) => {
    const solution = getSolutionOrWarn();
    const active = scopeManager.getActiveScope();
    if (!solution || !active) return;

    let targetValue: string | undefined;
    if (node?.project) {
      targetValue = node.project.path;
    } else if (node?.resourcePath) {
      targetValue = path.relative(solution.rootPath, node.resourcePath).replace(/\\/g, '/');
    }

    if (!targetValue) return;

    const remainingTargets = active.targets.filter(
      t => path.resolve(t.value).toLowerCase() !== path.resolve(targetValue!).toLowerCase() &&
           t.value.toLowerCase() !== targetValue!.toLowerCase()
    );

    if (remainingTargets.length === 0) {
      await scopeManager.clearScope();
      await refreshTree();
      vscode.window.showInformationMessage('All targets removed. Showing full solution.');
      return;
    }

    const names = remainingTargets.map(t => t.label || t.value);
    const scopeName = names.length <= 2 ? names.join(' + ') : `${names.slice(0, 2).join(' + ')} (+${names.length - 2})`;

    const scope = await scopeManager.createAndApplyScope(
      scopeName,
      remainingTargets,
      {
        includeDependencies: active.includeDependencies,
        includeDependents: active.includeDependents ?? false
      },
      solution.projects
    );

    await refreshTree();
    vscode.window.showInformationMessage(
      `Removed from scope (${scope.activeProjectPaths.length} projects active).`
    );
  });

  // 8. Export Current Scope to .slnf File
  register('dotnav.scope.exportSlnf', async () => {
    const solution = getSolutionOrWarn();
    if (!solution) return;

    const active = scopeManager.getActiveScope();
    const projectPaths = active ? active.activeProjectPaths : solution.projects.map(p => p.path);

    if (projectPaths.length === 0) {
      vscode.window.showErrorMessage('Cannot export .slnf: no projects selected.');
      return;
    }

    const solutionPath = solution.path ?? path.join(solution.rootPath, `${solution.name}.sln`);
    const defaultName = active
      ? `${active.name.replace(/[^a-zA-Z0-9_-]/g, '_')}.slnf`
      : `${solution.name}.slnf`;

    const uri = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.file(path.join(path.dirname(solutionPath), defaultName)),
      filters: { 'Solution Filter (*.slnf)': ['slnf'] },
      title: 'Export Solution Filter (.slnf)'
    });

    if (!uri) return;

    try {
      await writeSlnfFile(uri.fsPath, solutionPath, projectPaths);
      const action = await vscode.window.showInformationMessage(
        `Exported Solution Filter: ${path.basename(uri.fsPath)} (${projectPaths.length} projects).`,
        'Open File'
      );
      if (action === 'Open File') {
        await vscode.window.showTextDocument(uri);
      }
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to export .slnf: ${err?.message ?? err}`);
    }
  });
}
