import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import * as path from 'path';
import test from 'node:test';

const manifest = JSON.parse(
  readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf8')
) as {
  contributes: {
    commands: { command: string; title: string; category?: string }[];
    submenus: { id: string; label: string }[];
    views: Record<string, { id: string }[]>;
    menus: Record<string, { command?: string; submenu?: string; when?: string; group?: string }[]>;
    configuration: { properties: Record<string, unknown> };
  };
};

const efCommands = manifest.contributes.commands.filter(command => command.command.startsWith('dotnav.ef.'));

test('EF actions hang off the project context menu, not a separate view', () => {
  assert.ok(
    !manifest.contributes.views.dotnavContainer.some(view => view.id === 'dotnav.efCore'),
    'the EF tree view was replaced by the context menu'
  );

  assert.ok(manifest.contributes.submenus.some(submenu =>
    submenu.id === 'dotnav.efCore' && submenu.label === 'Entity Framework Core'));

  const anchors = manifest.contributes.menus['view/item/context']
    .filter(item => item.submenu === 'dotnav.efCore');
  assert.equal(anchors.length, 1);
  assert.match(anchors[0].when ?? '', /view == dotnav\b/);
  assert.match(anchors[0].when ?? '', /viewItem =~ \/\^project/);
  assert.match(anchors[0].when ?? '', /ef/);
});

test('every submenu entry maps to a declared command', () => {
  const declared = new Set(manifest.contributes.commands.map(command => command.command));
  for (const item of manifest.contributes.menus['dotnav.efCore']) {
    assert.ok(item.command, 'submenu entries are plain commands');
    assert.ok(declared.has(item.command!), `undeclared command ${item.command}`);
  }
});

test('the destructive action sits in its own trailing group', () => {
  const drop = manifest.contributes.menus['dotnav.efCore']
    .find(item => item.command === 'dotnav.ef.dropDatabase');
  assert.ok(drop);
  assert.match(drop!.group ?? '', /^9_/);

  const others = manifest.contributes.menus['dotnav.efCore']
    .filter(item => item.command !== 'dotnav.ef.dropDatabase');
  assert.ok(others.every(item => !/^9_/.test(item.group ?? '')));
});

test('the project submenu contains contextual actions and keeps maintenance in the Center toolbar', () => {
  const entries = manifest.contributes.menus['dotnav.efCore'];
  assert.equal(entries.length, 11);
  for (const maintenance of [
    'dotnav.ef.refresh',
    'dotnav.ef.showOutput',
    'dotnav.ef.openSettings',
    'dotnav.ef.installTool'
  ]) {
    assert.ok(!entries.some(item => item.command === maintenance), `${maintenance} belongs in the Center toolbar`);
  }
  assert.ok(entries.some(item => item.command === 'dotnav.ef.openCenter'));
  assert.ok(entries.some(item => item.command === 'dotnav.ef.pendingModelChanges'));
  assert.ok(entries.some(item => item.command === 'dotnav.ef.openDiagram'));
});

test('no menu entry references a command that was removed with the tree view', () => {
  const declared = new Set(manifest.contributes.commands.map(command => command.command));
  for (const [menu, items] of Object.entries(manifest.contributes.menus)) {
    for (const item of items) {
      assert.ok(
        !item.when?.includes('dotnav.efCore') || item.submenu === 'dotnav.efCore',
        `${menu} still targets the removed EF view`
      );
      if (item.command?.startsWith('dotnav.ef.')) {
        assert.ok(declared.has(item.command), `${menu} references removed command ${item.command}`);
      }
    }
  }
});

test('EF commands share the "EF Core" palette category', () => {
  assert.ok(efCommands.length > 0);
  for (const command of efCommands) {
    assert.equal(command.category, 'EF Core', `${command.command} must be grouped under EF Core`);
  }
});

test('declares the complete Center, diagnostics, and advanced command set', () => {
  const declared = new Set(efCommands.map(command => command.command));
  for (const expected of [
    'dotnav.ef.openCenter',
    'dotnav.ef.pendingModelChanges',
    'dotnav.ef.migrationsBundle',
    'dotnav.ef.optimizeDbContext',
    'dotnav.ef.openDiagram'
  ]) {
    assert.ok(declared.has(expected), `missing ${expected}`);
  }
});

test('EF settings are declared under the dotnav.ef namespace', () => {
  const keys = Object.keys(manifest.contributes.configuration.properties)
    .filter(key => key.startsWith('dotnav.ef.'));
  for (const expected of [
    'dotnav.ef.enable',
    'dotnav.ef.startupProject',
    'dotnav.ef.configuration',
    'dotnav.ef.noBuild',
    'dotnav.ef.verbose'
  ]) {
    assert.ok(keys.includes(expected), `missing setting ${expected}`);
  }
});
