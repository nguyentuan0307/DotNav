import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import * as path from 'path';
import test from 'node:test';

const manifest = JSON.parse(readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf8'));

test('contributes solution build commands and context actions', () => {
  const commandIds = new Set(manifest.contributes.commands.map((command: { command: string }) => command.command));
  for (const command of [
    'dotnetSolutionNavigator.buildSolution',
    'dotnetSolutionNavigator.rebuildSolution',
    'dotnetSolutionNavigator.cleanSolution'
  ]) {
    assert.ok(commandIds.has(command), `missing command ${command}`);
    assert.ok(manifest.contributes.menus['view/item/context'].some((item: { command: string; when: string }) =>
      item.command === command && item.when.includes('viewItem == solution')
    ), `missing solution context action ${command}`);
  }
});

test('contributes a welcome view with recovery actions', () => {
  const welcome = manifest.contributes.viewsWelcome.find((item: { view: string; contents: string }) => item.view === 'dotnetSolutionNavigator');
  assert.ok(welcome);
  assert.match(welcome.contents, /dotnetSolutionNavigator\.openWorkspaceFolder/);
  assert.match(welcome.contents, /dotnetSolutionNavigator\.selectSolution/);
});
