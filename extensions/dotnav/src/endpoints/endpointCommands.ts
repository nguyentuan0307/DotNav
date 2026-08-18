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

export interface EndpointQuickPickItem extends vscode.QuickPickItem {
  readonly endpoint?: ApiEndpoint;
  readonly searchResult?: EndpointSearchResult;
  readonly isAction?: boolean;
}

export async function populateEndpointIndexFromSolution(
  provider: DotnetTreeProvider,
  index: EndpointIndex
): Promise<void> {
  const solution = provider.getSolution();
  const files = await vscode.workspace.findFiles('**/*.cs', '{**/obj/**,**/bin/**,**/node_modules/**,**/.git/**}');

  for (const file of files) {
    const fsPath = file.fsPath;
    let projectName = 'Workspace';
    if (solution?.projects) {
      const project = solution.projects.find(p => fsPath.startsWith(path.dirname(p.path)));
      if (project) {
        projectName = project.name;
      }
    }
    const relPath = vscode.workspace.asRelativePath(fsPath);
    await index.scanFile(fsPath, projectName, relPath);
  }
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
        await populateEndpointIndexFromSolution(provider, index);
      }
    );
  }

  const allEndpoints = index.getAllEndpoints();
  if (allEndpoints.length === 0) {
    vscode.window.showInformationMessage('No ASP.NET Core controller or Minimal API endpoints were found in this workspace.');
    return;
  }

  const quickPick = vscode.window.createQuickPick<EndpointQuickPickItem>();
  quickPick.title = 'ASP.NET Core Endpoint Explorer — Smart Route Search';
  quickPick.placeholder = 'Type to search: e.g. "interface-views//filter-fields", "GET users", "api/orders"';
  quickPick.matchOnDescription = false;
  quickPick.matchOnDetail = false;

  const updateItems = (query: string) => {
    const results = searchEndpoints(allEndpoints, query, 150);

    quickPick.items = results.map(res => {
      const ep = res.endpoint;
      const methodBadge = `[${ep.httpMethod}]`;
      const route = `/${ep.routeTemplate.replace(/^\/+/, '')}`;
      const desc = `${ep.controllerName || ''}${ep.controllerName && ep.actionName ? '.' : ''}${ep.actionName || ''}`;
      const detail = `$(file-code) ${ep.relativePath}:${ep.line} • Project: ${ep.projectName} • Score: ${res.score}% (${res.matchReason})`;

      return {
        label: `${methodBadge} ${route}`,
        description: desc,
        detail,
        endpoint: ep,
        searchResult: res,
        buttons: [
          {
            iconPath: new vscode.ThemeIcon('copy'),
            tooltip: 'Copy Route Template'
          },
          {
            iconPath: new vscode.ThemeIcon('link-external'),
            tooltip: 'Copy Resolved Test URL'
          },
          {
            iconPath: new vscode.ThemeIcon('code'),
            tooltip: 'Copy as .http Request'
          },
          {
            iconPath: new vscode.ThemeIcon('terminal'),
            tooltip: 'Copy as cURL Command'
          }
        ]
      };
    });
  };

  updateItems('');

  quickPick.onDidChangeValue(value => {
    updateItems(value);
  });

  quickPick.onDidTriggerItemButton(async event => {
    const ep = event.item.endpoint;
    if (!ep) return;

    if (event.button.tooltip === 'Copy Route Template') {
      await vscode.env.clipboard.writeText(ep.routeTemplate);
      vscode.window.showInformationMessage(`Copied route: ${ep.routeTemplate}`);
    } else if (event.button.tooltip === 'Copy Resolved Test URL') {
      const resolvedUrl = formatResolvedUrl(ep);
      await vscode.env.clipboard.writeText(resolvedUrl);
      vscode.window.showInformationMessage(`Copied test URL: ${resolvedUrl}`);
    } else if (event.button.tooltip === 'Copy as .http Request') {
      const httpPayload = formatEndpointAsHttp(ep);
      await vscode.env.clipboard.writeText(httpPayload);
      vscode.window.showInformationMessage(`Copied .http request for [${ep.httpMethod}] ${ep.routeTemplate}`);
    } else if (event.button.tooltip === 'Copy as cURL Command') {
      const curlPayload = formatEndpointAsCurl(ep);
      await vscode.env.clipboard.writeText(curlPayload);
      vscode.window.showInformationMessage(`Copied cURL command for [${ep.httpMethod}] ${ep.routeTemplate}`);
    }
  });

  quickPick.onDidAccept(async () => {
    const selected = quickPick.selectedItems[0];
    quickPick.hide();
    if (!selected || !selected.endpoint) return;

    const ep = selected.endpoint;
    try {
      const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(ep.filePath));
      const editor = await vscode.window.showTextDocument(doc);
      const lineIndex = Math.max(0, ep.line - 1);
      const position = new vscode.Position(lineIndex, 0);
      editor.selection = new vscode.Selection(position, position);
      editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
    } catch (err) {
      vscode.window.showErrorMessage(`Failed to open endpoint source file: ${err instanceof Error ? err.message : String(err)}`);
    }
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
