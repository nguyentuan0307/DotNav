import * as path from 'path';

export type UniversalSymbolKind =
  | 'endpoint'
  | 'cqrs_command'
  | 'cqrs_query'
  | 'cqrs_handler'
  | 'cqrs_event'
  | 'ef_entity'
  | 'ef_dbset'
  | 'ef_migration'
  | 'db_table'
  | 'di_registration'
  | 'background_job'
  | 'mapping_profile'
  | 'validation_rule'
  | 'class'
  | 'interface'
  | 'record'
  | 'enum'
  | 'enum_member'
  | 'method'
  | 'property'
  | 'config_key'
  | 'error_message'
  | 'localization_resource'
  | 'project'
  | 'file';

export type SearchFilterMode =
  | 'all'
  | 'endpoints'
  | 'cqrs'
  | 'database'
  | 'types'
  | 'methods'
  | 'di'
  | 'jobs'
  | 'files';

export interface UniversalSymbol {
  readonly id: string;
  readonly name: string;
  readonly kind: UniversalSymbolKind;
  readonly filePath: string;
  readonly relativePath: string;
  readonly projectName: string;
  readonly line: number;
  readonly column: number;
  readonly containerName?: string;
  readonly metadata?: {
    readonly httpMethod?: string;
    readonly routeTemplate?: string;
    readonly controllerName?: string;
    readonly actionName?: string;
    readonly returnType?: string;
    readonly baseType?: string;
    readonly parameterSummary?: string;
    readonly configValue?: string;
    readonly docSummary?: string;
    readonly handledType?: string;
    readonly emittedEvents?: readonly string[];
    readonly injectedParams?: readonly string[];
    readonly sqlTable?: string;
  };
}

export interface CqrsFlowNode {
  readonly category: string;
  readonly icon: string;
  readonly symbol: UniversalSymbol;
  readonly label: string;
  readonly detail: string;
}

export interface CqrsFlowResult {
  readonly rootNoun: string;
  readonly nodes: readonly CqrsFlowNode[];
}

export interface UniversalSearchResult {
  readonly symbol: UniversalSymbol;
  readonly score: number;
  readonly matchReason: string;
}

export interface ParsedSearchQuery {
  readonly rawQuery: string;
  readonly filterMode: SearchFilterMode;
  readonly cleanQuery: string;
  readonly tokens: string[];
  readonly explicitHttpMethod?: string;
  readonly projectNameFilter?: string;
  readonly targetLine?: number;
  readonly targetColumn?: number;
  readonly isRouteQuery?: boolean;
}

export interface SearchRankingContext {
  readonly activeProjectName?: string;
  readonly activeFilePath?: string;
  readonly activeFileDir?: string;
  readonly activeNoun?: string;
  readonly gitModifiedPaths?: readonly string[];
  readonly mruSymbolIds?: readonly string[];
  readonly frecencyBonusMap?: Readonly<Record<string, number>>;
  readonly adaptiveBoostMap?: Readonly<Record<string, number>>;
}

export interface FrecencyRecord {
  readonly symbolId: string;
  readonly count: number;
  readonly lastAccessedAt: number;
}

export interface AdaptiveQueryRecord {
  readonly count: number;
  readonly lastUsed: number;
}

export interface AdaptiveQueryMap {
  readonly [queryKey: string]: Record<string, AdaptiveQueryRecord>;
}

export interface CompactDiskSymbol {
  n: string; // name
  k: UniversalSymbolKind; // kind
  f: string; // filePath
  r: string; // relativePath
  p: string; // projectName
  l: number; // line
  c: number; // column
  rt?: string; // returnType / baseType
  ps?: string; // parameterSummary / configValue
}

export interface SearchIndexSnapshot {
  readonly version: number;
  readonly timestamp: number;
  readonly fileTimestamps: Record<string, number>;
  readonly symbolsByFile: Record<string, UniversalSymbol[]>;
  readonly coldSymbolsByFile?: Record<string, CompactDiskSymbol[]>;
}

export function compactDirectoryPath(filePath: string): string {
  if (!filePath) return '.';
  const normalized = filePath.replace(/\\/g, '/');
  const dir = path.dirname(normalized);
  if (dir === '.' || !dir) {
    return '.';
  }
  const parts = dir.split('/').filter(Boolean);
  if (parts.length <= 2) {
    return parts.join('/');
  }
  return `.../${parts.slice(-2).join('/')}`;
}

export function formatSymbolDescription(
  symbol: UniversalSymbol,
  searchResult?: UniversalSearchResult,
  explainRanking = false
): string {
  const fileName = symbol.relativePath
    ? path.basename(symbol.relativePath)
    : path.basename(symbol.filePath || '');
  const location = fileName && symbol.line > 0 ? `${fileName}:${symbol.line}` : fileName;

  let baseDesc = '';
  if (symbol.kind === 'file') {
    baseDesc = `$(project) ${symbol.projectName}`;
  } else {
    baseDesc = location;
  }

  if (explainRanking && searchResult) {
    return `[Score: ${searchResult.score} | ${searchResult.matchReason}] • ${baseDesc}`;
  }

  return baseDesc;
}

export function formatSymbolDetail(symbol: UniversalSymbol): string {
  const compactDir = compactDirectoryPath(symbol.relativePath || symbol.filePath);
  const dirInfo = compactDir === '.' ? '' : `$(folder) ${compactDir} • `;
  const projInfo = `$(project) ${symbol.projectName}`;
  const baseNameWithoutExt = path.basename(symbol.filePath || symbol.relativePath || '', '.cs');
  const container =
    symbol.containerName && symbol.containerName !== baseNameWithoutExt
      ? ` • Container: ${symbol.containerName}`
      : '';
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

  return `${dirInfo}${projInfo}${container}${baseType}${handled}${emits}${injected}${sqlTable}${configVal}`;
}


