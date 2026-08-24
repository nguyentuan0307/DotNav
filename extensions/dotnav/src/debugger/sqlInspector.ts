import * as vscode from 'vscode';
import { DapVariable, evaluateDapExpression } from './evaluateEngine';

export interface SqlParameter {
  readonly name: string;
  readonly value: string;
  readonly type?: string;
}

export interface ExtractedSqlQuery {
  readonly rawSql: string;
  readonly formattedSql: string;
  readonly boundSql: string;
  readonly parameters: SqlParameter[];
  readonly tables: string[];
  readonly sourceExpression: string;
}

/**
 * Pretty-formats SQL statements for display
 */
export function formatSqlPretty(sql: string): string {
  if (!sql) return '';

  // Clean unescaped quotes or string literal wrappers
  let cleaned = sql
    .replace(/^["']|["']$/g, '')
    .replace(/\\r\\n/g, '\n')
    .replace(/\\n/g, '\n')
    .replace(/\\"/g, '"');

  // Strip EF Core debug header if present (.param set ...)
  const lines = cleaned.split('\n');
  const sqlLines: string[] = [];
  for (const line of lines) {
    if (!line.trim().startsWith('.param')) {
      sqlLines.push(line);
    }
  }
  cleaned = sqlLines.join('\n').trim();

  // Major SQL keywords to format
  const keywords = [
    'SELECT', 'FROM', 'WHERE', 'ORDER BY', 'GROUP BY', 'HAVING',
    'LEFT JOIN', 'RIGHT JOIN', 'INNER JOIN', 'FULL JOIN', 'CROSS JOIN', 'JOIN',
    'OFFSET', 'FETCH NEXT', 'ROWS ONLY', 'UNION ALL', 'UNION',
    'INSERT INTO', 'VALUES', 'UPDATE', 'SET', 'DELETE FROM'
  ];

  let result = cleaned;
  for (const kw of keywords) {
    const regex = new RegExp(`\\b(${kw})\\b`, 'gi');
    result = result.replace(regex, (match) => match.toUpperCase());
  }

  // Basic indentation around clauses
  result = result
    .replace(/\s+(FROM)\s+/g, '\nFROM ')
    .replace(/\s+(WHERE)\s+/g, '\nWHERE ')
    .replace(/\s+(ORDER BY)\s+/g, '\nORDER BY ')
    .replace(/\s+(GROUP BY)\s+/g, '\nGROUP BY ')
    .replace(/\s+(HAVING)\s+/g, '\nHAVING ')
    .replace(/\s+(LEFT JOIN|RIGHT JOIN|INNER JOIN|JOIN)\s+/g, '\n  $1 ')
    .replace(/\s+(OFFSET)\s+/g, '\nOFFSET ')
    .replace(/\s+(FETCH NEXT)\s+/g, '\nFETCH NEXT ');

  return result.trim();
}

/**
 * Extracts parameters from EF Core debug query text
 */
export function extractParametersFromDebugText(rawText: string): SqlParameter[] {
  const params: SqlParameter[] = [];
  const regex = /^\.param\s+set\s+(@[a-zA-Z0-9_]+)\s+(.+)$/gm;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(rawText)) !== null) {
    const name = match[1];
    let val = match[2].trim();
    params.push({ name, value: val });
  }

  // Also check for parameters declared in standard comments: -- @p0='1' (Type = Int32)
  const commentRegex = /--\s*(@[a-zA-Z0-9_]+)\s*:\s*([^(\n]+)(?:\s*\(([^)]+)\))?/g;
  while ((match = commentRegex.exec(rawText)) !== null) {
    params.push({
      name: match[1],
      value: match[2].trim(),
      type: match[3]?.trim()
    });
  }

  return params;
}

/**
 * Inlines parameter values into the SQL query for easy copy-paste to SQL tools
 */
export function bindParametersToSql(sql: string, parameters: SqlParameter[]): string {
  let bound = sql;
  for (const p of parameters) {
    let literal = p.value;
    if (literal === 'NULL' || literal === 'null') {
      literal = 'NULL';
    } else if (literal === 'true' || literal === 'True') {
      literal = '1';
    } else if (literal === 'false' || literal === 'False') {
      literal = '0';
    } else if (!literal.startsWith("'") && isNaN(Number(literal))) {
      literal = `'${literal.replace(/'/g, "''")}'`;
    }

    // Match exact parameter token, e.g. @__appId_0 or @_p0 or @p0
    const escaped = p.name.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
    bound = bound.replace(new RegExp(`${escaped}\\b`, 'g'), literal);
  }
  return bound;
}

/**
 * Detects table names referenced in the query
 */
export function extractTablesFromSql(sql: string): string[] {
  const tables = new Set<string>();
  const regex = /\b(?:FROM|JOIN)\s+(?:\[?([a-zA-Z0-9_]+)\]?\.)?\[?([a-zA-Z0-9_]+)\]?(?:\s+(?:AS\s+)?\[?([a-zA-Z0-9_]+)\]?)?/gi;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(sql)) !== null) {
    const tableName = match[2];
    if (tableName && !['SELECT', 'WHERE', 'JOIN', 'FROM', 'ORDER', 'GROUP'].includes(tableName.toUpperCase())) {
      tables.add(tableName);
    }
  }

  return Array.from(tables);
}

/**
 * Extracts and inspects EF Core SQL from an active debug session and frame
 */
export async function inspectSqlFromDebugSession(
  session: vscode.DebugSession,
  frameId: number,
  rawExpression: string,
  localVars?: Map<string, DapVariable>
): Promise<ExtractedSqlQuery | undefined> {
  const evalResult = await evaluateDapExpression(session, frameId, rawExpression, localVars);

  if (!evalResult.success || !evalResult.result) {
    return undefined;
  }

  const rawText = evalResult.result;
  const isSqlLike =
    rawText.includes('SELECT') ||
    rawText.includes('FROM') ||
    rawText.includes('INSERT') ||
    rawText.includes('UPDATE') ||
    rawText.includes('.param');

  if (!isSqlLike) {
    return undefined;
  }

  const parameters = extractParametersFromDebugText(rawText);
  let formattedSql = formatSqlPretty(rawText);

  // Check if expression contains OrderBy/OrderByDescending and formattedSql doesn't have ORDER BY
  const orderMatch = /\.OrderBy(Descending)?\s*\(\s*(?:[a-zA-Z0-9_]+|\(\s*\))\s*=>\s*(?:[a-zA-Z0-9_]+|\(\s*\))\s*\.?\s*([a-zA-Z0-9_]+)\s*\)/.exec(rawExpression);
  if (orderMatch && !formattedSql.includes('ORDER BY')) {
    const isDesc = orderMatch[1] === 'Descending';
    const propName = orderMatch[2];
    formattedSql += `\nORDER BY [${propName}] ${isDesc ? 'DESC' : 'ASC'}`;
  }

  const boundSql = bindParametersToSql(formattedSql, parameters);
  const tables = extractTablesFromSql(formattedSql);

  return {
    rawSql: rawText,
    formattedSql,
    boundSql,
    parameters,
    tables,
    sourceExpression: rawExpression
  };
}
