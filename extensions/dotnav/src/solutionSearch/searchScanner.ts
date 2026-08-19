import * as fs from 'fs';
import * as path from 'path';
import { SearchFilterMode, SearchIndexSnapshot, UniversalSymbol, UniversalSymbolKind } from './searchModel';
import { parseEndpointsFromCSharp } from '../endpoints/endpointScanner';

const CSHARP_RESERVED_KEYWORDS = new Set([
  'if', 'else', 'for', 'foreach', 'while', 'switch', 'using', 'catch', 'lock', 'fixed',
  'nameof', 'typeof', 'sizeof', 'default', 'new', 'return', 'throw', 'await', 'async',
  'get', 'set', 'init', 'add', 'remove', 'value', 'var', 'class', 'struct', 'record',
  'interface', 'enum', 'delegate', 'namespace', 'public', 'private', 'protected', 'internal'
]);

const stringPool = new Map<string, string>();
export function internString(str: string | undefined): string | undefined {
  if (!str) return str;
  const existing = stringPool.get(str);
  if (existing !== undefined) return existing;
  if (stringPool.size < 60000) {
    stringPool.set(str, str);
  }
  return str;
}

export function extractIndexTokens(symbol: UniversalSymbol): string[] {
  const tokens = new Set<string>();
  const originalBareName = symbol.name.split('(')[0].trim();
  const bareLower = originalBareName.toLowerCase();
  if (bareLower) {
    tokens.add(bareLower);
    if (bareLower.length >= 2) {
      tokens.add(bareLower.slice(0, 2));
      tokens.add(bareLower.slice(0, 3));
    }
  }

  // CamelCase word segments (e.g. UpdateRecordFieldValueAsync -> update, record, field, value, async)
  const segments = originalBareName.split(/(?<=[a-z])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])|[-_\s/.:]+/).filter(Boolean);
  for (const seg of segments) {
    const segLower = seg.toLowerCase();
    if (segLower.length >= 2) {
      tokens.add(segLower);
      tokens.add(segLower.slice(0, 2));
    }
  }

  // Acronym and acronym prefixes (e.g. CIVC, URFA, CI, CIV)
  const uppercase = originalBareName.replace(/[^A-Z]/g, '').toLowerCase();
  if (uppercase.length >= 2) {
    for (let l = 2; l <= uppercase.length; l++) {
      tokens.add(uppercase.slice(0, l));
    }
  }

  // Container name and segments
  if (symbol.containerName) {
    const cLower = symbol.containerName.toLowerCase();
    tokens.add(cLower);
    if (cLower.length >= 2) tokens.add(cLower.slice(0, 2));
    const cSegments = symbol.containerName.split(/(?<=[a-z])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])|[-_\s/.:]+/).filter(Boolean);
    for (const cSeg of cSegments) {
      const cSegLower = cSeg.toLowerCase();
      if (cSegLower.length >= 2) {
        tokens.add(cSegLower);
        tokens.add(cSegLower.slice(0, 2));
      }
    }
  }

  // BaseType / Return Type metadata and segments (e.g. RecordAppearanceLayoutType)
  const typeMeta = symbol.metadata?.baseType || symbol.metadata?.returnType;
  if (typeMeta) {
    const baseTokens = typeMeta.split(/<|>|\s|,|\[|\]|:/).filter(Boolean);
    for (const b of baseTokens) {
      const bLower = b.toLowerCase();
      if (bLower.length >= 2) {
        tokens.add(bLower);
        tokens.add(bLower.slice(0, 2));
      }
      const bSegs = b.split(/(?<=[a-z])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])|[-_\s/.:]+/).filter(Boolean);
      for (const bs of bSegs) {
        const bsLower = bs.toLowerCase();
        if (bsLower.length >= 2) {
          tokens.add(bsLower);
          tokens.add(bsLower.slice(0, 2));
        }
      }
    }
  }

  // Endpoint route template tokens
  if (symbol.metadata?.routeTemplate) {
    const routeSegments = symbol.metadata.routeTemplate.toLowerCase().split(/[\/\\{}:]+/).filter(Boolean);
    for (const rSeg of routeSegments) {
      if (rSeg.length >= 2) {
        tokens.add(rSeg);
        tokens.add(rSeg.slice(0, 2));
      }
    }
  }

  return Array.from(tokens);
}

export function isIgnoredSearchFile(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, '/');
  if (/\/(bin|obj|node_modules|\.vs|\.git|\.idea)\//i.test(normalized)) {
    return true;
  }
  const base = path.basename(filePath);
  if (/\.(g|Designer|generated)\.cs$/i.test(base)) {
    return true;
  }
  return false;
}

export function parseSymbolsFromCSharp(
  code: string,
  filePath: string,
  projectName: string,
  relativePath: string
): UniversalSymbol[] {
  const symbols: UniversalSymbol[] = [];

  // 1. Parse ASP.NET Core Endpoints (Controllers & Minimal APIs)
  const endpoints = parseEndpointsFromCSharp(code, filePath, projectName, relativePath);
  for (const ep of endpoints) {
    symbols.push({
      id: `${ep.filePath}:${ep.line}:${ep.httpMethod}:${ep.routeTemplate}`,
      name: `${ep.httpMethod} /${ep.routeTemplate.replace(/^\/+/, '')}`,
      kind: 'endpoint',
      filePath: ep.filePath,
      relativePath: ep.relativePath,
      projectName: ep.projectName,
      line: ep.line,
      column: 1,
      containerName: ep.controllerName,
      metadata: {
        httpMethod: ep.httpMethod,
        routeTemplate: ep.routeTemplate,
        controllerName: ep.controllerName,
        actionName: ep.actionName
      }
    });
  }

  // Fast-path heuristic: If file doesn't have class/interface/record/enum/struct declarations, skip
  if (
    !code.includes('class') &&
    !code.includes('interface') &&
    !code.includes('record') &&
    !code.includes('enum') &&
    !code.includes('struct')
  ) {
    return symbols;
  }

  const lines = code.split(/\r?\n/);

  // 2. Parse EF Core DbSets
  const dbSetRegex = /public\s+(?:virtual\s+)?DbSet<([a-zA-Z0-9_]+)>\s+([a-zA-Z0-9_]+)\s*\{\s*get;\s*set;\s*\}(?:\s*=\s*[^;]+;)?/g;
  let dbSetMatch: RegExpExecArray | null;
  while ((dbSetMatch = dbSetRegex.exec(code)) !== null) {
    const entityType = dbSetMatch[1];
    const propertyName = dbSetMatch[2];
    const lineIndex = code.substring(0, dbSetMatch.index).split(/\r?\n/).length;

    symbols.push({
      id: `${filePath}:${lineIndex}:dbset:${propertyName}`,
      name: `DbSet<${entityType}> ${propertyName}`,
      kind: 'ef_dbset',
      filePath,
      relativePath,
      projectName,
      line: lineIndex,
      column: 1,
      metadata: {
        baseType: entityType
      }
    });
  }

  // 3. Parse Types & CQRS & Domain Patterns
  const typeRegex = /^\s*(?:\[[^\]]+\]\s*)*(?:public|internal|protected|private)?\s*(?:static|abstract|sealed|partial)*\s*(class|interface|record|enum|struct)\s+([a-zA-Z0-9_]+)(?:<[^>]+>)?(?:\s*\([^)]*\))?(?:\s*:\s*([^{;\r\n]+))?/gm;
  let typeMatch: RegExpExecArray | null;

  while ((typeMatch = typeRegex.exec(code)) !== null) {
    const typeKeyword = typeMatch[1]; // class, interface, record, enum, struct
    const typeName = typeMatch[2];
    const inheritanceList = typeMatch[3] ? typeMatch[3].trim() : '';
    const lineIndex = code.substring(0, typeMatch.index).split(/\r?\n/).length;

    let kind: UniversalSymbolKind = 'class';
    if (typeKeyword === 'interface') {
      kind = 'interface';
    } else if (typeKeyword === 'record') {
      kind = 'record';
    } else if (typeKeyword === 'enum') {
      kind = 'enum';
    }

    // CQRS, EF Core & Domain classifications
    if (inheritanceList) {
      if (/\bMigration\b/.test(inheritanceList)) {
        kind = 'ef_migration';
      } else if (/\bIRequestHandler\b/.test(inheritanceList)) {
        kind = 'cqrs_handler';
      } else if (/\b(IRequest|ICommand)\b/.test(inheritanceList) && !typeName.endsWith('Query')) {
        kind = 'cqrs_command';
      } else if (/\b(IRequest|IQuery)\b/.test(inheritanceList) || typeName.endsWith('Query')) {
        kind = 'cqrs_query';
      } else if (/\b(INotification|IDomainEvent)\b/.test(inheritanceList)) {
        kind = 'cqrs_event';
      } else if (
        /\b(IEntityTypeConfiguration|TenantEntity|BaseEntity|AuditableEntity|AggregateRoot|DbContext|AuditlogDBContext)\b/.test(
          inheritanceList
        )
      ) {
        kind = 'ef_entity';
      } else if (/\b(BackgroundService|IHostedService|IJob)\b/.test(inheritanceList)) {
        kind = 'cqrs_event';
      }
    } else {
      if (typeName.endsWith('Command') && !typeName.endsWith('CommandHandler')) {
        kind = 'cqrs_command';
      } else if (typeName.endsWith('CommandHandler') || typeName.endsWith('Handler')) {
        kind = 'cqrs_handler';
      } else if (typeName.endsWith('Query') && !typeName.endsWith('QueryHandler')) {
        kind = 'cqrs_query';
      } else if (
        typeName.endsWith('Entity') ||
        relativePath.includes('/Entities/') ||
        relativePath.includes('/Domain/Entities/')
      ) {
        kind = 'ef_entity';
      }
    }

    // Ignore Controller classes from types list if already parsed as endpoints
    if (typeName.endsWith('Controller') && kind === 'class') {
      // Still include Controller as a Class symbol so user can search by class name
    }

    symbols.push({
      id: `${filePath}:${lineIndex}:${kind}:${typeName}`,
      name: typeName,
      kind,
      filePath,
      relativePath,
      projectName,
      line: lineIndex,
      column: 1,
      metadata: {
        baseType: inheritanceList || undefined
      }
    });

    // 4. If Enum, parse enum values
    if (typeKeyword === 'enum') {
      const enumBodyStartIndex = typeMatch.index + typeMatch[0].length;
      const openBrace = code.indexOf('{', enumBodyStartIndex);
      if (openBrace !== -1) {
        const closeBrace = code.indexOf('}', openBrace);
        if (closeBrace !== -1) {
          const enumBody = code.substring(openBrace + 1, closeBrace);
          const enumLines = enumBody.split(/\r?\n/);
          let currentEnumLine = code.substring(0, openBrace).split(/\r?\n/).length;

          for (const rawLine of enumLines) {
            currentEnumLine++;
            const trimmed = rawLine.replace(/\/\/.*$/, '').trim();
            if (!trimmed || trimmed.startsWith('[')) continue;
            const lineMembers = trimmed.split(',');
            for (const item of lineMembers) {
              const itemTrimmed = item.trim();
              if (!itemTrimmed || itemTrimmed.startsWith('[')) continue;
              const memberMatch = /^([a-zA-Z0-9_]+)/.exec(itemTrimmed);
              if (memberMatch && memberMatch[1] && memberMatch[1] !== typeName) {
                const memberName = memberMatch[1];
                symbols.push({
                  id: `${filePath}:${currentEnumLine}:enum_member:${typeName}.${memberName}`,
                  name: `${typeName}.${memberName}`,
                  kind: 'enum_member',
                  filePath,
                  relativePath,
                  projectName,
                  line: currentEnumLine,
                  column: 1,
                  containerName: typeName
                });
              }
            }
          }
        }
      }
    }
  }

  // 5. Parse Methods (public, private, protected, internal, static, async, virtual)
  const methodRegex = /^\s*(?:\[[^\]]+\]\s*)*(?:(?:public|private|protected|internal|static|async|virtual|override|sealed|new|readonly|unsafe)\s+)+([a-zA-Z0-9_<>?,.\[\]\(\)\s*]+?)\s+([a-zA-Z0-9_]+)\s*(?:<[^>]+>)?\s*\(([\s\S]*?)\)\s*(?:where[^{;=>]+)?\s*(?:\{|=>|;)/gm;
  let methodMatch: RegExpExecArray | null;

  while ((methodMatch = methodRegex.exec(code)) !== null) {
    const returnType = methodMatch[1].trim();
    const methodName = methodMatch[2].trim();
    const params = methodMatch[3].trim();
    const lineIndex = code.substring(0, methodMatch.index).split(/\r?\n/).length;

    // Filter out language keywords and boilerplate
    if (CSHARP_RESERVED_KEYWORDS.has(methodName) || CSHARP_RESERVED_KEYWORDS.has(returnType)) {
      continue;
    }
    if (
      methodName === 'ToString' ||
      methodName === 'Dispose' ||
      methodName === 'GetHashCode' ||
      methodName === 'Equals' ||
      methodName.startsWith('get_') ||
      methodName.startsWith('set_')
    ) {
      continue;
    }

    symbols.push({
      id: `${filePath}:${lineIndex}:method:${methodName}`,
      name: `${methodName}(${params.split(',').length > 1 ? '...' : (params.length > 25 ? '...' : params)})`,
      kind: internString('method') as UniversalSymbolKind,
      filePath,
      relativePath,
      projectName: internString(projectName)!,
      line: lineIndex,
      column: 1,
      metadata: {
        returnType: internString(returnType),
        parameterSummary: params.replace(/\s+/g, ' ').trim()
      }
    });
  }

  // 6. Parse Properties (public, internal, protected)
  const propRegex = /^\s*(?:\[[^\]]+\]\s*)*(?:public|internal|protected)\s+(?:virtual|override|static|sealed|readonly|new)*\s*([a-zA-Z0-9_<>?,.\[\]]+)\s+([a-zA-Z0-9_]+)\s*\{\s*(?:get|set|init)/gm;
  let propMatch: RegExpExecArray | null;

  while ((propMatch = propRegex.exec(code)) !== null) {
    const propType = propMatch[1].trim();
    const propName = propMatch[2].trim();
    const lineIndex = code.substring(0, propMatch.index).split(/\r?\n/).length;

    if (CSHARP_RESERVED_KEYWORDS.has(propName) || CSHARP_RESERVED_KEYWORDS.has(propType)) {
      continue;
    }
    if (propType === 'DbSet' || propType.startsWith('DbSet<')) {
      continue; // already captured as ef_dbset
    }

    symbols.push({
      id: `${filePath}:${lineIndex}:property:${propName}`,
      name: `${propName} : ${propType}`,
      kind: internString('property') as UniversalSymbolKind,
      filePath,
      relativePath,
      projectName: internString(projectName)!,
      line: lineIndex,
      column: 1,
      metadata: {
        returnType: internString(propType)
      }
    });
  }

  return symbols;
}

export function parseSymbolsFromAppSettings(
  content: string,
  filePath: string,
  projectName: string,
  relativePath: string
): UniversalSymbol[] {
  const symbols: UniversalSymbol[] = [];
  try {
    const parsed = JSON.parse(content);
    const internedProj = internString(projectName)!;
    const flatten = (obj: Record<string, any>, prefix = '', lineTracker = 1) => {
      for (const [key, val] of Object.entries(obj)) {
        const fullKey = prefix ? `${prefix}:${key}` : key;
        if (val !== null && typeof val === 'object' && !Array.isArray(val)) {
          flatten(val, fullKey, lineTracker);
        } else {
          symbols.push({
            id: `${filePath}:${fullKey}`,
            name: fullKey,
            kind: 'config_key',
            filePath,
            relativePath,
            projectName: internedProj,
            line: lineTracker,
            column: 1,
            metadata: {
              configValue: typeof val === 'string' ? val : JSON.stringify(val)
            }
          });
        }
      }
    };
    if (parsed && typeof parsed === 'object') {
      flatten(parsed);
    }
  } catch {
    // Ignore malformed json
  }
  return symbols;
}

export class UniversalSymbolIndex {
  private readonly fileCache = new Map<string, UniversalSymbol[]>();
  private readonly fileTimestamps = new Map<string, number>();
  private readonly kindBuckets = new Map<UniversalSymbolKind, Set<UniversalSymbol>>();
  private readonly tokenBuckets = new Map<string, Set<UniversalSymbol>>();
  private readonly projectBuckets = new Map<string, Set<UniversalSymbol>>();
  private cachedAllSymbols: UniversalSymbol[] | undefined = undefined;
  private _isFullScanCompleted: boolean = false;

  public get isFullScanCompleted(): boolean {
    return this._isFullScanCompleted;
  }

  public markFullScanCompleted(): void {
    this._isFullScanCompleted = true;
  }

  public getFileTimestamp(filePath: string): number | undefined {
    return this.fileTimestamps.get(filePath);
  }

  public exportSnapshot(): SearchIndexSnapshot {
    const symbolsByFile: Record<string, UniversalSymbol[]> = {};
    const fileTimestamps: Record<string, number> = {};
    for (const [filePath, symbols] of this.fileCache.entries()) {
      symbolsByFile[filePath] = symbols;
      const mtime = this.fileTimestamps.get(filePath) || 0;
      if (mtime > 0) {
        fileTimestamps[filePath] = mtime;
      }
    }
    return {
      version: 1,
      timestamp: Date.now(),
      fileTimestamps,
      symbolsByFile
    };
  }

  public loadSnapshot(snapshot: SearchIndexSnapshot): void {
    this.clear();
    if (!snapshot || !snapshot.symbolsByFile) return;
    for (const [filePath, symbols] of Object.entries(snapshot.symbolsByFile)) {
      this.fileCache.set(filePath, symbols);
      const mtime = snapshot.fileTimestamps?.[filePath] || 0;
      if (mtime > 0) {
        this.fileTimestamps.set(filePath, mtime);
      }
      for (const s of symbols) {
        this.addSymbolToBuckets(s);
      }
    }
    this._isFullScanCompleted = true;
  }

  public addSymbolToBuckets(sym: UniversalSymbol): void {
    // Kind bucket
    let kb = this.kindBuckets.get(sym.kind);
    if (!kb) {
      kb = new Set<UniversalSymbol>();
      this.kindBuckets.set(sym.kind, kb);
    }
    kb.add(sym);

    // Project bucket
    const projLower = sym.projectName.toLowerCase();
    let pb = this.projectBuckets.get(projLower);
    if (!pb) {
      pb = new Set<UniversalSymbol>();
      this.projectBuckets.set(projLower, pb);
    }
    pb.add(sym);

    // Token buckets
    const tokens = extractIndexTokens(sym);
    for (const tok of tokens) {
      let tb = this.tokenBuckets.get(tok);
      if (!tb) {
        tb = new Set<UniversalSymbol>();
        this.tokenBuckets.set(tok, tb);
      }
      tb.add(sym);
    }
  }

  private removeSymbolFromBuckets(sym: UniversalSymbol): void {
    const kb = this.kindBuckets.get(sym.kind);
    if (kb) kb.delete(sym);

    const pb = this.projectBuckets.get(sym.projectName.toLowerCase());
    if (pb) pb.delete(sym);

    const tokens = extractIndexTokens(sym);
    for (const tok of tokens) {
      const tb = this.tokenBuckets.get(tok);
      if (tb) tb.delete(sym);
    }
  }

  public scanFileContent(
    filePath: string,
    content: string,
    projectName: string,
    relativePath: string,
    mtime?: number
  ): UniversalSymbol[] {
    const oldSymbols = this.fileCache.get(filePath);
    if (oldSymbols) {
      for (const s of oldSymbols) {
        this.removeSymbolFromBuckets(s);
      }
    }

    if (mtime !== undefined && mtime > 0) {
      this.fileTimestamps.set(filePath, mtime);
    }

    let symbols: UniversalSymbol[] = [];
    if (filePath.endsWith('.cs')) {
      symbols = parseSymbolsFromCSharp(content, filePath, projectName, relativePath);
    } else if (path.basename(filePath).startsWith('appsettings') && filePath.endsWith('.json')) {
      symbols = parseSymbolsFromAppSettings(content, filePath, projectName, relativePath);
    } else if (filePath.endsWith('.csproj')) {
      const projName = internString(path.basename(filePath, '.csproj'))!;
      symbols = [
        {
          id: `${filePath}:project:${projName}`,
          name: `${projName}.csproj`,
          kind: 'project',
          filePath,
          relativePath,
          projectName: projName,
          line: 1,
          column: 1
        }
      ];
    }

    for (const s of symbols) {
      this.addSymbolToBuckets(s);
    }

    this.fileCache.set(filePath, symbols);
    this.cachedAllSymbols = undefined;
    return symbols;
  }

  public async scanFile(filePath: string, projectName: string, relativePath: string): Promise<UniversalSymbol[]> {
    try {
      if (isIgnoredSearchFile(filePath) || !fs.existsSync(filePath)) {
        this.invalidateFile(filePath);
        return [];
      }
      const stat = await fs.promises.stat(filePath);
      const content = await fs.promises.readFile(filePath, 'utf8');
      return this.scanFileContent(filePath, content, projectName, relativePath, stat.mtimeMs);
    } catch {
      this.invalidateFile(filePath);
      return [];
    }
  }

  public invalidateFile(filePath: string): void {
    const old = this.fileCache.get(filePath);
    if (old) {
      for (const s of old) {
        this.removeSymbolFromBuckets(s);
      }
      this.fileCache.delete(filePath);
      this.fileTimestamps.delete(filePath);
      this.cachedAllSymbols = undefined;
    }
  }

  public clear(): void {
    this.fileCache.clear();
    this.fileTimestamps.clear();
    this.kindBuckets.clear();
    this.tokenBuckets.clear();
    this.projectBuckets.clear();
    this.cachedAllSymbols = undefined;
    this._isFullScanCompleted = false;
  }

  public hasFile(filePath: string): boolean {
    return this.fileCache.has(filePath);
  }

  public get fileCount(): number {
    return this.fileCache.size;
  }

  public getAllSymbols(): UniversalSymbol[] {
    if (this.cachedAllSymbols === undefined) {
      const all: UniversalSymbol[] = [];
      for (const list of this.fileCache.values()) {
        all.push(...list);
      }
      this.cachedAllSymbols = all;
    }
    return this.cachedAllSymbols;
  }

  public getSymbolsForMode(mode: SearchFilterMode): UniversalSymbol[] {
    switch (mode) {
      case 'endpoints':
        return Array.from(this.kindBuckets.get('endpoint') || []);
      case 'cqrs':
        return [
          ...Array.from(this.kindBuckets.get('cqrs_command') || []),
          ...Array.from(this.kindBuckets.get('cqrs_query') || []),
          ...Array.from(this.kindBuckets.get('cqrs_handler') || []),
          ...Array.from(this.kindBuckets.get('cqrs_event') || [])
        ];
      case 'database':
        return [
          ...Array.from(this.kindBuckets.get('ef_entity') || []),
          ...Array.from(this.kindBuckets.get('ef_dbset') || []),
          ...Array.from(this.kindBuckets.get('ef_migration') || [])
        ];
      case 'types':
        return [
          ...Array.from(this.kindBuckets.get('class') || []),
          ...Array.from(this.kindBuckets.get('interface') || []),
          ...Array.from(this.kindBuckets.get('record') || []),
          ...Array.from(this.kindBuckets.get('enum') || []),
          ...Array.from(this.kindBuckets.get('enum_member') || [])
        ];
      case 'methods':
        return [
          ...Array.from(this.kindBuckets.get('method') || []),
          ...Array.from(this.kindBuckets.get('property') || [])
        ];
      case 'files':
        return [
          ...Array.from(this.kindBuckets.get('file') || []),
          ...Array.from(this.kindBuckets.get('project') || []),
          ...Array.from(this.kindBuckets.get('config_key') || [])
        ];
      default:
        return this.getAllSymbols();
    }
  }

  public getCandidates(
    filterMode: SearchFilterMode,
    tokens: string[],
    projectNameFilter?: string
  ): UniversalSymbol[] {
    const all = this.getAllSymbols();
    if (all.length <= 200) {
      return all;
    }

    let pool: UniversalSymbol[] | undefined;
    if (filterMode && filterMode !== 'all') {
      pool = this.getSymbolsForMode(filterMode);
    }

    if (tokens.length === 0) {
      if (projectNameFilter) {
        const projList = Array.from(this.projectBuckets.get(projectNameFilter) || []);
        if (pool) {
          const poolSet = new Set(pool);
          return projList.filter(s => poolSet.has(s));
        }
        return projList;
      }
      return pool || all;
    }

    const candidateSet = new Set<UniversalSymbol>();
    const rawQuery = tokens.join(' ');
    const rawQueryLower = rawQuery.toLowerCase();

    // 1. Direct token bucket match
    const direct = this.tokenBuckets.get(rawQueryLower);
    if (direct) {
      for (const s of direct) candidateSet.add(s);
    }

    // 2. Query word segments & 2-char prefix buckets
    const segments = rawQuery.split(/(?<=[a-z])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])|[-_\s/.:]+/).filter(Boolean);
    for (const seg of segments) {
      const segLower = seg.toLowerCase();
      const segBucket = this.tokenBuckets.get(segLower);
      if (segBucket) {
        for (const s of segBucket) candidateSet.add(s);
      }
      if (segLower.length >= 2) {
        const p2 = segLower.slice(0, 2);
        const p2Bucket = this.tokenBuckets.get(p2);
        if (p2Bucket) {
          for (const s of p2Bucket) candidateSet.add(s);
        }
      }
    }

    // 3. Acronym bucket match
    const uppercase = rawQuery.replace(/[^A-Z]/g, '').toLowerCase();
    if (uppercase.length >= 2) {
      const acBucket = this.tokenBuckets.get(uppercase);
      if (acBucket) {
        for (const s of acBucket) candidateSet.add(s);
      }
    }

    if (candidateSet.size === 0) {
      return pool || all;
    }

    let candidates = Array.from(candidateSet);
    if (pool) {
      const poolSet = new Set(pool);
      candidates = candidates.filter(s => poolSet.has(s));
    }

    if (projectNameFilter) {
      candidates = candidates.filter(s => s.projectName.toLowerCase().includes(projectNameFilter));
    }

    return candidates;
  }

  public get count(): number {
    let sum = 0;
    for (const list of this.fileCache.values()) {
      sum += list.length;
    }
    return sum;
  }
}
