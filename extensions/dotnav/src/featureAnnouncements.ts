import * as vscode from 'vscode';

const lastAnnouncementVersionKey = 'dotnav.featureAnnouncements.lastVersion';

interface PreviewFeature extends vscode.QuickPickItem {
  readonly introducedIn: string;
  readonly enabled: () => boolean;
  readonly update: (enabled: boolean) => Promise<void>;
}

const previewFeatures: PreviewFeature[] = [
  {
    label: '$(history) Local History (Preview)',
    description: 'Keep private local revisions for compare and recovery',
    detail: 'Off by default. Revisions stay on this machine and follow configured storage limits.',
    introducedIn: '0.12.0',
    enabled: () => vscode.workspace.getConfiguration('dotnav.localHistory').get<boolean>('enabled', false),
    update: updateLocalHistoryEnabled
  }
];

const lastEndpointAnnouncementVersionKey = 'dotnav.endpointAnnouncement.lastVersion';
const lastSearchAnnouncementVersionKey = 'dotnav.searchAnnouncement.lastVersion';

export async function showFeatureAnnouncements(context: vscode.ExtensionContext): Promise<void> {
  const currentVersion = String(context.extension.packageJSON.version ?? '0.0.0');
  const lastVersion = context.globalState.get<string>(lastAnnouncementVersionKey);

  // Announce Universal Solution Search Everywhere on update
  const lastSearchAnnounced = context.globalState.get<string>(lastSearchAnnouncementVersionKey);
  if (!lastSearchAnnounced || compareVersions('0.12.0', lastSearchAnnounced) > 0) {
    await context.globalState.update(lastSearchAnnouncementVersionKey, currentVersion);
    void vscode.window.showInformationMessage(
      '⚡ New in DotNav: Universal Search Everywhere! Instantly search C# Classes, Methods, Endpoints (/), CQRS ($), and Database (%) across your entire solution with sub-millisecond speed.',
      'Try Search Everywhere',
      'Learn More'
    ).then(action => {
      if (action === 'Try Search Everywhere') {
        void vscode.commands.executeCommand('dotnav.searchEverywhere');
      } else if (action === 'Learn More') {
        void vscode.window.showInformationMessage(
          '💡 DotNav Search Everywhere Tips:\n• /: API Endpoints (e.g. /users)\n• $: CQRS Commands & Queries (e.g. $CreateOrder)\n• %: Database Models & EF Core\n• #: Classes & Types\n• @: Methods\n• Acronyms: Type CIVC for CreateInterfaceViewCommand\n• Line jump: Symbol:762',
          'Try Search Everywhere'
        ).then(subAction => {
          if (subAction === 'Try Search Everywhere') {
            void vscode.commands.executeCommand('dotnav.searchEverywhere');
          }
        });
      }
    });
  }

  // Announce Endpoint Explorer on update
  const lastEndpointAnnounced = context.globalState.get<string>(lastEndpointAnnouncementVersionKey);
  if (!lastEndpointAnnounced || compareVersions('0.11.0', lastEndpointAnnounced) > 0) {
    await context.globalState.update(lastEndpointAnnouncementVersionKey, currentVersion);
    void vscode.window.showInformationMessage(
      '🚀 New in DotNav: ASP.NET Core Endpoint Explorer! Search API routes, jump to code, and copy cURL/.http with Ctrl+Alt+A (Ctrl+Enter for actions).',
      'Search Endpoints'
    ).then(action => {
      if (action === 'Search Endpoints') {
        void vscode.commands.executeCommand('dotnav.searchApiEndpoints');
      }
    });
  }

  const available = previewFeatures.filter(feature =>
    compareVersions(feature.introducedIn, currentVersion) <= 0
    && (!lastVersion || compareVersions(feature.introducedIn, lastVersion) > 0));
  if (available.length === 0) {
    await context.globalState.update(lastAnnouncementVersionKey, currentVersion);
    return;
  }

  // Record the version before displaying the picker so dismissing it does not
  // make the same release announcement appear on every activation.
  await context.globalState.update(lastAnnouncementVersionKey, currentVersion);
  const items = available.map(feature => ({ ...feature, picked: feature.enabled(), feature }));
  const selected = await vscode.window.showQuickPick(items, {
    title: `What's New in DotNav ${currentVersion}`,
    placeHolder: 'Select the preview features you want to enable',
    canPickMany: true,
    ignoreFocusOut: true
  });
  if (!selected) return;
  const enabled = new Set(selected.map(item => item.feature));
  await Promise.all(available.map(feature => feature.update(enabled.has(feature))));
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

function compareVersions(left: string, right: string): number {
  const parse = (value: string) => value.split('-', 1)[0].split('.').map(part => Number.parseInt(part, 10) || 0);
  const a = parse(left);
  const b = parse(right);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}
