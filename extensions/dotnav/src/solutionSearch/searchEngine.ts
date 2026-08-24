import {
  ParsedSearchQuery,
  SearchFilterMode,
  UniversalSearchResult,
  UniversalSymbol,
  UniversalSymbolKind
} from './searchModel';
import { stripAccents } from './searchScanner';

export function isNearMatch(a: string, b: string): boolean {
  const al = a.length;
  const bl = b.length;
  if (Math.abs(al - bl) > 1) return false;
  if (al < 4 || bl < 4) return false;

  // Check 1-char substitution or adjacent transposition
  if (al === bl) {
    let diffs = 0;
    for (let i = 0; i < al; i++) {
      if (a[i] !== b[i]) {
        diffs++;
        if (diffs > 2) return false;
        if (diffs === 1 && i < al - 1 && a[i] === b[i + 1] && a[i + 1] === b[i]) {
          i++; // skip transposed char
        }
      }
    }
    return diffs <= 2;
  }

  // 1 insertion / deletion check
  const longer = al > bl ? a : b;
  const shorter = al > bl ? b : a;
  let i = 0;
  let j = 0;
  let diffs = 0;
  while (i < longer.length && j < shorter.length) {
    if (longer[i] === shorter[j]) {
      i++;
      j++;
    } else {
      diffs++;
      if (diffs > 1) return false;
      i++;
    }
  }
  return true;
}

export function isCamelCaseAcronymMatch(token: string, text: string): boolean {
  if (!token || !text) return false;
  // Extract uppercase letters from CamelCase (e.g. CreateInterfaceViewCommand -> CIVC)
  const uppercaseLetters = text.replace(/[^A-Z]/g, '').toLowerCase();
  const tokenLower = token.toLowerCase();

  if (uppercaseLetters.length >= 2 && uppercaseLetters === tokenLower) {
    return true;
  }
  if (uppercaseLetters.length >= 2 && uppercaseLetters.startsWith(tokenLower) && tokenLower.length >= 2) {
    return true;
  }

  // Extract hyphen / underscore initials
  const words = text.split(/[-_\s/]+/).filter(Boolean);
  if (words.length >= 2) {
    const initials = words.map(w => w[0].toLowerCase()).join('');
    if (initials === tokenLower || (initials.startsWith(tokenLower) && tokenLower.length >= 2)) {
      return true;
    }
  }

  return false;
}

export function parseUniversalSearchQuery(rawQuery: string): ParsedSearchQuery {
  let clean = rawQuery.trim();
  let filterMode: SearchFilterMode = 'all';

  // 1. Check prefixes
  if (clean.startsWith('/') || clean.toLowerCase().startsWith('api:')) {
    filterMode = 'endpoints';
    clean = clean.startsWith('/') ? clean.slice(1) : clean.slice(4);
  } else if (clean.startsWith('$') || clean.toLowerCase().startsWith('cqrs:')) {
    filterMode = 'cqrs';
    clean = clean.startsWith('$') ? clean.slice(1) : clean.slice(5);
  } else if (clean.startsWith('%') || clean.toLowerCase().startsWith('db:') || clean.toLowerCase().startsWith('table:')) {
    filterMode = 'database';
    clean = clean.startsWith('%') ? clean.slice(1) : clean.startsWith('db:') ? clean.slice(3) : clean.slice(6);
  } else if (clean.startsWith('#') || clean.toLowerCase().startsWith('type:')) {
    filterMode = 'types';
    clean = clean.startsWith('#') ? clean.slice(1) : clean.slice(5);
  } else if (clean.startsWith('@') || clean.toLowerCase().startsWith('method:')) {
    filterMode = 'methods';
    clean = clean.startsWith('@') ? clean.slice(1) : clean.slice(7);
  } else if (clean.toLowerCase().startsWith('di:') || clean.toLowerCase().startsWith('inject:')) {
    filterMode = 'di';
    clean = clean.startsWith('di:') ? clean.slice(3) : clean.slice(7);
  } else if (clean.toLowerCase().startsWith('job:')) {
    filterMode = 'jobs';
    clean = clean.slice(4);
  } else if (clean.startsWith('!') || clean.toLowerCase().startsWith('file:')) {
    filterMode = 'files';
    clean = clean.startsWith('!') ? clean.slice(1) : clean.slice(5);
  }

  clean = clean.trim();

  // 2. Extract line jump syntax at the end: e.g. "SubmitFormService:762", "SubmitFormService:762:15", "SubmitFormService@762"
  let targetLine: number | undefined;
  let targetColumn: number | undefined;
  const lineMatch = /(?::(\d+)(?::(\d+))?|@(\d+))$/.exec(clean);
  if (lineMatch) {
    targetLine = parseInt(lineMatch[1] || lineMatch[3], 10);
    targetColumn = lineMatch[2] ? parseInt(lineMatch[2], 10) : 1;
    clean = clean.substring(0, lineMatch.index).trim();
  }

  // 3. Extract explicit HTTP method
  let explicitHttpMethod: string | undefined;
  const methodMatch = /^(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)\s+/i.exec(clean);
  if (methodMatch) {
    explicitHttpMethod = methodMatch[1].toUpperCase();
    clean = clean.substring(methodMatch[0].length).trim();
  }

  // 4. Extract project name filter (e.g. "WebApp: users" or "CustomApp: orders")
  let projectNameFilter: string | undefined;
  const projectMatch = /^([a-zA-Z0-9_.-]+):\s+(.*)$/.exec(clean);
  if (projectMatch && !projectMatch[1].includes('/')) {
    projectNameFilter = projectMatch[1].toLowerCase();
    clean = projectMatch[2].trim();
  }

  // 5. Tokenize
  const rawSegments = clean
    .split(/[\/\\\*\s]+/)
    .map(s => s.trim())
    .filter(Boolean);

  return {
    rawQuery,
    filterMode,
    cleanQuery: clean,
    tokens: rawSegments,
    explicitHttpMethod,
    projectNameFilter,
    targetLine,
    targetColumn
  };
}

export function isKindMatchingMode(kind: UniversalSymbolKind, mode: SearchFilterMode): boolean {
  if (mode === 'all') return true;
  switch (mode) {
    case 'endpoints':
      return kind === 'endpoint';
    case 'cqrs':
      return kind === 'cqrs_command' || kind === 'cqrs_query' || kind === 'cqrs_handler' || kind === 'cqrs_event';
    case 'database':
      return kind === 'ef_entity' || kind === 'ef_dbset' || kind === 'ef_migration' || kind === 'db_table';
    case 'di':
      return kind === 'di_registration';
    case 'jobs':
      return kind === 'background_job';
    case 'types':
      return kind === 'class' || kind === 'interface' || kind === 'record' || kind === 'enum' || kind === 'enum_member';
    case 'methods':
      return kind === 'method' || kind === 'property' || kind === 'validation_rule' || kind === 'mapping_profile';
    case 'files':
      return kind === 'file' || kind === 'project' || kind === 'config_key';
    default:
      return true;
  }
}

export function normalizeRouteTemplate(route: string): string {
  if (!route) return '';
  return route
    .toLowerCase()
    .replace(/^\/+|\/+$/g, '') // Remove leading & trailing slashes
    .replace(/^api\//, '') // Remove optional leading "api/"
    .replace(/\{([a-zA-Z0-9_]+)(?::[^}]+)?\}/g, '{$1}') // Strip all constraints e.g. {appId:int}, {id:regex(...)} -> {appId}
    .trim();
}

export function scoreSymbol(
  symbol: UniversalSymbol,
  query: ParsedSearchQuery,
  rankingContext?: import('./searchModel').SearchRankingContext
): { score: number; matchReason: string } {
  // 1. Filter Mode Guard
  if (!isKindMatchingMode(symbol.kind, query.filterMode)) {
    return { score: 0, matchReason: '' };
  }

  // 2. Project Name Filter Guard
  if (query.projectNameFilter && !symbol.projectName.toLowerCase().includes(query.projectNameFilter)) {
    return { score: 0, matchReason: '' };
  }

  if (query.tokens.length === 0) {
    if (query.explicitHttpMethod && symbol.kind === 'endpoint') {
      if (symbol.metadata?.httpMethod?.toUpperCase() === query.explicitHttpMethod) {
        return { score: 100, matchReason: 'Explicit HTTP method match' };
      }
      return { score: 0, matchReason: '' };
    }
    // If MRU symbol, score based on recency
    if (rankingContext?.mruSymbolIds && rankingContext.mruSymbolIds.length > 0) {
      const mruIdx = rankingContext.mruSymbolIds.indexOf(symbol.id);
      if (mruIdx !== -1) {
        return { score: Math.max(60, 95 - mruIdx), matchReason: 'Recently visited' };
      }
    }
    return { score: 50, matchReason: 'Recent symbol' };
  }

  const symbolNameLower = symbol.name.toLowerCase();
  const originalBareName = symbol.name.split('(')[0].trim();
  const bareSymbolName = originalBareName.toLowerCase();
  const rawQueryLower = query.cleanQuery.toLowerCase();
  const rawQueryUnaccented = stripAccents(rawQueryLower);
  const bareUnaccented = stripAccents(bareSymbolName);
  const nameUnaccented = stripAccents(symbolNameLower);

  const normQueryRoute = normalizeRouteTemplate(rawQueryLower);
  const normSymRoute = symbol.metadata?.routeTemplate ? normalizeRouteTemplate(symbol.metadata.routeTemplate) : '';

  let baseScore = 0;
  let matchReason = '';

  // 3. Exact full match or bare name match or route template match (accent-tolerant)
  if (bareSymbolName === rawQueryLower || symbolNameLower === rawQueryLower || bareUnaccented === rawQueryUnaccented || nameUnaccented === rawQueryUnaccented) {
    baseScore = 100;
    matchReason = 'Exact name match';
  } else if (normSymRoute && normQueryRoute && (normSymRoute === normQueryRoute || stripAccents(normSymRoute) === stripAccents(normQueryRoute))) {
    baseScore = 100;
    matchReason = 'Exact route template match';
  } else if (normSymRoute && normQueryRoute && (normSymRoute.endsWith(normQueryRoute) || normSymRoute.startsWith(normQueryRoute)) && normQueryRoute.length >= 5) {
    baseScore = 98;
    matchReason = 'Route prefix/suffix match';
  } else if ((bareSymbolName.startsWith(rawQueryLower) || bareUnaccented.startsWith(rawQueryUnaccented)) && rawQueryLower.length >= 3) {
    baseScore = 98;
    matchReason = 'Name prefix match';
  } else if ((bareSymbolName.includes(rawQueryLower) || bareUnaccented.includes(rawQueryUnaccented)) && rawQueryLower.length >= 3) {
    baseScore = 95;
    matchReason = 'Name substring match';
  } else if (normSymRoute && normQueryRoute && normSymRoute.includes(normQueryRoute) && normQueryRoute.length >= 5) {
    baseScore = 94;
    matchReason = 'Route substring match';
  }

  // 4. CamelCase Acronym match (e.g. CIVC -> CreateInterfaceViewCommand)
  if (baseScore === 0 && query.cleanQuery.length >= 2) {
    if (isCamelCaseAcronymMatch(query.cleanQuery, originalBareName || symbol.name)) {
      baseScore = 92;
      matchReason = 'CamelCase acronym match';
    }
  }

  // 5. Multi-token / Subsequence / Wildcard Matching
  if (baseScore === 0) {
    const container = symbol.containerName || '';
    const bareContainer = container.replace(/Controller$/i, '');
    const pluralContainer = bareContainer ? (bareContainer.endsWith('s') ? bareContainer : bareContainer + 's') : '';

    const targetText = (
      symbol.name + ' ' +
      (symbol.metadata?.configValue || '') + ' ' +
      (symbol.metadata?.routeTemplate || '') + ' ' +
      (symbol.metadata?.sqlTable || '') + ' ' +
      ((symbol.metadata?.injectedParams || []).join(' ')) + ' ' +
      container + ' ' +
      bareContainer + ' ' +
      pluralContainer + ' ' +
      (symbol.metadata?.actionName || '') + ' ' +
      (symbol.metadata?.baseType || '') + ' ' +
      (symbol.metadata?.returnType || '') + ' ' +
      (symbol.relativePath || '')
    ).toLowerCase();

    const targetUnaccented = stripAccents(targetText);

    let matchedTokens = 0;
    let inOrder = true;
    let lastIndex = -1;

    for (const token of query.tokens) {
      const tokLower = token.toLowerCase();
      const tokUnaccented = stripAccents(tokLower);
      const tokSingular = tokLower.endsWith('s') && tokLower.length > 3 ? tokLower.slice(0, -1) : tokLower;
      const tokSingularUnaccented = stripAccents(tokSingular);

      const idx = targetText.indexOf(tokLower, lastIndex + 1);
      const idxUnaccented = targetUnaccented.indexOf(tokUnaccented, lastIndex + 1);

      if (idx !== -1) {
        matchedTokens++;
        lastIndex = idx;
      } else if (idxUnaccented !== -1) {
        matchedTokens++;
        lastIndex = idxUnaccented;
      } else if (targetText.includes(tokLower) || targetUnaccented.includes(tokUnaccented)) {
        matchedTokens += 0.9;
        inOrder = false;
      } else if (targetText.includes(tokSingular) || targetUnaccented.includes(tokSingularUnaccented)) {
        matchedTokens += 0.85;
      } else if (isNearMatch(tokLower, symbolNameLower) || isNearMatch(tokUnaccented, nameUnaccented)) {
        matchedTokens += 0.7;
        matchReason = 'Typo tolerated';
      }
    }

    if (matchedTokens >= query.tokens.length * 0.6) {
      const matchRatio = Math.min(1, matchedTokens / query.tokens.length);
      let score = Math.round(matchRatio * 90) - (inOrder ? 0 : 5);

      // Match Density & Extra Path Noise Penalty
      if (symbol.kind === 'endpoint' && normSymRoute) {
        const routeSegs = normSymRoute.split('/').filter(Boolean);
        const querySegs = normQueryRoute ? normQueryRoute.split('/').filter(Boolean) : query.tokens;
        if (routeSegs.length > 0 && querySegs.length > 0) {
          const segDensity = Math.min(1, querySegs.length / routeSegs.length);
          const noisePenalty = Math.round((1 - segDensity) * 25);
          score = Math.max(20, score - noisePenalty);
        }
      } else if (bareSymbolName.length > 0 && rawQueryLower.length > 0) {
        const nameRatio = Math.min(1, rawQueryLower.length / Math.max(rawQueryLower.length, bareSymbolName.length));
        if (nameRatio < 0.5) {
          score = Math.max(20, score - Math.round((1 - nameRatio) * 15));
        }
      }

      baseScore = score;
      if (!matchReason) {
        matchReason = query.tokens.length > 1 ? 'Multi-token wildcard match' : 'Subsequence match';
      }
    }
  }

  if (baseScore <= 0) {
    return { score: 0, matchReason: '' };
  }

  // 6. HTTP Method Bonus / Penalty for Endpoints
  if (symbol.kind === 'endpoint' && query.explicitHttpMethod) {
    if (symbol.metadata?.httpMethod?.toUpperCase() === query.explicitHttpMethod) {
      baseScore = Math.min(100, baseScore + 10);
      matchReason = `${matchReason} (${query.explicitHttpMethod} matched)`;
    } else {
      baseScore = Math.max(10, baseScore - 40);
    }
  }

  // 7. Domain priority adjustments
  if (
    symbol.kind === 'endpoint' ||
    symbol.kind === 'cqrs_command' ||
    symbol.kind === 'cqrs_handler' ||
    symbol.kind === 'cqrs_event' ||
    symbol.kind === 'di_registration' ||
    symbol.kind === 'background_job'
  ) {
    baseScore = Math.min(100, baseScore + 2);
  }

  // 8. Active Project / Active File Affinity Bonus
  if (rankingContext?.activeFilePath && symbol.filePath === rankingContext.activeFilePath) {
    baseScore = Math.min(100, baseScore + 8);
    matchReason = `${matchReason} (Current File)`;
  } else if (
    rankingContext?.activeProjectName &&
    symbol.projectName.toLowerCase() === rankingContext.activeProjectName.toLowerCase()
  ) {
    baseScore = Math.min(100, baseScore + 5);
    matchReason = `${matchReason} (Active Project)`;
  }

  // 9. MRU Recency Bonus
  if (rankingContext?.mruSymbolIds && rankingContext.mruSymbolIds.includes(symbol.id)) {
    baseScore = Math.min(100, baseScore + 10);
    matchReason = `${matchReason} (Recent)`;
  }

  return { score: baseScore, matchReason };
}

export function searchUniversalSymbols(
  symbolsOrIndex: readonly UniversalSymbol[] | {
    getCandidates: (mode: SearchFilterMode, tokens: string[], proj?: string) => UniversalSymbol[];
    getAllSymbols: () => UniversalSymbol[];
    getDiskStore?: () => import('./searchDiskStore').DiskSymbolStore | undefined;
  },
  rawQuery: string,
  limit = 200,
  rankingContext?: import('./searchModel').SearchRankingContext
): UniversalSearchResult[] {
  const parsed = parseUniversalSearchQuery(rawQuery);
  let candidateSymbols: readonly UniversalSymbol[];

  if (symbolsOrIndex && typeof (symbolsOrIndex as any).getCandidates === 'function') {
    candidateSymbols = (symbolsOrIndex as any).getCandidates(
      parsed.filterMode,
      parsed.tokens,
      parsed.projectNameFilter
    );
  } else if (Array.isArray(symbolsOrIndex)) {
    candidateSymbols = symbolsOrIndex;
  } else {
    candidateSymbols = [];
  }

  const results: UniversalSearchResult[] = [];
  const seenIds = new Set<string>();

  // 1. Phase 1: In-Memory Hot RAM Candidates (< 1-2ms)
  for (const sym of candidateSymbols) {
    const { score, matchReason } = scoreSymbol(sym, parsed, rankingContext);
    if (score >= 40) {
      results.push({ symbol: sym, score, matchReason });
      seenIds.add(sym.id);
    }
  }

  // 2. Phase 2: On-Demand Cold Disk Store Search (< 15-25ms)
  const diskStore = typeof (symbolsOrIndex as any)?.getDiskStore === 'function' ? (symbolsOrIndex as any).getDiskStore() : undefined;
  if (diskStore && (parsed.filterMode === 'all' || parsed.filterMode === 'methods' || parsed.filterMode === 'files' || results.length < limit)) {
    const coldSymbols = diskStore.searchColdSymbols(parsed.tokens, limit);
    for (const sym of coldSymbols) {
      if (!seenIds.has(sym.id)) {
        const { score, matchReason } = scoreSymbol(sym, parsed, rankingContext);
        if (score >= 40) {
          results.push({ symbol: sym, score: Math.max(30, score - 2), matchReason: matchReason || 'Disk symbol match' });
          seenIds.add(sym.id);
        }
      }
    }
  }

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, limit);
}
