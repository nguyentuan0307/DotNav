import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_CONTAINER_FOLDERS, containerFolderOf, containerFolderSet } from '../containerFolders';

test('default container folders cover common layout names including tools', () => {
  const folders = containerFolderSet();

  for (const name of ['src', 'source', 'sources', 'test', 'tests', 'tools']) {
    assert.ok(folders.has(name), `${name} should be a container folder by default`);
  }

  assert.deepStrictEqual(DEFAULT_CONTAINER_FOLDERS, ['src', 'source', 'sources', 'test', 'tests', 'tools']);
});

test('containerFolderSet lower-cases configured names and an empty list disables grouping', () => {
  assert.ok(containerFolderSet(['Tools']).has('tools'));
  assert.strictEqual(containerFolderSet([]).size, 0);
});

test('containerFolderOf returns the first segment for container paths only', () => {
  const folders = containerFolderSet();

  assert.strictEqual(containerFolderOf('tools/BlogMaintenance/BlogMaintenance.csproj', folders), 'tools');
  assert.strictEqual(containerFolderOf('src/Rabit.Api/Rabit.Api.csproj', folders), 'src');
  assert.strictEqual(containerFolderOf('Tools/Import/Import.csproj', folders), 'Tools');

  // A single path segment is the project file itself at the solution root,
  // which never becomes a folder.
  assert.strictEqual(containerFolderOf('Rabit.Api.csproj', folders), undefined);
  assert.strictEqual(containerFolderOf('', folders), undefined);

  // First segment outside the list: keep the project at the root.
  assert.strictEqual(containerFolderOf('extensions/dotnav/package.json', folders), undefined);
});

test('containerFolderOf honours a custom list', () => {
  const folders = containerFolderSet(['apps']);

  assert.strictEqual(containerFolderOf('apps/web/web.csproj', folders), 'apps');
  assert.strictEqual(containerFolderOf('tools/BlogMaintenance/BlogMaintenance.csproj', folders), undefined);
});
