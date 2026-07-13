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

test('separates solution and run configuration views', () => {
  const views = manifest.contributes.views.dotnetSolutionNavigatorContainer;
  assert.deepEqual(
    views.map((view: { id: string }) => view.id),
    ['dotnetSolutionNavigator', 'dotnetSolutionNavigator.runConfigurations']
  );

  const titleItems = manifest.contributes.menus['view/title'];
  const solutionNavigation = titleItems
    .filter((item: { when: string; group: string }) => item.when.includes('view == dotnetSolutionNavigator') && !item.when.includes('.runConfigurations') && item.group.startsWith('navigation'))
    .map((item: { command: string }) => item.command);
  assert.ok(!solutionNavigation.includes('dotnetSolutionNavigator.runActiveConfig'));
  assert.ok(!solutionNavigation.includes('dotnetSolutionNavigator.debugActiveConfig'));

  const runViewCommands = titleItems
    .filter((item: { when: string }) => item.when.includes('dotnetSolutionNavigator.runConfigurations'))
    .map((item: { command: string }) => item.command);
  assert.ok(runViewCommands.includes('dotnetSolutionNavigator.addRunConfig'));
  assert.ok(runViewCommands.includes('dotnetSolutionNavigator.runActiveConfig'));
  assert.ok(runViewCommands.includes('dotnetSolutionNavigator.debugActiveConfig'));
});

test('uses automatic icons and project hover actions', () => {
  const iconMode = manifest.contributes.configuration.properties['dotnetSolutionNavigator.iconMode'];
  assert.equal(iconMode.default, 'auto');
  assert.ok(iconMode.enum.includes('auto'));

  const inlineCommands = manifest.contributes.menus['view/item/context']
    .filter((item: { group: string; when: string }) => item.group.startsWith('inline') && item.when.includes('viewItem =~ /project/'))
    .map((item: { command: string }) => item.command);
  assert.deepEqual(inlineCommands, [
    'dotnetSolutionNavigator.runProject',
    'dotnetSolutionNavigator.debugProject',
    'dotnetSolutionNavigator.stopProject'
  ]);
});

test('contributes run configuration rename action', () => {
  const commandIds = new Set(manifest.contributes.commands.map((command: { command: string }) => command.command));
  assert.ok(commandIds.has('dotnetSolutionNavigator.renameRunConfig'));
  assert.ok(manifest.contributes.menus['view/item/context'].some((item: { command: string; when: string }) =>
    item.command === 'dotnetSolutionNavigator.renameRunConfig'
      && item.when.includes('view == dotnetSolutionNavigator.runConfigurations')
      && item.when.includes('viewItem =~ /runConfig/')
  ));
});

test('groups editor git actions under a submenu while keeping format visible', () => {
  assert.ok(manifest.contributes.submenus.some((submenu: { id: string; label: string }) =>
    submenu.id === 'dotnetSolutionNavigator.git' && submenu.label === 'Git'
  ));

  const editorContext = manifest.contributes.menus['editor/context'];
  assert.ok(editorContext.some((item: { command?: string; submenu?: string }) =>
    item.command === 'dotnetSolutionNavigator.formatSelection'
  ));
  assert.ok(editorContext.some((item: { command?: string; submenu?: string; when?: string }) =>
    item.submenu === 'dotnetSolutionNavigator.git' && item.when?.includes('editorHasSelection')
  ));
  assert.ok(!editorContext.some((item: { command?: string }) =>
    item.command === 'dotnetSolutionNavigator.showHistoryForSelection'
  ));

  assert.ok(manifest.contributes.menus['dotnetSolutionNavigator.git'].some((item: { command: string }) =>
    item.command === 'dotnetSolutionNavigator.showHistoryForSelection'
  ));
});
