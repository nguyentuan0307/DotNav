import * as cp from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import * as vscode from 'vscode';
import { DotnetTreeProvider } from '../treeProvider';
import { ApiEndpoint, HttpMethod } from '../endpoints/endpointModel';
import { parseRouteSegments } from '../endpoints/endpointScanner';
import { formatEndpointAsCurl, formatEndpointAsHttp, formatResolvedUrl } from '../endpoints/endpointSearch';
import { parseUniversalSearchQuery, searchUniversalSymbols } from './searchEngine';
import { SearchFilterMode, SearchIndexSnapshot, UniversalSearchResult, UniversalSymbol, UniversalSymbolKind } from './searchModel';
import { UniversalSymbolIndex, buildCqrsFlow, detectActiveCqrsContext } from './searchScanner';

export interface UniversalQuickPickItem extends vscode.QuickPickItem {
  readonly symbol?: UniversalSymbol;
  readonly searchResult?: UniversalSearchResult;
  readonly isAction?: boolean;
}

let lastSearchQuery = '';
let activeFullScanPromise: Promise<void> | undefined;
let currentUniversalQuickPick: vscode.QuickPick<UniversalQuickPickItem> | undefined;
let globalActiveTreeProvider: DotnetTreeProvider | undefined;
let globalActiveSymbolIndex: UniversalSymbolIndex | undefined;

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

function buildApiEndpointFromSymbol(symbol: UniversalSymbol): ApiEndpoint {
  const httpMethod = (symbol.metadata?.httpMethod?.toUpperCase() || 'GET') as HttpMethod;
  const routeTemplate = symbol.metadata?.routeTemplate || symbol.name;
  return {
    id: symbol.id,
    httpMethod,
    routeTemplate,
    normalizedRoute: routeTemplate.toLowerCase().replace(/^\/+/, ''),
    filePath: symbol.filePath,
    relativePath: symbol.relativePath,
    projectName: symbol.projectName,
    controllerName: symbol.metadata?.controllerName,
    actionName: symbol.metadata?.actionName,
    line: symbol.line,
    kind: 'controller',
    segments: parseRouteSegments(routeTemplate),
    routeParameters: []
  };
}

export function formatSymbolLabel(symbol: UniversalSymbol): string {
  switch (symbol.kind) {
    case 'endpoint': {
      const method = symbol.metadata?.httpMethod || 'API';
      const route = symbol.metadata?.routeTemplate
        ? '/' + symbol.metadata.routeTemplate
            .replace(/^\/+/, '')
            .replace(/\{([a-zA-Z0-9_]+)(?::[^}]+)?\}/g, '{$1}')
        : symbol.name;
      return `[${method}] ${route}`;
    }
    case 'cqrs_command':
      return `$(zap) ${symbol.name}`;
    case 'cqrs_query':
      return `$(search) ${symbol.name}`;
    case 'cqrs_handler':
      return `$(gear) ${symbol.name}`;
    case 'cqrs_event':
      return `$(bell) ${symbol.name}`;
    case 'ef_dbset':
      return `$(database) ${symbol.name}`;
    case 'ef_entity':
      return `$(table) ${symbol.name}`;
    case 'ef_migration':
      return `$(history) ${symbol.name}`;
    case 'db_table':
      return `$(database) ${symbol.name}`;
    case 'di_registration':
      return `$(plug) ${symbol.name}`;
    case 'background_job':
      return `$(clock) ${symbol.name}`;
    case 'mapping_profile':
      return `$(arrow-swap) ${symbol.name}`;
    case 'validation_rule':
      return `$(pass) ${symbol.name}`;
    case 'interface':
      return `$(symbol-interface) ${symbol.name}`;
    case 'class':
      return `$(symbol-class) ${symbol.name}`;
    case 'record':
      return `$(symbol-structure) ${symbol.name}`;
    case 'enum':
      return `$(symbol-enum) ${symbol.name}`;
    case 'enum_member':
      return `$(symbol-enum-member) ${symbol.name}`;
    case 'method':
      return `$(symbol-method) ${symbol.name}`;
    case 'property':
      return `$(symbol-property) ${symbol.name}`;
    case 'config_key':
      return `$(settings) ${symbol.name}`;
    case 'project':
      return `$(project) ${symbol.name}`;
    case 'file':
      return `$(file) ${symbol.name}`;
    default:
      return symbol.name;
  }
}

export function formatSymbolDetail(symbol: UniversalSymbol): string {
  const fileInfo = symbol.relativePath
    ? `${symbol.relativePath}:${symbol.line}`
    : `${path.basename(symbol.filePath)}:${symbol.line}`;
  const container = symbol.containerName ? ` • Container: ${symbol.containerName}` : '';
  const baseType = symbol.metadata?.baseType ? ` • Base: ${symbol.metadata.baseType}` : '';
  const configVal = symbol.metadata?.configValue ? ` = ${symbol.metadata.configValue}` : '';
  const handled = symbol.metadata?.handledType ? ` • Handles: ${symbol.metadata.handledType}` : '';
  const emits =
    symbol.metadata?.emittedEvents && symbol.metadata.emittedEvents.length > 0
      ? ` • Emits: ${symbol.metadata.emittedEvents.join(', ')}`
      : '';
  const injected =
    symbol.metadata?.injectedParams && symbol.metadata.injectedParams.length > 0
      ? ` • Injects: ${symbol.metadata.injectedParams.slice(0, 3).join(', ')}${symbol.metadata.injectedParams.length > 3 ? '...' : ''}`
      : '';
  const sqlTable = symbol.metadata?.sqlTable ? ` • Table: ${symbol.metadata.sqlTable}` : '';

  return `$(file-code) ${fileInfo} (${symbol.projectName})${container}${baseType}${handled}${emits}${injected}${sqlTable}${configVal}`;
}

export function getGroupTitleForKind(kind: UniversalSymbolKind): string {
  switch (kind) {
    case 'endpoint':
      return 'API Endpoints';
    case 'cqrs_command':
    case 'cqrs_query':
    case 'cqrs_handler':
    case 'cqrs_event':
      return 'CQRS (Commands, Queries & Handlers)';
    case 'ef_dbset':
    case 'ef_entity':
    case 'ef_migration':
    case 'db_table':
      return 'Database & EF Core Tables';
    case 'di_registration':
      return 'Dependency Injection';
    case 'background_job':
      return 'Background Jobs (Hangfire / Worker)';
    case 'mapping_profile':
      return 'Object Mappings (AutoMapper / Mapster)';
    case 'validation_rule':
      return 'Validation Rules (FluentValidation)';
    case 'class':
    case 'interface':
    case 'record':
    case 'enum':
    case 'enum_member':
      return 'C# Types & Interfaces';
    case 'method':
    case 'property':
      return 'Methods & Properties';
    case 'config_key':
      return 'Configuration Keys';
    default:
      return 'Files & Projects';
  }
}

let mruSymbolIds: string[] = [];

export async function openSymbolInEditor(symbol: UniversalSymbol, targetLine?: number, targetColumn?: number): Promise<void> {
  try {
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(symbol.filePath));
    const editor = await vscode.window.showTextDocument(doc);
    const targetL = targetLine !== undefined && targetLine > 0 ? targetLine : symbol.line;
    const targetC = targetColumn !== undefined && targetColumn > 0 ? targetColumn : symbol.column;
    const lineIndex = Math.max(0, targetL - 1);
    const position = new vscode.Position(lineIndex, Math.max(0, targetC - 1));
    editor.selection = new vscode.Selection(position, position);
    editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
  } catch (err) {
    vscode.window.showErrorMessage(
      `Failed to open symbol source file: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

interface SymbolActionPickItem extends vscode.QuickPickItem {
  action: 'open' | 'copyName' | 'copyPath' | 'copyRoute' | 'copyUrl' | 'copyHttp' | 'copyCurl' | 'traceFlow';
}

async function getGitModifiedFiles(): Promise<string[]> {
  try {
    const gitExt = vscode.extensions.getExtension('vscode.git')?.exports;
    const gitApi = gitExt?.getAPI?.(1);
    if (gitApi && gitApi.repositories && gitApi.repositories.length > 0) {
      const repo = gitApi.repositories[0];
      const changes = [
        ...(repo.state.workingTreeChanges || []),
        ...(repo.state.indexChanges || []),
        ...(repo.state.untrackedChanges || [])
      ];
      return changes
        .map((c: any) => c.uri?.fsPath)
        .filter((p: string | undefined): p is string => Boolean(p && (p.endsWith('.cs') || p.endsWith('.json') || p.endsWith('.csproj'))));
    }
  } catch {
    // ignore git extension error
  }
  return [];
}

async function showSymbolActions(symbol: UniversalSymbol): Promise<void> {
  const actions: SymbolActionPickItem[] = [
    {
      label: '$(go-to-file) Open Source Code',
      description: `${path.basename(symbol.filePath)}:${symbol.line}`,
      action: 'open'
    }
  ];

  if (
    symbol.kind === 'cqrs_command' ||
    symbol.kind === 'cqrs_handler' ||
    symbol.kind === 'cqrs_event' ||
    symbol.kind === 'cqrs_query'
  ) {
    actions.push({
      label: '$(workflow) Trace CQRS Flow (Command ➔ Handler ➔ Event ➔ Listener)',
      description: `Trace execution pipeline for ${symbol.name}`,
      action: 'traceFlow'
    });
  }

  actions.push(
    {
      label: '$(copy) Copy Symbol Name',
      description: symbol.name,
      action: 'copyName'
    },
    {
      label: '$(files) Copy Relative Path',
      description: `${symbol.relativePath}:${symbol.line}`,
      action: 'copyPath'
    }
  );

  if (symbol.kind === 'endpoint') {
    const epMock = buildApiEndpointFromSymbol(symbol);

    actions.push(
      {
        label: '$(link-external) Copy Resolved Test URL',
        description: formatResolvedUrl(epMock),
        action: 'copyUrl'
      },
      {
        label: '$(code) Copy as .http Request',
        description: `[${epMock.httpMethod}] /${epMock.routeTemplate.replace(/^\/+/, '')}`,
        action: 'copyHttp'
      },
      {
        label: '$(terminal) Copy as cURL Command',
        description: `curl -X ${epMock.httpMethod} ...`,
        action: 'copyCurl'
      }
    );
  }

  const picked = await vscode.window.showQuickPick(actions, {
    title: `Actions for ${symbol.name}`,
    placeHolder: 'Select an action to perform'
  });

  if (!picked) return;

  if (picked.action === 'open') {
    await openSymbolInEditor(symbol);
  } else if (picked.action === 'traceFlow') {
    if (globalActiveTreeProvider && globalActiveSymbolIndex) {
      await traceCqrsFlowInteractive(globalActiveTreeProvider, globalActiveSymbolIndex, symbol);
    }
  } else if (picked.action === 'copyName') {
    await vscode.env.clipboard.writeText(symbol.name);
    vscode.window.showInformationMessage(`Copied: ${symbol.name}`);
  } else if (picked.action === 'copyPath') {
    const pathText = `${symbol.relativePath}:${symbol.line}`;
    await vscode.env.clipboard.writeText(pathText);
    vscode.window.showInformationMessage(`Copied path: ${pathText}`);
  } else if (picked.action === 'copyUrl' && symbol.kind === 'endpoint') {
    const epMock = buildApiEndpointFromSymbol(symbol);
    const url = formatResolvedUrl(epMock);
    await vscode.env.clipboard.writeText(url);
    vscode.window.showInformationMessage(`Copied test URL: ${url}`);
  } else if (picked.action === 'copyHttp' && symbol.kind === 'endpoint') {
    const epMock = buildApiEndpointFromSymbol(symbol);
    const payload = formatEndpointAsHttp(epMock);
    await vscode.env.clipboard.writeText(payload);
    vscode.window.showInformationMessage(`Copied .http request`);
  } else if (picked.action === 'copyCurl' && symbol.kind === 'endpoint') {
    const epMock = buildApiEndpointFromSymbol(symbol);
    const payload = formatEndpointAsCurl(epMock);
    await vscode.env.clipboard.writeText(payload);
    vscode.window.showInformationMessage(`Copied cURL command`);
  }
}

export function getCacheFilePath(context?: vscode.ExtensionContext): string | undefined {
  const dir = context?.storageUri?.fsPath || context?.globalStorageUri?.fsPath;
  if (dir) {
    if (!fs.existsSync(dir)) {
      try {
        fs.mkdirSync(dir, { recursive: true });
      } catch {
        // ignore
      }
    }
    return path.join(dir, 'dotnav_search_cache.json.gz');
  }
  return undefined;
}

export async function loadSnapshotFromDisk(
  context: vscode.ExtensionContext | undefined,
  index: UniversalSymbolIndex
): Promise<boolean> {
  const cachePath = getCacheFilePath(context);
  if (!cachePath || !fs.existsSync(cachePath)) {
    return false;
  }
  try {
    const compressed = await fs.promises.readFile(cachePath);
    const unzipped = await new Promise<string>((resolve, reject) => {
      zlib.gunzip(compressed, (err, buf) => {
        if (err) reject(err);
        else resolve(buf.toString('utf8'));
      });
    });
    const snapshot: SearchIndexSnapshot = JSON.parse(unzipped);
    if (snapshot && snapshot.version === 5 && snapshot.symbolsByFile) {
      index.loadSnapshot(snapshot);
      return true;
    }
  } catch (err) {
    console.warn(`[DotNav] Failed to load search snapshot from disk: ${err}`);
  }
  return false;
}

let saveDebounceTimer: NodeJS.Timeout | undefined;

export function scheduleSaveSnapshotToDisk(
  context: vscode.ExtensionContext | undefined,
  index: UniversalSymbolIndex
): void {
  if (saveDebounceTimer) {
    clearTimeout(saveDebounceTimer);
  }
  saveDebounceTimer = setTimeout(async () => {
    saveDebounceTimer = undefined;
    const cachePath = getCacheFilePath(context);
    if (!cachePath) return;
    try {
      const snapshot = index.exportSnapshot();
      const jsonStr = JSON.stringify(snapshot);
      const compressed = await new Promise<Buffer>((resolve, reject) => {
        zlib.gzip(Buffer.from(jsonStr), { level: 6 }, (err, buf) => {
          if (err) reject(err);
          else resolve(buf);
        });
      });
      await fs.promises.writeFile(cachePath, compressed);
    } catch (err) {
      console.warn(`[DotNav] Failed to save search snapshot to disk: ${err}`);
    }
  }, 1500);
}

export async function populateUniversalIndexFromSolution(
  provider: DotnetTreeProvider,
  index: UniversalSymbolIndex,
  context?: vscode.ExtensionContext
): Promise<void> {
  const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!root) {
    return;
  }

  const solution = provider.getSolution();
  const projects = solution?.projects;

  // Fast guard: If no solution loaded, check if workspace has ANY .sln, .csproj or .fsproj
  if (!solution) {
    const dotnetFiles = await vscode.workspace.findFiles('**/*.{sln,csproj,fsproj}', '{**/node_modules/**,**/bin/**,**/obj/**}', 1);
    if (dotnetFiles.length === 0) {
      // Non-.NET workspace: Do NOT scan, do NOT allocate memory or disk cache
      return;
    }
  }

  // Phase 1: Zero-Delay Startup Load (< 50ms)
  let loadedFromCache = false;
  if (!index.isFullScanCompleted && index.count === 0) {
    loadedFromCache = await loadSnapshotFromDisk(context, index);
  }

  // Phase 2: Git-modified Priority Warming (< 50ms)
  try {
    const dirtyFiles = await getGitModifiedFiles();
    for (const fsPath of dirtyFiles) {
      const projectName = resolveProjectForFile(fsPath, projects);
      const relPath = vscode.workspace.asRelativePath(fsPath);
      await index.scanFile(fsPath, projectName, relPath);
    }
  } catch {
    // Ignore git error
  }

  // Phase 3: Stale-While-Revalidate Background Sync (check mtime diff)
  const files = await vscode.workspace.findFiles(
    '**/*.{cs,json,csproj,resx,sql,yaml,yml,proto}',
    '{**/obj/**,**/bin/**,**/node_modules/**,**/.git/**,**/.vs/**,**/.idea/**,**/.cache/**,**/dist/**}'
  );

  let hasChanges = false;
  const existingFilesInDisk = new Set<string>();
  const chunkSize = 48;

  for (let i = 0; i < files.length; i += chunkSize) {
    const chunk = files.slice(i, i + chunkSize);
    await Promise.all(
      chunk.map(async file => {
        const fsPath = file.fsPath;
        existingFilesInDisk.add(fsPath);
        try {
          const stat = await fs.promises.stat(fsPath);
          const cachedMtime = index.getFileTimestamp(fsPath);
          if (!cachedMtime || stat.mtimeMs > cachedMtime || !index.hasFile(fsPath)) {
            const projectName = resolveProjectForFile(fsPath, projects);
            const relPath = vscode.workspace.asRelativePath(fsPath);
            await index.scanFile(fsPath, projectName, relPath);
            hasChanges = true;
          }
        } catch {
          // ignore
        }
      })
    );
  }

  // Clean up any deleted files from cache
  for (const cachedPath of index.getAllSymbols().map(s => s.filePath)) {
    if (!existingFilesInDisk.has(cachedPath) && !fs.existsSync(cachedPath)) {
      index.invalidateFile(cachedPath);
      hasChanges = true;
    }
  }

  if (hasChanges || !loadedFromCache) {
    scheduleSaveSnapshotToDisk(context, index);
    index.getDiskStore()?.saveToDisk().catch(() => {});
  }
}

export function isSolutionSearchEnabled(): boolean {
  return vscode.workspace.getConfiguration('dotnav').get<boolean>('solutionSearch.enabled', true);
}

export async function warmUpUniversalSearchIndex(
  provider: DotnetTreeProvider,
  index: UniversalSymbolIndex,
  context?: vscode.ExtensionContext,
  force = false
): Promise<void> {
  if (!isSolutionSearchEnabled()) {
    return;
  }
  if (!force && (index.isFullScanCompleted || activeFullScanPromise)) {
    return activeFullScanPromise;
  }
  if (activeFullScanPromise) {
    return activeFullScanPromise;
  }
  activeFullScanPromise = (async () => {
    try {
      await populateUniversalIndexFromSolution(provider, index, context);
      index.markFullScanCompleted();
    } catch (err) {
      console.error(`DotNav background universal search warmup failed: ${err}`);
    } finally {
      activeFullScanPromise = undefined;
    }
  })();
  return activeFullScanPromise;
}

export async function rescanUniversalSearchIndex(
  provider: DotnetTreeProvider,
  index: UniversalSymbolIndex,
  context?: vscode.ExtensionContext,
  showNotification = false
): Promise<void> {
  const task = async () => {
    try {
      await populateUniversalIndexFromSolution(provider, index, context);
      index.markFullScanCompleted();
      if (showNotification) {
        vscode.window.showInformationMessage(`DotNav: Re-scanned ${index.count} symbols and endpoints.`);
      }
    } catch (err) {
      console.error(`DotNav symbol rescan failed: ${err}`);
      if (showNotification) {
        vscode.window.showErrorMessage(`DotNav symbol rescan failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  };

  if (showNotification) {
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'DotNav: Scanning Solution Symbols & Endpoints...'
      },
      task
    );
  } else {
    await task();
  }
}

export async function ensureUniversalIndexReady(
  provider: DotnetTreeProvider,
  index: UniversalSymbolIndex,
  context?: vscode.ExtensionContext
): Promise<void> {
  if (index.isFullScanCompleted) {
    return;
  }

  if (activeFullScanPromise) {
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'Scanning entire .NET Solution symbols & endpoints...'
      },
      async () => {
        await activeFullScanPromise;
      }
    );
    return;
  }

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'Scanning entire .NET Solution symbols & endpoints...'
    },
    async () => {
      try {
        activeFullScanPromise = populateUniversalIndexFromSolution(provider, index, context);
        await activeFullScanPromise;
        index.markFullScanCompleted();
      } finally {
        activeFullScanPromise = undefined;
      }
    }
  );
}

export async function openActiveSymbolActions(): Promise<void> {
  if (!currentUniversalQuickPick) return;
  const active = currentUniversalQuickPick.activeItems[0] || currentUniversalQuickPick.selectedItems[0];
  if (!active || !active.symbol || active.isAction) return;
  await showSymbolActions(active.symbol);
}

export async function showSearchEverywhereWithPrompt(
  provider: DotnetTreeProvider,
  index: UniversalSymbolIndex,
  initialPrefix = '',
  context?: vscode.ExtensionContext
): Promise<void> {
  if (!isSolutionSearchEnabled()) {
    const choice = await vscode.window.showInformationMessage(
      'DotNav Search Everywhere is currently disabled in Settings.',
      'Enable & Search',
      'Open Settings'
    );
    if (choice === 'Enable & Search') {
      await vscode.workspace.getConfiguration('dotnav').update('solutionSearch.enabled', true, vscode.ConfigurationTarget.Global);
    } else if (choice === 'Open Settings') {
      await vscode.commands.executeCommand('workbench.action.openSettings', 'dotnav.solutionSearch.enabled');
      return;
    } else {
      return;
    }
  }

  await searchEverywhereInteractive(provider, index, initialPrefix, context);
}

export async function getGitModifiedPaths(workspaceRoot?: string): Promise<string[]> {
  if (!workspaceRoot) return [];
  return new Promise<string[]>(resolve => {
    cp.execFile('git', ['status', '--porcelain'], { cwd: workspaceRoot, timeout: 1500 }, (err, stdout) => {
      if (err || !stdout) {
        resolve([]);
        return;
      }
      const files: string[] = [];
      for (const line of stdout.split(/\r?\n/)) {
        if (!line.trim()) continue;
        const p = line.substring(3).trim().replace(/^"|"$/g, '');
        if (p) files.push(p);
      }
      resolve(files);
    });
  });
}

function getButtonsForSymbol(sym: UniversalSymbol): vscode.QuickInputButton[] {
  const buttons: vscode.QuickInputButton[] = [];
  if (sym.kind === 'cqrs_command' || sym.kind === 'cqrs_query') {
    buttons.push({
      iconPath: new vscode.ThemeIcon('arrow-right'),
      tooltip: 'Jump to Handler'
    });
  }
  buttons.push({
    iconPath: new vscode.ThemeIcon('ellipsis'),
    tooltip: 'More Actions (Ctrl+Enter)'
  });
  return buttons;
}

function formatItemDescription(res: UniversalSearchResult): string {
  const score = res.score;
  const reason = res.matchReason || '';
  if (score >= 95) {
    return `✓ ${score} pts • ${reason}`;
  }
  if (score >= 80) {
    return `★ ${score} pts • ${reason}`;
  }
  return `${score} pts • ${reason}`;
}

function buildEmptySearchItems(
  allSymbols: UniversalSymbol[],
  gitModifiedPaths: string[],
  activeFilePath?: string,
  activeNoun?: string,
  mruSymbolIds?: readonly string[]
): UniversalQuickPickItem[] {
  const items: UniversalQuickPickItem[] = [];
  const addedIds = new Set<string>();

  // 1. Section 1: 🌿 Git Working Tree (Modified / Added Files)
  if (gitModifiedPaths.length > 0) {
    items.push({
      label: `🌿 Git Working Tree (${gitModifiedPaths.length} Modified)`,
      kind: vscode.QuickPickItemKind.Separator
    });

    for (const gitPath of gitModifiedPaths) {
      const fileSyms = allSymbols.filter(s => s.filePath.endsWith(gitPath) || s.relativePath.endsWith(gitPath));
      if (fileSyms.length > 0) {
        for (const s of fileSyms.slice(0, 3)) {
          if (!addedIds.has(s.id)) {
            addedIds.add(s.id);
            items.push({
              label: formatSymbolLabel(s),
              description: `🌿 Git Modified`,
              detail: formatSymbolDetail(s),
              alwaysShow: true,
              symbol: s,
              buttons: getButtonsForSymbol(s)
            });
          }
        }
      } else {
        const fileSym: UniversalSymbol = {
          id: `file:${gitPath}`,
          name: path.basename(gitPath),
          kind: 'file',
          filePath: gitPath,
          relativePath: gitPath,
          projectName: 'Git',
          line: 1,
          column: 1
        };
        if (!addedIds.has(fileSym.id)) {
          addedIds.add(fileSym.id);
          items.push({
            label: `$(diff-modified) ${path.basename(gitPath)}`,
            description: `🌿 Git Modified`,
            detail: `$(file) ${gitPath}`,
            alwaysShow: true,
            symbol: fileSym,
            buttons: getButtonsForSymbol(fileSym)
          });
        }
      }
    }
  }

  // 2. Section 2: 🎯 Related to Active File
  if (activeFilePath) {
    const activeBase = path.basename(activeFilePath, '.cs');
    const related = allSymbols.filter(
      s => !addedIds.has(s.id) && (s.filePath === activeFilePath || (activeNoun && s.name.toLowerCase().includes(activeNoun.toLowerCase())))
    );

    if (related.length > 0) {
      items.push({
        label: `🎯 Related to Active File (${activeBase}.cs)`,
        kind: vscode.QuickPickItemKind.Separator
      });

      for (const s of related.slice(0, 8)) {
        addedIds.add(s.id);
        items.push({
          label: formatSymbolLabel(s),
          description: `🎯 Active Context`,
          detail: formatSymbolDetail(s),
          alwaysShow: true,
          symbol: s,
          buttons: getButtonsForSymbol(s)
        });
      }
    }
  }

  // 3. Section 3: ⏱️ Frequently & Recently Visited (MRU)
  if (mruSymbolIds && mruSymbolIds.length > 0) {
    const mruSyms = mruSymbolIds
      .map(id => allSymbols.find(s => s.id === id))
      .filter((s): s is UniversalSymbol => s !== undefined && !addedIds.has(s.id));

    if (mruSyms.length > 0) {
      items.push({
        label: `⏱️ Frequently & Recently Visited`,
        kind: vscode.QuickPickItemKind.Separator
      });

      for (const s of mruSyms.slice(0, 10)) {
        addedIds.add(s.id);
        items.push({
          label: formatSymbolLabel(s),
          description: `⏱️ Recent`,
          detail: formatSymbolDetail(s),
          alwaysShow: true,
          symbol: s,
          buttons: getButtonsForSymbol(s)
        });
      }
    }
  }

  return items;
}

export async function searchEverywhereInteractive(
  provider: DotnetTreeProvider,
  index: UniversalSymbolIndex,
  initialPrefix = '',
  context?: vscode.ExtensionContext
): Promise<void> {
  globalActiveTreeProvider = provider;
  globalActiveSymbolIndex = index;
  await ensureUniversalIndexReady(provider, index, context);

  const allSymbols = index.getAllSymbols();
  if (allSymbols.length === 0) {
    vscode.window.showInformationMessage('No C# symbols, endpoints, or configurations found in this workspace.');
    return;
  }

  // Preserve initial active editor and selection to restore on cancellation
  const initialActiveEditor = vscode.window.activeTextEditor;
  const initialDocUri = initialActiveEditor?.document.uri;
  const initialSelection = initialActiveEditor?.selection;
  let isAccepted = false;

  const quickPick = vscode.window.createQuickPick<UniversalQuickPickItem>();
  currentUniversalQuickPick = quickPick;
  await vscode.commands.executeCommand('setContext', 'dotnav.solutionSearchOpen', true);

  quickPick.title = 'DotNav: Search Everywhere (Universal Solution Search)';
  quickPick.placeholder = 'Search everything: /api, $cqrs, %db, #type, @method, !file (Enter: Go to Code • Ctrl+Enter: Actions)';
  quickPick.matchOnDescription = true;
  quickPick.matchOnDetail = true;

  quickPick.buttons = [
    {
      iconPath: new vscode.ThemeIcon('globe'),
      tooltip: 'Filter Endpoints (/)'
    },
    {
      iconPath: new vscode.ThemeIcon('zap'),
      tooltip: 'Filter CQRS ($)'
    },
    {
      iconPath: new vscode.ThemeIcon('database'),
      tooltip: 'Filter Database & EF (%)'
    },
    {
      iconPath: new vscode.ThemeIcon('symbol-class'),
      tooltip: 'Filter Types (#)'
    },
    {
      iconPath: new vscode.ThemeIcon('symbol-method'),
      tooltip: 'Filter Methods (@)'
    },
    {
      iconPath: new vscode.ThemeIcon('sync'),
      tooltip: 'Re-scan / Refresh Solution Symbols'
    }
  ];

  quickPick.onDidTriggerButton(async button => {
    if (button.tooltip?.includes('Endpoints')) {
      quickPick.value = '/' + quickPick.value.replace(/^[/%$#@!]/, '');
    } else if (button.tooltip?.includes('CQRS')) {
      quickPick.value = '$' + quickPick.value.replace(/^[/%$#@!]/, '');
    } else if (button.tooltip?.includes('Database')) {
      quickPick.value = '%' + quickPick.value.replace(/^[/%$#@!]/, '');
    } else if (button.tooltip?.includes('Types')) {
      quickPick.value = '#' + quickPick.value.replace(/^[/%$#@!]/, '');
    } else if (button.tooltip?.includes('Methods')) {
      quickPick.value = '@' + quickPick.value.replace(/^[/%$#@!]/, '');
    } else if (button.tooltip?.includes('Re-scan') || button.tooltip?.includes('Refresh')) {
      quickPick.busy = true;
      try {
        await rescanUniversalSearchIndex(provider, index, context, false);
        updateItems(quickPick.value);
      } finally {
        quickPick.busy = false;
      }
    }
  });

  const activeEditor = vscode.window.activeTextEditor;
  const activeFilePath = activeEditor ? activeEditor.document.uri.fsPath : undefined;
  const activeFileDir = activeFilePath ? path.dirname(activeFilePath) : undefined;
  const activeBaseName = activeFilePath ? path.basename(activeFilePath, '.cs') : undefined;
  const activeNoun = activeBaseName ? activeBaseName.replace(/(Controller|Service|Repository|Handler|Command|Query|Model|Dto)$/i, '') : undefined;
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  const gitModifiedPaths = await getGitModifiedPaths(workspaceRoot);

  const solution = provider.getSolution();
  const activeProjectName = activeFilePath ? resolveProjectForFile(activeFilePath, solution?.projects) : undefined;
  const rankingContext = {
    activeProjectName,
    activeFilePath,
    activeFileDir,
    activeNoun,
    gitModifiedPaths,
    mruSymbolIds
  };

  const updateItems = (query: string) => {
    if (query.trim().length === 0) {
      const emptyItems = buildEmptySearchItems(
        allSymbols,
        gitModifiedPaths,
        activeFilePath,
        activeNoun,
        mruSymbolIds
      );
      quickPick.items = emptyItems.length > 0 ? emptyItems : [
        {
          label: '$(search) Start typing to search solution symbols...',
          description: 'Try: /api for endpoints, $ for CQRS, % for EF DbSets, # for classes',
          alwaysShow: true,
          isAction: true
        }
      ];
      return;
    }

    const results = searchUniversalSymbols(index, query, 120, rankingContext);

    if (results.length === 0) {
      quickPick.items = [
        {
          label: `$(info) No symbols or endpoints found matching "${query}"`,
          description: 'Try searching with prefixes: /api, $cqrs, %db, #type, @method, or acronyms like CIVC',
          alwaysShow: true,
          isAction: true
        }
      ];
      return;
    }

    const items: UniversalQuickPickItem[] = [];
    let currentGroup = '';

    for (const res of results) {
      const sym = res.symbol;
      const group = getGroupTitleForKind(sym.kind);

      if (group !== currentGroup && !query.startsWith('/') && !query.startsWith('$') && !query.startsWith('%') && !query.startsWith('#') && !query.startsWith('@')) {
        currentGroup = group;
        items.push({
          label: group,
          kind: vscode.QuickPickItemKind.Separator
        });
      }

      items.push({
        label: formatSymbolLabel(sym),
        description: formatItemDescription(res),
        detail: formatSymbolDetail(sym),
        alwaysShow: true,
        symbol: sym,
        searchResult: res,
        buttons: getButtonsForSymbol(sym)
      });
    }

    quickPick.items = items;
  };

  const startingValue = initialPrefix || lastSearchQuery;
  if (startingValue) {
    quickPick.value = startingValue;
  }
  updateItems(startingValue);

  quickPick.onDidChangeValue(value => {
    lastSearchQuery = value;
    updateItems(value);
  });

  // QuickPick mode: item button triggers actions or CQRS handler navigation
  quickPick.onDidTriggerItemButton(async event => {
    const sym = event.item.symbol;
    if (!sym) return;

    if (event.button.tooltip === 'Jump to Handler') {
      const all = index.getAllSymbols();
      const handlerName = sym.name.replace(/^(Command|Query):\s*/i, '') + 'Handler';
      const bareName = sym.name.replace(/^(Command|Query):\s*/i, '');
      const targetHandler = all.find(
        s => s.kind === 'cqrs_handler' && (s.name.includes(handlerName) || s.name.includes(bareName) || s.metadata?.handledType === bareName)
      );
      if (targetHandler) {
        isAccepted = true;
        quickPick.hide();
        await openSymbolInEditor(targetHandler);
        return;
      }
    }

    await showSymbolActions(sym);
  });

  quickPick.onDidAccept(async () => {
    const selected = quickPick.selectedItems[0];
    if (!selected || !selected.symbol || selected.isAction) return;
    const sym = selected.symbol;
    isAccepted = true;

    // Track MRU
    mruSymbolIds = [sym.id, ...mruSymbolIds.filter(id => id !== sym.id)].slice(0, 50);

    // Line Jump support (e.g. Symbol:762 or Symbol@762)
    const parsed = parseUniversalSearchQuery(quickPick.value);
    quickPick.hide();
    await openSymbolInEditor(sym, parsed.targetLine, parsed.targetColumn);
  });

  quickPick.onDidHide(async () => {
    if (currentUniversalQuickPick === quickPick) {
      currentUniversalQuickPick = undefined;
    }
    await vscode.commands.executeCommand('setContext', 'dotnav.solutionSearchOpen', false);

    // Restore original document if user cancelled preview
    if (!isAccepted && initialDocUri) {
      try {
        const origDoc = await vscode.workspace.openTextDocument(initialDocUri);
        const editor = await vscode.window.showTextDocument(origDoc, { preserveFocus: true, preview: true });
        if (initialSelection) {
          editor.selection = initialSelection;
          editor.revealRange(initialSelection, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
        }
      } catch {
        // Ignore restore failure
      }
    }
  });

  quickPick.show();
}

export async function traceCqrsFlowInteractive(
  provider: DotnetTreeProvider,
  index: UniversalSymbolIndex,
  targetQueryOrSymbol?: string | UniversalSymbol | vscode.Uri | any,
  context?: vscode.ExtensionContext
): Promise<void> {
  globalActiveTreeProvider = provider;
  globalActiveSymbolIndex = index;

  await ensureUniversalIndexReady(provider, index, context);

  let initialQuery = detectActiveCqrsContext(targetQueryOrSymbol, vscode.window.activeTextEditor);

  if (!initialQuery) {
    const input = await vscode.window.showInputBox({
      title: 'DotNav: Trace CQRS Flow',
      prompt: 'Enter Command, Query, Handler, or Event name to trace (e.g. AddAppField, CopyFunction, AppFieldDeleted)...',
      placeHolder: 'AddAppField'
    });
    if (!input || !input.trim()) return;
    initialQuery = input.trim();
  }

  const quickPick = vscode.window.createQuickPick<UniversalQuickPickItem>();
  quickPick.title = 'DotNav: Trace CQRS Flow (Command ➔ Handler ➔ Event ➔ Listener)';
  quickPick.placeholder = 'Search CQRS pipelines by name (e.g. AddAppField, CopyFunction, AppFieldDeleted)...';
  quickPick.matchOnDescription = false;
  quickPick.matchOnDetail = false;

  const updateFlowItems = (query: string) => {
    const flow = buildCqrsFlow(query, index);
    if (!flow || flow.nodes.length === 0) {
      quickPick.items = [
        {
          label: `$(info) No CQRS pipeline found matching "${query}"`,
          description: 'Try entering an entity or action name, e.g. AddAppField, CopyFunction, AppFieldDeleted',
          alwaysShow: true,
          isAction: true
        }
      ];
      return;
    }

    quickPick.title = `DotNav: CQRS Flow ➔ [${flow.rootNoun}] (${flow.nodes.length} components connected)`;

    const items: UniversalQuickPickItem[] = [];
    let currentCategory = '';

    for (const node of flow.nodes) {
      if (node.category !== currentCategory) {
        currentCategory = node.category;
        items.push({
          label: currentCategory,
          kind: vscode.QuickPickItemKind.Separator
        });
      }

      items.push({
        label: node.label,
        detail: node.detail,
        alwaysShow: true,
        symbol: node.symbol,
        buttons: [
          {
            iconPath: new vscode.ThemeIcon('ellipsis'),
            tooltip: 'More Actions (Ctrl+Enter)'
          }
        ]
      });
    }

    quickPick.items = items;
  };

  quickPick.value = initialQuery;
  updateFlowItems(initialQuery);

  quickPick.onDidChangeValue(val => {
    if (val.trim()) {
      updateFlowItems(val.trim());
    }
  });

  quickPick.onDidTriggerItemButton(async event => {
    const sym = event.item.symbol;
    if (!sym) return;
    await showSymbolActions(sym);
  });

  quickPick.onDidAccept(async () => {
    const selected = quickPick.selectedItems[0];
    if (!selected || !selected.symbol || selected.isAction) return;
    quickPick.hide();
    await openSymbolInEditor(selected.symbol);
  });

  quickPick.show();
}
