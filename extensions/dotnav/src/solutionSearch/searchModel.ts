export type UniversalSymbolKind =
  | 'endpoint'
  | 'cqrs_command'
  | 'cqrs_query'
  | 'cqrs_handler'
  | 'cqrs_event'
  | 'ef_entity'
  | 'ef_dbset'
  | 'ef_migration'
  | 'class'
  | 'interface'
  | 'record'
  | 'enum'
  | 'enum_member'
  | 'method'
  | 'property'
  | 'config_key'
  | 'project'
  | 'file';

export type SearchFilterMode =
  | 'all'
  | 'endpoints'
  | 'cqrs'
  | 'database'
  | 'types'
  | 'methods'
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
  };
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
}
