import * as path from 'path';
import * as vscode from 'vscode';
import { ProjectModel } from '../models';
import { ScopeManager } from './scopeManager';
import { ScopeTarget } from './scopeModel';

export interface ScopeQuickPickItem extends vscode.QuickPickItem {
  readonly target?: ScopeTarget;
  readonly isHeader?: boolean;
}

export async function showScopeQuickPick(
  allProjects: readonly ProjectModel[],
  scopeManager: ScopeManager,
  onScopeChanged: () => Promise<void>
): Promise<void> {
  if (allProjects.length === 0) {
    vscode.window.showInformationMessage('No projects loaded in the current solution.');
    return;
  }

  const activeScope = scopeManager.getActiveScope();
  let includeDependencies = activeScope ? activeScope.includeDependencies : true;

  // 1. Group Projects by Solution Folders
  const folderCounts = new Map<string, number>();
  for (const p of allProjects) {
    if (p.solutionFolder && p.solutionFolder.length > 0) {
      // Top-level solution folder or 2-level folder e.g. "Services/CustomApp"
      const folderKey = p.solutionFolder.slice(0, 2).join('/');
      folderCounts.set(folderKey, (folderCounts.get(folderKey) ?? 0) + 1);
    }
  }

  const sortedFolders = Array.from(folderCounts.entries()).sort(([a], [b]) => a.localeCompare(b));

  // 2. Build QuickPick Items
  const items: ScopeQuickPickItem[] = [];

  if (sortedFolders.length > 0) {
    items.push({
      label: 'SOLUTION FOLDERS / SERVICES',
      kind: vscode.QuickPickItemKind.Separator
    });

    for (const [folderPath, count] of sortedFolders) {
      items.push({
        label: `$(folder) ${folderPath}`,
        description: `${count} project${count > 1 ? 's' : ''}`,
        target: {
          kind: 'solutionFolder',
          value: folderPath,
          label: folderPath
        }
      });
    }
  }

  items.push({
    label: 'INDIVIDUAL PROJECTS',
    kind: vscode.QuickPickItemKind.Separator
  });

  const sortedProjects = [...allProjects].sort((a, b) => a.name.localeCompare(b.name));
  for (const p of sortedProjects) {
    const folderDetail = p.solutionFolder && p.solutionFolder.length > 0
      ? `[${p.solutionFolder.join('/')}]`
      : p.relativePath;

    items.push({
      label: `$(file-code) ${p.name}`,
      description: folderDetail,
      target: {
        kind: 'project',
        value: p.path,
        label: p.name
      }
    });
  }

  // 3. Pre-select existing targets if active scope exists
  const selectedItems: ScopeQuickPickItem[] = [];
  if (activeScope) {
    const activeFolderValues = new Set(
      activeScope.targets.filter(t => t.kind === 'solutionFolder').map(t => t.value.toLowerCase())
    );
    const activeProjectValues = new Set(
      activeScope.targets.filter(t => t.kind === 'project').map(t => path.resolve(t.value).toLowerCase())
    );

    for (const item of items) {
      if (!item.target) continue;
      if (item.target.kind === 'solutionFolder' && activeFolderValues.has(item.target.value.toLowerCase())) {
        selectedItems.push(item);
      } else if (item.target.kind === 'project' && activeProjectValues.has(path.resolve(item.target.value).toLowerCase())) {
        selectedItems.push(item);
      }
    }
  }

  const quickPick = vscode.window.createQuickPick<ScopeQuickPickItem>();
  quickPick.canSelectMany = true;
  quickPick.title = 'DotNav: Configure Solution Scope (Multi-Select)';
  quickPick.placeholder = 'Select solution folders or projects to focus on (Space to select, Enter to apply)...';
  quickPick.items = items;
  quickPick.selectedItems = selectedItems;

  const updateTitleButtons = () => {
    quickPick.buttons = [
      {
        iconPath: new vscode.ThemeIcon(includeDependencies ? 'references' : 'dash'),
        tooltip: `Auto-include Project References: ${includeDependencies ? 'ON' : 'OFF'} (Click to toggle)`
      },
      {
        iconPath: new vscode.ThemeIcon('clear-all'),
        tooltip: 'Clear Scope / Show Full Solution'
      }
    ];
  };

  updateTitleButtons();

  quickPick.onDidTriggerButton(async button => {
    if (button.tooltip?.startsWith('Auto-include')) {
      includeDependencies = !includeDependencies;
      updateTitleButtons();
      vscode.window.showInformationMessage(
        `Auto-include Project References is now ${includeDependencies ? 'ENABLED' : 'DISABLED'}.`
      );
    } else if (button.tooltip?.startsWith('Clear Scope')) {
      quickPick.hide();
      await scopeManager.clearScope();
      await onScopeChanged();
      vscode.window.showInformationMessage('Solution Scope cleared. Showing full solution.');
    }
  });

  quickPick.onDidAccept(async () => {
    const chosen = quickPick.selectedItems.filter(i => Boolean(i.target));
    quickPick.hide();

    if (chosen.length === 0) {
      await scopeManager.clearScope();
      await onScopeChanged();
      vscode.window.showInformationMessage('No scope items selected. Restored full solution.');
      return;
    }

    const targets: ScopeTarget[] = chosen.map(i => i.target!);

    // Generate readable scope name e.g. "CustomApp + Work"
    const names = chosen.map(i => {
      if (i.target?.kind === 'solutionFolder') {
        const parts = i.target.value.split('/');
        return parts[parts.length - 1];
      }
      return i.target?.label ?? 'Project';
    });

    const scopeName = names.length <= 2
      ? names.join(' + ')
      : `${names.slice(0, 2).join(' + ')} (+${names.length - 2} more)`;

    const scope = await scopeManager.createAndApplyScope(
      scopeName,
      targets,
      includeDependencies,
      allProjects
    );

    await onScopeChanged();

    const action = await vscode.window.showInformationMessage(
      `Focused on ${scope.name} (${scope.activeProjectPaths.length} of ${allProjects.length} projects active).`,
      'Save as Preset',
      'Export to .slnf'
    );

    if (action === 'Save as Preset') {
      const presetName = await vscode.window.showInputBox({
        title: 'Save Scope Preset',
        prompt: 'Enter a name for this Scope Preset',
        value: scope.name
      });
      if (presetName && presetName.trim()) {
        await scopeManager.savePreset(presetName.trim(), targets, includeDependencies);
        vscode.window.showInformationMessage(`Saved preset: "${presetName.trim()}".`);
      }
    } else if (action === 'Export to .slnf') {
      await vscode.commands.executeCommand('dotnav.scope.exportSlnf');
    }
  });

  quickPick.show();
}
