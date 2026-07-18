import * as vscode from 'vscode';
import { LineHistoryEntry } from './lineHistory';

interface PanelState {
  readonly header: string;
  readonly entries: LineHistoryEntry[];
}

export class LineHistoryPanel {
  private static panel: vscode.WebviewPanel | undefined;

  static show(entries: LineHistoryEntry[], header: string, extensionUri: vscode.Uri): void {
    const title = 'History for Selection';

    if (!LineHistoryPanel.panel) {
      LineHistoryPanel.panel = vscode.window.createWebviewPanel(
        'gitnav.lineHistory',
        title,
        vscode.ViewColumn.Beside,
        {
          enableScripts: true,
          retainContextWhenHidden: true,
          localResourceRoots: [extensionUri]
        }
      );
      LineHistoryPanel.panel.onDidDispose(() => {
        LineHistoryPanel.panel = undefined;
      });
    } else {
      LineHistoryPanel.panel.reveal(vscode.ViewColumn.Beside, true);
    }

    LineHistoryPanel.panel.title = title;
    LineHistoryPanel.panel.webview.html = renderHtml(LineHistoryPanel.panel.webview, { entries, header }, extensionUri);
  }
}

function renderHtml(webview: vscode.Webview, state: PanelState, extensionUri: vscode.Uri): string {
  const nonce = createNonce();
  const serializedState = JSON.stringify(state).replace(/</g, '\\u003c');
  const assetUri = (name: string) => webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, 'media', 'webview', name)
  ).with({ query: `v=${nonce}` });
  const uiStyleUri = assetUri('ui.css');
  const viewStyleUri = assetUri('line-history.css');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <title>History for Selection</title>
  <link rel="stylesheet" href="${uiStyleUri}">
  <link rel="stylesheet" href="${viewStyleUri}">
  <style media="not all">
    :root {
      color-scheme: light dark;
    }

    * {
      box-sizing: border-box;
    }

    body {
      margin: 0;
      padding: 0;
      color: var(--vscode-editor-foreground);
      background: var(--vscode-editor-background);
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      overflow: hidden;
    }

    .shell {
      display: grid;
      grid-template-columns: var(--commit-width, 320px) 5px minmax(0, 1fr);
      height: 100vh;
      min-width: 0;
    }

    .shell.resizing {
      cursor: col-resize;
      user-select: none;
    }

    .shell.collapsed {
      grid-template-columns: 0 7px minmax(0, 1fr);
    }

    .sidebar {
      border-right: 1px solid var(--vscode-panel-border);
      min-width: 0;
      display: flex;
      flex-direction: column;
      background: var(--vscode-sideBar-background);
      overflow: hidden;
    }

    .splitter {
      cursor: col-resize;
      background: var(--vscode-panel-border);
      position: relative;
      z-index: 2;
    }

    .splitter:hover,
    .shell.resizing .splitter {
      background: var(--vscode-focusBorder);
    }

    .splitter::before {
      content: '';
      position: absolute;
      inset: 0 -4px;
    }

    .title {
      padding: 10px 12px;
      border-bottom: 1px solid var(--vscode-panel-border);
      color: var(--vscode-descriptionForeground);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      flex: 0 0 auto;
    }

    .commit-list {
      list-style: none;
      margin: 0;
      padding: 4px 0;
      overflow: auto;
      outline: none;
      flex: 1 1 auto;
    }

    .commit {
      padding: 8px 12px;
      cursor: default;
      border-left: 3px solid transparent;
      min-width: 0;
    }

    .commit:hover {
      background: var(--vscode-list-hoverBackground);
    }

    .commit[aria-selected="true"] {
      color: var(--vscode-list-activeSelectionForeground);
      background: var(--vscode-list-activeSelectionBackground);
      border-left-color: var(--vscode-focusBorder);
    }

    .subject {
      font-weight: 600;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .meta,
    .rename {
      color: var(--vscode-descriptionForeground);
      margin-top: 3px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      font-size: 0.92em;
    }

    .commit[aria-selected="true"] .meta,
    .commit[aria-selected="true"] .rename {
      color: inherit;
      opacity: 0.86;
    }

    .patch-pane {
      min-width: 0;
      overflow: auto;
      display: flex;
      flex-direction: column;
    }

    .patch-head {
      padding: 10px 14px;
      border-bottom: 1px solid var(--vscode-panel-border);
      flex: 0 0 auto;
      min-width: 0;
    }

    .patch-title {
      font-weight: 600;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .patch-meta {
      color: var(--vscode-descriptionForeground);
      margin-top: 3px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      font-size: 0.92em;
    }

    .patch {
      font-family: var(--vscode-editor-font-family);
      font-size: var(--vscode-editor-font-size);
      line-height: 1.45;
      padding: 10px 0 18px;
      overflow: auto;
      flex: 1 1 auto;
    }

    .hunk {
      margin-bottom: 14px;
    }

    .hunk-header {
      color: var(--vscode-descriptionForeground);
      background: var(--vscode-editorGroupHeader-tabsBackground);
      padding: 4px 10px;
      border-top: 1px solid var(--vscode-panel-border);
      border-bottom: 1px solid var(--vscode-panel-border);
      white-space: pre;
    }

    .line {
      display: grid;
      grid-template-columns: 62px 62px minmax(0, 1fr);
      min-width: max-content;
      white-space: pre;
    }

    .line.add {
      background: var(--vscode-diffEditor-insertedTextBackground);
    }

    .line.del {
      background: var(--vscode-diffEditor-removedTextBackground);
    }

    .num {
      user-select: none;
      text-align: right;
      color: var(--vscode-editorLineNumber-foreground);
      padding: 0 10px;
      border-right: 1px solid var(--vscode-panel-border);
    }

    .code {
      padding: 0 12px;
      min-width: 0;
    }

    .empty {
      color: var(--vscode-descriptionForeground);
      padding: 18px;
    }
  </style>
</head>
<body>
  <script id="initial-data" type="application/json">${serializedState}</script>
  <main class="shell">
    <aside class="sidebar">
      <div class="title" id="header"></div>
      <ul class="commit-list" id="commitList" role="listbox" tabindex="0" aria-label="Commits"></ul>
    </aside>
    <div class="splitter" id="splitter" title="Drag to resize commit list. Double-click to collapse or restore."></div>
    <section class="patch-pane">
      <div class="patch-head">
        <div class="patch-title" id="patchTitle"></div>
        <div class="patch-meta" id="patchMeta"></div>
      </div>
      <div class="patch" id="patch"></div>
    </section>
  </main>
  <script nonce="${nonce}">
    const state = JSON.parse(document.getElementById('initial-data').textContent);
    const shell = document.querySelector('.shell');
    const commitList = document.getElementById('commitList');
    const header = document.getElementById('header');
    const splitter = document.getElementById('splitter');
    const patch = document.getElementById('patch');
    const patchTitle = document.getElementById('patchTitle');
    const patchMeta = document.getElementById('patchMeta');
    const layoutKey = 'gitnav.lineHistory.commitWidth';
    const collapsedKey = 'gitnav.lineHistory.commitCollapsed';
    const minCommitWidth = 160;
    const maxCommitWidth = 640;
    let selectedIndex = 0;
    let lastCommitWidth = Number(localStorage.getItem(layoutKey)) || 320;

    header.textContent = state.header + ' · ' + state.entries.length + ' commit' + (state.entries.length === 1 ? '' : 's');

    function clampCommitWidth(value) {
      return Math.max(minCommitWidth, Math.min(maxCommitWidth, value));
    }

    function applyCommitWidth(value) {
      lastCommitWidth = clampCommitWidth(value);
      shell.style.setProperty('--commit-width', lastCommitWidth + 'px');
      localStorage.setItem(layoutKey, String(lastCommitWidth));
    }

    function setCollapsed(collapsed) {
      shell.classList.toggle('collapsed', collapsed);
      localStorage.setItem(collapsedKey, collapsed ? 'true' : 'false');
      splitter.title = collapsed
        ? 'Double-click to restore commit list.'
        : 'Drag to resize commit list. Double-click to collapse.';
    }

    applyCommitWidth(lastCommitWidth);
    setCollapsed(localStorage.getItem(collapsedKey) === 'true');

    function relativeTime(timestamp) {
      const seconds = Math.max(0, Math.floor(Date.now() / 1000) - timestamp);
      if (seconds < 60) return 'just now';
      const minutes = Math.floor(seconds / 60);
      if (minutes < 60) return minutes + 'm ago';
      const hours = Math.floor(minutes / 60);
      if (hours < 24) return hours + 'h ago';
      const days = Math.floor(hours / 24);
      if (days < 30) return days + 'd ago';
      const months = Math.floor(days / 30);
      if (months < 12) return months + 'mo ago';
      return Math.floor(months / 12) + 'y ago';
    }

    function renderCommits() {
      commitList.replaceChildren();
      state.entries.forEach((entry, index) => {
        const item = document.createElement('li');
        item.className = 'commit';
        item.role = 'option';
        item.tabIndex = -1;
        item.setAttribute('aria-selected', String(index === selectedIndex));

        const subject = document.createElement('div');
        subject.className = 'subject';
        subject.textContent = entry.subject;

        const meta = document.createElement('div');
        meta.className = 'meta';
        meta.textContent = entry.shortHash + ' · ' + entry.authorName + ' · ' + relativeTime(entry.timestamp);

        item.append(subject, meta);
        if (entry.oldPath !== entry.newPath) {
          const rename = document.createElement('div');
          rename.className = 'rename';
          rename.textContent = '↳ old name: ' + entry.oldPath;
          item.append(rename);
        }

        item.addEventListener('click', () => selectCommit(index));
        commitList.append(item);
      });
    }

    function renderPatch() {
      const entry = state.entries[selectedIndex];
      patch.replaceChildren();

      if (!entry) {
        patchTitle.textContent = 'No commits';
        patchMeta.textContent = '';
        const empty = document.createElement('div');
        empty.className = 'empty';
        empty.textContent = 'No commit touched this selected range.';
        patch.append(empty);
        return;
      }

      patchTitle.textContent = entry.subject;
      patchMeta.textContent = entry.hash + ' · ' + entry.authorName + ' <' + entry.authorEmail + '> · ' + new Date(entry.timestamp * 1000).toLocaleString();

      if (entry.hunks.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'empty';
        empty.textContent = 'This commit has no patch hunk for the selected range.';
        patch.append(empty);
        return;
      }

      for (const hunk of entry.hunks) {
        const hunkEl = document.createElement('section');
        hunkEl.className = 'hunk';

        const hunkHeader = document.createElement('div');
        hunkHeader.className = 'hunk-header';
        hunkHeader.textContent = hunk.header;
        hunkEl.append(hunkHeader);

        for (const line of hunk.lines) {
          const row = document.createElement('div');
          row.className = 'line ' + line.kind;

          const oldNum = document.createElement('span');
          oldNum.className = 'num';
          oldNum.textContent = line.oldLine === undefined ? '' : String(line.oldLine);

          const newNum = document.createElement('span');
          newNum.className = 'num';
          newNum.textContent = line.newLine === undefined ? '' : String(line.newLine);

          const code = document.createElement('span');
          code.className = 'code';
          code.textContent = (line.kind === 'add' ? '+' : line.kind === 'del' ? '-' : ' ') + line.text;

          row.append(oldNum, newNum, code);
          hunkEl.append(row);
        }

        patch.append(hunkEl);
      }
    }

    function selectCommit(index) {
      if (index < 0 || index >= state.entries.length || index === selectedIndex) {
        return;
      }

      selectedIndex = index;
      renderCommits();
      renderPatch();
      commitList.children[selectedIndex]?.scrollIntoView({ block: 'nearest' });
    }

    commitList.addEventListener('keydown', event => {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        selectCommit(Math.min(selectedIndex + 1, state.entries.length - 1));
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        selectCommit(Math.max(selectedIndex - 1, 0));
      } else if (event.key === 'Home') {
        event.preventDefault();
        selectCommit(0);
      } else if (event.key === 'End') {
        event.preventDefault();
        selectCommit(state.entries.length - 1);
      }
    });

    splitter.addEventListener('dblclick', () => {
      setCollapsed(!shell.classList.contains('collapsed'));
    });

    splitter.addEventListener('pointerdown', event => {
      event.preventDefault();
      setCollapsed(false);
      shell.classList.add('resizing');
      splitter.setPointerCapture(event.pointerId);

      const onPointerMove = moveEvent => {
        applyCommitWidth(moveEvent.clientX - shell.getBoundingClientRect().left);
      };

      const finishResize = () => {
        shell.classList.remove('resizing');
        splitter.removeEventListener('pointermove', onPointerMove);
        splitter.removeEventListener('pointerup', finishResize);
        splitter.removeEventListener('pointercancel', finishResize);
      };

      splitter.addEventListener('pointermove', onPointerMove);
      splitter.addEventListener('pointerup', finishResize);
      splitter.addEventListener('pointercancel', finishResize);
    });

    renderCommits();
    renderPatch();
    commitList.focus();
  </script>
</body>
</html>`;
}

function createNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let value = '';
  for (let index = 0; index < 32; index++) {
    value += chars.charAt(Math.floor(Math.random() * chars.length));
  }

  return value;
}
