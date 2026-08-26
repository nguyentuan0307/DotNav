import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { EntityModel, EntityRelationship } from './efDiagramModel';
import {
  buildRelationships,
  buildStrictWorkspaceEntities,
  parseDbContextDbSets,
  parseFluentConfigurations,
  parseRawClassesFromCSharp,
  RawClassInfo,
  FluentConfigRule
} from './efDiagramScanner';
import {
  listSavedDiagrams,
  loadDiagramFromFile,
  liveSyncDiagramWithCode,
  saveDiagramToFile
} from './efDiagramStorage';
import { renderEfDiagramHtml } from './efDiagramHtml';

let currentDiagramPanel: vscode.WebviewPanel | undefined;

export async function scanWorkspaceEntities(): Promise<{
  entities: EntityModel[];
  relationships: EntityRelationship[];
}> {
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!workspaceRoot) {
    return { entities: [], relationships: [] };
  }

  const csFiles = await vscode.workspace.findFiles(
    '**/*.cs',
    '{**/bin/**,**/obj/**,**/node_modules/**,**/.git/**}',
    2500
  );

  const rawClasses: RawClassInfo[] = [];
  const fluentRules: FluentConfigRule[] = [];
  const dbContextSets: { dbContextName: string; entityTypes: string[] }[] = [];

  for (const uri of csFiles) {
    try {
      const content = await fs.promises.readFile(uri.fsPath, 'utf8');
      const relPath = path.relative(workspaceRoot, uri.fsPath);
      const projName = relPath.split(path.sep)[0] || 'Workspace';

      // 1. Check for DbSets
      if (content.includes('DbSet<')) {
        const foundSets = parseDbContextDbSets(content);
        if (foundSets.length > 0) {
          dbContextSets.push(...foundSets);
        }
      }

      // 2. Check for IEntityTypeConfiguration<T>
      if (content.includes('IEntityTypeConfiguration<')) {
        const foundRules = parseFluentConfigurations(content);
        if (foundRules.length > 0) {
          fluentRules.push(...foundRules);
        }
      }

      // 3. Collect Raw Classes
      if (content.includes('class ') || content.includes('record ')) {
        const foundClasses = parseRawClassesFromCSharp(content, uri.fsPath, projName);
        if (foundClasses.length > 0) {
          rawClasses.push(...foundClasses);
        }
      }
    } catch {
      // Ignore read failure
    }
  }

  const entities = buildStrictWorkspaceEntities(rawClasses, fluentRules, dbContextSets);
  const relationships = buildRelationships(entities);

  return { entities, relationships };
}

export async function openEfDiagramPanel(
  context: vscode.ExtensionContext,
  initialEntityName?: string,
  initialDbContextFilter?: string
): Promise<void> {
  const isEnabled = vscode.workspace.getConfiguration('dotnav.ef.diagram').get<boolean>('enabled', true);
  if (!isEnabled) {
    const choice = await vscode.window.showWarningMessage(
      'EF Core Visual ERD Diagram is currently disabled in DotNav settings.',
      'Open Settings',
      'Cancel'
    );
    if (choice === 'Open Settings') {
      await vscode.commands.executeCommand('workbench.action.openSettings', 'dotnav.ef.diagram.enabled');
    }
    return;
  }

  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

  if (currentDiagramPanel) {
    currentDiagramPanel.reveal(vscode.ViewColumn.One);
    if (initialEntityName || initialDbContextFilter) {
      // Add initial entity or filter to canvas
      const { entities, relationships } = await scanWorkspaceEntities();
      currentDiagramPanel.webview.postMessage({
        type: 'init',
        allEntities: entities,
        relationships,
        activeDiagramName: 'Default',
        activePositions: initialEntityName ? { [initialEntityName]: { x: 120, y: 120 } } : undefined,
        initialDbContextFilter
      });
    }
    return;
  }

  const panel = vscode.window.createWebviewPanel(
    'dotnav.efDiagram',
    'EF Core: Entity Relationship Diagram',
    vscode.ViewColumn.One,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.file(context.extensionPath)]
    }
  );

  currentDiagramPanel = panel;

  panel.onDidDispose(() => {
    currentDiagramPanel = undefined;
  });

  panel.webview.html = renderEfDiagramHtml();

  panel.webview.onDidReceiveMessage(async msg => {
    switch (msg.type) {
      case 'ready': {
        const { entities, relationships } = await scanWorkspaceEntities();
        const savedDiagrams = await listSavedDiagrams(workspaceRoot);
        let activePositions: Record<string, { x: number; y: number }> = {};

        if (initialEntityName) {
          activePositions[initialEntityName] = { x: 120, y: 120 };
        } else {
          // Load default diagram if exists
          const saved = await loadDiagramFromFile('Default', workspaceRoot);
          if (saved) {
            activePositions = liveSyncDiagramWithCode(saved, entities);
          } else if (entities.length > 0) {
            // Pick first 3 entities as initial showcase
            entities.slice(0, 3).forEach((e, idx) => {
              activePositions[e.name] = { x: 60 + idx * 300, y: 60 };
            });
          }
        }

        panel.webview.postMessage({
          type: 'init',
          allEntities: entities,
          relationships,
          activeDiagramName: 'Default',
          activePositions,
          savedDiagramNames: savedDiagrams,
          initialDbContextFilter
        });
        break;
      }

      case 'loadDiagram': {
        const { entities } = await scanWorkspaceEntities();
        const saved = await loadDiagramFromFile(msg.name, workspaceRoot);
        const synced = liveSyncDiagramWithCode(saved, entities);
        panel.webview.postMessage({
          type: 'diagramLoaded',
          diagramName: msg.name,
          activePositions: synced
        });
        break;
      }

      case 'saveDiagram': {
        const success = await saveDiagramToFile(msg.name, msg.positions, workspaceRoot);
        if (success) {
          vscode.window.showInformationMessage(`Diagram "${msg.name}" saved successfully!`);
          const savedDiagrams = await listSavedDiagrams(workspaceRoot);
          panel.webview.postMessage({
            type: 'diagramListUpdated',
            savedDiagramNames: savedDiagrams
          });
        } else {
          vscode.window.showErrorMessage(`Failed to save diagram "${msg.name}".`);
        }
        break;
      }

      case 'openFile': {
        if (msg.filePath && fs.existsSync(msg.filePath)) {
          const doc = await vscode.workspace.openTextDocument(msg.filePath);
          const editor = await vscode.window.showTextDocument(doc, {
            viewColumn: vscode.ViewColumn.Beside,
            preserveFocus: false
          });
          if (msg.line) {
            const lineIdx = Math.max(0, msg.line - 1);
            const pos = new vscode.Position(lineIdx, 0);
            editor.selection = new vscode.Selection(pos, pos);
            editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
          }
        }
        break;
      }
    }
  });
}
