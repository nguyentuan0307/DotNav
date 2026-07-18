import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import * as path from 'path';
import test from 'node:test';

const gitnavManifest = JSON.parse(readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf8'));
const dotnavManifest = JSON.parse(readFileSync(path.join(__dirname, '..', '..', '..', 'dotnav', 'package.json'), 'utf8'));
const manifest = {
  activationEvents: [...dotnavManifest.activationEvents, ...gitnavManifest.activationEvents],
  contributes: {
    commands: [...dotnavManifest.contributes.commands, ...gitnavManifest.contributes.commands],
    submenus: [...dotnavManifest.contributes.submenus, ...gitnavManifest.contributes.submenus],
    viewsContainers: { ...dotnavManifest.contributes.viewsContainers, ...gitnavManifest.contributes.viewsContainers },
    views: { ...dotnavManifest.contributes.views, ...gitnavManifest.contributes.views },
    viewsWelcome: dotnavManifest.contributes.viewsWelcome,
    menus: {
      ...dotnavManifest.contributes.menus,
      ...gitnavManifest.contributes.menus,
      'editor/context': [
        ...dotnavManifest.contributes.menus['editor/context'],
        ...gitnavManifest.contributes.menus['editor/context']
      ],
      'view/title': [
        ...dotnavManifest.contributes.menus['view/title'],
        ...gitnavManifest.contributes.menus['view/title']
      ]
    },
    configuration: {
      properties: {
        ...dotnavManifest.contributes.configuration.properties,
        ...gitnavManifest.contributes.configuration.properties
      }
    }
  }
};

test('contributes solution build commands and context actions', () => {
  const commandIds = new Set(manifest.contributes.commands.map((command: { command: string }) => command.command));
  for (const command of [
    'dotnav.buildSolution',
    'dotnav.rebuildSolution',
    'dotnav.cleanSolution'
  ]) {
    assert.ok(commandIds.has(command), `missing command ${command}`);
    assert.ok(manifest.contributes.menus['view/item/context'].some((item: { command: string; when: string }) =>
      item.command === command && item.when.includes('viewItem == solution')
    ), `missing solution context action ${command}`);
  }
});

test('contributes recursive folder project build action', () => {
  const commandIds = new Set(manifest.contributes.commands.map((command: { command: string }) => command.command));
  assert.ok(commandIds.has('dotnav.buildFolderProjects'));
  assert.ok(manifest.activationEvents.includes('onCommand:dotnav.buildFolderProjects'));
  assert.ok(manifest.contributes.menus['view/item/context'].some((item: { command: string; when: string }) =>
    item.command === 'dotnav.buildFolderProjects'
      && item.when.includes('viewItem =~ /folder|solutionFolder/')));
});

test('contributes a welcome view with recovery actions', () => {
  const welcome = manifest.contributes.viewsWelcome.find((item: { view: string; contents: string }) => item.view === 'dotnav');
  assert.ok(welcome);
  assert.match(welcome.contents, /dotnav\.openWorkspaceFolder/);
  assert.match(welcome.contents, /dotnav\.selectSolution/);
});

test('separates solution and run configuration views', () => {
  const views = manifest.contributes.views.dotnavContainer;
  assert.deepEqual(
    views.map((view: { id: string }) => view.id),
    ['dotnav', 'dotnav.runConfigurations']
  );

  const titleItems = manifest.contributes.menus['view/title'];
  const solutionNavigation = titleItems
    .filter((item: { when: string; group: string }) => item.when.includes('view == dotnav') && !item.when.includes('.runConfigurations') && item.group.startsWith('navigation'))
    .map((item: { command: string }) => item.command);
  assert.ok(!solutionNavigation.includes('dotnav.runActiveConfig'));
  assert.ok(!solutionNavigation.includes('dotnav.debugActiveConfig'));

  const runViewCommands = titleItems
    .filter((item: { when: string }) => item.when.includes('dotnav.runConfigurations'))
    .map((item: { command: string }) => item.command);
  assert.ok(runViewCommands.includes('dotnav.addRunConfig'));
  assert.ok(runViewCommands.includes('dotnav.runActiveConfig'));
  assert.ok(runViewCommands.includes('dotnav.debugActiveConfig'));
});

test('uses automatic icons and project hover actions', () => {
  const iconMode = manifest.contributes.configuration.properties['dotnav.iconMode'];
  assert.equal(iconMode.default, 'auto');
  assert.ok(iconMode.enum.includes('auto'));

  const inlineCommands = manifest.contributes.menus['view/item/context']
    .filter((item: { group: string; when: string }) => item.group.startsWith('inline') && item.when.includes('viewItem =~ /project/'))
    .map((item: { command: string }) => item.command);
  assert.deepEqual(inlineCommands, [
    'dotnav.runProject',
    'dotnav.debugProject',
    'dotnav.stopProject'
  ]);
});

test('contributes run configuration rename action', () => {
  const commandIds = new Set(manifest.contributes.commands.map((command: { command: string }) => command.command));
  assert.ok(commandIds.has('dotnav.renameRunConfig'));
  assert.ok(manifest.contributes.menus['view/item/context'].some((item: { command: string; when: string }) =>
    item.command === 'dotnav.renameRunConfig'
      && item.when.includes('view == dotnav.runConfigurations')
      && item.when.includes('viewItem =~ /runConfig/')
  ));
});

test('keeps Git contributions in GitNav and installs it with DotNav', () => {
  assert.ok(dotnavManifest.extensionDependencies.includes('tuna-ex.gitnav-workflows'));
  assert.ok(!dotnavManifest.contributes.commands.some((item: { command: string }) =>
    item.command.startsWith('gitnav.') || item.command.includes('HistoryForSelection') || item.command.includes('WithBranch')));
  assert.ok(gitnavManifest.contributes.commands.every((item: { command: string }) =>
    item.command.startsWith('gitnav.')));
});

test('keeps DotNav formatting visible and groups GitNav editor actions', () => {
  const commandIds = new Set(manifest.contributes.commands.map((command: { command: string }) => command.command));
  assert.ok(commandIds.has('gitnav.compareFileWithBranch'));
  assert.ok(commandIds.has('gitnav.compareSelectionWithBranch'));
  assert.equal(gitnavManifest.contributes.commands.find((command: { command: string }) =>
    command.command === 'gitnav.showHistoryForSelection')?.title, 'Show History for Selection');
  assert.equal(gitnavManifest.contributes.commands.find((command: { command: string }) =>
    command.command === 'gitnav.compareFileWithBranch')?.title, 'Compare File With Branch...');
  assert.equal(gitnavManifest.contributes.commands.find((command: { command: string }) =>
    command.command === 'gitnav.compareSelectionWithBranch')?.title, 'Compare Selection With Branch...');

  assert.ok(manifest.contributes.submenus.some((submenu: { id: string; label: string }) =>
    submenu.id === 'gitnav.editorMenu' && submenu.label === 'GitNav'
  ));

  const editorContext = manifest.contributes.menus['editor/context'];
  assert.ok(editorContext.some((item: { command?: string; submenu?: string; group?: string }) =>
    item.command === 'dotnav.formatSelection' && item.group?.startsWith('6_dotnav')
  ));
  assert.ok(editorContext.some((item: { command?: string; submenu?: string; when?: string; group?: string }) =>
    item.submenu === 'gitnav.editorMenu' && item.when === undefined && item.group?.startsWith('6_gitnav')
  ));
  assert.ok(!editorContext.some((item: { command?: string }) =>
    item.command === 'gitnav.showHistoryForSelection'
  ));

  const gitMenu = manifest.contributes.menus['gitnav.editorMenu'];
  assert.deepEqual(gitMenu.map((item: { command: string }) => item.command), [
    'gitnav.showHistoryForSelection',
    'gitnav.compareFileWithBranch',
    'gitnav.compareSelectionWithBranch'
  ]);
  assert.ok(gitMenu.some((item: { command: string }) =>
    item.command === 'gitnav.compareFileWithBranch'
  ));
  assert.ok(gitMenu.some((item: { command: string; when?: string }) =>
    item.command === 'gitnav.compareSelectionWithBranch' && item.when?.includes('editorHasSelection')
  ));
  assert.ok(gitMenu.some((item: { command: string; when?: string }) =>
    item.command === 'gitnav.showHistoryForSelection' && item.when?.includes('editorHasSelection')
  ));
});

test('contributes Git Log as a bottom panel webview', () => {
  const panel = manifest.contributes.viewsContainers.panel;
  assert.ok(panel.some((item: { id: string }) => item.id === 'gitnavPanel'));
  const views = manifest.contributes.views.gitnavPanel;
  assert.ok(views.some((item: { id: string; type: string }) =>
    item.id === 'gitnav.gitLog' && item.type === 'webview'));
});

test('contributes Git Log safety and auto-fetch settings', () => {
  const properties = manifest.contributes.configuration.properties;
  assert.deepEqual(properties['gitnav.protectedBranches'].default,
    ['main', 'master', 'develop', 'release/*']);
  assert.equal(properties['gitnav.autoFetch'].default, true);
  assert.equal(properties['gitnav.autoFetchMinutes'].default, 20);
});

test('renders Git Log context actions inside the webview', () => {
  const source = readFileSync(path.join(__dirname, '..', '..', 'src', 'git', 'gitLogViewProvider.ts'), 'utf8');
  const styles = readFileSync(path.join(__dirname, '..', '..', 'media', 'webview', 'git-log.css'), 'utf8');
  assert.match(source, /class="context-menu ui-menu" id="contextMenu"/);
  assert.match(source, /showInlineContextMenu/);
  assert.match(source, /window\.innerWidth-rect\.width/);
  assert.doesNotMatch(source, /showQuickPick\(actions/);
  assert.match(source, /const \{type,\.\.\.context\}=state\.contextPayload/);
  assert.match(source, /function requestContext\(data\)/);
  assert.match(styles, /body\s*\{[^}]*user-select:\s*none/);
  assert.match(styles, /input,\s*textarea,\s*\.detail \.message,\s*\.detail \.meta,\s*\.diff-preview\s*\{[^}]*user-select:\s*text/);
  assert.match(source, /addEventListener\('contextmenu',e=>\{e\.preventDefault\(\)/);
  assert.match(source, /context\.requestId!==state\.contextRequestId/);
  assert.match(source, /button\.disabled=true/);
  assert.match(source, /Ignored duplicate mutation/);
  assert.match(source, /context menu is stale because the active repository changed/i);
  assert.match(source, /Compare with Working Tree/);
  assert.match(source, /Show in Log/);
  assert.doesNotMatch(source, /branches'\)\.ondblclick/);
  assert.match(source, /<svg class="graph-overlay" id="graphSvg"/);
  assert.match(source, /class="graph-clip" id="graphClip"/);
  assert.match(styles, /\.graph-clip\s*\{[^}]*overflow:\s*hidden/);
  assert.match(source, /function renderGraph\(/);
  assert.match(source, /clip\.style\.transform='translateY\('\+vp\.scrollTop\+'px\)'/);
  assert.doesNotMatch(source, /esc\(c\.graph/);
  assert.match(source, /requestAnimationFrame/);
  assert.match(source, /function indexCommits\(/);
  assert.match(source, /function refreshSelection\(/);
  assert.match(source, /document\.body\.classList\.contains\('resizing'\)/);
  assert.match(source, /localStorage\.setItem\('gitLog\.'\+side,String\(value\)\)/);
  assert.match(source, /const loadFilteredDebounced=debounce\(loadFiltered,300\)/);
  assert.match(source, /e\.shiftKey&&state\.selectionAnchor/);
  assert.match(source, /\.filter\(hash=>hash&&state\.selectedHashes\.has\(hash\)\)\.reverse\(\)/);
  assert.match(source, /m\.type==='busy'/);
  assert.match(source, /class="column-resizer" data-resize="graph"/);
  assert.match(source, /gitLog\.columnWidths/);
  assert.match(source, /id="toggleColumns"/);
  assert.match(source, /gitLog\.visibleColumns/);
  assert.match(source, /function positionColumnMenu\(\)/);
  assert.match(source, /function closeColumnMenu\(\)/);
  assert.match(source, /getBoundingClientRect\(\)/);
  assert.match(source, /Keep at least one column visible/);
  assert.match(source, /setPointerCapture/);
  assert.match(source, /Math\.max\(28/);
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
  assert.match(source, /function branchRefIcon\(/);
  assert.match(source, /function detailHeightKey\(/);
  assert.match(source, /rightSplit'\)\.ondblclick/);
  assert.match(source, /initial\+latest-start/);
  assert.ok(source.lastIndexOf('.right .right-split{display:block') > source.lastIndexOf('.right .right-split{display:none}'));
  assert.match(source, /height:7px;flex:0 0 7px;cursor:row-resize/);
  assert.doesNotMatch(source, /'⑂'/);
  assert.match(source, /function showRecoveryToast\(/);
  assert.match(source, /recovery\.actions/);
  assert.match(source, /id="toastClose"/);
  assert.match(source, /m\.repositoryId!==state\.repository\.root/);
  assert.match(source, /function renderStatusBadges\(/);
  assert.match(source, /id="repoBadges"/);
  assert.match(source, /state\.selectedRef===x\.name\?'viewing'/);
  assert.match(source, /\.item\.viewing/);
  assert.match(source, /class="filter-chips"/);
  assert.match(source, /state\.selectedRef=item\.dataset\.ref;renderBranches\(\)/);
  assert.match(source, /BRANCH_SEARCH_DELAY=120,BRANCH_SEARCH_LIMIT=200/);
  assert.match(source, /clearTimeout\(branchSearchTimer\)/);
  assert.match(source, /cancelAnimationFrame\(branchSearchFrame\)/);
  assert.match(source, /generation!==branchSearchGeneration/);
  assert.match(source, /branchSearch'\)\.oninput=scheduleBranchSearch/);
  assert.match(source, /data-open-local/);
  assert.match(source, /Open local file \(Ctrl\+Enter\)/);
  assert.match(source, /if\(e\.ctrlKey\|\|e\.metaKey\)send\('openFile'/);
  assert.match(source, /File is not available locally\./);
  assert.match(source, /Restore from Commit/);
});

test('renders Git Log lane focus, action feedback, and worktree support', () => {
  const provider = readFileSync(path.join(__dirname, '..', '..', 'src', 'git', 'gitLogViewProvider.ts'), 'utf8');
  const service = readFileSync(path.join(__dirname, '..', '..', 'src', 'git', 'gitRepositoryService.ts'), 'utf8');
  const mutations = readFileSync(path.join(__dirname, '..', '..', 'src', 'git', 'gitMutationRunner.ts'), 'utf8');
  assert.match(provider, /function selectedFirstParentPath\(\)/);
  assert.match(provider, /showActionFeedback\(m\.feedback\|\|'status',m\.actionLabel/);
  assert.match(provider, /data-kind="'\+\(x\.current\?'worktreeCurrent':'worktree'\)/);
  assert.match(provider, /path:item\.dataset\.path/);
  assert.match(provider, /e\.key==='ArrowDown'\|\|e\.key==='ArrowUp'/);
  assert.match(service, /worktree', 'list', '--porcelain'/);
  assert.doesNotMatch(service, /rev-list', '--count/);
  assert.match(service, /`--max-count=\$\{limit \+ 1\}`/);
  assert.doesNotMatch(service, /detailCache\.deletePrefix/);
  assert.match(service, /export function parseWorktrees/);
  assert.match(mutations, /case 'worktreeAdd'/);
  assert.match(mutations, /case 'worktreeRemove'/);
  assert.match(mutations, /case 'worktreePrune'/);
});

test('builds professional commit filters with AND semantics', () => {
  const provider = readFileSync(path.join(__dirname, '..', '..', 'src', 'git', 'gitLogViewProvider.ts'), 'utf8');
  const service = readFileSync(path.join(__dirname, '..', '..', 'src', 'git', 'gitRepositoryService.ts'), 'utf8');
  const models = readFileSync(path.join(__dirname, '..', '..', 'src', 'git', 'gitPanelModels.ts'), 'utf8');
  const uiStyles = readFileSync(path.join(__dirname, '..', '..', 'media', 'webview', 'ui.css'), 'utf8');
  const viewStyles = readFileSync(path.join(__dirname, '..', '..', 'media', 'webview', 'git-log.css'), 'utf8');
  assert.match(models, /readonly authors\?: string\[\]/);
  assert.doesNotMatch(models, /readonly regex\?:/);
  assert.doesNotMatch(models, /readonly matchCase\?:/);
  assert.match(service, /for \(const author of filter\.authors \?\? \[\]\)/);
  assert.match(service, /'--regexp-ignore-case', '--fixed-strings'/);
  assert.match(service, /filterOptions\(root: string/);
  assert.match(service, /'ls-files', '-co', '--exclude-standard', '-z'/);
  assert.match(service, /'ls-files', '--deleted', '-z'/);
  assert.match(service, /searchAuthors\(root: string, query: string/);
  assert.doesNotMatch(service, /'shortlog', '-sne', '--all'/);
  assert.doesNotMatch(provider, /workingTreeFiles\(this\.root, read\.source\.token\), this\.service\.filterOptions/);
  assert.match(provider, /void this\.loadFilterOptions\(this\.root\)/);
  assert.match(provider, /m\.type!=='filterOptions'/);
  assert.match(provider, /const channel = 'filter-options'/);
  assert.match(provider, /filterOptions\(root, read\.source\.token\)/);
  assert.match(provider, /const channel = 'filter-authors'/);
  assert.match(provider, /searchAuthors\(root, query, read\.source\.token\)/);
  assert.match(provider, /this\.requests\.isCurrent\(channel, read\.identity, this\.root\)/);
  assert.match(provider, /function absorbAuthors\(commits=\[\]\)/);
  assert.match(provider, /send\('searchAuthors',\{query\}\)/);
  assert.doesNotMatch(provider, /querySelector\('\.match-toggle'\)\?\.remove/);
  assert.match(provider, /until:state\.filterDraft\.until\?state\.filterDraft\.until\+' 23:59:59'/);
  assert.match(provider, /fuzzyMatch\(pathBase\(x\.path\),q\)/);
  assert.match(provider, /data-filter-view="author"/);
  assert.match(provider, /data-filter-view="path"/);
  assert.match(provider, /data-filter-view="date"/);
  assert.match(provider, /data-date-preset="custom"/);
  assert.doesNotMatch(provider, /id="datePreset"/);
  assert.doesNotMatch(provider, /type="date"/);
  assert.match(provider, /function setFilterView\(view\)/);
  assert.match(viewStyles, /\.filters\[data-view="author"\] \.filter-author-view/);
  assert.match(provider, /class="choice-check"/);
  assert.match(uiStyles, /--gn-font:\s*var\(--vscode-font-family\)/);
  assert.match(uiStyles, /\.ui-trigger/);
});

test('reuses mutation state and keeps expensive refresh work off the action critical path', () => {
  const provider = readFileSync(path.join(__dirname, '..', '..', 'src', 'git', 'gitLogViewProvider.ts'), 'utf8');
  const service = readFileSync(path.join(__dirname, '..', '..', 'src', 'git', 'gitRepositoryService.ts'), 'utf8');
  const mutations = readFileSync(path.join(__dirname, '..', '..', 'src', 'git', 'gitMutationRunner.ts'), 'utf8');
  assert.match(mutations, /class GitMutationExecutionContext/);
  assert.match(mutations, /snapshot\(root, undefined, true\)/);
  assert.match(mutations, /checkoutArgs\(context: GitMutationExecutionContext/);
  assert.match(mutations, /remoteCheckoutArgs\(context: GitMutationExecutionContext/);
  assert.doesNotMatch(mutations, /await vscode\.commands\.executeCommand\('git\.refresh'\)/);
  assert.match(service, /repositoryDiscoveryCache/);
  assert.match(service, /snapshotInFlight/);
  assert.match(service, /snapshotGenerations/);
  assert.match(service, /=== generation/);
  assert.match(service, /expiresAt: Date\.now\(\) \+ 300/);
  assert.match(provider, /await this\.refreshRepositoryStatus\(root\)/);
  assert.match(provider, /void this\.refresh\(\)\.catch/);
});

test('renders advanced Git Log UX and interactive rebase preview', () => {
  const source = readFileSync(path.join(__dirname, '..', '..', 'src', 'git', 'gitLogViewProvider.ts'), 'utf8');
  const styles = readFileSync(path.join(__dirname, '..', '..', 'media', 'webview', 'git-log.css'), 'utf8');
  assert.match(source, /\['ready','refresh','loadLog'\]\.includes\(m\.scope\)/);
  assert.doesNotMatch(source, /id="historyMap"/);
  assert.doesNotMatch(source, /function renderHistoryMap\(/);
  assert.doesNotMatch(source, /function renderInlineDiff\(/);
  assert.doesNotMatch(source, /send\('inlineDiff'/);
  assert.match(source, /\['↑ '\+r\.ahead/);
  assert.match(source, /\['↓ '\+r\.behind/);
  assert.match(source, />↑ '\+x\.ahead/);
  assert.match(source, />↓ '\+x\.behind/);
  assert.match(source, /\.branches \.badge \.branch-ahead/);
  assert.match(source, /Interactive Rebase Preview/);
  assert.match(source, /completing this change may require a force-with-lease push/);
  assert.doesNotMatch(source, /Delete local branch.*showWarningMessage/);
  assert.doesNotMatch(source, /Allow Published Rebase/);
  assert.match(source, /Create Backup & Rebase/);
  assert.doesNotMatch(source, /<span id="status">/);
  assert.doesNotMatch(source, /class="quick-actions"/);
  assert.match(source, /class="toolbar-action ui-button quiet" data-action="fetch"/);
  assert.match(source, /class="ui-icon" viewBox="0 0 24 24"/);
  assert.match(source, /function lockIcon\(\)/);
  assert.doesNotMatch(source, /class="action-icon">[↻⇣⇡↓]/);
  assert.match(source, /id="branchTrigger"/);
  assert.match(source, /id="branchPicker"/);
  assert.match(source, /id="branchSearch" placeholder="Search branches"/);
  assert.match(source, /const current=r\.refs\.find\(x=>x\.current\),matching=r\.refs\.filter\(x=>x!==current/);
  assert.match(source, /'<div class="group">Current branch<\/div>'\+refItem\(current,current\.name\)/);
  assert.match(source, /m\.repositories\.length>1\?'block':'none'/);
  assert.match(source, /id="fileSummary"/);
  assert.match(source, /function commitAge\(/);
  assert.match(source, /class="filter-root"/);
  assert.match(source, /class="filter-view filter-author-view"/);
  assert.match(source, /class="filter-view filter-path-view"/);
  assert.match(source, /id="dateChoices"/);
  assert.match(styles, /\.filter-root-row/);
  assert.match(source, /function highlightText\(/);
  assert.match(source, /document\.addEventListener\('pointerdown'/);
  assert.doesNotMatch(source, /type="checkbox" id="regex"/);
  assert.doesNotMatch(source, /type="checkbox" id="case"/);
  assert.match(source, /aria-expanded="false"/);
  assert.match(source, />Fetch<\/span>/);
  assert.match(source, />Push<\/span>/);
  assert.match(source, /updateButton\.dataset\.action='update'/);
  assert.match(source, /Update current branch/);
  assert.match(source, /have diverged\.`?, \{ modal: true \}/);
  assert.doesNotMatch(source, />New Branch<\/button>/);
  assert.match(source, /Update from Origin/);
  assert.match(source, /updateBranchFromOrigin/);
  assert.match(source, /Update Current Branch/);
  assert.match(source, /contextActions\(message\.kind, message\.current === true\)/);
  assert.match(source, /data-menu-action/);
  assert.match(source, /Push Options…/);
  assert.match(source, /function renderContextMenu\(/);
  assert.match(source, /data-context-group="more"/);
  assert.match(source, /function showContextSubmenu\(/);
  assert.match(source, /\.onpointerover=e=>/);
  assert.match(source, /aria-haspopup="menu"/);
  assert.match(source, /function closeContextMenus\(/);
  assert.match(source, /Push Recovery Settings…/);
  assert.match(source, /Remember this choice for this repository/);
  assert.match(source, /recovery\.actions\.slice\(0,2\)/);
  assert.match(source, /id="recoveryModal" role="dialog" aria-modal="true"/);
  assert.match(source, /function showRecoveryModal\(/);
  assert.match(source, /if\(recovery\.actions\.length\)return showRecoveryModal\(message\)/);
  assert.match(source, /is behind \$\{remoteRef\}\.`, \{ modal: true \}/);
  assert.match(source, /function renderOperationBanner\(/);
  assert.match(source, /Resetting will permanently drop them/);
  assert.match(source, /action: 'checkoutRemoteReset'/);
  assert.match(source, /Branch .* already exists/);
  assert.match(source, /Tag .* already exists/);
  assert.match(source, /state\.fileMode==='flat'\?folder\+old:old/);
  assert.match(source, /f\.additions\?'<span class="file-add">/);
  assert.match(source, /querySelectorAll\('\.file'\)/);
  assert.doesNotMatch(source, /state\.selectedFilePath=file\.dataset\.path;renderFiles/);
  assert.match(source, /item\.group==='danger'/);
  assert.match(source, /gitLog\.sectionCollapsed/);
  assert.match(source, /aria-live="assertive"/);
  assert.match(source, /role="tree" aria-label="Changed files"/);
});

test('keeps embedded Git Log webview JavaScript syntactically valid', () => {
  const source = readFileSync(path.join(__dirname, '..', '..', 'src', 'git', 'gitLogViewProvider.ts'), 'utf8');
  const template = /function renderHtml[\s\S]*?return `([\s\S]*?)`;\r?\n\s*}/.exec(source)?.[1];
  assert.ok(template);
  const html = new Function(
    'nonce', 'webview', 'uiStyleUri', 'viewStyleUri', 'uiScriptUri',
    `return \`${template}\`;`
  )('test-nonce', { cspSource: 'test-csp' }, 'ui.css', 'git-log.css', 'ui.js') as string;
  const script = /<script nonce="test-nonce">([\s\S]*?)<\/script>/.exec(html)?.[1];
  assert.ok(script);
  assert.doesNotThrow(() => new Function(script));
});

test('preserves repository-specific log filters across full refreshes', () => {
  const source = readFileSync(path.join(__dirname, '..', '..', 'src', 'git', 'gitLogViewProvider.ts'), 'utf8');
  assert.match(source, /activeFilters\.get\(this\.root, \{\}\)/);
  assert.match(source, /this\.service\.log\(this\.root, 0, 200, activeFilter/);
  assert.match(source, /activeFilter, generation:/);
  assert.match(source, /activeFilters\.set\(this\.root, filter\)/);
  assert.match(source, /state\.selectedRef=f\.refs\?\.\[0\]/);
  assert.doesNotMatch(source, /this\.service\.log\(this\.root, 0, 200, \{\}/);
});

test('synchronizes local Git events without fetching on panel visibility', () => {
  const extension = readFileSync(path.join(__dirname, '..', '..', 'src', 'extension.ts'), 'utf8');
  const provider = readFileSync(path.join(__dirname, '..', '..', 'src', 'git', 'gitLogViewProvider.ts'), 'utf8');
  const sync = readFileSync(path.join(__dirname, '..', '..', 'src', 'git', 'gitLocalSync.ts'), 'utf8');
  assert.match(extension, /subscribeToBuiltInGitChanges/);
  assert.match(sync, /getExtension<GitExtensionExports>\('vscode\.git'\)/);
  assert.match(sync, /repository\.state\.onDidChange/);
  assert.match(provider, /view\.onDidChangeVisibility/);
  assert.match(provider, /type: 'repositoryStatus'/);
  assert.match(provider, /packed-refs/);
  assert.doesNotMatch(provider, /onDidChangeVisibility[\s\S]{0,200}fetch/);
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
  assert.match(source, /Webview runtime error:/);
});

test('recovers from invalid persisted Git Log webview state', () => {
  const source = readFileSync(path.join(__dirname, '..', '..', 'src', 'git', 'gitLogViewProvider.ts'), 'utf8');
  assert.match(source, /function storedArray\(key\)/);
  assert.match(source, /localStorage\.removeItem\(key\)/);
  assert.doesNotMatch(source, /new Set\(JSON\.parse\(localStorage\.getItem/);
});
