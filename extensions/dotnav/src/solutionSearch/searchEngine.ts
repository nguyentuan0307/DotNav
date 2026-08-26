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

  // 1. Strip protocol and host (e.g. http://localhost:5000/api/... or https://dev.eldesk.com/api/...)
  clean = clean.replace(/^https?:\/\/[^\/]+/i, '').trim();

  // 2. Check filter mode prefixes
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

  // 3. Strip query string (?foo=bar) and hash anchor (#section) if present in URL
  clean = clean.replace(/[\?\#].*$/, '').trim();

  // 4. Extract line jump syntax at the end: e.g. "SubmitFormService:762", "SubmitFormService:762:15", "SubmitFormService@762"
  let targetLine: number | undefined;
  let targetColumn: number | undefined;
  const lineMatch = /(?::(\d+)(?::(\d+))?|@(\d+))$/.exec(clean);
  if (lineMatch) {
    targetLine = parseInt(lineMatch[1] || lineMatch[3], 10);
    targetColumn = lineMatch[2] ? parseInt(lineMatch[2], 10) : 1;
    clean = clean.substring(0, lineMatch.index).trim();
  }

  // 5. Extract explicit HTTP method (e.g. "PUT apps/forms/66090/mode" or "GET /users")
  let explicitHttpMethod: string | undefined;
  const methodMatch = /^(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)\s+/i.exec(clean);
  if (methodMatch) {
    explicitHttpMethod = methodMatch[1].toUpperCase();
    clean = clean.substring(methodMatch[0].length).trim();
  }

  // 6. Extract project name filter (e.g. "WebApp: users" or "CustomApp: orders")
  let projectNameFilter: string | undefined;
  const projectMatch = /^([a-zA-Z0-9_.-]+):\s+(.*)$/.exec(clean);
  if (projectMatch && !projectMatch[1].includes('/')) {
    projectNameFilter = projectMatch[1].toLowerCase();
    clean = projectMatch[2].trim();
  }

  // 7. Auto-detect Route Query (contains slashes or explicit HTTP method)
  const isRouteQuery = clean.includes('/') || explicitHttpMethod !== undefined || filterMode === 'endpoints';

  // 8. Tokenize
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
    targetColumn,
    isRouteQuery
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
    .replace(/\/{2,}/g, '/') // Collapse multiple consecutive slashes
    .replace(/^\/+|\/+$/g, '') // Remove leading & trailing slashes
    .replace(/^api\//, '') // Remove optional leading "api/"
    .replace(/\{([a-zA-Z0-9_]+)(?::[^}]+)?\}/g, '{$1}') // Strip all constraints e.g. {appId:int}, {id:regex(...)} -> {appId}
    .trim();
}

export function matchSingleSegment(qSeg: string, tSeg: string): boolean {
  if (!qSeg || !tSeg) return false;
  const qLower = qSeg.toLowerCase();
  const tLower = tSeg.toLowerCase();

  // 1. Target is a parameter placeholder e.g. {formId}, {id}, {appId}, {fileId:guid}
  if (tLower.startsWith('{') && tLower.endsWith('}')) {
    const rawParam = tLower.slice(1, -1).trim();
    const paramName = rawParam.split(':')[0].toLowerCase();

    // Direct parameter name match (e.g. q is "id", "viewId", "{viewId}")
    if (qLower === paramName || qLower === '{' + paramName + '}' || qLower === tLower) {
      return true;
    }

    // Number value (e.g. "66090", "115089")
    if (/^\d+$/.test(qLower)) {
      return true;
    }

    // UUID/GUID value (e.g. "a1b2c3d4-e5f6-...")
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(qLower) || /^[0-9a-f]{32}$/i.test(qLower)) {
      return true;
    }

    // Boolean value ("true", "false")
    if (qLower === 'true' || qLower === 'false') {
      return true;
    }

    // Explicit placeholder in query (e.g. "{id}", "{any}")
    if (qLower.startsWith('{') && qLower.endsWith('}')) {
      return true;
    }

    // Wildcard query segment ("*" or "%")
    if (qLower === '*' || qLower === '%') {
      return true;
    }

    // Static resource/action tokens (e.g. "record-fields", "GetFormElementByReferenceIdsAsync") must NOT match generic parameter placeholders
    return false;
  }

  // 2. Query is a placeholder e.g. {formId}
  if (qLower.startsWith('{') && qLower.endsWith('}')) {
    return true;
  }

  // 3. Exact string or unaccented match
  if (tLower === qLower || stripAccents(tLower) === stripAccents(qLower)) {
    return true;
  }

  // 4. Singular / Plural variation (e.g. apps vs app, forms vs form, views vs view)
  const qSingular = qLower.endsWith('s') && qLower.length > 3 ? qLower.slice(0, -1) : qLower;
  const tSingular = tLower.endsWith('s') && tLower.length > 3 ? tLower.slice(0, -1) : tLower;
  if (qSingular === tSingular || qSingular === tLower || tSingular === qLower) {
    return true;
  }

  // 5. Hyphen vs underscore vs no-separator (e.g. view-fields vs viewfields vs view_fields)
  const qClean = qLower.replace(/[-_]/g, '');
  const tClean = tLower.replace(/[-_]/g, '');
  if (qClean === tClean && qClean.length >= 3) {
    return true;
  }

  return false;
}

export function matchRouteSegments(
  querySegs: string[],
  targetSegs: string[]
): { matched: boolean; score: number; matchReason: string } {
  if (querySegs.length === 0 || targetSegs.length === 0) {
    return { matched: false, score: 0, matchReason: '' };
  }

  // 1. Exact Match: Same number of segments and all match positionally
  if (querySegs.length === targetSegs.length) {
    let allMatch = true;
    let literalCount = 0;
    for (let i = 0; i < querySegs.length; i++) {
      if (!matchSingleSegment(querySegs[i], targetSegs[i])) {
        allMatch = false;
        break;
      }
      if (!targetSegs[i].startsWith('{')) literalCount++;
    }
    if (allMatch) {
      const isAllLiteral = literalCount === querySegs.length;
      return { matched: true, score: isAllLiteral ? 100 : 98, matchReason: 'Exact route template match' };
    }
  }

  // 2. Suffix Match: Target ends with all query segments (e.g. "apps/forms/66090/mode" matches "custom-app/apps/forms/{formId}/mode")
  if (targetSegs.length > querySegs.length) {
    const offset = targetSegs.length - querySegs.length;
    let suffixMatch = true;
    let literalCount = 0;
    for (let i = 0; i < querySegs.length; i++) {
      if (!matchSingleSegment(querySegs[i], targetSegs[offset + i])) {
        suffixMatch = false;
        break;
      }
      if (!targetSegs[offset + i].startsWith('{')) literalCount++;
    }
    if (suffixMatch) {
      const skippedSegments = targetSegs.slice(0, offset);
      const isCleanPrefix = skippedSegments.length <= 2;
      const score = (isCleanPrefix ? 99 : 97) - (literalCount < querySegs.length ? 3 : 0);
      return { matched: true, score, matchReason: 'Route suffix match' };
    }
  }

  // 3. Prefix Match: Target starts with all query segments (e.g. "custom-app/apps" matches "custom-app/apps/forms/{formId}/mode")
  if (targetSegs.length > querySegs.length) {
    let prefixMatch = true;
    let literalCount = 0;
    for (let i = 0; i < querySegs.length; i++) {
      if (!matchSingleSegment(querySegs[i], targetSegs[i])) {
        prefixMatch = false;
        break;
      }
      if (!targetSegs[i].startsWith('{')) literalCount++;
    }
    if (prefixMatch) {
      const score = 98 - (literalCount < querySegs.length ? 3 : 0);
      return { matched: true, score, matchReason: 'Route prefix match' };
    }
  }

  // 4. Contiguous Subsegment Match: Query segments appear consecutively inside target segments
  if (targetSegs.length > querySegs.length && querySegs.length >= 2) {
    for (let start = 0; start <= targetSegs.length - querySegs.length; start++) {
      let subMatch = true;
      let literalCount = 0;
      for (let i = 0; i < querySegs.length; i++) {
        if (!matchSingleSegment(querySegs[i], targetSegs[start + i])) {
          subMatch = false;
          break;
        }
        if (!targetSegs[start + i].startsWith('{')) literalCount++;
      }
      if (subMatch) {
        const score = 96 - (literalCount < querySegs.length ? 2 : 0);
        return { matched: true, score, matchReason: 'Route subsegment match' };
      }
    }
  }

  // 5. In-Order Subsequence / Gap Match: Query segments appear in order with placeholders or gaps in between
  // (e.g. "project-views//record-fields" -> "projects/{projectId}/project-views/{viewId}/record-fields")
  if (querySegs.length >= 2 && targetSegs.length >= querySegs.length) {
    let qIdx = 0;
    let literalMatches = 0;
    for (let tIdx = 0; tIdx < targetSegs.length && qIdx < querySegs.length; tIdx++) {
      if (matchSingleSegment(querySegs[qIdx], targetSegs[tIdx])) {
        if (!targetSegs[tIdx].startsWith('{')) literalMatches++;
        qIdx++;
      }
    }
    if (qIdx === querySegs.length) {
      const isAllLiteral = literalMatches === querySegs.length;
      const score = isAllLiteral ? 98 : 95;
      return {
        matched: true,
        score,
        matchReason: isAllLiteral ? 'Route literal subsequence match' : 'Route subsequence match'
      };
    }
  }

  return { matched: false, score: 0, matchReason: '' };
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

  // 3. Dynamic Route Parameter & Segment Matching (for Endpoints)
  if (symbol.kind === 'endpoint' && normSymRoute && (query.isRouteQuery || query.tokens.length > 1)) {
    const routeSegs = normSymRoute.split('/').filter(Boolean);
    const querySegs = (normQueryRoute ? normQueryRoute.split('/') : query.tokens).filter(Boolean);
    if (querySegs.length > 0 && routeSegs.length > 0) {
      const routeMatch = matchRouteSegments(querySegs, routeSegs);
      if (routeMatch.matched) {
        baseScore = routeMatch.score;
        matchReason = routeMatch.matchReason;
      }
    }
  }

  // 4. Exact full match or bare name match or route template match (accent-tolerant)
  if (baseScore === 0) {
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

    const minRatio = query.tokens.length <= 2 ? 0.95 : 0.6;
    if (matchedTokens >= query.tokens.length * minRatio) {
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

  // 7. C# Naming Intent Detection
  const cleanQ = query.cleanQuery;
  if (/^I[A-Z][a-zA-Z0-9_]*$/.test(cleanQ)) {
    if (symbol.kind === 'interface') {
      baseScore = Math.min(100, baseScore + 20);
      matchReason = `${matchReason} (Interface)`;
    } else if (symbol.kind === 'class') {
      baseScore = Math.max(10, baseScore - 15);
    }
  } else if (/(Command|Query|Handler|Event)$/i.test(cleanQ)) {
    if (symbol.kind.startsWith('cqrs_')) {
      baseScore = Math.min(100, baseScore + 15);
      matchReason = `${matchReason} (CQRS)`;
    }
  } else if (/(Dto|Model|Request|Response|ViewModel)$/i.test(cleanQ)) {
    if (symbol.kind === 'class' || symbol.kind === 'record') {
      baseScore = Math.min(100, baseScore + 12);
      matchReason = `${matchReason} (Model/DTO)`;
    }
  } else if (/Exception$/i.test(cleanQ) && symbol.kind === 'class') {
    baseScore = Math.min(100, baseScore + 15);
    matchReason = `${matchReason} (Exception)`;
  }

  // 8. Domain priority adjustments
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

  // 9. Git Working Tree Gravity (Files being actively modified in Git)
  if (rankingContext?.gitModifiedPaths && rankingContext.gitModifiedPaths.length > 0) {
    const isGitModified = rankingContext.gitModifiedPaths.some(
      p => symbol.filePath.endsWith(p) || symbol.relativePath.endsWith(p)
    );
    if (isGitModified) {
      baseScore = Math.min(100, baseScore + 15);
      matchReason = `${matchReason} (🌿 Git Modified)`;
    }
  }

  // 10. Active Project / Active File Affinity Bonus
  if (rankingContext?.activeFilePath && symbol.filePath === rankingContext.activeFilePath) {
    baseScore = Math.min(100, baseScore + 8);
    matchReason = `${matchReason} (Current File)`;
  } else if (rankingContext?.activeFileDir && symbol.relativePath.startsWith(rankingContext.activeFileDir)) {
    baseScore = Math.min(100, baseScore + 6);
    matchReason = `${matchReason} (Same Module)`;
  } else if (
    rankingContext?.activeProjectName &&
    symbol.projectName.toLowerCase() === rankingContext.activeProjectName.toLowerCase()
  ) {
    baseScore = Math.min(100, baseScore + 4);
    matchReason = `${matchReason} (Active Project)`;
  }

  // 11. Active Editor Noun Gravity (e.g. FormController -> FormService)
  if (rankingContext?.activeNoun && symbol.name.toLowerCase().includes(rankingContext.activeNoun.toLowerCase())) {
    baseScore = Math.min(100, baseScore + 5);
  }

  // 12. MRU Recency Bonus
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
