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

  assert.doesNotMatch(provider, /<select(?![^>]*\bhidden\b)/);
  assert.doesNotMatch(provider, /type="date"/);
  assert.match(provider, /id="dateChoices"/);
  assert.match(provider, /inputmode="numeric" placeholder="YYYY-MM-DD"/);
  assert.match(provider, /id="repoPicker"/);
  assert.match(provider, /id="parentMenu"/);
  assert.match(provider, /id="rebaseActionMenu"/);
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
