import { ApiEndpoint, EndpointSearchResult, HttpMethod, RouteSegmentDescriptor } from './endpointModel';

export interface ParsedQuery {
  readonly raw: string;
  readonly desiredMethod?: HttpMethod;
  readonly routeQuery: string;
  readonly tokens: readonly string[];
}

export function parseSearchQuery(query: string): ParsedQuery {
  let clean = query.trim();
  if (!clean) {
    return { raw: '', routeQuery: '', tokens: [] };
  }

  // Strip query params (?foo=bar) and hashes (#section)
  clean = clean.replace(/[\?\#].*$/, '').trim();

  // Extract leading or trailing HTTP method
  const methodRegex = /^(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)\s+/i;
  const trailingMethodRegex = /\s+(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)$/i;

  let desiredMethod: HttpMethod | undefined;
  let cleanQuery = clean;

  const leadingMatch = clean.match(methodRegex);
  if (leadingMatch) {
    desiredMethod = leadingMatch[1].toUpperCase() as HttpMethod;
    cleanQuery = clean.substring(leadingMatch[0].length).trim();
  } else {
    const trailingMatch = clean.match(trailingMethodRegex);
    if (trailingMatch) {
      desiredMethod = trailingMatch[1].toUpperCase() as HttpMethod;
      cleanQuery = clean.substring(0, trailingMatch.index).trim();
    }
  }

  // Split query into tokens: handle slashes, backslashes, wildcards (*), and whitespace
  // e.g. "fields//validation" -> ["fields", "validation"]
  // e.g. "fields * validation" -> ["fields", "validation"]
  const rawSegments = cleanQuery
    .split(/[\/\\\*\s]+/)
    .map(s => s.trim())
    .filter(Boolean);

  return {
    raw: query.trim(),
    desiredMethod,
    routeQuery: cleanQuery,
    tokens: rawSegments
  };
}

export function damerauLevenshteinDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const al = a.length;
  const bl = b.length;
  const matrix: number[][] = [];

  for (let i = 0; i <= al; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= bl; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= al; i++) {
    for (let j = 1; j <= bl; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,        // deletion
        matrix[i][j - 1] + 1,        // insertion
        matrix[i - 1][j - 1] + cost  // substitution
      );
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        matrix[i][j] = Math.min(matrix[i][j], matrix[i - 2][j - 2] + 1); // transposition
      }
    }
  }

  return matrix[al][bl];
}

export function isAcronymMatch(token: string, text: string): boolean {
  if (!token || !text) return false;
  const words = text.split(/[-_\s/]+/).filter(Boolean);
  if (words.length < 2 && token.length > 1) return false;

  const initials = words.map(w => w[0].toLowerCase()).join('');
  return initials.includes(token.toLowerCase()) || token.toLowerCase() === initials;
}

export function getRouteInitials(endpoint: ApiEndpoint): { full: string; nonParams: string } {
  const full = endpoint.segments.map(s => s.cleanText[0] || '').join('').toLowerCase();
  const nonParams = endpoint.segments.filter(s => !s.isParam).map(s => s.cleanText[0] || '').join('').toLowerCase();
  return { full, nonParams };
}

export function matchTokenToSegment(token: string, segment: RouteSegmentDescriptor): { matched: boolean; score: number } {
  const tokLower = token.toLowerCase();

  // 1. Exact match on raw or clean text or variations
  for (const v of segment.variations) {
    if (v === tokLower) {
      return { matched: true, score: 100 };
    }
  }

  // 2. Substring match
  for (const v of segment.variations) {
    if (v.includes(tokLower)) {
      return { matched: true, score: 85 };
    }
  }

  // 3. Acronym match (e.g. "iv" -> "interface-views")
  if (isAcronymMatch(tokLower, segment.cleanText)) {
    return { matched: true, score: 80 };
  }

  // 4. Parameter constraint match (e.g. query "fieldId:int" or "int" matching "{fieldId:int}")
  if (segment.isParam) {
    if (segment.paramName?.toLowerCase() === tokLower) {
      return { matched: true, score: 90 };
    }
    if (segment.constraint?.toLowerCase() === tokLower) {
      return { matched: true, score: 85 };
    }
  }

  // 5. Typo tolerance with Damerau-Levenshtein (for tokens of length >= 4)
  if (tokLower.length >= 4 && segment.cleanText.length >= 4) {
    const dist = damerauLevenshteinDistance(tokLower, segment.cleanText.toLowerCase());
    if (dist <= 1) {
      return { matched: true, score: 75 };
    }
  }

  return { matched: false, score: 0 };
}

export function scoreEndpoint(endpoint: ApiEndpoint, query: ParsedQuery): EndpointSearchResult | undefined {
  if (!query.raw) {
    return { endpoint, score: 50, matchReason: 'All endpoints' };
  }

  const { desiredMethod, routeQuery, tokens } = query;
  let baseScore = 0;
  let matchReason = '';

  const routeLower = endpoint.routeTemplate.toLowerCase();
  const normalizedLower = endpoint.normalizedRoute.toLowerCase();
  const queryLower = routeQuery.toLowerCase();
  const controllerLower = (endpoint.controllerName || '').toLowerCase();
  const actionLower = (endpoint.actionName || '').toLowerCase();
  const projectLower = (endpoint.projectName || '').toLowerCase();

  // 1. Exact match on raw or normalized route
  if (routeLower === queryLower || normalizedLower === queryLower) {
    baseScore = 100;
    matchReason = 'Exact route match';
  }
  // 2. Multi-Gap Subsequence Matcher with Parameter Skips
  else if (tokens.length > 0) {
    const segments = endpoint.segments;
    let matchedTokenCount = 0;
    let lastSegmentIndex = -1;
    let inOrder = true;
    let totalParamGaps = 0;
    let totalStaticGaps = 0;

    for (let t = 0; t < tokens.length; t++) {
      const token = tokens[t];
      let bestSegmentIndex = -1;
      let bestSegmentScore = 0;

      for (let s = lastSegmentIndex + 1; s < segments.length; s++) {
        const result = matchTokenToSegment(token, segments[s]);
        if (result.matched) {
          bestSegmentIndex = s;
          bestSegmentScore = result.score;
          break;
        }
      }

      if (bestSegmentIndex !== -1) {
        matchedTokenCount += (bestSegmentScore / 100);

        if (lastSegmentIndex !== -1 && bestSegmentIndex > lastSegmentIndex + 1) {
          // Check what was skipped in the gap between lastSegmentIndex and bestSegmentIndex
          for (let g = lastSegmentIndex + 1; g < bestSegmentIndex; g++) {
            if (segments[g].isParam) {
              totalParamGaps++;
            } else {
              totalStaticGaps++;
            }
          }
        }
        lastSegmentIndex = bestSegmentIndex;
      } else {
        inOrder = false;
        // Check if token matches controller, action, or project instead
        const tokLower = token.toLowerCase();
        if (
          controllerLower.includes(tokLower) ||
          actionLower.includes(tokLower) ||
          projectLower.includes(tokLower) ||
          isAcronymMatch(tokLower, controllerLower) ||
          isAcronymMatch(tokLower, actionLower)
        ) {
          matchedTokenCount += 0.8;
        }
      }
    }

    if (inOrder && matchedTokenCount >= tokens.length * 0.6) {
      const matchRatio = matchedTokenCount / tokens.length;
      baseScore = Math.round(96 * matchRatio) - (totalParamGaps * 1) - (totalStaticGaps * 3);
      matchReason = totalParamGaps > 0
        ? 'Route matched with parameter wildcards'
        : 'Sequential segment match';
    } else if (matchedTokenCount >= tokens.length * 0.6) {
      baseScore = 82;
      matchReason = 'Multi-token route match';
    } else if (routeLower.includes(queryLower) || normalizedLower.includes(queryLower)) {
      baseScore = 78;
      matchReason = 'Route substring match';
    } else if (
      controllerLower.includes(queryLower) ||
      actionLower.includes(queryLower) ||
      projectLower.includes(queryLower)
    ) {
      baseScore = 74;
      matchReason = 'Project/Controller/Action match';
    } else {
      // Route initials / Acronym match (e.g. "afv" for "api/fields/{id}/validation")
      const { full: fullInitials, nonParams: nonParamInitials } = getRouteInitials(endpoint);
      if (nonParamInitials === queryLower || fullInitials === queryLower || nonParamInitials.includes(queryLower)) {
        baseScore = 80;
        matchReason = 'Acronym route match';
      } else {
        const fullAcronymMatch = isAcronymMatch(queryLower, routeLower) || isAcronymMatch(queryLower, controllerLower) || isAcronymMatch(queryLower, actionLower);
        if (fullAcronymMatch) {
          baseScore = 75;
          matchReason = 'Acronym match';
        }
      }
    }
  }

  if (baseScore === 0) {
    return undefined;
  }

  // Method matching adjustment
  if (desiredMethod) {
    if (endpoint.httpMethod === desiredMethod || endpoint.httpMethod === 'ANY') {
      baseScore += 15;
      matchReason += ` (${desiredMethod} matched)`;
    } else {
      baseScore -= 40;
    }
  }

  return {
    endpoint,
    score: Math.max(1, Math.min(100, Math.round(baseScore))),
    matchReason
  };
}

export function searchEndpoints(
  endpoints: readonly ApiEndpoint[],
  query: string,
  limit: number = 100
): EndpointSearchResult[] {
  const parsed = parseSearchQuery(query);
  const results: EndpointSearchResult[] = [];

  for (const ep of endpoints) {
    const scored = scoreEndpoint(ep, parsed);
    if (scored && scored.score > 20) {
      results.push(scored);
    }
  }

  // Sort descending by score, then alphabetically by route
  results.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.endpoint.routeTemplate.localeCompare(b.endpoint.routeTemplate);
  });

  return results.slice(0, limit);
}

export function generateMockValueForConstraint(constraint?: string, paramName?: string): string {
  const c = (constraint || '').toLowerCase();
  const n = (paramName || '').toLowerCase();

  if (c.includes('int') || c.includes('long') || c.includes('short') || c.includes('byte')) return '1';
  if (c.includes('guid')) return '00000000-0000-0000-0000-000000000000';
  if (c.includes('bool')) return 'true';
  if (c.includes('decimal') || c.includes('double') || c.includes('float')) return '99.99';
  if (c.includes('datetime')) return '2026-01-01T00:00:00Z';

  if (n.includes('id')) return '1';
  if (n.includes('email')) return 'user@example.com';
  if (n.includes('name')) return 'sample-name';
  return 'sample';
}

export function formatResolvedUrl(endpoint: ApiEndpoint, host: string = 'https://localhost:5001'): string {
  let resolved = endpoint.routeTemplate.replace(/^\/+/, '');
  for (const seg of endpoint.segments) {
    if (seg.isParam && seg.paramName) {
      const mockVal = generateMockValueForConstraint(seg.constraint, seg.paramName);
      resolved = resolved.replace(seg.raw, mockVal);
    }
  }
  return `${host}/${resolved}`;
}

export function formatEndpointAsHttp(endpoint: ApiEndpoint): string {
  const host = 'https://localhost:5001';
  const cleanRoute = endpoint.routeTemplate.replace(/^\/+/, '');
  const method = endpoint.httpMethod === 'ANY' ? 'GET' : endpoint.httpMethod;

  const lines = [
    `### ${endpoint.actionName || endpoint.controllerName || 'API Request'}`,
    `${method} ${host}/${cleanRoute}`,
    'Accept: application/json'
  ];

  if (['POST', 'PUT', 'PATCH'].includes(method)) {
    lines.push('Content-Type: application/json');
    lines.push('');
    lines.push('{\n  \n}');
  }

  return lines.join('\n');
}

export function formatEndpointAsCurl(endpoint: ApiEndpoint): string {
  const resolvedUrl = formatResolvedUrl(endpoint);
  const method = endpoint.httpMethod === 'ANY' ? 'GET' : endpoint.httpMethod;

  if (['POST', 'PUT', 'PATCH'].includes(method)) {
    return `curl -X ${method} "${resolvedUrl}" -H "Accept: application/json" -H "Content-Type: application/json" -d '{}'`;
  }
  return `curl -X ${method} "${resolvedUrl}" -H "Accept: application/json"`;
}
