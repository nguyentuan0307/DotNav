import * as vscode from 'vscode';
import { SolutionScope } from './scopeModel';

export class ScopeStatusBarController implements vscode.Disposable {
  private readonly item: vscode.StatusBarItem;

  constructor() {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 98);
    this.item.command = 'dotnav.scope.openMenu';
  }

  update(activeScope: SolutionScope | undefined, totalProjectsCount: number): void {
    const config = vscode.workspace.getConfiguration('dotnav.scope');
    const enabled = config.get<boolean>('showStatusBarItem', true);

    if (!enabled || totalProjectsCount === 0) {
      this.item.hide();
      return;
    }

    if (!activeScope) {
      this.item.text = '$(target) Full Solution';
      this.item.tooltip = 'DotNav: Showing all projects. Click to configure Solution Scope / Focus Mode.';
      this.item.backgroundColor = undefined;
    } else {
      this.item.text = `$(target) ${activeScope.name} (${activeScope.activeProjectPaths.length}/${totalProjectsCount})`;
      this.item.tooltip = `DotNav Scope: ${activeScope.name}\n${activeScope.activeProjectPaths.length} of ${totalProjectsCount} projects active.\nClick to switch scope, edit, or show full solution.`;
      this.item.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
    }

    this.item.show();
  }

  dispose(): void {
    this.item.dispose();
  }
}
