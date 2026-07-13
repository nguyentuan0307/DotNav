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

test('contributes recursive folder project build action', () => {
  const commandIds = new Set(manifest.contributes.commands.map((command: { command: string }) => command.command));
  assert.ok(commandIds.has('dotnetSolutionNavigator.buildFolderProjects'));
  assert.ok(manifest.activationEvents.includes('onCommand:dotnetSolutionNavigator.buildFolderProjects'));
  assert.ok(manifest.contributes.menus['view/item/context'].some((item: { command: string; when: string }) =>
    item.command === 'dotnetSolutionNavigator.buildFolderProjects' && item.when.includes('viewItem =~ /folder/')));
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
  const commandIds = new Set(manifest.contributes.commands.map((command: { command: string }) => command.command));
  assert.ok(commandIds.has('dotnetSolutionNavigator.compareFileWithBranch'));
  assert.ok(commandIds.has('dotnetSolutionNavigator.compareSelectionWithBranch'));

  assert.ok(manifest.contributes.submenus.some((submenu: { id: string; label: string }) =>
    submenu.id === 'dotnetSolutionNavigator.git' && submenu.label === 'Git'
  ));

  const editorContext = manifest.contributes.menus['editor/context'];
  assert.ok(editorContext.some((item: { command?: string; submenu?: string; group?: string }) =>
    item.command === 'dotnetSolutionNavigator.formatSelection' && item.group?.startsWith('6_dotnetNavigator')
  ));
  assert.ok(editorContext.some((item: { command?: string; submenu?: string; when?: string; group?: string }) =>
    item.submenu === 'dotnetSolutionNavigator.git' && item.when === undefined && item.group?.startsWith('6_dotnetNavigator')
  ));
  assert.ok(!editorContext.some((item: { command?: string }) =>
    item.command === 'dotnetSolutionNavigator.showHistoryForSelection'
  ));

  const gitMenu = manifest.contributes.menus['dotnetSolutionNavigator.git'];
  assert.ok(gitMenu.some((item: { command: string }) =>
    item.command === 'dotnetSolutionNavigator.compareFileWithBranch'
  ));
  assert.ok(gitMenu.some((item: { command: string; when?: string }) =>
    item.command === 'dotnetSolutionNavigator.compareSelectionWithBranch' && item.when?.includes('editorHasSelection')
  ));
  assert.ok(gitMenu.some((item: { command: string; when?: string }) =>
    item.command === 'dotnetSolutionNavigator.showHistoryForSelection' && item.when?.includes('editorHasSelection')
  ));
});

test('contributes Git Log as a bottom panel webview', () => {
  const panel = manifest.contributes.viewsContainers.panel;
  assert.ok(panel.some((item: { id: string }) => item.id === 'dotnetSolutionNavigatorGitPanel'));
  const views = manifest.contributes.views.dotnetSolutionNavigatorGitPanel;
  assert.ok(views.some((item: { id: string; type: string }) =>
    item.id === 'dotnetSolutionNavigator.gitLog' && item.type === 'webview'));
});

test('contributes Git Log safety and auto-fetch settings', () => {
  const properties = manifest.contributes.configuration.properties;
  assert.deepEqual(properties['dotnetSolutionNavigator.gitLog.protectedBranches'].default,
    ['main', 'master', 'develop', 'release/*']);
  assert.equal(properties['dotnetSolutionNavigator.gitLog.autoFetch'].default, true);
  assert.equal(properties['dotnetSolutionNavigator.gitLog.autoFetchMinutes'].default, 20);
});

test('renders Git Log context actions inside the webview', () => {
  const source = readFileSync(path.join(__dirname, '..', '..', 'src', 'git', 'gitLogViewProvider.ts'), 'utf8');
  assert.match(source, /class="context-menu" id="contextMenu"/);
  assert.match(source, /showInlineContextMenu/);
  assert.match(source, /window\.innerWidth-rect\.width/);
  assert.doesNotMatch(source, /showQuickPick\(actions/);
  assert.match(source, /const \{type,\.\.\.context\}=state\.contextPayload/);
  assert.doesNotMatch(source, /branches'\)\.ondblclick/);
  assert.match(source, /<svg class="graph-overlay" id="graphSvg"/);
  assert.match(source, /function renderGraph\(/);
  assert.doesNotMatch(source, /esc\(c\.graph/);
  assert.match(source, /requestAnimationFrame/);
  assert.match(source, /e\.shiftKey&&state\.selectionAnchor/);
  assert.match(source, /\.filter\(hash=>hash&&state\.selectedHashes\.has\(hash\)\)\.reverse\(\)/);
  assert.match(source, /m\.type==='busy'/);
  assert.match(source, /class="toast" id="toast"/);
  assert.match(source, /conflicts\.length\+' unresolved'/);
  assert.match(source, /data-conflict="skip"/);
  assert.match(source, /active repository changed while this action was open/i);
});

test('renders changed files as a recursive collapsible tree', () => {
  const source = readFileSync(path.join(__dirname, '..', '..', 'src', 'git', 'gitLogViewProvider.ts'), 'utf8');
  assert.match(source, /function fileTree\(/);
  assert.match(source, /function renderFileNode\(/);
  assert.match(source, /data-file-folder/);
  assert.match(source, /collapseFiles/);
  assert.match(source, /expandFiles/);
  assert.match(source, /function fileStatus\(/);
  assert.match(source, /status-conflict/);
  assert.match(source, /file-add/);
  assert.match(source, /file-del/);
  assert.match(source, /gitDecoration-addedResourceForeground/);
  assert.match(source, /gitDecoration-deletedResourceForeground/);
  assert.match(source, /id="rightSplit"/);
  assert.match(source, /gitLog\.detailHeight/);
  assert.match(source, /class="ref-shape"/);
  assert.doesNotMatch(source, /'⑂'/);
  assert.match(source, /function showRecoveryToast\(/);
  assert.match(source, /recovery\.actions/);
  assert.match(source, /id="toastClose"/);
  assert.match(source, /m\.repositoryId!==state\.repository\.root/);
  assert.match(source, /repositoryStatus\(state\.repository\)/);
  assert.match(source, /state\.selectedRef===x\.name\?'viewing'/);
  assert.match(source, /\.item\.viewing/);
  assert.match(source, /Viewing: /);
  assert.match(source, /state\.selectedRef=item\.dataset\.ref;renderBranches\(\)/);
});

test('keeps embedded Git Log webview JavaScript syntactically valid', () => {
  const source = readFileSync(path.join(__dirname, '..', '..', 'src', 'git', 'gitLogViewProvider.ts'), 'utf8');
  const script = /<script nonce="\$\{nonce\}">([\s\S]*?)<\/script>/.exec(source)?.[1];
  assert.ok(script);
  assert.doesNotThrow(() => new Function(script));
});

test('subscribes to Git Log messages before loading webview HTML', () => {
  const source = readFileSync(path.join(__dirname, '..', '..', 'src', 'git', 'gitLogViewProvider.ts'), 'utf8');
  const resolver = source.slice(source.indexOf('resolveWebviewView('), source.indexOf('async refresh()'));
  assert.ok(resolver.indexOf('onDidReceiveMessage') < resolver.indexOf('webview.html = renderHtml'));
});

test('exposes Git Log initialization diagnostics in an output channel', () => {
  const source = readFileSync(path.join(__dirname, '..', '..', 'src', 'git', 'gitLogViewProvider.ts'), 'utf8');
  assert.match(source, /createOutputChannel\('Git Log'\)/);
  assert.match(source, /Received webview message:/);
  assert.match(source, /Repository discovery completed/);
  assert.match(source, /State posted:/);
});
