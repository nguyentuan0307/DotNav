import * as fs from 'fs';
import * as path from 'path';
import { ApiEndpoint, HttpMethod } from './endpointModel';

export function normalizeRouteTemplate(route: string): string {
  if (!route) return '';
  let cleaned = route.trim().replace(/^\/+|^\~+\/+/, '');
  // Clean double slashes
  cleaned = cleaned.replace(/\/+/g, '/');
  // Normalize parameter constraints e.g. {id:int} -> {id}, {id:guid?} -> {id}
  cleaned = cleaned.replace(/\{([a-zA-Z0-9_]+)(?::[^}]+)?\}/g, '{$1}');
  return cleaned;
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

export function parseEndpointsFromCSharp(
  code: string,
  filePath: string,
  projectName: string,
  relativePath: string
): ApiEndpoint[] {
  const endpoints: ApiEndpoint[] = [];
  const lines = code.split(/\r?\n/);

  // 1. Controller parsing
  const classRegex = /(?:public\s+|internal\s+)?(?:partial\s+)?class\s+([A-Za-z0-9_]+Controller)\b(?:\s*:\s*([A-Za-z0-9_,\s<>]+))?/g;
  let classMatch: RegExpExecArray | null;

  while ((classMatch = classRegex.exec(code)) !== null) {
    const controllerName = classMatch[1];
    const classIndex = classMatch.index;

    // Find class start line
    const classLine = code.substring(0, classIndex).split('\n').length;

    // Look backwards from class definition for attributes
    const beforeClass = code.substring(Math.max(0, classIndex - 1000), classIndex);
    let classRoute: string | undefined;
    let areaName: string | undefined;
    const classAuth: string[] = [];

    const routeAttrMatch = beforeClass.match(/\[Route\(\s*(?:\$|@)?"([^"]+)"\s*\)\]/i);
    if (routeAttrMatch) {
      classRoute = routeAttrMatch[1];
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

    // Find class body boundaries (approximate based on brace counting)
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

    // Method regex looking for action methods with HTTP attributes
    const methodRegex = /\[(?:(HttpGet|HttpPost|HttpPut|HttpDelete|HttpPatch|HttpHead|HttpOptions|AcceptVerbs|Route)\s*(?:\(\s*(?:\$|@)?"([^"]*)"[^)]*\))?)\]\s*(?:\[[^\]]+\]\s*)*(?:public\s+|async\s+)*(?:Task<[^>]+>|Task|ActionResult<[^>]+>|IActionResult|IResult|[A-Za-z0-9_<>[\]]+)\s+([A-Za-z0-9_]+)\s*\(([^)]*)\)/g;

    let methodMatch: RegExpExecArray | null;
    while ((methodMatch = methodRegex.exec(classBody)) !== null) {
      const httpAttr = methodMatch[1];
      const actionRouteArg = methodMatch[2] || '';
      const actionName = methodMatch[3];
      const paramsArg = methodMatch[4] || '';

      let httpMethod: HttpMethod = 'GET';
      if (/^HttpPost$/i.test(httpAttr)) httpMethod = 'POST';
      else if (/^HttpPut$/i.test(httpAttr)) httpMethod = 'PUT';
      else if (/^HttpDelete$/i.test(httpAttr)) httpMethod = 'DELETE';
      else if (/^HttpPatch$/i.test(httpAttr)) httpMethod = 'PATCH';
      else if (/^HttpHead$/i.test(httpAttr)) httpMethod = 'HEAD';
      else if (/^HttpOptions$/i.test(httpAttr)) httpMethod = 'OPTIONS';
      else if (/^Route$/i.test(httpAttr)) httpMethod = 'ANY';
      else if (/^AcceptVerbs$/i.test(httpAttr)) {
        const verbMatch = actionRouteArg.match(/(GET|POST|PUT|DELETE|PATCH)/i);
        if (verbMatch) httpMethod = verbMatch[1].toUpperCase() as HttpMethod;
      }

      const methodOffset = bodyStartIndex + methodMatch.index;
      const methodLine = code.substring(0, methodOffset).split('\n').length;

      const combined = combineRoutes(classRoute, actionRouteArg);
      const rawRoute = resolveRouteTokens(combined, controllerName, actionName, areaName);
      const normalized = normalizeRouteTemplate(rawRoute);

      const params = paramsArg
        .split(',')
        .map(p => p.trim())
        .filter(Boolean);

      const id = `${filePath}:${methodLine}:${httpMethod}:${rawRoute}`;

      endpoints.push({
        id,
        httpMethod,
        routeTemplate: rawRoute || '[root]',
        normalizedRoute: normalized || '[root]',
        controllerName,
        actionName,
        kind: 'controller',
        filePath,
        relativePath,
        line: methodLine,
        projectName,
        parameters: params,
        authorization: classAuth
      });
    }
  }

  // 2. Minimal API parsing (e.g. app.MapGet("...", ...), endpoints.MapPost("...", ...), group.MapPut("...", ...))
  const minimalApiRegex = /\b(?:app|endpoints|group|routes|api|builder)\s*\.\s*(MapGet|MapPost|MapPut|MapDelete|MapPatch|MapMethods)\s*\(\s*(?:\$|@)?"([^"]+)"/g;
  let minimalMatch: RegExpExecArray | null;

  while ((minimalMatch = minimalApiRegex.exec(code)) !== null) {
    const mapFunc = minimalMatch[1];
    const route = minimalMatch[2];

    let httpMethod: HttpMethod = 'GET';
    if (/MapPost/i.test(mapFunc)) httpMethod = 'POST';
    else if (/MapPut/i.test(mapFunc)) httpMethod = 'PUT';
    else if (/MapDelete/i.test(mapFunc)) httpMethod = 'DELETE';
    else if (/MapPatch/i.test(mapFunc)) httpMethod = 'PATCH';

    const matchOffset = minimalMatch.index;
    const line = code.substring(0, matchOffset).split('\n').length;
    const normalized = normalizeRouteTemplate(route);

    const id = `${filePath}:${line}:${httpMethod}:${route}`;

    endpoints.push({
      id,
      httpMethod,
      routeTemplate: route,
      normalizedRoute: normalized,
      actionName: `MinimalApi (${mapFunc})`,
      kind: 'minimalApi',
      filePath,
      relativePath,
      line,
      projectName
    });
  }

  return endpoints;
}

export class EndpointIndex {
  private readonly fileCache = new Map<string, ApiEndpoint[]>();

  public scanFileContent(
    filePath: string,
    content: string,
    projectName: string,
    relativePath: string
  ): ApiEndpoint[] {
    const endpoints = parseEndpointsFromCSharp(content, filePath, projectName, relativePath);
    this.fileCache.set(filePath, endpoints);
    return endpoints;
  }

  public async scanFile(filePath: string, projectName: string, relativePath: string): Promise<ApiEndpoint[]> {
    try {
      if (!fs.existsSync(filePath)) {
        this.fileCache.delete(filePath);
        return [];
      }
      const content = await fs.promises.readFile(filePath, 'utf8');
      return this.scanFileContent(filePath, content, projectName, relativePath);
    } catch {
      return [];
    }
  }

  public invalidateFile(filePath: string): void {
    this.fileCache.delete(filePath);
  }

  public clear(): void {
    this.fileCache.clear();
  }

  public getAllEndpoints(): ApiEndpoint[] {
    const all: ApiEndpoint[] = [];
    for (const list of this.fileCache.values()) {
      all.push(...list);
    }
    return all;
  }

  public get count(): number {
    let sum = 0;
    for (const list of this.fileCache.values()) {
      sum += list.length;
    }
    return sum;
  }
}
