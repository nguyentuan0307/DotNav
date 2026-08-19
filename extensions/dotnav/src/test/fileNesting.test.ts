import assert from 'node:assert/strict';
import test from 'node:test';
import { nestFiles } from '../fileNesting';
import { TreeNode } from '../models';

test('nestFiles correctly nests C# Designer, generated, and g.cs files under parent', () => {
  const input: TreeNode[] = [
    { kind: 'file', label: 'Program.cs', resourcePath: '/app/Program.cs', collapsibleState: 0 },
    { kind: 'file', label: 'MainWindow.xaml', resourcePath: '/app/MainWindow.xaml', collapsibleState: 0 },
    { kind: 'file', label: 'MainWindow.xaml.cs', resourcePath: '/app/MainWindow.xaml.cs', collapsibleState: 0 },
    { kind: 'file', label: 'UserService.cs', resourcePath: '/app/UserService.cs', collapsibleState: 0 },
    { kind: 'file', label: 'UserService.Designer.cs', resourcePath: '/app/UserService.Designer.cs', collapsibleState: 0 },
    { kind: 'file', label: 'UserService.g.cs', resourcePath: '/app/UserService.g.cs', collapsibleState: 0 },
    { kind: 'file', label: 'appsettings.json', resourcePath: '/app/appsettings.json', collapsibleState: 0 },
    { kind: 'file', label: 'appsettings.Development.json', resourcePath: '/app/appsettings.Development.json', collapsibleState: 0 },
    { kind: 'file', label: 'appsettings.Production.json', resourcePath: '/app/appsettings.Production.json', collapsibleState: 0 },
    { kind: 'file', label: 'package.json', resourcePath: '/app/package.json', collapsibleState: 0 },
    { kind: 'file', label: 'package-lock.json', resourcePath: '/app/package-lock.json', collapsibleState: 0 },
    { kind: 'file', label: 'docker-compose.yml', resourcePath: '/app/docker-compose.yml', collapsibleState: 0 },
    { kind: 'file', label: 'docker-compose.override.yml', resourcePath: '/app/docker-compose.override.yml', collapsibleState: 0 }
  ];

  const nested = nestFiles(input);

  const labels = nested.map(n => n.label);
  assert.deepStrictEqual(labels, [
    'Program.cs',
    'MainWindow.xaml',
    'UserService.cs',
    'appsettings.json',
    'package.json',
    'docker-compose.yml'
  ]);

  const userNode = nested.find(n => n.label === 'UserService.cs');
  assert.ok(userNode?.children);
  assert.strictEqual(userNode.children.length, 2);
  assert.deepStrictEqual(userNode.children.map(c => c.label), ['UserService.Designer.cs', 'UserService.g.cs']);

  const appsettingsNode = nested.find(n => n.label === 'appsettings.json');
  assert.ok(appsettingsNode?.children);
  assert.strictEqual(appsettingsNode.children.length, 2);
  assert.deepStrictEqual(appsettingsNode.children.map(c => c.label), ['appsettings.Development.json', 'appsettings.Production.json']);

  const pkgNode = nested.find(n => n.label === 'package.json');
  assert.ok(pkgNode?.children);
  assert.strictEqual(pkgNode.children.length, 1);
  assert.strictEqual(pkgNode.children[0].label, 'package-lock.json');
});
