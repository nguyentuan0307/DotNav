import * as path from 'path';
import * as vscode from 'vscode';
import { DotnetTreeProvider } from '../treeProvider';
import { ApiEndpoint, EndpointSearchResult } from './endpointModel';
import { EndpointIndex } from './endpointScanner';
import {
  formatEndpointAsCurl,
  formatEndpointAsHttp,
  formatResolvedUrl,
  searchEndpoints
} from './endpointSearch';

let lastEndpointSearchQuery = '';

export interface EndpointQuickPickItem extends vscode.QuickPickItem {
  readonly endpoint?: ApiEndpoint;
  readonly searchResult?: EndpointSearchResult;
  readonly isAction?: boolean;
}

function formatDisplayRoute(routeTemplate: string): string {
  const clean = '/' + routeTemplate.replace(/^\/+/, '');
  // Simplify parameter constraints for clean display: e.g. {id:int} -> {id}, {guid:guid} -> {guid}
  return clean.replace(/\{([a-zA-Z0-9_]+):[^}]+\}/g, '{$1}');
}

async function openEndpointInEditor(ep: ApiEndpoint): Promise<void> {
  try {
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(ep.filePath));
    const editor = await vscode.window.showTextDocument(doc);
    const lineIndex = Math.max(0, ep.line - 1);
    const position = new vscode.Position(lineIndex, 0);
    editor.selection = new vscode.Selection(position, position);
    editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
  } catch (err) {
    vscode.window.showErrorMessage(
      `Failed to open endpoint source file: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

interface EndpointActionPickItem extends vscode.QuickPickItem {
  action: 'open' | 'copyRoute' | 'copyUrl' | 'copyHttp' | 'copyCurl';
}

async function showEndpointActions(ep: ApiEndpoint): Promise<void> {
  const actions: EndpointActionPickItem[] = [
    {
      label: '$(go-to-file) Open Source Code',
      description: `${path.basename(ep.filePath)}:${ep.line}`,
      action: 'open'
    },
    {
      label: '$(copy) Copy Route Template',
      description: ep.routeTemplate,
      action: 'copyRoute'
    },
    {
      label: '$(link-external) Copy Resolved Test URL',
      description: formatResolvedUrl(ep),
      action: 'copyUrl'
    },
    {
      label: '$(file-code) Copy as .http Request',
      description: `[${ep.httpMethod}] ${ep.routeTemplate}`,
      action: 'copyHttp'
    },
    {
      label: '$(terminal) Copy as cURL Command',
      description: `curl -X ${ep.httpMethod} ...`,
      action: 'copyCurl'
    }
  ];

  const picked = await vscode.window.showQuickPick(actions, {
    title: `Actions for [${ep.httpMethod}] /${ep.routeTemplate.replace(/^\/+/, '')}`,
    placeHolder: 'Select an action to perform'
  });

  if (!picked) return;

  if (picked.action === 'open') {
    await openEndpointInEditor(ep);
  } else if (picked.action === 'copyRoute') {
    await vscode.env.clipboard.writeText(ep.routeTemplate);
    vscode.window.showInformationMessage(`Copied route: ${ep.routeTemplate}`);
  } else if (picked.action === 'copyUrl') {
    const resolvedUrl = formatResolvedUrl(ep);
    await vscode.env.clipboard.writeText(resolvedUrl);
    vscode.window.showInformationMessage(`Copied test URL: ${resolvedUrl}`);
  } else if (picked.action === 'copyHttp') {
    const httpPayload = formatEndpointAsHttp(ep);
    await vscode.env.clipboard.writeText(httpPayload);
    vscode.window.showInformationMessage(`Copied .http request for [${ep.httpMethod}] ${ep.routeTemplate}`);
  } else if (picked.action === 'copyCurl') {
    const curlPayload = formatEndpointAsCurl(ep);
    await vscode.env.clipboard.writeText(curlPayload);
    vscode.window.showInformationMessage(`Copied cURL command for [${ep.httpMethod}] ${ep.routeTemplate}`);
  }
}

export function resolveProjectForFile(
  fsPath: string,
  solutionProjects: readonly { name: string; path: string }[] | undefined
): string {
  if (!solutionProjects || solutionProjects.length === 0) {
    return 'Workspace';
  }
  for (const project of solutionProjects) {
    if (fsPath.startsWith(path.dirname(project.path))) {
      return project.name;
    }
  }
  return 'Workspace';
}

let activeScanPromise: Promise<void> | undefined;

export async function warmUpEndpointIndex(
  provider: DotnetTreeProvider,
  index: EndpointIndex
): Promise<void> {
  if (index.count > 0 || activeScanPromise) {
    return activeScanPromise;
  }
  activeScanPromise = (async () => {
    try {
      await populateEndpointIndexFromSolution(provider, index);
    } catch (err) {
      console.error(`DotNav background endpoint warmup failed: ${err}`);
    } finally {
      activeScanPromise = undefined;
    }
  })();
  return activeScanPromise;
}

export async function populateEndpointIndexFromSolution(
  provider: DotnetTreeProvider,
  index: EndpointIndex
): Promise<void> {
  const solution = provider.getSolution();
  const projects = solution?.projects;
  const files = await vscode.workspace.findFiles(
    '**/*.cs',
    '{**/obj/**,**/bin/**,**/node_modules/**,**/.git/**,**/.vs/**}'
  );

  const chunkSize = 32;
  for (let i = 0; i < files.length; i += chunkSize) {
    const chunk = files.slice(i, i + chunkSize);
    await Promise.all(
      chunk.map(async file => {
        const fsPath = file.fsPath;
        const projectName = resolveProjectForFile(fsPath, projects);
        const relPath = vscode.workspace.asRelativePath(fsPath);
        await index.scanFile(fsPath, projectName, relPath);
      })
    );
  }
}

let currentEndpointQuickPick: vscode.QuickPick<EndpointQuickPickItem> | undefined;

export async function openActiveEndpointActions(): Promise<void> {
  if (!currentEndpointQuickPick) return;
  const active = currentEndpointQuickPick.activeItems[0] || currentEndpointQuickPick.selectedItems[0];
  if (!active || !active.endpoint || active.isAction) return;
  await showEndpointActions(active.endpoint);
}

export async function searchEndpointsInteractive(
  provider: DotnetTreeProvider,
  index: EndpointIndex
): Promise<void> {
  if (index.count === 0) {
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'Scanning ASP.NET Core API endpoints...'
      },
      async () => {
        if (activeScanPromise) {
          await activeScanPromise;
        } else {
          await populateEndpointIndexFromSolution(provider, index);
        }
      }
    );
  }

  const allEndpoints = index.getAllEndpoints();
  if (allEndpoints.length === 0) {
    vscode.window.showInformationMessage('No ASP.NET Core controller or Minimal API endpoints were found in this workspace.');
    return;
  }

  const quickPick = vscode.window.createQuickPick<EndpointQuickPickItem>();
  currentEndpointQuickPick = quickPick;
  await vscode.commands.executeCommand('setContext', 'dotnav.endpointSearchOpen', true);

  quickPick.title = 'ASP.NET Core Endpoint Explorer — Smart Route Search';
  quickPick.placeholder = 'Type to search: e.g. "interface-views//filter-fields" (Enter: Go to Code • Ctrl+Enter: Actions)';
  quickPick.matchOnDescription = false;
  quickPick.matchOnDetail = false;

  const updateItems = (query: string) => {
    const results = searchEndpoints(allEndpoints, query, 150);

    if (results.length === 0 && query.trim().length > 0) {
      quickPick.items = [
        {
          label: `$(info) No API endpoints found matching "${query}"`,
          description: 'Try searching with wildcards (e.g. fields//validation), acronyms (iv/ff), or HTTP verbs (GET fields)',
          alwaysShow: true,
          isAction: true
        }
      ];
      return;
    }

    quickPick.items = results.map(res => {
      const ep = res.endpoint;
      const methodBadge = `[${ep.httpMethod}]`;
      const route = formatDisplayRoute(ep.routeTemplate);
      const actionName = ep.controllerName && ep.actionName
        ? `${ep.controllerName}.${ep.actionName}`
        : (ep.controllerName || ep.actionName || '');
      const fileInfo = ep.relativePath ? `${ep.relativePath}:${ep.line}` : `${path.basename(ep.filePath)}:${ep.line}`;
      const detail = actionName
        ? `$(symbol-method) ${actionName}  •  $(file-code) ${fileInfo} (${ep.projectName})`
        : `$(file-code) ${fileInfo} (${ep.projectName})`;

      return {
        label: `${methodBadge} ${route}`,
        detail,
        alwaysShow: true,
        endpoint: ep,
        searchResult: res,
        buttons: [
          {
            iconPath: new vscode.ThemeIcon('ellipsis'),
            tooltip: 'More Actions (Ctrl+Enter)'
          }
        ]
      };
    });
  };

  if (lastEndpointSearchQuery) {
    quickPick.value = lastEndpointSearchQuery;
  }
  updateItems(lastEndpointSearchQuery);

  quickPick.onDidChangeValue(value => {
    lastEndpointSearchQuery = value;
    updateItems(value);
  });

  quickPick.onDidTriggerItemButton(async event => {
    const ep = event.item.endpoint;
    if (!ep) return;
    await showEndpointActions(ep);
  });

  quickPick.onDidAccept(async () => {
    const selected = quickPick.selectedItems[0];
    if (!selected || !selected.endpoint || selected.isAction) return;
    quickPick.hide();
    await openEndpointInEditor(selected.endpoint);
  });

  quickPick.onDidHide(async () => {
    if (currentEndpointQuickPick === quickPick) {
      currentEndpointQuickPick = undefined;
    }
    await vscode.commands.executeCommand('setContext', 'dotnav.endpointSearchOpen', false);
  });

  quickPick.show();
}

export async function refreshEndpointsInteractive(
  provider: DotnetTreeProvider,
  index: EndpointIndex
): Promise<void> {
  index.clear();
  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'Refreshing ASP.NET Core endpoints index...'
    },
    async () => {
      await populateEndpointIndexFromSolution(provider, index);
    }
  );
  vscode.window.showInformationMessage(`Scanned ${index.count} ASP.NET Core endpoints.`);
}
