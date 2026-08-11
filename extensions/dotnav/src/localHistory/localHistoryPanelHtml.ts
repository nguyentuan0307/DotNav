export interface LocalHistoryPanelRevisionState {
  readonly id: string;
  readonly timestamp: number;
  readonly source: string;
  readonly path: string;
}

export interface LocalHistoryPanelState {
  readonly fileName: string;
  readonly filePath: string;
  readonly scopeLabel: string;
  readonly revisions: readonly LocalHistoryPanelRevisionState[];
}

export function renderLocalHistoryPanelHtml(state: LocalHistoryPanelState, nonce: string): string {
  const serializedState = JSON.stringify(state)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <title>${escapeHtml(`Local History — ${state.fileName}`)}</title>
  <style>
    :root { color-scheme: light dark; }
    * { box-sizing: border-box; }
    body {
      margin: 0; padding: 0; overflow: hidden;
      color: var(--vscode-editor-foreground);
      background: var(--vscode-editor-background);
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
    }
    .shell {
      --revision-width: 310px;
      display: grid;
      grid-template-columns: var(--revision-width) 5px minmax(0, 1fr);
      height: 100vh;
      min-width: 0;
    }
    .shell.resizing { cursor: col-resize; user-select: none; }
    .shell.collapsed { grid-template-columns: 0 7px minmax(0, 1fr); }
    .sidebar {
      min-width: 0; overflow: hidden;
      display: flex; flex-direction: column;
      background: var(--vscode-sideBar-background);
      border-right: 1px solid var(--vscode-panel-border);
    }
    .sidebar-head {
      flex: 0 0 auto; padding: 10px 12px;
      border-bottom: 1px solid var(--vscode-panel-border);
    }
    .file-name { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .file-path, .revision-count, .patch-meta {
      color: var(--vscode-descriptionForeground);
      font-size: 0.92em;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .file-path { margin-top: 3px; }
    .revision-count { margin-top: 5px; }
    .revision-list {
      flex: 1 1 auto; overflow: auto; outline: none;
      list-style: none; margin: 0; padding: 4px 0;
    }
    .revision {
      min-width: 0; padding: 9px 12px;
      border-left: 3px solid transparent;
      cursor: default;
    }
    .revision:hover { background: var(--vscode-list-hoverBackground); }
    .revision[aria-selected="true"] {
      color: var(--vscode-list-activeSelectionForeground);
      background: var(--vscode-list-activeSelectionBackground);
      border-left-color: var(--vscode-focusBorder);
    }
    .revision-title { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .revision-meta { margin-top: 3px; color: var(--vscode-descriptionForeground); font-size: 0.92em; }
    .revision[aria-selected="true"] .revision-meta { color: inherit; opacity: 0.86; }
    .splitter { cursor: col-resize; background: var(--vscode-panel-border); position: relative; z-index: 2; }
    .splitter:hover, .shell.resizing .splitter { background: var(--vscode-focusBorder); }
    .splitter::before { content: ''; position: absolute; inset: 0 -4px; }
    .patch-pane { min-width: 0; overflow: hidden; display: flex; flex-direction: column; }
    .patch-head {
      flex: 0 0 auto; min-width: 0; padding: 10px 14px;
      border-bottom: 1px solid var(--vscode-panel-border);
    }
    .patch-title { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .patch-meta { margin-top: 3px; }
    .patch {
      flex: 1 1 auto; overflow: auto; padding: 10px 0 18px;
      font-family: var(--vscode-editor-font-family);
      font-size: var(--vscode-editor-font-size);
      line-height: 1.45;
    }
    .hunk { margin-bottom: 14px; }
    .hunk-header {
      padding: 4px 10px; white-space: pre;
      color: var(--vscode-descriptionForeground);
      background: var(--vscode-editorGroupHeader-tabsBackground);
      border-top: 1px solid var(--vscode-panel-border);
      border-bottom: 1px solid var(--vscode-panel-border);
    }
    .line {
      display: grid; grid-template-columns: 62px 62px minmax(0, 1fr);
      min-width: max-content; white-space: pre;
    }
    .line.add { background: var(--vscode-diffEditor-insertedTextBackground); }
    .line.del { background: var(--vscode-diffEditor-removedTextBackground); }
    .num {
      padding: 0 10px; text-align: right; user-select: none;
      color: var(--vscode-editorLineNumber-foreground);
      border-right: 1px solid var(--vscode-panel-border);
    }
    .code { min-width: 0; padding: 0 12px; }
    .empty { padding: 18px; color: var(--vscode-descriptionForeground); }
    .loading::after { content: 'Loading diff…'; display: block; padding: 18px; color: var(--vscode-descriptionForeground); }
  </style>
</head>
<body>
  <script id="initial-data" type="application/json">${serializedState}</script>
  <main class="shell" id="shell">
    <aside class="sidebar">
      <header class="sidebar-head">
        <div class="file-name" id="fileName"></div>
        <div class="file-path" id="filePath"></div>
        <div class="revision-count" id="revisionCount"></div>
      </header>
      <ul class="revision-list" id="revisionList" role="listbox" tabindex="0" aria-label="Local History revisions"></ul>
    </aside>
    <div class="splitter" id="splitter" title="Drag to resize revision list. Double-click to collapse or restore."></div>
    <section class="patch-pane">
      <header class="patch-head">
        <div class="patch-title" id="patchTitle">Select a revision</div>
        <div class="patch-meta" id="patchMeta"></div>
      </header>
      <div class="patch" id="patch"></div>
    </section>
  </main>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const state = JSON.parse(document.getElementById('initial-data').textContent);
    const shell = document.getElementById('shell');
    const revisionList = document.getElementById('revisionList');
    const splitter = document.getElementById('splitter');
    const patch = document.getElementById('patch');
    const patchTitle = document.getElementById('patchTitle');
    const patchMeta = document.getElementById('patchMeta');
    const widthKey = 'dotnav.localHistory.revisionWidth';
    const collapsedKey = 'dotnav.localHistory.revisionCollapsed';
    let selectedIndex = 0;
    let selectedRevisionId;
    let lastWidth = Number(localStorage.getItem(widthKey)) || 310;

    document.getElementById('fileName').textContent = state.fileName;
    document.getElementById('filePath').textContent = state.filePath;
    document.getElementById('revisionCount').textContent = state.scopeLabel + ' · ' + state.revisions.length + ' revision' + (state.revisions.length === 1 ? '' : 's');

    function sourceLabel(source) {
      if (source === 'baseline') return 'Opened snapshot';
      if (source === 'save') return 'Saved changes';
      if (source === 'external') return 'External change';
      if (source === 'command') return 'DotNav file operation';
      if (source === 'manual') return 'Current editor state';
      if (source === 'restore') return 'Restored revision';
      return 'Local change';
    }

    function relativeTime(timestamp) {
      const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
      if (seconds < 60) return 'just now';
      const minutes = Math.floor(seconds / 60);
      if (minutes < 60) return minutes + 'm ago';
      const hours = Math.floor(minutes / 60);
      if (hours < 24) return hours + 'h ago';
      const days = Math.floor(hours / 24);
      if (days < 30) return days + 'd ago';
      return new Date(timestamp).toLocaleDateString();
    }

    function renderRevisions() {
      revisionList.replaceChildren();
      state.revisions.forEach((revision, index) => {
        const item = document.createElement('li');
        item.className = 'revision';
        item.role = 'option';
        item.tabIndex = -1;
        item.setAttribute('aria-selected', String(index === selectedIndex));

        const title = document.createElement('div');
        title.className = 'revision-title';
        title.textContent = sourceLabel(revision.source);
        const meta = document.createElement('div');
        meta.className = 'revision-meta';
        meta.textContent = new Date(revision.timestamp).toLocaleString() + ' · ' + relativeTime(revision.timestamp);
        item.append(title, meta);
        item.addEventListener('click', () => selectRevision(index));
        revisionList.append(item);
      });
    }

    function selectRevision(index) {
      if (index < 0 || index >= state.revisions.length) return;
      selectedIndex = index;
      selectedRevisionId = state.revisions[index].id;
      renderRevisions();
      revisionList.children[index]?.scrollIntoView({ block: 'nearest' });
      patch.replaceChildren();
      patch.classList.add('loading');
      patchTitle.textContent = sourceLabel(state.revisions[index].source);
      patchMeta.textContent = 'Loading revision…';
      vscode.postMessage({ type: 'selectRevision', revisionId: selectedRevisionId });
    }

    function renderPatch(entry) {
      patch.classList.remove('loading');
      patch.replaceChildren();
      patchTitle.textContent = entry.title;
      patchMeta.textContent = entry.meta;
      if (entry.hunks.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'empty';
        empty.textContent = 'This revision has no content changes from the previous revision.';
        patch.append(empty);
        return;
      }
      for (const hunk of entry.hunks) {
        const section = document.createElement('section');
        section.className = 'hunk';
        const header = document.createElement('div');
        header.className = 'hunk-header';
        header.textContent = hunk.header;
        section.append(header);
        for (const line of hunk.lines) {
          const row = document.createElement('div');
          row.className = 'line ' + line.kind;
          const oldNumber = document.createElement('span');
          oldNumber.className = 'num';
          oldNumber.textContent = line.oldLine === undefined ? '' : String(line.oldLine);
          const newNumber = document.createElement('span');
          newNumber.className = 'num';
          newNumber.textContent = line.newLine === undefined ? '' : String(line.newLine);
          const code = document.createElement('span');
          code.className = 'code';
          code.textContent = (line.kind === 'add' ? '+' : line.kind === 'del' ? '-' : ' ') + line.text;
          row.append(oldNumber, newNumber, code);
          section.append(row);
        }
        patch.append(section);
      }
    }

    function renderError(message) {
      patch.classList.remove('loading');
      patch.replaceChildren();
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = message;
      patch.append(empty);
    }

    window.addEventListener('message', event => {
      const message = event.data;
      if (message.revisionId !== selectedRevisionId) return;
      if (message.type === 'revisionLoaded') renderPatch(message.entry);
      if (message.type === 'revisionError') renderError(message.message);
    });

    revisionList.addEventListener('keydown', event => {
      if (event.key === 'ArrowDown') { event.preventDefault(); selectRevision(Math.min(selectedIndex + 1, state.revisions.length - 1)); }
      else if (event.key === 'ArrowUp') { event.preventDefault(); selectRevision(Math.max(selectedIndex - 1, 0)); }
      else if (event.key === 'Home') { event.preventDefault(); selectRevision(0); }
      else if (event.key === 'End') { event.preventDefault(); selectRevision(state.revisions.length - 1); }
    });

    function applyWidth(value) {
      lastWidth = Math.max(170, Math.min(640, value));
      shell.style.setProperty('--revision-width', lastWidth + 'px');
      localStorage.setItem(widthKey, String(lastWidth));
    }
    function setCollapsed(collapsed) {
      shell.classList.toggle('collapsed', collapsed);
      localStorage.setItem(collapsedKey, collapsed ? 'true' : 'false');
    }
    splitter.addEventListener('dblclick', () => setCollapsed(!shell.classList.contains('collapsed')));
    splitter.addEventListener('pointerdown', event => {
      event.preventDefault(); setCollapsed(false); shell.classList.add('resizing'); splitter.setPointerCapture(event.pointerId);
      const move = moveEvent => applyWidth(moveEvent.clientX - shell.getBoundingClientRect().left);
      const finish = () => {
        shell.classList.remove('resizing');
        splitter.removeEventListener('pointermove', move);
        splitter.removeEventListener('pointerup', finish);
        splitter.removeEventListener('pointercancel', finish);
      };
      splitter.addEventListener('pointermove', move);
      splitter.addEventListener('pointerup', finish);
      splitter.addEventListener('pointercancel', finish);
    });

    applyWidth(lastWidth);
    setCollapsed(localStorage.getItem(collapsedKey) === 'true');
    renderRevisions();
    revisionList.focus();
    selectRevision(0);
  </script>
</body>
</html>`;
}

function escapeHtml(value: string): string {
  const replacements: Record<string, string> = {
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  };
  return value.replace(/[&<>"']/g, character => replacements[character]);
}
