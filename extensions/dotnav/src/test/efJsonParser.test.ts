import assert from 'node:assert/strict';
import test from 'node:test';
import {
  classifyEfError,
  extractJsonPayload,
  maskConnectionString,
  migrationNameFromId,
  migrationTimestampFromId,
  parseDbContextInfo,
  parseDbContextList,
  parseMigrationFileName,
  parseMigrationsList,
  summarizeEfError,
  validateMigrationName
} from '../ef/efJsonParser';

test('extracts payload from data-prefixed output', () => {
  const output = [
    'Build started...',
    'Build succeeded.',
    'data: [',
    'data:   { "id": "20260101120000_Init", "name": "Init", "applied": true }',
    'data: ]'
  ].join('\n');
  const payload = extractJsonPayload(output);
  assert.ok(payload);
  assert.deepEqual(JSON.parse(payload!), [{ id: '20260101120000_Init', name: 'Init', applied: true }]);
});

test('extracts raw JSON payload mixed with build noise', () => {
  const output = 'Build started...\nBuild succeeded.\n[\n  { "id": "20260101120000_Init", "name": "Init" }\n]';
  const payload = extractJsonPayload(output);
  assert.ok(payload);
  assert.equal(JSON.parse(payload!)[0].id, '20260101120000_Init');
});

test('returns undefined when no payload exists', () => {
  assert.equal(extractJsonPayload('Build FAILED.\n  error CS1002: ; expected'), undefined);
});

test('parses migrations list across EF versions', () => {
  const withApplied = 'data: [{ "id": "20260101120000_Init", "name": "Init", "safeName": "Init", "applied": false }]';
  const entries = parseMigrationsList(withApplied);
  assert.deepEqual(entries, [{ id: '20260101120000_Init', name: 'Init', applied: false }]);

  // Older/unknown shapes: missing name and applied fields are tolerated.
  const minimal = 'data: [{ "id": "20260101120000_AddOrders", "extraField": 1 }]';
  const minimalEntries = parseMigrationsList(minimal);
  assert.deepEqual(minimalEntries, [{ id: '20260101120000_AddOrders', name: 'AddOrders', applied: undefined }]);
});

test('parses dbcontext list', () => {
  const output = 'data: [{ "fullName": "MyApp.Data.AppDbContext", "safeName": "AppDbContext", "name": "AppDbContext", "assemblyQualifiedName": "x" }]';
  const entries = parseDbContextList(output);
  assert.equal(entries?.length, 1);
  assert.equal(entries![0].fullName, 'MyApp.Data.AppDbContext');
  assert.equal(entries![0].name, 'AppDbContext');
});

test('parses dbcontext info object payload', () => {
  const output = 'data: { "providerName": "Microsoft.EntityFrameworkCore.SqlServer", "databaseName": "MyAppDb", "dataSource": "localhost", "options": "None" }';
  const info = parseDbContextInfo(output);
  assert.equal(info?.databaseName, 'MyAppDb');
  assert.equal(info?.providerName, 'Microsoft.EntityFrameworkCore.SqlServer');
});

test('derives migration name and timestamp from id', () => {
  assert.equal(migrationNameFromId('20260722140000_AddOrders'), 'AddOrders');
  assert.equal(migrationNameFromId('NotAnId'), 'NotAnId');
  const timestamp = migrationTimestampFromId('20260722140000_AddOrders');
  assert.equal(timestamp?.toISOString(), '2026-07-22T14:00:00.000Z');
});

test('recognizes migration file names and skips designer files', () => {
  assert.deepEqual(
    parseMigrationFileName('20260722140000_AddOrders.cs'),
    { id: '20260722140000_AddOrders', name: 'AddOrders' }
  );
  assert.equal(parseMigrationFileName('20260722140000_AddOrders.Designer.cs'), undefined);
  assert.equal(parseMigrationFileName('AppDbContextModelSnapshot.cs'), undefined);
});

test('classifies EF errors', () => {
  assert.equal(classifyEfError('', 'Build FAILED.\nBuild failed. Use dotnet build...'), 'buildError');
  assert.equal(
    classifyEfError('Could not execute because the specified command or file was not found.', ''),
    'toolMissing'
  );
  assert.equal(
    classifyEfError('A network-related or instance-specific error occurred while establishing a connection to SQL Server.', ''),
    'dbConnection'
  );
  assert.equal(
    classifyEfError("Your startup project 'Web' doesn't reference Microsoft.EntityFrameworkCore.Design.", ''),
    'startupProject'
  );
  assert.equal(classifyEfError('Some unexpected failure', ''), 'general');
});

test('summarizes errors without stack frames', () => {
  const stderr = [
    'System.InvalidOperationException: boom',
    '   at MyApp.Data.Something()',
    '   at Microsoft.EntityFrameworkCore.Whatever()',
    'The underlying failure message.'
  ].join('\n');
  assert.equal(summarizeEfError(stderr, ''), 'The underlying failure message.');
});

test('masks secrets in connection strings', () => {
  const masked = maskConnectionString('Server=db;Database=App;User Id=sa;Password=Secr;et123;TrustServerCertificate=true');
  assert.ok(!masked.includes('Secr'));
  assert.ok(masked.includes('Password=***'));
  assert.ok(masked.includes('Server=db'));

  const uriMasked = maskConnectionString('postgres://admin:hunter2@localhost:5432/app');
  assert.ok(!uriMasked.includes('hunter2'));
  assert.ok(uriMasked.includes('admin'));

  const pwd = maskConnectionString('Host=x;Pwd=abc123;Port=5432');
  assert.ok(!pwd.includes('abc123'));
});

test('validates migration names', () => {
  assert.equal(validateMigrationName('AddOrders', []), undefined);
  assert.equal(validateMigrationName('_private', []), undefined);
  assert.ok(validateMigrationName('', []));
  assert.ok(validateMigrationName('   ', []));
  assert.ok(validateMigrationName('1BadName', []));
  assert.ok(validateMigrationName('Bad-Name', []));
  assert.ok(validateMigrationName('addorders', ['AddOrders']));
});
