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
