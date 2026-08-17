import * as vscode from 'vscode';
import { isSmartBuildEnabled, updateSmartBuildEnabled } from './smartBuildFeature';

export type SmartBuildStatusState =
  | 'idle-uptodate'
  | 'idle-changed'
  | 'evaluating'
  | 'building'
  | 'disabled';

export class SmartBuildStatusBar implements vscode.Disposable {
  private readonly item: vscode.StatusBarItem;
  private state: SmartBuildStatusState = 'idle-uptodate';
  private changedCount = 0;

  constructor() {
    this.item = vscode.window.createStatusBarItem('dotnav.smartBuildStatus', vscode.StatusBarAlignment.Right, 100);
    this.item.name = 'DotNav Smart Build';
    this.item.command = 'dotnav.showSmartBuildStatusMenu';
    this.refresh();
  }

  setState(state: SmartBuildStatusState, changedCount = 0): void {
    this.state = state;
    this.changedCount = changedCount;
    this.refresh();
  }

  show(): void {
    if (isSmartBuildEnabled()) {
      this.item.show();
    } else {
      this.item.hide();
    }
  }

  hide(): void {
    this.item.hide();
  }

  refresh(): void {
    if (!isSmartBuildEnabled()) {
      this.item.hide();
      return;
    }
    this.item.show();
    switch (this.state) {
      case 'idle-uptodate':
        this.item.text = '$(check) Smart Build';
        this.item.tooltip = 'DotNav Smart Build: Workspace is up-to-date. Click for options.';
        this.item.backgroundColor = undefined;
        break;
      case 'idle-changed':
        this.item.text = `$(edit) Smart Build (${this.changedCount})`;
        this.item.tooltip = `DotNav Smart Build: ${this.changedCount} file(s) changed, ready for instant build. Click for options.`;
        this.item.backgroundColor = undefined;
        break;
      case 'evaluating':
        this.item.text = '$(sync~spin) Smart Build: Pre-warming…';
        this.item.tooltip = 'DotNav Smart Build: Background graph evaluation in progress.';
        this.item.backgroundColor = undefined;
        break;
      case 'building':
        this.item.text = '$(sync~spin) Smart Build: Compiling…';
        this.item.tooltip = 'DotNav Smart Build: Executing build plan…';
        this.item.backgroundColor = undefined;
        break;
      case 'disabled':
        this.item.hide();
        break;
    }
  }

  dispose(): void {
    this.item.dispose();
  }
}
