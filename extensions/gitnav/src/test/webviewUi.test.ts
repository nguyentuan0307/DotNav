import { readFileSync } from 'fs';
import * as path from 'path';
import test from 'node:test';
import assert from 'node:assert/strict';

const extensionRoot = path.join(__dirname, '..', '..');
const read = (...parts: string[]) => readFileSync(path.join(extensionRoot, ...parts), 'utf8');
const readGitLogSurface = () => [
  read('src', 'git', 'gitLogViewProvider.ts'),
  read('src', 'git', 'gitLogWebviewHtml.ts'),
  read('media', 'webview', 'git-log.js')
].join('\n');

test('uses one reusable webview UI foundation across GitNav surfaces', () => {
  const provider = readGitLogSurface();
  const history = read('src', 'git', 'lineHistoryPanel.ts');
  const ui = read('media', 'webview', 'ui.css');
  const runtime = read('media', 'webview', 'ui.js');

  assert.match(provider, /assetUri\('ui\.css'\)/);
  assert.match(history, /assetUri\('ui\.css'\)/);
  assert.match(provider, /assetUri\('ui\.js'\)/);
  assert.match(ui, /--gn-control-height:/);
  assert.match(ui, /\.ui-trigger/);
  assert.match(ui, /\.ui-popover/);
  assert.match(ui, /\.ui-list-item/);
  assert.match(ui, /\.ui-dialog/);
  assert.match(runtime, /function createOverlayManager\(\)/);
  assert.match(runtime, /function navigateList\(container, event\)/);
});

test('avoids operating-system-native popup controls in visible GitNav UI', () => {
  const provider = readGitLogSurface();
  const ui = read('media', 'webview', 'ui.css');

  assert.doesNotMatch(provider, /<select(?![^>]*\bhidden\b)/);
  assert.doesNotMatch(provider, /type="date"/);
  assert.match(provider, /id="dateChoices"/);
  assert.match(provider, /inputmode="numeric" placeholder="YYYY-MM-DD"/);
  assert.match(provider, /id="repoPicker"/);
  assert.match(provider, /id="parentMenu"/);
  assert.match(provider, /id="rebaseActionMenu"/);
  assert.match(ui, /\[hidden\]\s*\{\s*display: none !important;/);
});

test('loads shared styles externally while allowing dynamic layout styles', () => {
  const provider = readGitLogSurface();
  const history = read('src', 'git', 'lineHistoryPanel.ts');

  assert.match(provider, /style-src \$\{webview\.cspSource\} 'unsafe-inline'/);
  assert.match(history, /style-src \$\{webview\.cspSource\} 'unsafe-inline'/);
  assert.match(provider, /href="\$\{uiStyleUri\}"/);
  assert.match(provider, /href="\$\{viewStyleUri\}"/);
  assert.match(history, /href="\$\{uiStyleUri\}"/);
  assert.match(history, /href="\$\{viewStyleUri\}"/);
});

test('generated webview markup does not depend on blocked inline handlers or styles', () => {
  const provider = readGitLogSurface();

  assert.doesNotMatch(provider, /onclick="/);
  assert.doesNotMatch(provider, /'<[^']+\sstyle="/);
  assert.match(provider, /row\.style\.top=/);
  assert.match(provider, /\.with\(\{ query: `v=\$\{nonce\}` \}\)/);
});

test('changed files defaults to list mode and uses one compact folder action', () => {
  const provider = readGitLogSurface();
  const styles = read('media', 'webview', 'git-log.css');

  assert.match(provider, /localStorage\.getItem\('gitLog\.fileMode'\)\|\|'flat'/);
  assert.match(provider, /id="folderToggle"/);
  assert.doesNotMatch(provider, /id="collapseFiles"|id="expandFiles"/);
  assert.match(styles, /\.file-view-toggle button\s*\{[^}]*display: inline-flex;[^}]*align-items: center;[^}]*justify-content: center;/s);
});

test('changed files expose focus, search, and status filters', () => {
  const provider = readGitLogSurface();
  const styles = read('media', 'webview', 'git-log.css');

  assert.match(provider, /id="filesFocusToggle"[^>]*aria-pressed="false"/);
  assert.match(provider, /id="fileSearch"/);
  assert.match(provider, /id="fileStatusTrigger"[^>]*aria-haspopup="true"/);
  assert.match(provider, /id="fileStatusMenu"[^>]*role="group"/);
  assert.match(provider, /type="checkbox" data-file-status="M"/);
  assert.match(provider, /data-file-status="A"/);
  assert.match(provider, /data-file-status="C"/);
  assert.match(provider, /fileSearch='';fileStatusFilter=\[\]/);
  assert.match(provider, /fileStatusFilter\.includes\(fileStatusCode\(f\)\)/);
  assert.match(styles, /\.file-filter-bar/);
  assert.match(styles, /\.file-status-menu/);
  assert.match(styles, /\.layout\.files-focused \.detail/);
});

test('custom date range provides a themed calendar and themed filter chips', () => {
  const provider = readGitLogSurface();
  const styles = read('media', 'webview', 'git-log.css');

  assert.match(provider, /id="dateCalendar"/);
  assert.match(provider, /data-calendar-for="since"/);
  assert.match(provider, /data-calendar-for="until"/);
  assert.match(provider, /data-calendar-date/);
  assert.match(provider, /class="filter-chip ui-chip"/);
  assert.match(styles, /\.date-calendar-grid/);
  assert.match(styles, /\.calendar-day\.selected/);
});

test('context submenu has a visible chevron and closes after pointer exit', () => {
  const provider = readGitLogSurface();
  const styles = read('media', 'webview', 'git-log.css');

  assert.match(provider, /class="context-more-chevron"/);
  assert.match(provider, /function scheduleContextSubmenuClose\(\)/);
  assert.match(provider, /\$\('contextSubmenu'\)\.onpointerenter=cancelContextSubmenuClose/);
  assert.match(provider, /\$\('contextSubmenu'\)\.onpointerleave=scheduleContextSubmenuClose/);
  assert.match(styles, /\.context-more-chevron svg/);
});

test('stash actions are available only from the context menu', () => {
  const provider = readGitLogSurface();

  assert.match(provider, /if \(kind === 'stash'\) return \[contextAction\('stashApply'/);
  assert.match(provider, /\$\('branches'\)\.oncontextmenu=/);
  assert.doesNotMatch(provider, /data-stash-action|stash-actions|function stashAction/);
});

test('branch and repository pickers keep toolbar-sized search controls above scrolling lists', () => {
  const styles = read('media', 'webview', 'git-log.css');

  assert.match(styles, /--gn-toolbar-control-height:\s*34px/);
  assert.match(styles, /\.branch-picker-search,\s*\.repo-picker-search\s*\{[^}]*height:\s*var\(--gn-toolbar-control-height\);[^}]*min-height:\s*var\(--gn-toolbar-control-height\);[^}]*flex:\s*0 0 var\(--gn-toolbar-control-height\);/s);
  assert.match(styles, /#branchPickerItems,\s*#repoPickerItems\s*\{[^}]*min-height:\s*0;[^}]*flex:\s*1 1 auto;[^}]*overflow-x:\s*hidden;[^}]*overflow-y:\s*auto;[^}]*overscroll-behavior:\s*contain;/s);
});

test('branch selection uses native list colors while current branch keeps a small edge marker', () => {
  const styles = read('media', 'webview', 'git-log.css');

  assert.match(styles, /\.item\.viewing\s*\{[^}]*color:\s*var\(--gn-active-fg\);[^}]*background:\s*var\(--gn-active\);/s);
  assert.match(styles, /\.item\.active\s*\{[^}]*border-left-color:\s*var\(--gn-focus\);/s);
  assert.doesNotMatch(styles, /\.current-indicator/);
  assert.doesNotMatch(styles, /\.item\.viewing\s*\{[^}]*box-shadow:\s*inset/s);
});

test('branch favorite stars stay visible without hover', () => {
  const styles = read('media', 'webview', 'git-log.css');

  assert.match(styles, /\.item button\[data-star\]\s*\{[^}]*visibility:\s*visible;/s);
  assert.doesNotMatch(styles, /\.item button\[data-star\]\s*\{[^}]*visibility:\s*hidden;/s);
});

test('editor reveal focuses an exact commit in the Git Log view', () => {
  const provider = readGitLogSurface();

  assert.match(provider, /async revealCommit\(root: string, hash: string\)/);
  assert.match(provider, /executeCommand\(`\$\{GitLogViewProvider\.viewId\}\.focus`\)/);
  assert.match(provider, /this\.activeFilters\.set\(root, \{ text: hash \}\)/);
  assert.match(provider, /this\.post\(\{ type: 'focusCommit', hash \}\)/);
  assert.match(provider, /function focusCommit\(hash\)/);
  assert.match(provider, /m\.type==='focusCommit'/);
});

test('history panel supports command-specific titles', () => {
  const history = read('src', 'git', 'lineHistoryPanel.ts');

  assert.match(history, /title = 'History for Selection'/);
  assert.match(history, /\{ title, entries, header \}/);
  assert.match(history, /<title>\$\{escapeHtml\(state\.title\)\}<\/title>/);
});

test('commit column visibility uses eye toggle buttons instead of checkboxes', () => {
  const provider = readGitLogSurface();
  const styles = read('media', 'webview', 'git-log.css');

  assert.match(provider, /function columnVisibilityIcon\(visible\)/);
  assert.match(provider, /role="menuitemcheckbox" aria-checked="/);
  assert.match(provider, /class="column-toggle"/);
  assert.doesNotMatch(provider, /type="checkbox" data-column-toggle/);
  assert.match(styles, /\.column-toggle-icon svg/);
  assert.match(styles, /\.column-toggle\[aria-checked="false"\]/);
  assert.match(styles, /\.hide-col-graph \[data-col="graph"\]/);
  assert.match(styles, /\.hide-col-subject \[data-col="subject"\]/);
  assert.match(styles, /\.hide-col-author \[data-col="author"\]/);
  assert.match(styles, /\.hide-col-date \[data-col="date"\]/);
});

test('diff and history views separate sign markers with user-select none to prevent copy pollution', () => {
  const history = read('src', 'git', 'lineHistoryPanel.ts');
  const historyCss = read('media', 'webview', 'line-history.css');
  const gitLogJs = read('media', 'webview', 'git-log.js');
  const gitLogCss = read('media', 'webview', 'git-log.css');

  assert.match(history, /sign\.className = 'sign'/);
  assert.match(history, /sign\.setAttribute\('aria-hidden', 'true'\)/);
  assert.match(history, /row\.append\(oldNum, newNum, sign, code\)/);
  assert.match(historyCss, /\.sign\s*\{[^}]*user-select:\s*none;/);
  assert.match(gitLogJs, /class="diff-sign"/);
  assert.match(gitLogCss, /\.diff-sign\s*\{[^}]*user-select:\s*none;/);
});

test('supports accessible modals, keyboard navigation, text selection, and picker limits', () => {
  const gitLogJs = read('media', 'webview', 'git-log.js');
  const gitLogCss = read('media', 'webview', 'git-log.css');

  assert.match(gitLogJs, /function openModal\(modal,initialFocus\)/);
  assert.match(gitLogJs, /function closeModal\(modal\)/);
  assert.match(gitLogJs, /function trapModalTab\(modal,e\)/);

  assert.match(gitLogCss, /\.row\s*>\s*\[data-col="subject"\]/);
  assert.match(gitLogCss, /\.file-name,\s*\.file-path\s*\{[^}]*user-select:\s*text;/s);

  assert.match(gitLogJs, /e\.key==='Home'/);
  assert.match(gitLogJs, /e\.key==='End'/);
  assert.match(gitLogJs, /e\.key==='PageDown'\|\|e\.key==='PageUp'/);
  assert.match(gitLogJs, /\(e\.ctrlKey\|\|e\.metaKey\)&&\s*\(e\.key==='c'\|\|e\.key==='C'\)/);

  assert.match(gitLogJs, /state\.selectedHashes\.size\+' commits selected'/);

  assert.match(gitLogJs, /BRANCH_PICKER_LIMIT=100;/);
  assert.match(gitLogJs, /Showing '\+refs\.length\+' of '\+allMatching\.length/);
});

test('detail actions and column menu use professional SVG icons and structured headers', () => {
  const gitLogJs = read('media', 'webview', 'git-log.js');
  const gitLogCss = read('media', 'webview', 'git-log.css');

  assert.match(gitLogJs, /class="ui-icon-button quiet" data-copy-detail/);
  assert.match(gitLogJs, /class="ui-icon-button quiet" data-edit-message/);
  assert.doesNotMatch(gitLogJs, /✏️/);
  assert.doesNotMatch(gitLogJs, /data-copy-detail="[^"]*" title="Copy hash">⧉/);
  assert.doesNotMatch(gitLogJs, /data-copy-detail="[^"]*" title="Copy commit message">≡/);
  assert.match(gitLogCss, /\.detail-icon-actions button\s*\{[^}]*background:\s*transparent;/s);

  assert.match(gitLogJs, /class="menu-group-header"/);
  assert.match(gitLogJs, /class="menu-action-icon"/);
  assert.match(gitLogCss, /\.menu-group-header\s*\{[^}]*text-transform:\s*uppercase;/s);
  assert.match(gitLogCss, /\.menu-action-icon/);
  assert.match(gitLogCss, /#viewOptions\[aria-expanded="true"\]/);

  // Parent commit syncs graph and detail actions omits dots button
  assert.match(gitLogJs, /if\(state\.commits\.some\(c=>c\?\.hash===ph\)\)focusCommit\(ph\)/);
  assert.doesNotMatch(gitLogJs, /data-detail-menu/);
  assert.match(gitLogJs, /tableHeader\.oncontextmenu/);
  assert.match(gitLogCss, /\.detail-icon-actions button\s*\{[^}]*width:\s*28px;/s);
});
