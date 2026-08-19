export function renderSearchEverywhereHtml(cspSource: string, initialPrefix: string = ''): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Search Everywhere</title>
  <style>
    :root {
      --bg-color: var(--vscode-editor-background, #1e1e1e);
      --panel-bg: var(--vscode-sideBar-background, #252526);
      --header-bg: var(--vscode-titleBar-activeBackground, #2d2d2d);
      --input-bg: var(--vscode-input-background, #3c3c3c);
      --input-fg: var(--vscode-input-foreground, #cccccc);
      --input-border: var(--vscode-input-border, #3c3c3c);
      --focus-border: var(--vscode-focusBorder, #007acc);
      --list-hover: var(--vscode-list-hoverBackground, #2a2d2e);
      --list-active: var(--vscode-list-activeSelectionBackground, #04395e);
      --list-active-fg: var(--vscode-list-activeSelectionForeground, #ffffff);
      --text-color: var(--vscode-editor-foreground, #d4d4d4);
      --text-muted: var(--vscode-descriptionForeground, #8c8c8c);
      --border-color: var(--vscode-panel-border, #3c3c3c);
      --target-line-bg: rgba(255, 215, 0, 0.15);
      --target-line-border: rgba(255, 215, 0, 0.7);
      --font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif);
      --font-code: var(--vscode-editor-font-family, 'Cascadia Code', 'Fira Code', Consolas, 'Courier New', monospace);
    }

    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    body {
      background: rgba(0, 0, 0, 0.45);
      color: var(--text-color);
      font-family: var(--font-family);
      font-size: 13px;
      line-height: 1.4;
      height: 100vh;
      width: 100vw;
      display: flex;
      justify-content: center;
      align-items: flex-start;
      padding-top: 5vh;
      overflow: hidden;
      user-select: none;
    }

    /* Floating Modal Container */
    .modal-container {
      width: 820px;
      max-width: 94vw;
      height: 640px;
      max-height: 90vh;
      background: var(--bg-color);
      border: 1px solid var(--border-color);
      border-radius: 8px;
      box-shadow: 0 20px 50px rgba(0, 0, 0, 0.65), 0 0 0 1px rgba(255, 255, 255, 0.08);
      display: flex;
      flex-direction: column;
      overflow: hidden;
      resize: both;
      min-width: 500px;
      min-height: 380px;
      position: relative;
    }

    /* Top Search Bar & Header */
    .search-header {
      background: var(--header-bg);
      border-bottom: 1px solid var(--border-color);
      padding: 10px 14px;
      display: flex;
      flex-direction: column;
      gap: 8px;
      flex-shrink: 0;
    }

    .input-row {
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .search-input-wrapper {
      position: relative;
      flex: 1;
      display: flex;
      align-items: center;
    }

    .search-icon {
      position: absolute;
      left: 10px;
      color: var(--text-muted);
      font-size: 14px;
      pointer-events: none;
    }

    .search-input {
      width: 100%;
      background: var(--input-bg);
      color: var(--input-fg);
      border: 1px solid var(--input-border);
      border-radius: 4px;
      padding: 8px 32px 8px 30px;
      font-size: 14px;
      font-family: var(--font-family);
      outline: none;
      transition: border-color 0.15s ease;
    }

    .search-input:focus {
      border-color: var(--focus-border);
    }

    .clear-btn {
      position: absolute;
      right: 8px;
      background: none;
      border: none;
      color: var(--text-muted);
      cursor: pointer;
      font-size: 14px;
      padding: 2px 4px;
    }
    .clear-btn:hover {
      color: var(--text-color);
    }

    .header-actions {
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .btn-action {
      background: var(--panel-bg);
      border: 1px solid var(--border-color);
      color: var(--text-color);
      border-radius: 4px;
      padding: 6px 10px;
      font-size: 12px;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 5px;
      transition: all 0.15s ease;
    }
    .btn-action:hover {
      background: var(--list-hover);
    }
    .btn-action.active {
      background: var(--list-active);
      color: var(--list-active-fg);
      border-color: var(--focus-border);
    }

    /* Filter Pills */
    .filter-pills {
      display: flex;
      align-items: center;
      gap: 6px;
      flex-wrap: wrap;
    }

    .pill {
      background: var(--panel-bg);
      color: var(--text-muted);
      border: 1px solid var(--border-color);
      border-radius: 12px;
      padding: 3px 10px;
      font-size: 11px;
      cursor: pointer;
      transition: all 0.15s ease;
      display: flex;
      align-items: center;
      gap: 4px;
    }

    .pill:hover {
      color: var(--text-color);
      background: var(--list-hover);
    }

    .pill.active {
      background: var(--list-active);
      color: var(--list-active-fg);
      border-color: var(--focus-border);
      font-weight: 600;
    }

    /* 2-Row Vertical Layout */
    .content-body {
      flex: 1;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      position: relative;
    }

    /* Row 1: Upper Search Results Pane */
    .results-pane {
      height: 260px;
      min-height: 100px;
      overflow-y: auto;
      background: var(--bg-color);
      display: flex;
      flex-direction: column;
    }

    .group-header {
      padding: 5px 12px;
      font-size: 11px;
      font-weight: bold;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: var(--text-muted);
      background: rgba(128, 128, 128, 0.08);
      border-bottom: 1px solid var(--border-color);
      position: sticky;
      top: 0;
      z-index: 2;
    }

    .result-item {
      padding: 7px 12px;
      display: flex;
      align-items: center;
      gap: 10px;
      cursor: pointer;
      border-bottom: 1px solid rgba(128, 128, 128, 0.05);
      transition: background 0.1s ease;
    }

    .result-item:hover {
      background: var(--list-hover);
    }

    .result-item.selected {
      background: var(--list-active);
      color: var(--list-active-fg);
    }

    .result-item.selected .item-subtitle,
    .result-item.selected .item-project {
      color: rgba(255, 255, 255, 0.8);
    }

    .item-icon {
      font-size: 15px;
      width: 20px;
      text-align: center;
      flex-shrink: 0;
    }

    .item-info {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 1px;
    }

    .item-title-row {
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .item-title {
      font-weight: 500;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .http-badge {
      font-size: 9px;
      font-weight: bold;
      padding: 1px 4px;
      border-radius: 3px;
      text-transform: uppercase;
    }
    .http-get { background: #2e7d32; color: #ffffff; }
    .http-post { background: #1565c0; color: #ffffff; }
    .http-put { background: #e65100; color: #ffffff; }
    .http-delete { background: #c62828; color: #ffffff; }
    .http-patch { background: #6a1b9a; color: #ffffff; }

    .item-subtitle {
      font-size: 11px;
      color: var(--text-muted);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .item-project {
      font-size: 10px;
      color: var(--text-muted);
      background: rgba(128, 128, 128, 0.15);
      padding: 1px 6px;
      border-radius: 3px;
      flex-shrink: 0;
      white-space: nowrap;
    }

    .empty-state {
      padding: 35px 20px;
      text-align: center;
      color: var(--text-muted);
    }

    /* Draggable Split Resizer Divider */
    .resizer-divider {
      height: 6px;
      background: var(--header-bg);
      border-top: 1px solid var(--border-color);
      border-bottom: 1px solid var(--border-color);
      cursor: row-resize;
      display: flex;
      justify-content: center;
      align-items: center;
      flex-shrink: 0;
      user-select: none;
      transition: background 0.15s ease;
    }

    .resizer-divider:hover,
    .resizer-divider.dragging {
      background: var(--focus-border);
    }

    .resizer-grip {
      width: 32px;
      height: 2px;
      background: var(--text-muted);
      border-radius: 1px;
    }

    /* Row 2: Lower Code Preview Box */
    .preview-pane {
      flex: 1;
      display: flex;
      flex-direction: column;
      background: var(--panel-bg);
      overflow: hidden;
      min-height: 100px;
    }

    .preview-pane.hidden {
      display: none;
    }

    .preview-header {
      padding: 6px 14px;
      background: var(--header-bg);
      border-bottom: 1px solid var(--border-color);
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      flex-shrink: 0;
    }

    .preview-title {
      font-size: 12px;
      font-weight: 600;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .preview-open-btn {
      background: var(--input-bg);
      color: var(--text-color);
      border: 1px solid var(--border-color);
      border-radius: 3px;
      padding: 3px 8px;
      font-size: 11px;
      cursor: pointer;
    }
    .preview-open-btn:hover {
      background: var(--focus-border);
      color: #ffffff;
    }

    .preview-code-container {
      flex: 1;
      overflow: auto;
      font-family: var(--font-code);
      font-size: 12px;
      line-height: 19px;
      background: #1e1e1e;
      padding: 8px 0;
    }

    .code-line {
      display: flex;
      padding: 0 10px;
      white-space: pre;
    }

    .code-line:hover {
      background: rgba(255, 255, 255, 0.04);
    }

    .code-line.target-line {
      background: var(--target-line-bg);
      border-left: 3px solid var(--target-line-border);
      font-weight: 600;
    }

    .line-number {
      width: 45px;
      text-align: right;
      padding-right: 12px;
      color: #5a5a5a;
      user-select: none;
      flex-shrink: 0;
    }

    .code-line.target-line .line-number {
      color: #ffd700;
    }

    .line-content {
      flex: 1;
    }

    /* Bottom Status Bar */
    .status-bar {
      padding: 5px 14px;
      background: var(--header-bg);
      border-top: 1px solid var(--border-color);
      display: flex;
      align-items: center;
      justify-content: space-between;
      font-size: 11px;
      color: var(--text-muted);
      flex-shrink: 0;
    }

    .shortcuts-hint {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .kbd {
      background: rgba(128, 128, 128, 0.2);
      padding: 1px 5px;
      border-radius: 3px;
      font-family: var(--font-code);
      font-size: 10px;
    }
  </style>
</head>
<body>
  <!-- Floating Modal Card -->
  <div id="modalCard" class="modal-container">
    <!-- Top Header -->
    <div class="search-header">
      <div class="input-row">
        <div class="search-input-wrapper">
          <span class="search-icon">🔍</span>
          <input
            type="text"
            id="searchInput"
            class="search-input"
            placeholder="Search everywhere: /api, $cqrs, %db, #type, @method, !file, :Line..."
            autofocus
            autocomplete="off"
            spellcheck="false"
            value="${initialPrefix}"
          />
          <button id="clearBtn" class="clear-btn" title="Clear input" style="display: none;">✕</button>
        </div>
        <div class="header-actions">
          <button id="togglePreviewBtn" class="btn-action active" title="Toggle Code Preview Pane (Ctrl+P)">
            👁️ Preview
          </button>
          <button id="closeBtn" class="btn-action" title="Close (Esc)">
            ✕
          </button>
        </div>
      </div>

      <!-- Filter Pills -->
      <div class="filter-pills">
        <div class="pill active" data-filter="all">All</div>
        <div class="pill" data-filter="endpoints">⚡ Endpoints (/)</div>
        <div class="pill" data-filter="cqrs">⚡ CQRS ($)</div>
        <div class="pill" data-filter="database">💾 Database (%)</div>
        <div class="pill" data-filter="types">📦 Types (#)</div>
        <div class="pill" data-filter="methods">⚡ Methods (@)</div>
        <div class="pill" data-filter="files">📄 Files (!)</div>
      </div>
    </div>

    <!-- 2-Row Vertical Split Body -->
    <div class="content-body">
      <!-- Row 1: Upper Search Results List -->
      <div id="resultsPane" class="results-pane">
        <div class="empty-state">Type a query to search across the entire solution...</div>
      </div>

      <!-- Draggable Split Resizer Divider -->
      <div id="resizerDivider" class="resizer-divider" title="Drag to resize results / preview">
        <div class="resizer-grip"></div>
      </div>

      <!-- Row 2: Lower Code Preview Box -->
      <div id="previewPane" class="preview-pane">
        <div class="preview-header">
          <div id="previewTitle" class="preview-title">
            <span>📄</span> <span id="previewFileName">No selection</span>
          </div>
          <button id="previewOpenBtn" class="preview-open-btn" style="display: none;">
            Open in Editor ↗
          </button>
        </div>
        <div id="previewCodeContainer" class="preview-code-container">
          <div style="padding: 20px; color: var(--text-muted); text-align: center;">
            Select a symbol to preview code definition
          </div>
        </div>
      </div>
    </div>

    <!-- Bottom Status Bar -->
    <div class="status-bar">
      <div id="statusCount">Ready</div>
      <div class="shortcuts-hint">
        <span><span class="kbd">↑↓</span> Navigate</span>
        <span><span class="kbd">↵</span> Open</span>
        <span><span class="kbd">Esc</span> Close</span>
        <span><span class="kbd">Tab</span> Filter</span>
        <span><span class="kbd">Ctrl+P</span> Preview</span>
      </div>
    </div>
  </div>

  <script>
    const vscode = acquireVsCodeApi();
    const searchInput = document.getElementById('searchInput');
    const clearBtn = document.getElementById('clearBtn');
    const closeBtn = document.getElementById('closeBtn');
    const resultsPane = document.getElementById('resultsPane');
    const previewPane = document.getElementById('previewPane');
    const resizerDivider = document.getElementById('resizerDivider');
    const togglePreviewBtn = document.getElementById('togglePreviewBtn');
    const previewFileName = document.getElementById('previewFileName');
    const previewCodeContainer = document.getElementById('previewCodeContainer');
    const previewOpenBtn = document.getElementById('previewOpenBtn');
    const statusCount = document.getElementById('statusCount');
    const filterPills = document.querySelectorAll('.pill');

    let currentResults = [];
    let selectedIndex = 0;
    let isPreviewVisible = true;
    let activeFilter = 'all';
    let debounceTimer;

    function getKindIcon(kind) {
      switch (kind) {
        case 'endpoint': return '🌐';
        case 'cqrs_command': return '⚡';
        case 'cqrs_query': return '🔍';
        case 'cqrs_handler': return '⚙️';
        case 'cqrs_event': return '📢';
        case 'ef_entity': return '📄';
        case 'ef_dbset': return '💾';
        case 'ef_migration': return '🗄️';
        case 'class': return '📦';
        case 'interface': return '🔷';
        case 'record': return '📑';
        case 'enum': return '🏷️';
        case 'enum_member': return '🔹';
        case 'method': return '⚡';
        case 'property': return '🔧';
        case 'config_key': return '⚙️';
        case 'project': return '📁';
        case 'file': return '📄';
        default: return '📍';
      }
    }

    function getGroupTitle(kind) {
      switch (kind) {
        case 'endpoint': return 'API Endpoints';
        case 'cqrs_command':
        case 'cqrs_query':
        case 'cqrs_handler':
        case 'cqrs_event': return 'CQRS & Domain Events';
        case 'ef_entity':
        case 'ef_dbset':
        case 'ef_migration': return 'Database & EF Core';
        case 'class':
        case 'interface':
        case 'record':
        case 'enum':
        case 'enum_member': return 'Types & Models';
        case 'method':
        case 'property': return 'Methods & Properties';
        default: return 'Files & Configurations';
      }
    }

    function renderResults(results) {
      currentResults = results;
      resultsPane.innerHTML = '';

      if (!results || results.length === 0) {
        resultsPane.innerHTML = '<div class="empty-state">No symbols or endpoints found.</div>';
        previewCodeContainer.innerHTML = '<div style="padding: 20px; color: var(--text-muted); text-align: center;">No preview available</div>';
        previewFileName.textContent = 'No selection';
        previewOpenBtn.style.display = 'none';
        statusCount.textContent = '0 results';
        return;
      }

      statusCount.textContent = results.length + ' result' + (results.length > 1 ? 's' : '');

      let currentGroup = '';
      results.forEach((item, index) => {
        const sym = item.symbol;
        const group = getGroupTitle(sym.kind);

        if (group !== currentGroup) {
          currentGroup = group;
          const header = document.createElement('div');
          header.className = 'group-header';
          header.textContent = group;
          resultsPane.appendChild(header);
        }

        const div = document.createElement('div');
        div.className = 'result-item' + (index === selectedIndex ? ' selected' : '');
        div.dataset.index = index;

        let httpBadge = '';
        if (sym.kind === 'endpoint' && sym.metadata && sym.metadata.httpMethod) {
          const m = sym.metadata.httpMethod.toLowerCase();
          httpBadge = '<span class="http-badge http-' + m + '">' + sym.metadata.httpMethod + '</span>';
        }

        div.innerHTML = 
          '<div class="item-icon">' + getKindIcon(sym.kind) + '</div>' +
          '<div class="item-info">' +
            '<div class="item-title-row">' +
              httpBadge +
              '<span class="item-title">' + escapeHtml(sym.name) + '</span>' +
            '</div>' +
            '<div class="item-subtitle">' + escapeHtml(sym.relativePath) + ':' + sym.line + '</div>' +
          '</div>' +
          '<div class="item-project">' + escapeHtml(sym.projectName) + '</div>';

        div.addEventListener('click', () => {
          selectItem(index);
          openSelectedItem();
        });

        div.addEventListener('mouseenter', () => {
          selectItem(index);
        });

        resultsPane.appendChild(div);
      });

      selectItem(Math.min(selectedIndex, results.length - 1));
    }

    function selectItem(index) {
      if (index < 0 || index >= currentResults.length) return;
      selectedIndex = index;

      document.querySelectorAll('.result-item').forEach((el) => {
        if (parseInt(el.dataset.index, 10) === selectedIndex) {
          el.classList.add('selected');
          el.scrollIntoView({ block: 'nearest' });
        } else {
          el.classList.remove('selected');
        }
      });

      const selected = currentResults[selectedIndex];
      if (selected && isPreviewVisible) {
        requestPreview(selected.symbol);
      }
    }

    function requestPreview(symbol) {
      previewFileName.textContent = symbol.relativePath + ':' + symbol.line;
      previewOpenBtn.style.display = 'block';
      vscode.postMessage({
        type: 'getPreview',
        filePath: symbol.filePath,
        line: symbol.line,
        column: symbol.column
      });
    }

    function openSelectedItem() {
      const selected = currentResults[selectedIndex];
      if (!selected) return;
      vscode.postMessage({
        type: 'openSymbol',
        symbol: selected.symbol,
        rawQuery: searchInput.value
      });
    }

    function triggerSearch() {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        const query = searchInput.value.trim();
        clearBtn.style.display = query ? 'block' : 'none';
        vscode.postMessage({
          type: 'search',
          query: query,
          filterMode: activeFilter
        });
      }, 50);
    }

    function escapeHtml(text) {
      if (!text) return '';
      return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
    }

    // Draggable Split Divider Logic
    let isDraggingDivider = false;
    let startY = 0;
    let startHeight = 0;

    resizerDivider.addEventListener('mousedown', (e) => {
      isDraggingDivider = true;
      startY = e.clientY;
      startHeight = resultsPane.offsetHeight;
      resizerDivider.classList.add('dragging');
      document.body.style.cursor = 'row-resize';
      e.preventDefault();
    });

    window.addEventListener('mousemove', (e) => {
      if (!isDraggingDivider) return;
      const delta = e.clientY - startY;
      const newHeight = Math.max(100, Math.min(startHeight + delta, window.innerHeight - 250));
      resultsPane.style.height = newHeight + 'px';
      e.preventDefault();
    });

    window.addEventListener('mouseup', () => {
      if (isDraggingDivider) {
        isDraggingDivider = false;
        resizerDivider.classList.remove('dragging');
        document.body.style.cursor = 'default';
      }
    });

    // Event listeners
    searchInput.addEventListener('input', () => {
      selectedIndex = 0;
      triggerSearch();
    });

    clearBtn.addEventListener('click', () => {
      searchInput.value = '';
      searchInput.focus();
      triggerSearch();
    });

    closeBtn.addEventListener('click', () => {
      vscode.postMessage({ type: 'close' });
    });

    previewOpenBtn.addEventListener('click', () => {
      openSelectedItem();
    });

    togglePreviewBtn.addEventListener('click', () => {
      isPreviewVisible = !isPreviewVisible;
      togglePreviewBtn.classList.toggle('active', isPreviewVisible);
      previewPane.classList.toggle('hidden', !isPreviewVisible);
      resizerDivider.style.display = isPreviewVisible ? 'flex' : 'none';
      if (isPreviewVisible) {
        resultsPane.style.height = '260px';
        if (currentResults[selectedIndex]) {
          requestPreview(currentResults[selectedIndex].symbol);
        }
      } else {
        resultsPane.style.height = '100%';
      }
    });

    filterPills.forEach(pill => {
      pill.addEventListener('click', () => {
        filterPills.forEach(p => p.classList.remove('active'));
        pill.classList.add('active');
        activeFilter = pill.dataset.filter;
        triggerSearch();
      });
    });

    // Close on click outside modal card
    document.body.addEventListener('click', (e) => {
      if (e.target === document.body) {
        vscode.postMessage({ type: 'close' });
      }
    });

    // Keyboard navigation
    window.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        selectItem(Math.min(currentResults.length - 1, selectedIndex + 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        selectItem(Math.max(0, selectedIndex - 1));
      } else if (e.key === 'PageDown') {
        e.preventDefault();
        selectItem(Math.min(currentResults.length - 1, selectedIndex + 8));
      } else if (e.key === 'PageUp') {
        e.preventDefault();
        selectItem(Math.max(0, selectedIndex - 8));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        openSelectedItem();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        vscode.postMessage({ type: 'close' });
      } else if (e.key === 'Tab') {
        e.preventDefault();
        const pills = Array.from(filterPills);
        const currentIdx = pills.findIndex(p => p.classList.contains('active'));
        const nextIdx = (currentIdx + (e.shiftKey ? -1 : 1) + pills.length) % pills.length;
        pills[nextIdx].click();
      } else if (e.ctrlKey && (e.key === 'p' || e.key === 'P')) {
        e.preventDefault();
        togglePreviewBtn.click();
      } else {
        if (document.activeElement !== searchInput && e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
          searchInput.focus();
        }
      }
    });

    // Handle messages from extension backend
    window.addEventListener('message', (event) => {
      const msg = event.data;
      if (msg.type === 'results') {
        renderResults(msg.results);
      } else if (msg.type === 'preview') {
        renderPreviewCode(msg.filePath, msg.targetLine, msg.startLine, msg.lines);
      }
    });

    function renderPreviewCode(filePath, targetLine, startLine, lines) {
      if (!lines || lines.length === 0) {
        previewCodeContainer.innerHTML = '<div style="padding: 20px; color: var(--text-muted); text-align: center;">Empty file</div>';
        return;
      }

      previewCodeContainer.innerHTML = '';
      let targetEl = null;

      lines.forEach((lineText, idx) => {
        const lineNum = startLine + idx;
        const isTarget = lineNum === targetLine;

        const row = document.createElement('div');
        row.className = 'code-line' + (isTarget ? ' target-line' : '');

        row.innerHTML = 
          '<div class="line-number">' + lineNum + '</div>' +
          '<div class="line-content">' + lineText + '</div>';

        if (isTarget) {
          targetEl = row;
        }

        previewCodeContainer.appendChild(row);
      });

      if (targetEl) {
        targetEl.scrollIntoView({ block: 'center' });
      }
    }

    // Initial query
    triggerSearch();
  </script>
</body>
</html>`;
}
