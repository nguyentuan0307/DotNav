import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  DapVariable,
  rewriteCSharpExpressionForDap
} from '../debugger/evaluateEngine';
import {
  bindParametersToSql,
  extractParametersFromDebugText,
  extractTablesFromSql,
  formatSqlPretty
} from '../debugger/sqlInspector';

test('rewriteCSharpExpressionForDap rewrites .ToQueryString() to static call', () => {
  const candidates = rewriteCSharpExpressionForDap('myQuery.ToQueryString()');
  assert.equal(candidates.includes('Microsoft.EntityFrameworkCore.EntityFrameworkQueryableExtensions.ToQueryString(myQuery)'), true);
});

test('rewriteCSharpExpressionForDap rewrites .DebugView.Query to EntityQueryable downcast', () => {
  const localVars = new Map<string, DapVariable>([
    ['query', { name: 'query', value: '{...}', type: 'System.Linq.IQueryable<AppField>' }]
  ]);

  const candidates = rewriteCSharpExpressionForDap('query.DebugView.Query', localVars);
  assert.equal(
    candidates.includes('((Microsoft.EntityFrameworkCore.Query.Internal.EntityQueryable<AppField>)query).DebugView.Query'),
    true
  );
});

test('rewriteCSharpExpressionForDap auto-detects IQueryable variable and generates inspection queries', () => {
  const localVars = new Map<string, DapVariable>([
    ['customFields', { name: 'customFields', value: '{...}', type: 'Microsoft.EntityFrameworkCore.DbSet<CustomField>' }]
  ]);

  const candidates = rewriteCSharpExpressionForDap('customFields', localVars);
  assert.equal(
    candidates.includes('Microsoft.EntityFrameworkCore.EntityFrameworkQueryableExtensions.ToQueryString(customFields)'),
    true
  );
  assert.equal(
    candidates.includes('((Microsoft.EntityFrameworkCore.Query.Internal.EntityQueryable<CustomField>)customFields).DebugView.Query'),
    true
  );
});

test('rewriteCSharpExpressionForDap rewrites extension methods .Count() and .Any()', () => {
  const candidates = rewriteCSharpExpressionForDap('orders.Count()');
  assert.equal(candidates.includes('System.Linq.Queryable.Count(orders)'), true);
  assert.equal(candidates.includes('System.Linq.Enumerable.Count(orders)'), true);
});

test('formatSqlPretty correctly formats keywords and clauses', () => {
  const rawSql = 'select [a].[Id], [a].[Name] from [AppField] as [a] where [a].[IsActive] = 1 order by [a].[Id] desc';
  const formatted = formatSqlPretty(rawSql);

  assert.equal(formatted.includes('SELECT [a].[Id]'), true);
  assert.equal(formatted.includes('\nFROM [AppField]'), true);
  assert.equal(formatted.includes('\nWHERE [a].[IsActive]'), true);
  assert.equal(formatted.includes('\nORDER BY [a].[Id]'), true);
});

test('extractParametersFromDebugText extracts EF Core parameters', () => {
  const debugText = `
.param set @_appId 'app_12345'
.param set @_parentId NULL
.param set @_isDisplay 'true'
SELECT [t].[Id] FROM [AppField] AS [t]
`;

  const params = extractParametersFromDebugText(debugText);
  assert.equal(params.length, 3);
  assert.equal(params[0].name, '@_appId');
  assert.equal(params[0].value, "'app_12345'");
  assert.equal(params[1].name, '@_parentId');
  assert.equal(params[1].value, 'NULL');
  assert.equal(params[2].name, '@_isDisplay');
});

test('bindParametersToSql inlines parameter values into query', () => {
  const sql = 'SELECT * FROM [AppField] WHERE [AppId] = @_appId AND [ParentId] IS @_parentId';
  const params = [
    { name: '@_appId', value: '123' },
    { name: '@_parentId', value: 'NULL' }
  ];

  const bound = bindParametersToSql(sql, params);
  assert.equal(bound, 'SELECT * FROM [AppField] WHERE [AppId] = 123 AND [ParentId] IS NULL');
});

test('extractTablesFromSql identifies table names from query', () => {
  const sql = `
SELECT [a].[Id], [d].[Name]
FROM [AppField] AS [a]
LEFT JOIN [DataEntity] AS [d] ON [a].[DataEntityId] = [d].[Id]
WHERE [a].[AppId] = 1
`;

  const tables = extractTablesFromSql(sql);
  assert.equal(tables.includes('AppField'), true);
  assert.equal(tables.includes('DataEntity'), true);
});

test('rewriteCSharpExpressionForDap extracts root variable from complex chained LINQ expressions', () => {
  const localVars = new Map<string, DapVariable>([
    ['query', { name: 'query', value: '{...}', type: 'System.Linq.IQueryable<AppField>' }]
  ]);

  const chainedExpr = `query
    .OrderByDescending(_ => _.Id)
    .Select(DbConnectionFieldDataResponse.GetBasicConnectionDataSelection(null, connectionField.TableFieldId).Expand())`;

  const candidates = rewriteCSharpExpressionForDap(chainedExpr, localVars);
  assert.equal(
    candidates.includes('Microsoft.EntityFrameworkCore.EntityFrameworkQueryableExtensions.ToQueryString(query)'),
    true
  );
  assert.equal(
    candidates.includes('((Microsoft.EntityFrameworkCore.Query.Internal.EntityQueryable<AppField>)query).DebugView.Query'),
    true
  );
});

