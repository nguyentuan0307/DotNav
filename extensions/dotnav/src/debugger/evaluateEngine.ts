import * as vscode from 'vscode';

export interface DapVariable {
  readonly name: string;
  readonly value: string;
  readonly type?: string;
  readonly evaluateName?: string;
  readonly variablesReference?: number;
}

export interface DapStackFrame {
  readonly id: number;
  readonly name: string;
  readonly source?: { name?: string; path?: string };
  readonly line: number;
  readonly column: number;
}

export interface DapEvaluateResponse {
  readonly result: string;
  readonly type?: string;
  readonly variablesReference?: number;
  readonly success: boolean;
  readonly error?: string;
  readonly usedExpression: string;
}

/**
 * Retrieves active stack frame ID for the debug session
 */
export async function getActiveStackFrame(session: vscode.DebugSession): Promise<DapStackFrame | undefined> {
  try {
    const threadsResponse = await session.customRequest('threads');
    const threads = threadsResponse?.threads;
    if (!threads || threads.length === 0) {
      return undefined;
    }

    // Default to the first thread or active thread
    const threadId = threads[0].id;
    const stackTraceResponse = await session.customRequest('stackTrace', {
      threadId,
      startFrame: 0,
      levels: 1
    });

    const frames = stackTraceResponse?.stackFrames;
    if (!frames || frames.length === 0) {
      return undefined;
    }

    const topFrame = frames[0];
    return {
      id: topFrame.id,
      name: topFrame.name,
      source: topFrame.source,
      line: topFrame.line,
      column: topFrame.column
    };
  } catch {
    return undefined;
  }
}

/**
 * Retrieves all local variables and arguments for the current stack frame
 */
export async function getLocalVariables(
  session: vscode.DebugSession,
  frameId: number
): Promise<Map<string, DapVariable>> {
  const varsMap = new Map<string, DapVariable>();
  try {
    const scopesResponse = await session.customRequest('scopes', { frameId });
    const scopes = scopesResponse?.scopes || [];

    for (const scope of scopes) {
      // Typically 'Locals' or 'Arguments'
      if (scope.variablesReference > 0) {
        const varsResponse = await session.customRequest('variables', {
          variablesReference: scope.variablesReference
        });
        const variables = varsResponse?.variables || [];
        for (const v of variables) {
          if (v.name) {
            varsMap.set(v.name, {
              name: v.name,
              value: v.value,
              type: v.type,
              evaluateName: v.evaluateName || v.name,
              variablesReference: v.variablesReference
            });
          }
        }
      }
    }
  } catch {
    // Ignore scope extraction failure
  }
  return varsMap;
}

/**
 * Normalizes C# expressions to be compatible with vsdbg expression evaluator
 */
export function rewriteCSharpExpressionForDap(
  rawExpression: string,
  localVars?: Map<string, DapVariable>
): string[] {
  let expr = rawExpression.trim().replace(/;+$/, '');
  const candidates: string[] = [];

  // Candidate 1: The trimmed expression as typed
  candidates.push(expr);

  // Pattern 1: .ToQueryString() -> Microsoft.EntityFrameworkCore.EntityFrameworkQueryableExtensions.ToQueryString(target)
  const toQueryStringMatch = /^(.+)\.ToQueryString\s*\(\s*\)$/.exec(expr);
  if (toQueryStringMatch) {
    const target = toQueryStringMatch[1].trim();
    candidates.push(`Microsoft.EntityFrameworkCore.EntityFrameworkQueryableExtensions.ToQueryString(${target})`);
  }

  // Pattern 2: target.DebugView.Query or target.DebugView -> cast to EntityQueryable
  const debugViewMatch = /^(.+)\.DebugView(?:\.Query)?$/.exec(expr);
  if (debugViewMatch) {
    const target = debugViewMatch[1].trim();
    const varInfo = localVars?.get(target);
    const typeName = varInfo?.type;
    if (typeName && typeName.includes('<') && typeName.includes('>')) {
      const genericType = typeName.substring(typeName.indexOf('<') + 1, typeName.lastIndexOf('>'));
      candidates.push(`((Microsoft.EntityFrameworkCore.Query.Internal.EntityQueryable<${genericType}>)${target}).DebugView.Query`);
    } else {
      candidates.push(`((Microsoft.EntityFrameworkCore.Query.Internal.EntityQueryable<object>)${target}).DebugView.Query`);
    }
  }

  // Pattern 3: If expression is an IQueryable variable name or a chain starting with one
  let targetVar = expr;
  const rootVarMatch = /^([a-zA-Z0-9_]+)\s*\./.exec(expr);
  if (rootVarMatch && localVars?.has(rootVarMatch[1])) {
    targetVar = rootVarMatch[1];
  }

  if (localVars && localVars.has(targetVar)) {
    const varInfo = localVars.get(targetVar);
    const isQueryable = varInfo?.type?.includes('IQueryable') || varInfo?.type?.includes('EntityQueryable') || varInfo?.type?.includes('DbSet');
    if (isQueryable) {
      candidates.push(`Microsoft.EntityFrameworkCore.EntityFrameworkQueryableExtensions.ToQueryString(${targetVar})`);
      if (varInfo?.type && varInfo.type.includes('<') && varInfo.type.includes('>')) {
        const genericType = varInfo.type.substring(varInfo.type.indexOf('<') + 1, varInfo.type.lastIndexOf('>'));
        candidates.push(`((Microsoft.EntityFrameworkCore.Query.Internal.EntityQueryable<${genericType}>)${targetVar}).DebugView.Query`);
      }
    }
  }

  // Pattern 4: .Count(), .Any(), .First() extension methods on queryable/enumerable
  const countMatch = /^(.+)\.Count\s*\(\s*\)$/.exec(expr);
  if (countMatch) {
    const target = countMatch[1].trim();
    candidates.push(`System.Linq.Queryable.Count(${target})`);
    candidates.push(`System.Linq.Enumerable.Count(${target})`);
  }

  const anyMatch = /^(.+)\.Any\s*\(\s*\)$/.exec(expr);
  if (anyMatch) {
    const target = anyMatch[1].trim();
    candidates.push(`System.Linq.Queryable.Any(${target})`);
    candidates.push(`System.Linq.Enumerable.Any(${target})`);
  }

  return [...new Set(candidates)];
}

/**
 * Evaluates an expression against the active DAP session, trying smart fallbacks if needed
 */
export async function evaluateDapExpression(
  session: vscode.DebugSession,
  frameId: number,
  rawExpression: string,
  localVars?: Map<string, DapVariable>
): Promise<DapEvaluateResponse> {
  const candidates = rewriteCSharpExpressionForDap(rawExpression, localVars);
  let lastError: string | undefined;

  for (const expr of candidates) {
    try {
      const response = await session.customRequest('evaluate', {
        expression: expr,
        frameId,
        context: 'watch'
      });

      if (response && response.result !== undefined) {
        return {
          result: response.result,
          type: response.type,
          variablesReference: response.variablesReference,
          success: true,
          usedExpression: expr
        };
      }
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
  }

  return {
    result: '',
    success: false,
    error: lastError || 'Unable to evaluate expression',
    usedExpression: rawExpression
  };
}
