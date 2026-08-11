import * as vscode from 'vscode';
import { TreeNode } from '../models';
import { showFileLocalHistory, showSelectionLocalHistory } from './historyCommands';
import { LocalHistoryService } from './localHistoryService';

const enabledConfiguration = 'dotnav.localHistory.enabled';
const introductionStateKey = 'dotnav.localHistory.introduction.v1.shown';

export function activateLocalHistory(context: vscode.ExtensionContext): void {
  let service: LocalHistoryService | undefined;

  const isEnabled = () => vscode.workspace
    .getConfiguration('dotnav.localHistory')
    .get<boolean>('enabled', false);

  const synchronizeService = () => {
    const enabled = isEnabled();
    void vscode.commands.executeCommand('setContext', 'dotnav.localHistoryEnabled', enabled);
    if (enabled && !service) {
      service = new LocalHistoryService(context);
      service.start();
    } else if (!enabled && service) {
      service.dispose();
      service = undefined;
    }
  };

  const withEnabledService = async (action: (activeService: LocalHistoryService) => Promise<void>) => {
    if (!service) {
      const enable = 'Enable Local History';
      const selected = await vscode.window.showInformationMessage(
        'DotNav Local History is turned off. Enable it to start recording local file revisions?',
        enable
      );
      if (selected !== enable) {
        return;
      }
      await updateLocalHistoryEnabled(true);
      synchronizeService();
    }
    if (service) {
      await action(service);
    }
  };

  context.subscriptions.push(
    vscode.commands.registerCommand('dotnav.localHistory.show', (node?: TreeNode) =>
      withEnabledService(activeService => showFileLocalHistory(activeService, node))),
    vscode.commands.registerCommand('dotnav.localHistory.showSelection', () =>
      withEnabledService(activeService => showSelectionLocalHistory(activeService))),
    vscode.workspace.onDidChangeConfiguration(event => {
      if (event.affectsConfiguration(enabledConfiguration)) {
        synchronizeService();
      }
    }),
    { dispose: () => service?.dispose() }
  );

  synchronizeService();
  void showLocalHistoryIntroduction(context);
}

async function showLocalHistoryIntroduction(context: vscode.ExtensionContext): Promise<void> {
  if (context.globalState.get<boolean>(introductionStateKey, false)) {
    return;
  }

  // Record the announcement before displaying it so dismissing the popup does not
  // make it reappear on every activation.
  await context.globalState.update(introductionStateKey, true);
  const enable = 'Enable Local History';
  const keepDisabled = 'Keep Disabled';
  const selected = await vscode.window.showInformationMessage(
    'New in DotNav: Local History can keep private file revisions on this machine so you can compare or recover local changes. It is off by default and uses configurable storage limits when enabled.',
    { modal: true },
    enable,
    keepDisabled
  );
  if (selected === enable) {
    await updateLocalHistoryEnabled(true);
  } else if (selected === keepDisabled) {
    await updateLocalHistoryEnabled(false);
  }
}

async function updateLocalHistoryEnabled(enabled: boolean): Promise<void> {
  const configuration = vscode.workspace.getConfiguration('dotnav.localHistory');
  const inspected = configuration.inspect<boolean>('enabled');
  const target = inspected?.workspaceFolderValue !== undefined
    ? vscode.ConfigurationTarget.WorkspaceFolder
    : inspected?.workspaceValue !== undefined
      ? vscode.ConfigurationTarget.Workspace
      : vscode.ConfigurationTarget.Global;
  await configuration.update('enabled', enabled, target);
}
