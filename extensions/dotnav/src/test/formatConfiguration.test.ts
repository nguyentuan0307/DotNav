import assert from 'assert/strict';
import { readFileSync } from 'fs';
import * as path from 'path';
import test from 'node:test';

test('format selection is strict by default and member expansion is opt-in', () => {
  const manifest = JSON.parse(readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf8'));
  const setting = manifest.contributes.configuration.properties['dotnav.format.expandToEnclosingMember'];

  assert.equal(setting.default, false);
  assert.match(setting.description, /only changes the selected lines/i);
});

test('offers explicit code and document reformat commands', () => {
  const manifest = JSON.parse(readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf8'));
  const commands = new Set(manifest.contributes.commands.map((command: { command: string }) => command.command));

  assert.equal(commands.has('dotnav.formatSelection'), true);
  assert.equal(commands.has('dotnav.formatDocument'), true);
});

test('enables smart style detection without requiring user configuration', () => {
  const manifest = JSON.parse(readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf8'));
  const properties = manifest.contributes.configuration.properties;

  assert.equal(properties['dotnav.format.styleDetection'].default, true);
  assert.equal(properties['dotnav.format.preserveExistingLayout'].default, true);
  assert.equal(properties['dotnav.format.continuationIndentMultiplier'].default, 0);
  assert.match(properties['dotnav.format.continuationIndentMultiplier'].description, /automatically/i);
});

test('project context actions are grouped into project and copy submenus', () => {
  const manifest = JSON.parse(readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf8'));

  assert.ok(manifest.contributes.submenus.some((submenu: { id: string; label: string }) =>
    submenu.id === 'dotnav.project' && submenu.label === 'Project'
  ));
  assert.ok(manifest.contributes.submenus.some((submenu: { id: string; label: string }) =>
    submenu.id === 'dotnav.copy' && submenu.label === 'Copy'
  ));
  assert.ok(manifest.contributes.menus['view/item/context'].some((item: { submenu?: string; when: string }) =>
    item.submenu === 'dotnav.project' && item.when.includes('viewItem =~ /project/')
  ));
  assert.ok(manifest.contributes.menus['view/item/context'].some((item: { submenu?: string; when: string }) =>
    item.submenu === 'dotnav.copy' && item.when.includes('viewItem =~ /file|folder|project/')
  ));
});
