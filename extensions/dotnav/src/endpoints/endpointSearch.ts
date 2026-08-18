import { ApiEndpoint, EndpointSearchResult, HttpMethod } from './endpointModel';

export interface ParsedQuery {
  readonly raw: string;
  readonly desiredMethod?: HttpMethod;
  readonly routeQuery: string;
  readonly tokens: readonly string[];
}

export function parseSearchQuery(query: string): ParsedQuery {
  const trimmed = query.trim();
  if (!trimmed) {
    return { raw: '', routeQuery: '', tokens: [] };
  }

  // Extract leading or trailing HTTP method e.g. "GET interface-views" or "interface-views POST"
  const methodRegex = /^(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)\s+/i;
  const trailingMethodRegex = /\s+(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)$/i;

  let desiredMethod: HttpMethod | undefined;
  let cleanQuery = trimmed;

  const leadingMatch = trimmed.match(methodRegex);
  if (leadingMatch) {
    desiredMethod = leadingMatch[1].toUpperCase() as HttpMethod;
    cleanQuery = trimmed.substring(leadingMatch[0].length).trim();
  } else {
    const trailingMatch = trimmed.match(trailingMethodRegex);
    if (trailingMatch) {
      desiredMethod = trailingMatch[1].toUpperCase() as HttpMethod;
      cleanQuery = trimmed.substring(0, trailingMatch.index).trim();
    }
  }

  // Split query into tokens by slashes, spaces, or hyphens/underscores if searching words
  // e.g. "interface-views//filter-fields" -> ["interface-views", "filter-fields"]
  const rawSegments = cleanQuery.split(/[\/\\]+/).map(s => s.trim()).filter(Boolean);

  // If no slashes were used, split by whitespace
  const tokens = rawSegments.length > 0
    ? rawSegments
    : cleanQuery.split(/\s+/).map(s => s.trim()).filter(Boolean);

  return {
    raw: trimmed,
    desiredMethod,
    routeQuery: cleanQuery,
    tokens
  };
}

export function extractRouteSegments(routeTemplate: string): string[] {
  return routeTemplate
    .replace(/^\/+|\/+$/g, '')
    .split(/\/+/)
    .map(s => s.trim())
    .filter(Boolean);
}

export function isParameterSegment(segment: string): boolean {
  return segment.startsWith('{') && segment.endsWith('}');
}

export function stripParamConstraints(segment: string): string {
  if (!isParameterSegment(segment)) return segment;
  return segment.replace(/\{([a-zA-Z0-9_]+)(?::[^}]+)?\}/g, '$1');
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

  // 1. Exact match on raw or normalized route
  if (routeLower === queryLower || normalizedLower === queryLower) {
    baseScore = 100;
    matchReason = 'Exact route match';
  }
  // 2. Segment Subsequence Match with Parameter Gaps (e.g. "interface-views//filter-fields" matching "interface-views/{id}/filter-fields")
  else if (tokens.length > 0) {
    const routeSegments = extractRouteSegments(endpoint.routeTemplate);
    let matchedTokenCount = 0;
    let lastSegmentIndex = -1;
    let inOrder = true;
    let matchedGapCount = 0;

    for (let t = 0; t < tokens.length; t++) {
      const token = tokens[t].toLowerCase();
      let foundIndex = -1;

      for (let s = lastSegmentIndex + 1; s < routeSegments.length; s++) {
        const seg = routeSegments[s].toLowerCase();
        const segClean = stripParamConstraints(seg).toLowerCase();

        if (seg === token || segClean === token || seg.includes(token)) {
          foundIndex = s;
          if (lastSegmentIndex !== -1 && s > lastSegmentIndex + 1) {
            // There was a gap of 1 or more segments in between (e.g. a parameter segment)
            matchedGapCount += (s - lastSegmentIndex - 1);
          }
          break;
        }
      }

      if (foundIndex !== -1) {
        matchedTokenCount++;
        lastSegmentIndex = foundIndex;
      } else {
        inOrder = false;
        // Check if token matches controller or action instead
        if (controllerLower.includes(token) || actionLower.includes(token)) {
          matchedTokenCount += 0.75;
        }
      }
    }

    if (matchedTokenCount === tokens.length && inOrder) {
      baseScore = 95 - Math.min(10, matchedGapCount * 2);
      matchReason = matchedGapCount > 0
        ? 'Route matched with parameter wildcards'
        : 'Sequential segment match';
    } else if (matchedTokenCount >= tokens.length * 0.75) {
      baseScore = 80;
      matchReason = 'Multi-token route match';
    } else if (routeLower.includes(queryLower) || normalizedLower.includes(queryLower)) {
      baseScore = 75;
      matchReason = 'Route substring match';
    } else if (controllerLower.includes(queryLower) || actionLower.includes(queryLower)) {
      baseScore = 70;
      matchReason = 'Controller/Action match';
    } else {
      // Fuzzy acronym or loose token match
      let looseMatches = 0;
      for (const token of tokens) {
        const tok = token.toLowerCase();
        if (routeLower.includes(tok) || controllerLower.includes(tok) || actionLower.includes(tok)) {
          looseMatches++;
        }
      }

      if (looseMatches > 0) {
        baseScore = 50 + (looseMatches / tokens.length) * 20;
        matchReason = 'Partial token match';
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
  const host = 'https://localhost:5001';
  const cleanRoute = endpoint.routeTemplate.replace(/^\/+/, '');
  const method = endpoint.httpMethod === 'ANY' ? 'GET' : endpoint.httpMethod;

  if (['POST', 'PUT', 'PATCH'].includes(method)) {
    return `curl -X ${method} "${host}/${cleanRoute}" -H "Accept: application/json" -H "Content-Type: application/json" -d '{}'`;
  }
  return `curl -X ${method} "${host}/${cleanRoute}" -H "Accept: application/json"`;
}

