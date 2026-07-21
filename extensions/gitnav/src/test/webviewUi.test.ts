import { readFileSync } from 'fs';
import * as path from 'path';
import test from 'node:test';
import assert from 'node:assert/strict';

const extensionRoot = path.join(__dirname, '..', '..');
const read = (...parts: string[]) => readFileSync(path.join(extensionRoot, ...parts), 'utf8');

test('uses one reusable webview UI foundation across GitNav surfaces', () => {
  const provider = read('src', 'git', 'gitLogViewProvider.ts');
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
  const provider = read('src', 'git', 'gitLogViewProvider.ts');
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
  const provider = read('src', 'git', 'gitLogViewProvider.ts');
  const history = read('src', 'git', 'lineHistoryPanel.ts');

  assert.match(provider, /style-src \$\{webview\.cspSource\} 'unsafe-inline'/);
  assert.match(history, /style-src \$\{webview\.cspSource\} 'unsafe-inline'/);
  assert.match(provider, /href="\$\{uiStyleUri\}"/);
  assert.match(provider, /href="\$\{viewStyleUri\}"/);
  assert.match(history, /href="\$\{uiStyleUri\}"/);
  assert.match(history, /href="\$\{viewStyleUri\}"/);
});

test('generated webview markup does not depend on blocked inline handlers or styles', () => {
  const provider = read('src', 'git', 'gitLogViewProvider.ts');

  assert.doesNotMatch(provider, /onclick="/);
  assert.doesNotMatch(provider, /'<[^']+\sstyle="/);
  assert.match(provider, /row\.style\.top=/);
  assert.match(provider, /\.with\(\{ query: `v=\$\{nonce\}` \}\)/);
});

test('changed files defaults to list mode and uses one compact folder action', () => {
  const provider = read('src', 'git', 'gitLogViewProvider.ts');
  const styles = read('media', 'webview', 'git-log.css');

  assert.match(provider, /localStorage\.getItem\('gitLog\.fileMode'\)\|\|'flat'/);
  assert.match(provider, /id="folderToggle"/);
  assert.doesNotMatch(provider, /id="collapseFiles"|id="expandFiles"/);
  assert.match(styles, /\.file-view-toggle button\s*\{[^}]*display: inline-flex;[^}]*align-items: center;[^}]*justify-content: center;/s);
});

test('custom date range provides a themed calendar and themed filter chips', () => {
  const provider = read('src', 'git', 'gitLogViewProvider.ts');
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
  const provider = read('src', 'git', 'gitLogViewProvider.ts');
  const styles = read('media', 'webview', 'git-log.css');

  assert.match(provider, /class="context-more-chevron"/);
  assert.match(provider, /function scheduleContextSubmenuClose\(\)/);
  assert.match(provider, /\$\('contextSubmenu'\)\.onpointerenter=cancelContextSubmenuClose/);
  assert.match(provider, /\$\('contextSubmenu'\)\.onpointerleave=scheduleContextSubmenuClose/);
  assert.match(styles, /\.context-more-chevron svg/);
});

test('stash actions are available only from the context menu', () => {
  const provider = read('src', 'git', 'gitLogViewProvider.ts');

  assert.match(provider, /if \(kind === 'stash'\) return \[contextAction\('stashApply'/);
  assert.match(provider, /\$\('branches'\)\.oncontextmenu=/);
  assert.doesNotMatch(provider, /data-stash-action|stash-actions|function stashAction/);
});

test('branch and repository picker lists scroll without chaining to the log', () => {
  const styles = read('media', 'webview', 'git-log.css');

  assert.match(styles, /#branchPickerItems,\s*#repoPickerItems\s*\{[^}]*min-height:\s*0;[^}]*overflow-x:\s*hidden;[^}]*overflow-y:\s*auto;[^}]*overscroll-behavior:\s*contain;/s);
});

test('branch selection uses native list colors while current branch keeps a small edge marker', () => {
  const styles = read('media', 'webview', 'git-log.css');

  assert.match(styles, /\.item\.viewing\s*\{[^}]*color:\s*var\(--gn-active-fg\);[^}]*background:\s*var\(--gn-active\);/s);
  assert.match(styles, /\.item\.active\s*\{[^}]*border-left-color:\s*var\(--gn-focus\);/s);
  assert.doesNotMatch(styles, /\.current-indicator/);
  assert.doesNotMatch(styles, /\.item\.viewing\s*\{[^}]*box-shadow:\s*inset/s);
});

test('commit column visibility uses eye toggle buttons instead of checkboxes', () => {
  const provider = read('src', 'git', 'gitLogViewProvider.ts');
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
