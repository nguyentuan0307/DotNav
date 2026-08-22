import * as fs from 'fs';
import * as path from 'path';
import { ApiEndpoint, HttpMethod, RouteParameterInfo, RouteSegmentDescriptor } from './endpointModel';

export function toKebabCase(str: string): string {
  return str
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1-$2')
    .toLowerCase();
}

export function pluralize(word: string): string {
  if (!word) return word;
  if (word.endsWith('y') && !/[aeiou]y$/i.test(word)) {
    return word.slice(0, -1) + 'ies';
  }
  if (word.endsWith('s') || word.endsWith('x') || word.endsWith('z') || word.endsWith('ch') || word.endsWith('sh')) {
    return word + 'es';
  }
  return word + 's';
}

export function parseRouteSegments(routeTemplate: string): RouteSegmentDescriptor[] {
  if (!routeTemplate) return [];
  const rawSegments = routeTemplate
    .replace(/^\/+|\/+$/g, '')
    .split(/\/+/)
    .map(s => s.trim())
    .filter(Boolean);

  return rawSegments.map(raw => {
    if (raw.startsWith('{') && raw.endsWith('}')) {
      const match = raw.match(/^\{([a-zA-Z0-9_]+)(?::([a-zA-Z0-9_()]+))?(\?)?(?:=([^}]+))?\}$/);
      if (match) {
        const paramName = match[1];
        const constraint = match[2];
        const variations = [
          paramName.toLowerCase(),
          toKebabCase(paramName),
          paramName
        ];
        if (constraint) {
          variations.push(`${paramName.toLowerCase()}:${constraint.toLowerCase()}`);
        }
        return {
          raw,
          isParam: true,
          paramName,
          constraint,
          cleanText: paramName,
          variations
        };
      }
      const stripped = raw.slice(1, -1);
      return {
        raw,
        isParam: true,
        paramName: stripped,
        cleanText: stripped,
        variations: [stripped.toLowerCase(), raw.toLowerCase()]
      };
    }

    const clean = raw.toLowerCase();
    const kebab = toKebabCase(raw);
    const variations = Array.from(new Set([clean, kebab, raw]));
    return {
      raw,
      isParam: false,
      cleanText: raw,
      variations
    };
  });
}

export function extractRouteParameters(segments: readonly RouteSegmentDescriptor[]): RouteParameterInfo[] {
  return segments
    .filter(s => s.isParam && s.paramName)
    .map(s => ({
      name: s.paramName!,
      typeConstraint: s.constraint
    }));
}

export function normalizeRouteTemplate(route: string): string {
  if (!route) return '';
  let cleaned = route.trim().replace(/^\/+|^\~+\/+/, '');
  // Clean multiple slashes
  cleaned = cleaned.replace(/\/+/g, '/');
  // Normalize parameter constraints e.g. {id:int} -> {id}, {id:guid?} -> {id}
  cleaned = cleaned.replace(/\{([a-zA-Z0-9_]+)(?::[^}]+)?\}/g, '{$1}');
  return cleaned;
}

export function combineMinimalApiRoutes(groupPrefix: string | undefined, route: string | undefined): string {
  const p = (groupPrefix || '').trim().replace(/^\/+|\/+$/g, '');
  const r = (route || '').trim().replace(/^\/+|\/+$/g, '');
  if (p && r) return `${p}/${r}`;
  return p || r || '';
}

export function combineRoutes(classRoute: string | undefined, actionRoute: string | undefined): string {
  const trimmedAction = (actionRoute || '').trim();

  // If action route starts with '/' or '~/', it overrides the class route
  if (trimmedAction.startsWith('/') || trimmedAction.startsWith('~/')) {
    return trimmedAction.replace(/^\~?\//, '');
  }

  const base = (classRoute || '').trim().replace(/^\/+|\/+$/g, '');
  const sub = trimmedAction.replace(/^\/+|\/+$/g, '');

  if (base && sub) {
    return `${base}/${sub}`;
  }
  return base || sub || '';
}

export function resolveRouteTokens(
  route: string,
  controllerName: string,
  actionName: string,
  areaName?: string
): string {
  const cleanController = controllerName.replace(/Controller$/i, '');
  let resolved = route
    .replace(/\[controller\]/gi, cleanController)
    .replace(/\[action\]/gi, actionName);

  if (areaName) {
    resolved = resolved.replace(/\[area\]/gi, areaName);
  }
  return resolved.replace(/\/+/g, '/');
}

export function isIgnoredEndpointFile(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, '/');
  if (/\/(bin|obj|node_modules|\.vs|\.git)\//i.test(normalized)) {
    return true;
  }
  const base = path.basename(filePath);
  if (/\.(g|Designer|generated)\.cs$/i.test(base)) {
    return true;
  }
  return false;
}

export function parseEndpointsFromCSharp(
  code: string,
  filePath: string,
  projectName: string,
  relativePath: string
): ApiEndpoint[] {
  // Fast-path heuristic: skip files that cannot possibly contain ASP.NET Core controllers or minimal APIs
  if (
    !code.includes('Controller') &&
    !code.includes('Map') &&
    !code.includes('Http') &&
    !code.includes('Route')
  ) {
    return [];
  }

  const endpoints: ApiEndpoint[] = [];

  // 1. Controller parsing
  const classRegex = /(?:public\s+|internal\s+)?(?:partial\s+)?class\s+([A-Za-z0-9_]+Controller)\b(?:\s*:\s*([A-Za-z0-9_,\s<>]+))?/g;
  let classMatch: RegExpExecArray | null;

  while ((classMatch = classRegex.exec(code)) !== null) {
    const controllerName = classMatch[1];
    const classIndex = classMatch.index;

    // Look backwards from class definition for attributes
    const beforeClass = code.substring(Math.max(0, classIndex - 1500), classIndex);
    const classRoutes: string[] = [];
    let areaName: string | undefined;
    const classAuth: string[] = [];

    const routeAttrMatches = beforeClass.matchAll(/\[Route\(\s*(?:\$|@)?"([^"]+)"\s*\)\]/gi);
    for (const m of routeAttrMatches) {
      classRoutes.push(m[1]);
    }

    if (classRoutes.length === 0) {
      // If no explicit [Route], infer standard convention routes for controllers
      const bare = controllerName.replace(/Controller$/i, '');
      const plural = pluralize(bare);
      classRoutes.push('api/[controller]');
      classRoutes.push('[controller]');
      if (plural.toLowerCase() !== bare.toLowerCase()) {
        classRoutes.push(`api/${plural.toLowerCase()}`);
        classRoutes.push(plural.toLowerCase());
      }
    }

    const areaAttrMatch = beforeClass.match(/\[Area\(\s*"([^"]+)"\s*\)\]/i);
    if (areaAttrMatch) {
      areaName = areaAttrMatch[1];
    }

    if (/\[Authorize/i.test(beforeClass)) {
      classAuth.push('Authorize');
    }
    if (/\[AllowAnonymous/i.test(beforeClass)) {
      classAuth.push('AllowAnonymous');
    }

    // Find class body boundaries
    const bodyStartIndex = code.indexOf('{', classIndex);
    if (bodyStartIndex === -1) continue;

    let braceCount = 1;
    let bodyEndIndex = code.length;
    for (let i = bodyStartIndex + 1; i < code.length; i++) {
      if (code[i] === '{') braceCount++;
      else if (code[i] === '}') {
        braceCount--;
        if (braceCount === 0) {
          bodyEndIndex = i;
          break;
        }
      }
    }

    const classBody = code.substring(bodyStartIndex, bodyEndIndex);

    // Match action methods with any combination of HTTP and Route attributes
    const actionBlockRegex = /(?:\[[^\]]+\]\s*)+(?:public\s+|protected\s+|internal\s+|private\s+|async\s+|virtual\s+|override\s+|static\s+)*(?:Task<[^>]+>|Task|ValueTask<[^>]+>|ValueTask|ActionResult<[^>]+>|IActionResult|IResult|[A-Za-z0-9_<>[\]]+)\s+([A-Za-z0-9_]+)\s*\(([^)]*)\)/g;

    let actionMatch: RegExpExecArray | null;
    while ((actionMatch = actionBlockRegex.exec(classBody)) !== null) {
      const fullBlock = actionMatch[0];
      const actionName = actionMatch[1];
      const paramsArg = actionMatch[2] || '';

      let httpMethod: HttpMethod | undefined = undefined;
      let actionRouteArg = '';
      const methodAuth: string[] = [];

      const attrRegex = /\[([^\]]+)\]/g;
      let attrMatch: RegExpExecArray | null;
      while ((attrMatch = attrRegex.exec(fullBlock)) !== null) {
        const rawContent = attrMatch[1].trim();
        const attrName = rawContent.split(/[\s(]/)[0].trim();
        const argMatch = rawContent.match(/\(\s*(?:\$|@)?"([^"]*)"/);
        const attrArg = argMatch ? argMatch[1] : '';

        if (/^HttpPost$/i.test(attrName)) {
          httpMethod = 'POST';
          if (attrArg) actionRouteArg = attrArg;
        } else if (/^HttpGet$/i.test(attrName)) {
          httpMethod = 'GET';
          if (attrArg) actionRouteArg = attrArg;
        } else if (/^HttpPut$/i.test(attrName)) {
          httpMethod = 'PUT';
          if (attrArg) actionRouteArg = attrArg;
        } else if (/^HttpDelete$/i.test(attrName)) {
          httpMethod = 'DELETE';
          if (attrArg) actionRouteArg = attrArg;
        } else if (/^HttpPatch$/i.test(attrName)) {
          httpMethod = 'PATCH';
          if (attrArg) actionRouteArg = attrArg;
        } else if (/^HttpHead$/i.test(attrName)) {
          httpMethod = 'HEAD';
          if (attrArg) actionRouteArg = attrArg;
        } else if (/^HttpOptions$/i.test(attrName)) {
          httpMethod = 'OPTIONS';
          if (attrArg) actionRouteArg = attrArg;
        } else if (/^Route$/i.test(attrName)) {
          if (attrArg) actionRouteArg = attrArg;
          if (!httpMethod) httpMethod = 'ANY';
        } else if (/^AcceptVerbs$/i.test(attrName)) {
          const verbMatch = rawContent.match(/(GET|POST|PUT|DELETE|PATCH)/i);
          if (verbMatch) httpMethod = verbMatch[1].toUpperCase() as HttpMethod;
        } else if (/^Authorize$/i.test(attrName)) {
          methodAuth.push('Authorize');
        } else if (/^AllowAnonymous$/i.test(attrName)) {
          methodAuth.push('AllowAnonymous');
        }
      }

      // If neither an HTTP verb nor a Route attribute was found, skip non-endpoint methods
      if (!httpMethod && !actionRouteArg) {
        continue;
      }

      const finalMethod: HttpMethod = httpMethod || 'GET';
      const methodOffset = bodyStartIndex + actionMatch.index;
      const methodLine = code.substring(0, methodOffset).split('\n').length;

      const params = paramsArg
        .split(',')
        .map(p => p.trim())
        .filter(Boolean);

      for (const classRoute of classRoutes) {
        const combined = combineRoutes(classRoute, actionRouteArg);
        const rawRoute = resolveRouteTokens(combined, controllerName, actionName, areaName);
        const normalized = normalizeRouteTemplate(rawRoute);
        const segments = parseRouteSegments(rawRoute);
        const routeParams = extractRouteParameters(segments);

        const id = `${filePath}:${methodLine}:${finalMethod}:${rawRoute}`;

        endpoints.push({
          id,
          httpMethod: finalMethod,
          routeTemplate: rawRoute || '[root]',
          normalizedRoute: normalized || '[root]',
          segments,
          controllerName,
          actionName,
          kind: 'controller',
          filePath,
          relativePath,
          line: methodLine,
          projectName,
          parameters: params,
          routeParameters: routeParams,
          authorization: Array.from(new Set([...classAuth, ...methodAuth]))
        });
      }
    }
  }

  // 2. Minimal API parsing (with MapGroup hierarchy tracking)
  const groupMap = new Map<string, string>();
  const groupRegex = /(?:var|RouteGroupBuilder|[A-Za-z0-9_]+)\s+([A-Za-z0-9_]+)\s*=\s*(?:[A-Za-z0-9_]+)\.MapGroup\(\s*(?:\$|@)?"([^"]+)"/g;
  let groupMatch: RegExpExecArray | null;

  while ((groupMatch = groupRegex.exec(code)) !== null) {
    const varName = groupMatch[1];
    const groupPrefix = groupMatch[2];
    if (varName && groupPrefix) {
      groupMap.set(varName, groupPrefix);
    }
  }

  const minimalApiRegex = /([A-Za-z0-9_]+)\.(MapGet|MapPost|MapPut|MapDelete|MapPatch|MapMethods)\s*\(\s*(?:\$|@)?"([^"]+)"/g;
  let minimalMatch: RegExpExecArray | null;

  while ((minimalMatch = minimalApiRegex.exec(code)) !== null) {
    const caller = minimalMatch[1];
    const mapFunc = minimalMatch[2];
    const route = minimalMatch[3];

    let prefix = '';
    if (caller && groupMap.has(caller)) {
      prefix = groupMap.get(caller)!;
    }

    let httpMethod: HttpMethod = 'GET';
    if (/MapPost/i.test(mapFunc)) httpMethod = 'POST';
    else if (/MapPut/i.test(mapFunc)) httpMethod = 'PUT';
    else if (/MapDelete/i.test(mapFunc)) httpMethod = 'DELETE';
    else if (/MapPatch/i.test(mapFunc)) httpMethod = 'PATCH';

    const fullRoute = combineMinimalApiRoutes(prefix, route);
    const matchOffset = minimalMatch.index;
    const line = code.substring(0, matchOffset).split('\n').length;
    const normalized = normalizeRouteTemplate(fullRoute);
    const segments = parseRouteSegments(fullRoute);
    const routeParams = extractRouteParameters(segments);

    const id = `${filePath}:${line}:${httpMethod}:${fullRoute}`;

    endpoints.push({
      id,
      httpMethod,
      routeTemplate: fullRoute,
      normalizedRoute: normalized,
      segments,
      actionName: `MinimalApi (${mapFunc})`,
      kind: 'minimalApi',
      filePath,
      relativePath,
      line,
      projectName,
      routeParameters: routeParams,
      groupName: prefix || undefined
    });
  }

  return endpoints;
}

export class EndpointIndex {
  private readonly fileCache = new Map<string, ApiEndpoint[]>();
  private cachedAllEndpoints: ApiEndpoint[] | undefined = undefined;
  private _isFullScanCompleted: boolean = false;

  public get isFullScanCompleted(): boolean {
    return this._isFullScanCompleted;
  }

  public markFullScanCompleted(): void {
    this._isFullScanCompleted = true;
  }

  public scanFileContent(
    filePath: string,
    content: string,
    projectName: string,
    relativePath: string
  ): ApiEndpoint[] {
    const endpoints = parseEndpointsFromCSharp(content, filePath, projectName, relativePath);
    this.fileCache.set(filePath, endpoints);
    this.cachedAllEndpoints = undefined;
    return endpoints;
  }

  public async scanFile(filePath: string, projectName: string, relativePath: string): Promise<ApiEndpoint[]> {
    try {
      if (isIgnoredEndpointFile(filePath) || !fs.existsSync(filePath)) {
        this.invalidateFile(filePath);
        return [];
      }
      const content = await fs.promises.readFile(filePath, 'utf8');
      return this.scanFileContent(filePath, content, projectName, relativePath);
    } catch {
      this.invalidateFile(filePath);
      return [];
    }
  }

  public invalidateFile(filePath: string): void {
    if (this.fileCache.delete(filePath)) {
      this.cachedAllEndpoints = undefined;
    }
  }

  public clear(): void {
    this.fileCache.clear();
    this.cachedAllEndpoints = undefined;
    this._isFullScanCompleted = false;
  }

  public hasFile(filePath: string): boolean {
    return this.fileCache.has(filePath);
  }

  public get fileCount(): number {
    return this.fileCache.size;
  }

  public getAllEndpoints(): ApiEndpoint[] {
    if (this.cachedAllEndpoints === undefined) {
      const all: ApiEndpoint[] = [];
      for (const list of this.fileCache.values()) {
        all.push(...list);
      }
      this.cachedAllEndpoints = all;
    }
    return this.cachedAllEndpoints;
  }

  public get count(): number {
    let sum = 0;
    for (const list of this.fileCache.values()) {
      sum += list.length;
    }
    return sum;
  }
}
