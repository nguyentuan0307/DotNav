import * as vscode from 'vscode';
import { getActive } from './runConfigStore';
import { DotnetTreeProvider } from './treeProvider';
import { ProcessManager } from './processManager';

let configItem: vscode.StatusBarItem | undefined;
let stopItem: vscode.StatusBarItem | undefined;
let runItem: vscode.StatusBarItem | undefined;
let debugItem: vscode.StatusBarItem | undefined;
let buildItem: vscode.StatusBarItem | undefined;

export function createStatusBar(): vscode.StatusBarItem[] {
  buildItem = makeItem('$(tools)', 'dotnetSolutionNavigator.buildActiveConfig', 'Build active run configuration', 104);
  configItem = makeItem('$(rocket) No config', 'dotnetSolutionNavigator.selectRunConfig', 'Select run configuration', 103);
  runItem = makeItem('$(play)', 'dotnetSolutionNavigator.runActiveConfig', 'Run active configuration', 102);
  debugItem = makeItem('$(bug)', 'dotnetSolutionNavigator.debugActiveConfig', 'Debug active configuration', 101);
  stopItem = makeItem('$(stop-circle)', 'dotnetSolutionNavigator.stopActiveConfig', 'Stop active run configuration', 100);
  stopItem.hide();

  return [buildItem, configItem, runItem, debugItem, stopItem];
}

export function updateStatusBar(
  provider: DotnetTreeProvider,
  context: vscode.ExtensionContext,
  processManager?: ProcessManager
): void {
  if (!configItem) {
    return;
  }

  const solution = provider.getSolution();
  const active = solution ? getActive(solution, context) : undefined;
  const activeSession = active && processManager?.getActiveSessionForConfig(active.id);
  const latestSession = active && processManager?.getLatestSessionForConfig(active.id);
  const phase = activeSession?.phase;
  const displayPhase = phase ?? latestSession?.phase;
  const icon = displayPhase === 'running'
    ? 'debug-alt'
    : displayPhase === 'failed'
      ? 'error'
      : displayPhase === 'succeeded'
        ? 'pass'
        : phase
          ? 'sync~spin'
          : 'rocket';
  configItem.text = `$(${icon}) ${active?.label ?? 'No config'}${displayPhase ? ` · ${displayPhase}` : ''}`;
  if (phase) {
    buildItem?.hide();
    runItem?.hide();
    debugItem?.hide();
    if (phase === 'stopping') {
      stopItem?.hide();
    } else {
      stopItem?.show();
    }
  } else {
    buildItem?.show();
    runItem?.show();
    debugItem?.show();
    stopItem?.hide();
  }
}

export function updateStopStatus(hasRunningProcesses: boolean): void {
  if (!stopItem) {
    return;
  }

  if (hasRunningProcesses) {
    stopItem.show();
  } else {
    stopItem.hide();
  }
}

function makeItem(text: string, command: string, tooltip: string, priority: number): vscode.StatusBarItem {
  const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, priority);
  item.text = text;
  item.command = command;
  item.tooltip = tooltip;
  item.show();
  return item;
}
