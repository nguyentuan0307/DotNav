import * as vscode from 'vscode';
import { QueueSnapshot } from './efQueue';

/**
 * Status bar item that appears only while EF commands run (design §5.7).
 * Clicking it focuses the "DotNav EF Core" output channel.
 */
export function createEfStatusBar(context: vscode.ExtensionContext): (snapshot: QueueSnapshot) => void {
  const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 90);
  item.command = 'dotnav.ef.showOutput';
  context.subscriptions.push(item);

  return snapshot => {
    if (!snapshot.running) {
      item.hide();
      return;
    }

    const queuedSuffix = snapshot.pending.length > 0 ? ` (+${snapshot.pending.length} queued)` : '';
    item.text = `$(sync~spin) EF: ${snapshot.running.label}${queuedSuffix}`;
    item.tooltip = 'An EF Core command is running. Click to show output.';
    item.show();
  };
}
