import assert from 'node:assert/strict';
import test from 'node:test';
import {
  bundleArgs,
  optimizeArgs,
  removeMigrationArgs,
  scriptArgs,
  updateDatabaseArgs
} from '../ef/efActionArgs';

test('builds version-gated remove and update arguments', () => {
  assert.deepEqual(removeMigrationArgs({ force: true, offline: false }), [
    'migrations', 'remove', '--force'
  ]);
  assert.deepEqual(removeMigrationArgs({ force: false, offline: true }), [
    'migrations', 'remove', '--offline'
  ]);
  assert.deepEqual(updateDatabaseArgs({
    target: 'AddOrders',
    add: true,
    outputDirectory: 'Migrations/Products',
    namespaceName: 'App.Migrations'
  }), [
    'database', 'update', 'AddOrders', '--add',
    '--output-dir', 'Migrations/Products', '--namespace', 'App.Migrations'
  ]);
  assert.deepEqual(updateDatabaseArgs({ target: '', add: false }), ['database', 'update']);
});

test('builds SQL script ranges without empty positional arguments', () => {
  assert.deepEqual(scriptArgs({ from: '', to: '', idempotent: false, outputPath: '/tmp/a.sql' }), [
    'migrations', 'script', '--output', '/tmp/a.sql'
  ]);
  assert.deepEqual(scriptArgs({ from: '', to: 'AddOrders', idempotent: true, outputPath: '/tmp/a.sql' }), [
    'migrations', 'script', '0', 'AddOrders', '--idempotent', '--output', '/tmp/a.sql'
  ]);
});

test('builds bundle and optimize arguments from typed options', () => {
  assert.deepEqual(bundleArgs({
    outputPath: 'efbundle',
    force: true,
    selfContained: true,
    targetRuntime: 'linux-x64'
  }), [
    'migrations', 'bundle', '--output', 'efbundle', '--force',
    '--self-contained', '--target-runtime', 'linux-x64'
  ]);
  assert.deepEqual(optimizeArgs({
    outputDirectory: 'CompiledModels',
    namespaceName: 'App.Compiled',
    suffix: 'Runtime',
    noScaffold: true,
    precompileQueries: true,
    nativeAot: true
  }), [
    'dbcontext', 'optimize', '--output-dir', 'CompiledModels',
    '--namespace', 'App.Compiled', '--suffix', 'Runtime',
    '--no-scaffold', '--precompile-queries', '--nativeaot'
  ]);
});
