import { readFileSync } from 'fs';
import * as path from 'path';
import test from 'node:test';
import assert from 'node:assert/strict';

const extensionRoot = path.join(__dirname, '..', '..');
const manifest = JSON.parse(readFileSync(path.join(extensionRoot, 'package.json'), 'utf8'));
const extensionSource = readFileSync(path.join(extensionRoot, 'src', 'extension.ts'), 'utf8');

test('offers project editing only for idle compound run configurations', () => {
  assert.ok(manifest.contributes.commands.some(
    (item: { command: string }) => item.command === 'dotnav.editRunConfigProjects'
  ));

  const menuItem = manifest.contributes.menus['view/item/context'].find(
    (item: { command?: string }) => item.command === 'dotnav.editRunConfigProjects'
  );
  assert.match(menuItem.when, /viewItem =~ \/compound\//);
  assert.match(menuItem.when, /!\(viewItem =~ \/busy\/\)/);
});

test('project editing preserves the compound identity and requires a target', () => {
  assert.match(extensionSource, /title: 'Edit Selected Projects'/);
  assert.match(extensionSource, /picked: config\.targets\.some/);
  assert.match(extensionSource, /if \(picked\.length === 0\)/);
  assert.match(
    extensionSource,
    /saveCompound\(context,\s*\{\s*\.\.\.config,\s*targets: picked\.flatMap\(item => item\.config\.targets\)\s*\}\)/s
  );
});

test('contributes attachProcess command in runConfigurations menu', () => {
  assert.ok(manifest.contributes.commands.some(
    (item: { command: string }) => item.command === 'dotnav.attachProcess'
  ));

  const menuItem = manifest.contributes.menus['view/title'].find(
    (item: { command?: string }) => item.command === 'dotnav.attachProcess'
  );
  assert.ok(menuItem);
  assert.equal(menuItem.when, 'view == dotnav.runConfigurations');
});

