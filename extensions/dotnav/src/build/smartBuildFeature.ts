import * as vscode from 'vscode';

export const smartBuildEnabledConfiguration = 'dotnav.smartBuild.enabled';

export function isSmartBuildEnabled(): boolean {
  return vscode.workspace.getConfiguration('dotnav.smartBuild').get<boolean>('enabled', false);
}

export async function requestSmartBuildEnabled(): Promise<boolean> {
  if (isSmartBuildEnabled()) return true;
  const enable = 'Enable Smart Build Preview';
  const selected = await vscode.window.showInformationMessage(
    'Smart Build (Preview) is turned off. Enable it to use incremental graph detection and scoped project builds?',
    enable
  );
  if (selected !== enable) return false;
  await updateSmartBuildEnabled(true);
  return true;
}

export async function updateSmartBuildEnabled(enabled: boolean): Promise<void> {
  const configuration = vscode.workspace.getConfiguration('dotnav.smartBuild');
  const inspected = configuration.inspect<boolean>('enabled');
  const target = inspected?.workspaceFolderValue !== undefined
    ? vscode.ConfigurationTarget.WorkspaceFolder
    : inspected?.workspaceValue !== undefined
      ? vscode.ConfigurationTarget.Workspace
      : vscode.ConfigurationTarget.Global;
  await configuration.update('enabled', enabled, target);
  await vscode.commands.executeCommand('setContext', 'dotnav.smartBuildEnabled', enabled);
}
