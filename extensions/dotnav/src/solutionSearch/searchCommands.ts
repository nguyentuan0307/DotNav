import * as cp from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import * as vscode from 'vscode';
import { DotnetTreeProvider } from '../treeProvider';
import { ApiEndpoint, HttpMethod } from '../endpoints/endpointModel';
import { parseRouteSegments } from '../endpoints/endpointScanner';
import { formatEndpointAsCurl, formatEndpointAsHttp, formatResolvedUrl } from '../endpoints/endpointSearch';
import {
  calculateAdaptiveBoost,
  calculateFrecencyBonus,
  parseUniversalSearchQuery,
  searchUniversalSymbols
} from './searchEngine';
import {
  compactDirectoryPath,
  compactFilePath,
  formatSymbolDescription,
  formatSymbolDetail,
  formatSymbolTooltip,
  AdaptiveQueryMap,
  AdaptiveQueryRecord,
  FrecencyRecord,
  SearchFilterMode,
  SearchIndexSnapshot,
  SearchRankingContext,
  UniversalSearchResult,
  UniversalSymbol,
  UniversalSymbolKind
} from './searchModel';
import { UniversalSymbolIndex, buildCqrsFlow, detectActiveCqrsContext } from './searchScanner';
import { getSearchIndexStatusBar } from './searchStatusBar';

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
    case 'error_message':
      return `$(alert) ${symbol.name}`;
    case 'localization_resource':
      return `$(globe) ${symbol.name}`;
    case 'project':
      return `$(project) ${symbol.name}`;
    case 'file':
      return `$(file) ${symbol.name}`;
    default:
      return symbol.name;
  }
}

export {
  compactDirectoryPath,
  compactFilePath,
  formatSymbolDescription,
  formatSymbolDetail,
  formatSymbolTooltip
} from './searchModel';

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
    case 'error_message':
      return 'Error Messages & Exceptions';
    case 'localization_resource':
      return 'Localization Resources (.resx / json)';
    default:
      return 'Files & Projects';
  }
}

const STORAGE_KEY_FRECENCY = 'dotnav.search.frecencyRecords';
const STORAGE_KEY_ADAPTIVE = 'dotnav.search.adaptiveClicks';

let mruSymbolIds: string[] = [];

export function getStoredFrecency(
  context?: vscode.ExtensionContext,
  knownSymbolIds?: Set<string>
): FrecencyRecord[] {
  if (!context) return [];
  const raw = context.workspaceState.get<FrecencyRecord[]>(STORAGE_KEY_FRECENCY, []);
  if (!Array.isArray(raw)) return [];
  const now = Date.now();
  const valid = knownSymbolIds && knownSymbolIds.size > 0
    ? raw.filter(r => r && typeof r.symbolId === 'string' && knownSymbolIds.has(r.symbolId))
    : raw.filter(r => r && typeof r.symbolId === 'string');
  return valid.sort((a, b) => {
    const bonusA = calculateFrecencyBonus(a.count, a.lastAccessedAt, now);
    const bonusB = calculateFrecencyBonus(b.count, b.lastAccessedAt, now);
    return bonusB - bonusA;
  });
}

export async function recordSymbolAccess(
  symbolId: string,
  context?: vscode.ExtensionContext,
  knownSymbolIds?: Set<string>
): Promise<void> {
  if (!context || !symbolId) return;
  const current = getStoredFrecency(context, knownSymbolIds);
  const existingIndex = current.findIndex(r => r.symbolId === symbolId);
  const now = Date.now();
  if (existingIndex !== -1) {
    const existing = current[existingIndex];
    current[existingIndex] = {
      symbolId,
      count: existing.count + 1,
      lastAccessedAt: now
    };
  } else {
    current.push({
      symbolId,
      count: 1,
      lastAccessedAt: now
    });
  }

  current.sort((a, b) => {
    const bonusA = calculateFrecencyBonus(a.count, a.lastAccessedAt, now);
    const bonusB = calculateFrecencyBonus(b.count, b.lastAccessedAt, now);
    return bonusB - bonusA;
  });

  await context.workspaceState.update(STORAGE_KEY_FRECENCY, current.slice(0, 100));
}

export function getStoredAdaptiveClicks(context?: vscode.ExtensionContext): AdaptiveQueryMap {
  if (!context) return {};
  return context.workspaceState.get<AdaptiveQueryMap>(STORAGE_KEY_ADAPTIVE, {}) || {};
}

export async function recordAdaptiveClick(
  rawQuery: string,
  symbolId: string,
  context?: vscode.ExtensionContext
): Promise<void> {
  if (!context || !symbolId) return;
  const parsed = parseUniversalSearchQuery(rawQuery);
  const cleanQ = parsed.cleanQuery.trim().toLowerCase();
  if (cleanQ.length < 2) return;

  const currentMap: Record<string, Record<string, { count: number; lastUsed: number }>> = {
    ...getStoredAdaptiveClicks(context)
  };

  const queryRecord = currentMap[cleanQ] ? { ...currentMap[cleanQ] } : {};
  const prev = queryRecord[symbolId];
  const now = Date.now();
  queryRecord[symbolId] = {
    count: (prev?.count || 0) + 1,
    lastUsed: now
  };

  const sortedEntries = Object.entries(queryRecord).sort(
    (a, b) => calculateAdaptiveBoost(b[1].count, b[1].lastUsed, now) - calculateAdaptiveBoost(a[1].count, a[1].lastUsed, now)
  );
  currentMap[cleanQ] = Object.fromEntries(sortedEntries.slice(0, 10));

  const allQueries = Object.keys(currentMap);
  if (allQueries.length > 100) {
    const queriesSorted = allQueries.sort((a, b) => {
      const maxA = Math.max(...Object.values(currentMap[a]).map(v => v.lastUsed));
      const maxB = Math.max(...Object.values(currentMap[b]).map(v => v.lastUsed));
      return maxB - maxA;
    });
    for (const q of queriesSorted.slice(100)) {
      delete currentMap[q];
    }
  }

  await context.workspaceState.update(STORAGE_KEY_ADAPTIVE, currentMap);
}

export async function resetSearchLearningCommand(context?: vscode.ExtensionContext): Promise<void> {
  if (context) {
    await context.workspaceState.update(STORAGE_KEY_ADAPTIVE, undefined);
  }
  if (vscode.window?.showInformationMessage) {
    vscode.window.showInformationMessage('DotNav: Search adaptive learning data has been reset.');
  }
}

export async function showSearchDiagnosticsCommand(
  index: UniversalSymbolIndex,
  context?: vscode.ExtensionContext
): Promise<void> {
  const allHotSymbols = index.getAllSymbols();
  const kindCounts: Record<string, number> = {};
  for (const s of allHotSymbols) {
    kindCounts[s.kind] = (kindCounts[s.kind] || 0) + 1;
  }

  const diskStore = index.getDiskStore();
  let coldCount = 0;
  let coldSizeKb = 0;
  let coldFilePath = '';
  if (diskStore) {
    coldCount = diskStore.coldSymbolCount || 0;
    coldFilePath = diskStore.cacheFilePath || '';
    if (coldFilePath && fs.existsSync(coldFilePath)) {
      try {
        const stat = fs.statSync(coldFilePath);
        coldSizeKb = Math.round(stat.size / 1024);
      } catch {}
    }
  }

  const frecency = getStoredFrecency(context);
  const adaptive = getStoredAdaptiveClicks(context);
  const adaptiveQueryCount = Object.keys(adaptive).length;

  const cqrsTotal = (kindCounts['cqrs_command'] || 0) + (kindCounts['cqrs_query'] || 0) + (kindCounts['cqrs_handler'] || 0) + (kindCounts['cqrs_event'] || 0);
  const efDbTotal = (kindCounts['ef_dbset'] || 0) + (kindCounts['ef_entity'] || 0) + (kindCounts['db_table'] || 0) + (kindCounts['ef_migration'] || 0);
  const typesTotal = (kindCounts['class'] || 0) + (kindCounts['interface'] || 0) + (kindCounts['record'] || 0) + (kindCounts['enum'] || 0);

  const items: (vscode.QuickPickItem & { action?: () => Promise<void> })[] = [
    {
      label: `$(zap) Hot Symbols in Memory (RAM)`,
      description: `${allHotSymbols.length.toLocaleString()} symbols indexed across ${index.fileCount} files`,
      detail: `Endpoints: ${kindCounts['endpoint'] || 0} • CQRS: ${cqrsTotal} • EF/DB: ${efDbTotal} • Types: ${typesTotal} • DI: ${kindCounts['di_registration'] || 0} • Jobs: ${kindCounts['background_job'] || 0}`
    },
    {
      label: `$(database) Secondary Symbols on Disk (.cache/cold_symbols.gz)`,
      description: diskStore ? `${coldCount.toLocaleString()} symbols (${coldSizeKb} KB compressed)` : 'Disabled',
      detail: coldFilePath || 'No disk store active'
    },
    {
      label: `$(history) Persistent Frecency Cache`,
      description: `${frecency.length} tracked items`,
      detail: 'Stored in workspaceState (survives reload, decays over time, auto-pruned)'
    },
    {
      label: `$(lightbulb) Local Adaptive Ranking Data`,
      description: `${adaptiveQueryCount} search query habits learned`,
      detail: 'Learns user symbol choices per query to promote favorites'
    },
    {
      label: `$(refresh) Rescan Solution Symbols`,
      description: 'Rebuild hot RAM index and disk cache immediately',
      action: async () => {
        if (globalActiveTreeProvider && globalActiveSymbolIndex) {
          await rescanUniversalSearchIndex(globalActiveTreeProvider, globalActiveSymbolIndex, context, true);
        }
      }
    },
    {
      label: `$(trash) Reset Adaptive Learning Data`,
      description: 'Clear all query-to-symbol click associations',
      action: async () => {
        await resetSearchLearningCommand(context);
      }
    }
  ];

  const pick = await vscode.window.showQuickPick(items, {
    title: 'DotNav: Search Everywhere Diagnostics',
    placeHolder: 'Search index statistics and performance'
  });

  if (pick?.action) {
    await pick.action();
  }
}

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

export function getCurrentGitBranch(workspaceRoot?: string): string {
  try {
    const root = workspaceRoot || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!root) return 'default';

    const gitExt = vscode.extensions.getExtension('vscode.git')?.exports;
    const gitApi = gitExt?.getAPI?.(1);
    if (gitApi && gitApi.repositories && gitApi.repositories.length > 0) {
      const repo = gitApi.repositories.find((r: any) => path.resolve(r.rootUri.fsPath) === path.resolve(root)) || gitApi.repositories[0];
      const headName = repo.state?.HEAD?.name;
      if (headName) {
        return headName;
      }
    }

    const headPath = path.join(root, '.git', 'HEAD');
    if (fs.existsSync(headPath)) {
      const content = fs.readFileSync(headPath, 'utf8').trim();
      const match = content.match(/^ref:\s*refs\/heads\/(.+)$/);
      if (match && match[1]) {
        return match[1].trim();
      }
      if (/^[0-9a-fA-F]{40}$/.test(content)) {
        return content.slice(0, 8);
      }
    }
  } catch {
    // ignore
  }
  return 'default';
}

export function getCacheFilePath(context?: vscode.ExtensionContext, workspaceRoot?: string): string | undefined {
  const dir = context?.storageUri?.fsPath || context?.globalStorageUri?.fsPath;
  if (dir) {
    if (!fs.existsSync(dir)) {
      try {
        fs.mkdirSync(dir, { recursive: true });
      } catch {
        // ignore
      }
    }
    const root = workspaceRoot || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const branch = getCurrentGitBranch(root);
    const safeBranch = branch.replace(/[^a-zA-Z0-9_.-]+/g, '_');
    return path.join(dir, `dotnav_search_cache_${safeBranch}.json.gz`);
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
    if (snapshot && snapshot.version === 6 && snapshot.symbolsByFile) {
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
  context?: vscode.ExtensionContext,
  force = false
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
  if (!force && !index.isFullScanCompleted && index.count === 0) {
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

  const statusBar = getSearchIndexStatusBar();
  const startTime = Date.now();
  let scannedCount = 0;
  if (files.length > 0) {
    statusBar.start(files.length);
  }

  let hasChanges = false;
  const normKey = (p: string) => process.platform === 'win32' ? path.resolve(p).toLowerCase() : path.resolve(p);
  const existingFilesInDisk = new Set<string>();
  const chunkSize = 48;

  try {
    for (let i = 0; i < files.length; i += chunkSize) {
      const chunk = files.slice(i, i + chunkSize);
      await Promise.all(
        chunk.map(async file => {
          const fsPath = file.fsPath;
          existingFilesInDisk.add(normKey(fsPath));
          try {
            const stat = await fs.promises.stat(fsPath);
            const cachedMtime = index.getFileTimestamp(fsPath);
            const isCs = fsPath.endsWith('.cs');
            const isMissingCold = isCs && (!index.getDiskStore() || !index.getDiskStore()!.hasFile(fsPath));
            if (!cachedMtime || stat.mtimeMs > cachedMtime || !index.hasFile(fsPath) || isMissingCold) {
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
      scannedCount += chunk.length;
      statusBar.reportProgress(scannedCount, files.length);
    }
  } finally {
    if (files.length > 0) {
      const elapsed = Date.now() - startTime;
      if (!hasChanges && elapsed < 200) {
        statusBar.hide();
      } else {
        statusBar.complete(index.count, elapsed);
      }
    }
  }

  // Clean up any deleted files from cache efficiently via fileCache keys
  const cachedFilePaths = index.getFilePaths();
  for (const cachedPath of cachedFilePaths) {
    if (!existingFilesInDisk.has(normKey(cachedPath)) && !fs.existsSync(cachedPath)) {
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

let pendingRescanRequested = false;

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
    if (force) {
      pendingRescanRequested = true;
    }
    return activeFullScanPromise;
  }
  activeFullScanPromise = (async () => {
    try {
      await populateUniversalIndexFromSolution(provider, index, context, force);
      index.markFullScanCompleted();
    } catch (err) {
      console.error(`DotNav background universal search warmup failed: ${err}`);
    } finally {
      activeFullScanPromise = undefined;
      if (pendingRescanRequested) {
        pendingRescanRequested = false;
        void warmUpUniversalSearchIndex(provider, index, context, true);
      }
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
      if (showNotification) {
        index.clear();
      }
      await populateUniversalIndexFromSolution(provider, index, context, showNotification);
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
  const loc = formatSymbolTooltip(sym);
  if (loc) {
    buttons.push({
      iconPath: new vscode.ThemeIcon('go-to-file'),
      tooltip: `Location: ${loc} (Click to copy)`
    });
  }
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

function buildEmptySearchItems(
  allSymbols: UniversalSymbol[],
  gitModifiedPaths: string[],
  activeFilePath?: string,
  activeNoun?: string,
  mruSymbolIds?: readonly string[],
  frecencyRecords?: readonly FrecencyRecord[]
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
              description: `🌿 Git Modified • ${formatSymbolDescription(s)}`,
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
            detail: `$(folder) ${compactDirectoryPath(gitPath)}`,
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
          description: `🎯 Active Context • ${formatSymbolDescription(s)}`,
          detail: formatSymbolDetail(s),
          alwaysShow: true,
          symbol: s,
          buttons: getButtonsForSymbol(s)
        });
      }
    }
  }

  // 3. Section 3: ⏱️ Frequently & Recently Visited (Persistent Frecency / MRU)
  if (frecencyRecords && frecencyRecords.length > 0) {
    const frecencyPairs = frecencyRecords
      .map(rec => ({ rec, sym: allSymbols.find(s => s.id === rec.symbolId) }))
      .filter((p): p is { rec: FrecencyRecord; sym: UniversalSymbol } => p.sym !== undefined && !addedIds.has(p.sym.id));

    if (frecencyPairs.length > 0) {
      items.push({
        label: `⏱️ Frequently & Recently Visited`,
        kind: vscode.QuickPickItemKind.Separator
      });

      for (const { rec, sym } of frecencyPairs.slice(0, 10)) {
        addedIds.add(sym.id);
        items.push({
          label: formatSymbolLabel(sym),
          description: `${rec.count > 1 ? `⏱️ Visited ${rec.count}x` : `⏱️ Recent`} • ${formatSymbolDescription(sym)}`,
          detail: formatSymbolDetail(sym),
          alwaysShow: true,
          symbol: sym,
          buttons: getButtonsForSymbol(sym)
        });
      }
    }
  } else if (mruSymbolIds && mruSymbolIds.length > 0) {
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
          description: `⏱️ Recent • ${formatSymbolDescription(s)}`,
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

  const defaultTitle = 'DotNav: Search Everywhere (Universal Solution Search)';
  quickPick.title = defaultTitle;
  quickPick.placeholder = 'Search everything: /api, $cqrs, %db, #type, @method, !file (Enter: Go to Code • Ctrl+Enter: Actions)';
  quickPick.matchOnDescription = true;
  quickPick.matchOnDetail = true;

  quickPick.onDidChangeActive(activeItems => {
    const item = activeItems[0];
    if (item?.symbol) {
      const loc = formatSymbolTooltip(item.symbol);
      const displayLoc = loc ? compactFilePath(loc, 55) : '';
      quickPick.title = displayLoc ? `DotNav: ${displayLoc}` : defaultTitle;
    } else {
      quickPick.title = defaultTitle;
    }
  });

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
      iconPath: new vscode.ThemeIcon('pulse'),
      tooltip: 'Search Diagnostics & Index Stats'
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
    } else if (button.tooltip?.includes('Diagnostics')) {
      await showSearchDiagnosticsCommand(index, context);
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

  const explainRanking = vscode.workspace.getConfiguration('dotnav').get<boolean>('solutionSearch.explainRanking', false);
  const allSymbolIds = new Set(allSymbols.map(s => s.id));
  const frecencyRecords = getStoredFrecency(context, allSymbolIds);
  const now = Date.now();
  const frecencyBonusMap: Record<string, number> = {};
  for (const rec of frecencyRecords) {
    frecencyBonusMap[rec.symbolId] = calculateFrecencyBonus(rec.count, rec.lastAccessedAt, now);
  }
  const adaptiveClicks = getStoredAdaptiveClicks(context);

  const updateItems = (query: string) => {
    if (query.trim().length === 0) {
      const emptyItems = buildEmptySearchItems(
        allSymbols,
        gitModifiedPaths,
        activeFilePath,
        activeNoun,
        mruSymbolIds,
        frecencyRecords
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

    const cleanQ = query.trim().toLowerCase();
    const adaptiveBoostMap: Record<string, number> = {};
    const queryAdaptive = adaptiveClicks[cleanQ];
    if (queryAdaptive) {
      const curNow = Date.now();
      for (const [sId, rec] of Object.entries(queryAdaptive)) {
        adaptiveBoostMap[sId] = calculateAdaptiveBoost(rec.count, rec.lastUsed, curNow);
      }
    }

    const dynamicRankingContext: SearchRankingContext = {
      ...rankingContext,
      frecencyBonusMap,
      adaptiveBoostMap
    };

    const results = searchUniversalSymbols(index, query, 120, dynamicRankingContext);

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

    for (const res of results) {
      const sym = res.symbol;
      items.push({
        label: formatSymbolLabel(sym),
        description: formatSymbolDescription(sym, res, explainRanking),
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

    if (event.button.tooltip?.startsWith('Location:')) {
      const loc = formatSymbolTooltip(sym);
      if (loc) {
        await vscode.env.clipboard.writeText(loc);
        vscode.window.showInformationMessage(`Copied to clipboard: ${loc}`);
      }
      return;
    }

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
        void recordSymbolAccess(targetHandler.id, context, allSymbolIds);
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

    // Track MRU and Persistent Frecency
    mruSymbolIds = [sym.id, ...mruSymbolIds.filter(id => id !== sym.id)].slice(0, 50);
    void recordSymbolAccess(sym.id, context, allSymbolIds);

    // Track Local Adaptive Click
    void recordAdaptiveClick(quickPick.value, sym.id, context);

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
  const defaultFlowTitle = 'DotNav: Trace CQRS Flow (Command ➔ Handler ➔ Event ➔ Listener)';
  let currentFlowTitle = defaultFlowTitle;
  quickPick.title = defaultFlowTitle;
  quickPick.placeholder = 'Search CQRS pipelines by name (e.g. AddAppField, CopyFunction, AppFieldDeleted)...';
  quickPick.matchOnDescription = false;
  quickPick.matchOnDetail = false;

  quickPick.onDidChangeActive(activeItems => {
    const item = activeItems[0];
    if (item?.symbol) {
      const loc = formatSymbolTooltip(item.symbol);
      if (loc) {
        quickPick.title = `DotNav: CQRS Flow ➔ ${compactFilePath(loc, 50)}`;
        return;
      }
    }
    quickPick.title = currentFlowTitle;
  });

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

    currentFlowTitle = `DotNav: CQRS Flow ➔ [${flow.rootNoun}] (${flow.nodes.length} components connected)`;
    quickPick.title = currentFlowTitle;

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

      const nodeButtons: vscode.QuickInputButton[] = [];
      if (node.symbol) {
        const loc = formatSymbolTooltip(node.symbol);
        if (loc) {
          nodeButtons.push({
            iconPath: new vscode.ThemeIcon('go-to-file'),
            tooltip: `Location: ${loc} (Click to copy)`
          });
        }
      }
      nodeButtons.push({
        iconPath: new vscode.ThemeIcon('ellipsis'),
        tooltip: 'More Actions (Ctrl+Enter)'
      });

      items.push({
        label: node.label,
        detail: node.detail,
        alwaysShow: true,
        symbol: node.symbol,
        buttons: nodeButtons
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

    if (event.button.tooltip?.startsWith('Location:')) {
      const loc = formatSymbolTooltip(sym);
      if (loc) {
        await vscode.env.clipboard.writeText(loc);
        vscode.window.showInformationMessage(`Copied to clipboard: ${loc}`);
      }
      return;
    }

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
