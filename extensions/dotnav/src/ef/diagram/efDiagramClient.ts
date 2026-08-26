export function getEfDiagramClientScript(): string {
  return `
(function() {
  const vscode = acquireVsCodeApi();
  
  // State
  let availableDbContexts = [];
  let activeDbContext = '';
  let entitiesByContext = {};
  let relationshipsByContext = {};

  let allEntities = [];
  let allRelationships = [];
  let activePositions = {};
  let notes = []; // Array of DiagramNote: { id, x, y, width, height, text, color }
  let minimizedCards = new Set();
  let hiddenColumnsByEntity = {}; // { [entityName]: Set<propName> }
  let colorByEntity = {}; // { [entityName]: hexColor }
  let activeSelectedRelId = null;

  // Multi-Selection State
  let selectedEntityNames = new Set();
  let isMarqueeSelecting = false;
  let marqueeStartX = 0;
  let marqueeStartY = 0;

  // Undo / Redo History State
  const undoStack = [];
  const redoStack = [];
  const MAX_HISTORY = 30;

  // Performance Caches (Eliminates Layout Thrashing / Reflow during Dragging)
  const cardSizeCache = {}; // { [name]: { width: number, height: number } }
  const cardRowOffsetCache = {}; // { [name]: { [propName]: number, pkDefault: number, fkDefault: number } }

  let currentDiagramName = 'Default';
  let activeFilterMode = 'all'; // 'all' | 'keys' | 'no-audit'

  let zoom = 1.0;
  let panX = 40;
  let panY = 40;
  let isPanning = false;
  let startPanX = 0;
  let startPanY = 0;

  let draggedCard = null;
  let dragOffsetX = 0;
  let dragOffsetY = 0;
  let batchDragInitialPositions = {};

  // Draggable Note State
  let draggedNote = null;
  let noteDragOffsetX = 0;
  let noteDragOffsetY = 0;

  // Draggable Inspector State
  let draggedInspector = null;
  let inspectorDragOffsetX = 0;
  let inspectorDragOffsetY = 0;

  let isResizingSidebar = false;
  let rafScheduled = false;

  // DOM Elements
  const sidebar = document.getElementById('sidebar');
  const sidebarResizer = document.getElementById('sidebarResizer');
  const viewport = document.getElementById('viewport');
  const canvasTransform = document.getElementById('canvasTransform');
  const linksSvg = document.getElementById('linksSvg');
  const cardsLayer = document.getElementById('cardsLayer');
  const notesLayer = document.getElementById('notesLayer');
  const entityListEl = document.getElementById('entityList');
  const searchBox = document.getElementById('searchBox');
  const dbContextSelect = document.getElementById('dbContextSelect');
  const diagramSelect = document.getElementById('diagramSelect');
  const sidebarContextTitle = document.getElementById('sidebarContextTitle');
  const btnAddAllToCanvas = document.getElementById('btnAddAllToCanvas');
  const emptyPrompt = document.getElementById('emptyPrompt');
  const zoomDisplay = document.getElementById('zoomDisplay');
  const marqueeBox = document.getElementById('marqueeBox');
  const canvasMinimap = document.getElementById('canvasMinimap');
  const minimapCanvas = document.getElementById('minimapCanvas');
  const minimapLens = document.getElementById('minimapLens');

  // Loading & Error Overlay Elements
  const loadingOverlay = document.getElementById('loadingOverlay');
  const loadingSpinner = document.getElementById('loadingSpinner');
  const loadingTitle = document.getElementById('loadingTitle');
  const loadingStatusText = document.getElementById('loadingStatusText');
  const btnRetryScan = document.getElementById('btnRetryScan');

  function showLoading(title, subtitle) {
    if (!loadingOverlay) return;
    loadingOverlay.classList.remove('hidden');
    if (loadingSpinner) loadingSpinner.style.display = 'block';
    if (loadingTitle) loadingTitle.textContent = title || 'Scanning EF Core Models...';
    if (loadingStatusText) loadingStatusText.textContent = subtitle || 'Discovering DbContexts, entities, and relationships in solution';
    if (btnRetryScan) btnRetryScan.style.display = 'none';
  }

  function hideLoading() {
    if (loadingOverlay) loadingOverlay.classList.add('hidden');
  }

  function showError(title, subtitle) {
    if (!loadingOverlay) return;
    loadingOverlay.classList.remove('hidden');
    if (loadingSpinner) loadingSpinner.style.display = 'none';
    if (loadingTitle) loadingTitle.textContent = title || 'Scanning Error';
    if (loadingStatusText) loadingStatusText.textContent = subtitle || 'An unexpected error occurred while scanning EF Core models.';
    if (btnRetryScan) btnRetryScan.style.display = 'inline-flex';
  }

  if (btnRetryScan) {
    btnRetryScan.addEventListener('click', () => {
      showLoading('Rescanning EF Core Models...', 'Reading C# entity models and migrations from disk');
      vscode.postMessage({ type: 'rescan' });
    });
  }

  // Toolbar Controls
  const btnUndo = document.getElementById('btnUndo');
  const btnRedo = document.getElementById('btnRedo');
  const btnAutoLayout = document.getElementById('btnAutoLayout');
  const layoutModeSelect = document.getElementById('layoutModeSelect');
  const btnAddNote = document.getElementById('btnAddNote');
  const exportSelect = document.getElementById('exportSelect');

  // Filter Chips
  const chipAll = document.getElementById('chipAll');
  const chipKeys = document.getElementById('chipKeys');
  const chipNoAudit = document.getElementById('chipNoAudit');

  const AUDIT_FIELD_NAMES = new Set([
    'createdby', 'createdon', 'createdat', 'createddate',
    'updatedby', 'updatedon', 'updatedat', 'updateddate', 'modifiedby', 'modifiedon',
    'deletedby', 'deletedon', 'deletedat', 'deleteddate', 'isdeleted', 'deleteruserid'
  ]);

  const COLOR_PALETTE = [
    { name: 'Default', hex: '' },
    { name: 'Blue', hex: '#2563eb' },
    { name: 'Purple', hex: '#7c3aed' },
    { name: 'Emerald', hex: '#059669' },
    { name: 'Amber', hex: '#d97706' },
    { name: 'Rose', hex: '#e11d48' },
    { name: 'Cyan', hex: '#0891b2' }
  ];

  function columnVisibilityIcon(visible) {
    return '<span class="column-toggle-icon"><svg aria-hidden="true" viewBox="0 0 16 16"><path d="M1.5 8s2.5-4 6.5-4 6.5 4 6.5 4-2.5 4-6.5 4S1.5 8 1.5 8Z"/><circle cx="8" cy="8" r="1.8"/>' + (visible ? '' : '<path d="M2 2l12 12"/>') + '</svg></span>';
  }

  // Snapshot State for Undo / Redo
  function captureStateSnapshot() {
    return {
      positions: JSON.parse(JSON.stringify(activePositions)),
      notes: JSON.parse(JSON.stringify(notes)),
      hiddenColumns: Object.fromEntries(Object.entries(hiddenColumnsByEntity).map(([k, v]) => [k, Array.from(v)])),
      colors: { ...colorByEntity },
      minimized: Array.from(minimizedCards)
    };
  }

  function pushHistory() {
    undoStack.push(captureStateSnapshot());
    if (undoStack.length > MAX_HISTORY) undoStack.shift();
    redoStack.length = 0;
    updateUndoRedoButtons();
  }

  function applyStateSnapshot(snap) {
    if (!snap) return;
    activePositions = JSON.parse(JSON.stringify(snap.positions || {}));
    notes = JSON.parse(JSON.stringify(snap.notes || []));
    hiddenColumnsByEntity = {};
    if (snap.hiddenColumns) {
      for (const [k, v] of Object.entries(snap.hiddenColumns)) {
        hiddenColumnsByEntity[k] = new Set(v);
      }
    }
    colorByEntity = { ...(snap.colors || {}) };
    minimizedCards = new Set(snap.minimized || []);
    selectedEntityNames.clear();

    renderEntityList(searchBox.value);
    renderCanvas();
    renderNotes();
    updateUndoRedoButtons();
  }

  function undo() {
    if (undoStack.length === 0) return;
    redoStack.push(captureStateSnapshot());
    const prev = undoStack.pop();
    applyStateSnapshot(prev);
  }

  function redo() {
    if (redoStack.length === 0) return;
    undoStack.push(captureStateSnapshot());
    const next = redoStack.pop();
    applyStateSnapshot(next);
  }

  function updateUndoRedoButtons() {
    if (btnUndo) btnUndo.disabled = undoStack.length === 0;
    if (btnRedo) btnRedo.disabled = redoStack.length === 0;
  }

  if (btnUndo) btnUndo.addEventListener('click', undo);
  if (btnRedo) btnRedo.addEventListener('click', redo);

  // Initialize from Extension Message
  window.addEventListener('message', event => {
    const msg = event.data;
    switch (msg.type) {
      case 'loading':
        showLoading('Scanning EF Core Models...', msg.message);
        break;

      case 'error':
        showError('Scanning Error', msg.message);
        break;

      case 'init':
        availableDbContexts = msg.availableDbContexts || [];
        entitiesByContext = msg.entitiesByContext || {};
        relationshipsByContext = msg.relationshipsByContext || {};
        activeDbContext = msg.activeDbContext || (availableDbContexts.length > 0 ? availableDbContexts[0] : 'Default');

        allEntities = entitiesByContext[activeDbContext] || msg.allEntities || [];
        allRelationships = relationshipsByContext[activeDbContext] || msg.relationships || [];
        activePositions = {};
        notes = msg.notes ? JSON.parse(JSON.stringify(msg.notes)) : [];
        hiddenColumnsByEntity = {};
        colorByEntity = {};
        minimizedCards.clear();
        selectedEntityNames.clear();
        activeSelectedRelId = null;

        restoreEntityStates(msg.activePositions || {});
        currentDiagramName = msg.activeDiagramName || 'Default';

        updateDbContextSelect();
        updateDiagramSelect(msg.savedDiagramNames || []);
        updateSidebarTitle();
        renderEntityList();
        renderCanvas();
        renderNotes();
        hideLoading();
        break;

      case 'diagramLoaded':
        activePositions = {};
        notes = msg.notes ? JSON.parse(JSON.stringify(msg.notes)) : [];
        hiddenColumnsByEntity = {};
        colorByEntity = {};
        minimizedCards.clear();
        selectedEntityNames.clear();
        activeSelectedRelId = null;

        restoreEntityStates(msg.activePositions || {});
        currentDiagramName = msg.diagramName || 'Default';
        renderEntityList();
        renderCanvas();
        renderNotes();
        hideLoading();
        break;

      case 'diagramListUpdated':
        updateDiagramSelect(msg.savedDiagramNames || []);
        break;
    }
  });

  function restoreEntityStates(rawPositions) {
    for (const [name, state] of Object.entries(rawPositions)) {
      if (state) {
        activePositions[name] = { x: state.x, y: state.y };
        if (state.hiddenColumns && Array.isArray(state.hiddenColumns)) {
          hiddenColumnsByEntity[name] = new Set(state.hiddenColumns);
        }
        if (state.color) {
          colorByEntity[name] = state.color;
        }
        if (state.isMinimized) {
          minimizedCards.add(name);
        }
      }
    }
  }

  function getSerializablePositions() {
    const out = {};
    for (const name of Object.keys(activePositions)) {
      const pos = activePositions[name];
      out[name] = {
        x: pos.x,
        y: pos.y,
        hiddenColumns: hiddenColumnsByEntity[name] ? Array.from(hiddenColumnsByEntity[name]) : [],
        color: colorByEntity[name] || '',
        isMinimized: minimizedCards.has(name)
      };
    }
    return out;
  }

  vscode.postMessage({ type: 'ready' });

  // Sidebar Resizing Logic
  if (sidebarResizer && sidebar) {
    sidebarResizer.addEventListener('pointerdown', e => {
      isResizingSidebar = true;
      sidebarResizer.classList.add('resizing');
      sidebarResizer.setPointerCapture(e.pointerId);
      document.body.style.cursor = 'col-resize';
      e.preventDefault();
    });

    window.addEventListener('pointermove', e => {
      if (isResizingSidebar) {
        const newWidth = Math.max(200, Math.min(650, e.clientX));
        sidebar.style.width = newWidth + 'px';
      }
    });

    window.addEventListener('pointerup', e => {
      if (isResizingSidebar) {
        isResizingSidebar = false;
        sidebarResizer.classList.remove('resizing');
        document.body.style.cursor = '';
      }
    });
  }

  // Column View Filter Chips
  function setFilterMode(mode) {
    pushHistory();
    activeFilterMode = mode;
    [chipAll, chipKeys, chipNoAudit].forEach(chip => {
      if (chip) {
        chip.classList.toggle('active', chip.dataset.mode === mode);
      }
    });
    renderCanvas();
  }

  if (chipAll) chipAll.addEventListener('click', () => setFilterMode('all'));
  if (chipKeys) chipKeys.addEventListener('click', () => setFilterMode('keys'));
  if (chipNoAudit) chipNoAudit.addEventListener('click', () => setFilterMode('no-audit'));

  // Update DbContext Dropdown
  function updateDbContextSelect() {
    if (!dbContextSelect) return;
    dbContextSelect.innerHTML = '';
    for (const ctx of availableDbContexts) {
      const count = (entitiesByContext[ctx] || []).length;
      const opt = document.createElement('option');
      opt.value = ctx;
      opt.textContent = \`\${ctx} (\${count} tables)\`;
      dbContextSelect.appendChild(opt);
    }
    dbContextSelect.value = activeDbContext;
  }

  if (dbContextSelect) {
    dbContextSelect.addEventListener('change', () => {
      pushHistory();
      activeDbContext = dbContextSelect.value;
      allEntities = entitiesByContext[activeDbContext] || [];
      allRelationships = relationshipsByContext[activeDbContext] || [];
      activePositions = {};
      notes = [];
      minimizedCards.clear();
      hiddenColumnsByEntity = {};
      colorByEntity = {};
      selectedEntityNames.clear();
      activeSelectedRelId = null;

      if (allEntities.length > 0) {
        allEntities.slice(0, 3).forEach((e, idx) => {
          activePositions[e.name] = { x: 60 + idx * 360, y: 60 };
        });
      }

      updateSidebarTitle();
      renderEntityList();
      renderCanvas();
      renderNotes();
    });
  }

  function updateSidebarTitle() {
    if (sidebarContextTitle) {
      sidebarContextTitle.textContent = 'Active DbContext';
    }
  }

  // Update Diagram Dropdown
  function updateDiagramSelect(savedNames) {
    diagramSelect.innerHTML = '';
    const defOpt = document.createElement('option');
    defOpt.value = 'Default';
    defOpt.textContent = 'Default Diagram';
    diagramSelect.appendChild(defOpt);

    for (const name of savedNames) {
      if (name !== 'Default') {
        const opt = document.createElement('option');
        opt.value = name;
        opt.textContent = name;
        diagramSelect.appendChild(opt);
      }
    }
    diagramSelect.value = currentDiagramName;
  }

  diagramSelect.addEventListener('change', () => {
    const val = diagramSelect.value;
    vscode.postMessage({ type: 'loadDiagram', name: val, dbContext: activeDbContext });
  });

  // Render Sidebar Entity List
  function renderEntityList(filter = '') {
    entityListEl.innerHTML = '';
    const q = filter.trim().toLowerCase();

    const filtered = allEntities.filter(e => {
      if (!q) return true;
      return e.name.toLowerCase().includes(q) || (e.tableName && e.tableName.toLowerCase().includes(q));
    });

    if (filtered.length === 0) {
      entityListEl.innerHTML = '<div style="padding: 14px; font-size: 11px; color: var(--text-muted); text-align: center;">No entities found in this DbContext.</div>';
      return;
    }

    for (const entity of filtered) {
      const isInDiagram = !!activePositions[entity.name];
      const item = document.createElement('div');
      item.className = 'entity-list-item' + (isInDiagram ? ' in-diagram' : '');
      item.draggable = !isInDiagram;
      item.dataset.entityName = entity.name;

      const tableLabel = entity.tableName ? (entity.schemaName ? entity.schemaName + '.' + entity.tableName : entity.tableName) : '';
      const actionBadge = isInDiagram 
        ? '<span class="entity-item-badge" style="background: rgba(59, 130, 246, 0.2); color: #60a5fa; font-weight: 500;">✓ In Diagram</span>'
        : \`<span class="entity-item-badge">\${entity.properties.length} cols</span>\`;

      const actionBtn = isInDiagram
        ? '<button class="entity-remove-btn" title="Remove from Diagram" style="background:none;border:none;cursor:pointer;color:var(--text-muted);font-size:11px;">✕</button>'
        : '<button class="entity-add-btn" title="Add to Diagram" style="background:none;border:none;cursor:pointer;color:var(--accent);font-size:12px;">➕</button>';

      item.innerHTML = \`
        <div class="entity-item-info">
          <svg class="icon-svg" style="color: var(--pk-color); flex-shrink: 0;" viewBox="0 0 16 16" fill="currentColor">
            <path d="M2 3.5a1.5 1.5 0 0 1 1.5-1.5h9A1.5 1.5 0 0 1 14 3.5v9a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 12.5v-9zm1.5-.5a.5.5 0 0 0-.5.5v1h10v-1a.5.5 0 0 0-.5-.5h-9z"/>
          </svg>
          <div style="display: flex; flex-direction: column; overflow: hidden;">
            <span class="entity-item-name">\${escapeHtml(entity.name)}</span>
            \${tableLabel ? \`<span style="font-size: 10px; color: var(--text-muted); font-family: monospace;">\${escapeHtml(tableLabel)}</span>\` : ''}
          </div>
        </div>
        <div style="display: flex; align-items: center; gap: 6px;">
          \${actionBadge}
          \${actionBtn}
        </div>
      \`;

      if (!isInDiagram) {
        item.addEventListener('dragstart', e => {
          e.dataTransfer.setData('text/plain', entity.name);
        });
      }

      const addBtn = item.querySelector('.entity-add-btn');
      if (addBtn) {
        addBtn.addEventListener('click', e => {
          e.stopPropagation();
          addEntityToCanvas(entity.name);
        });
      }

      const removeBtn = item.querySelector('.entity-remove-btn');
      if (removeBtn) {
        removeBtn.addEventListener('click', e => {
          e.stopPropagation();
          removeEntityFromCanvas(entity.name);
        });
      }

      item.addEventListener('click', () => {
        if (isInDiagram) {
          focusCard(entity.name);
        } else {
          addEntityToCanvas(entity.name);
        }
      });

      entityListEl.appendChild(item);
    }
  }

  function focusCard(entityName) {
    const card = document.getElementById('card-' + entityName);
    if (card) {
      card.classList.add('selected');
      card.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
      setTimeout(() => card.classList.remove('selected'), 1200);
    }
  }

  function findFreeCanvasSlot(preferredX, preferredY) {
    let targetX = preferredX;
    let targetY = preferredY;
    let attempts = 0;

    while (attempts < 25) {
      let collides = false;
      for (const name in activePositions) {
        const p = activePositions[name];
        if (Math.abs(p.x - targetX) < 320 && Math.abs(p.y - targetY) < 280) {
          collides = true;
          break;
        }
      }

      if (!collides) {
        return { x: targetX, y: targetY };
      }

      targetY += 360;
      if (targetY > 1400) {
        targetY = 60;
        targetX += 420;
      }
      attempts++;
    }

    return { x: targetX, y: targetY };
  }

  if (btnAddAllToCanvas) {
    btnAddAllToCanvas.addEventListener('click', () => {
      pushHistory();
      for (const e of allEntities) {
        if (!activePositions[e.name]) {
          activePositions[e.name] = { x: 0, y: 0 };
        }
      }
      autoLayoutEntities(allEntities, 'column');
      renderEntityList(searchBox.value);
      renderCanvas();
    });
  }

  searchBox.addEventListener('input', () => {
    renderEntityList(searchBox.value);
  });

  function addEntityToCanvas(entityName, worldX, worldY) {
    if (activePositions[entityName]) {
      focusCard(entityName);
      return;
    }

    pushHistory();
    let posX = worldX;
    let posY = worldY;

    if (posX === undefined || posY === undefined || isNaN(posX) || isNaN(posY)) {
      const slot = findFreeCanvasSlot(80, 80);
      posX = slot.x;
      posY = slot.y;
    }

    activePositions[entityName] = { x: Math.round(posX), y: Math.round(posY) };
    renderEntityList(searchBox.value);
    renderCanvas();
    focusCard(entityName);
  }

  function removeEntityFromCanvas(entityName) {
    pushHistory();
    delete activePositions[entityName];
    minimizedCards.delete(entityName);
    selectedEntityNames.delete(entityName);
    delete hiddenColumnsByEntity[entityName];
    delete colorByEntity[entityName];
    delete cardSizeCache[entityName];
    delete cardRowOffsetCache[entityName];
    closeAllPopovers();
    renderEntityList(searchBox.value);
    renderCanvas();
  }

  // Pre-calculate and cache card dimensions and row pin offsets for 60FPS Dragging
  function cacheCardLayout(entityName) {
    const card = document.getElementById('card-' + entityName);
    if (!card) return;

    const isMinimized = card.classList.contains('minimized');
    const width = card.offsetWidth || 310;
    const height = card.offsetHeight || (isMinimized ? 40 : 200);
    cardSizeCache[entityName] = { width, height };

    const offsets = {};
    if (!isMinimized) {
      let firstPkOffset = 42;
      let firstFkOffset = 42;

      card.querySelectorAll('.prop-row:not(.hidden-prop)').forEach(row => {
        const propName = row.dataset.propName;
        const midY = row.offsetTop + row.offsetHeight / 2;
        offsets[propName] = midY;

        if (row.classList.contains('pk') && firstPkOffset === 42) firstPkOffset = midY;
        if (row.classList.contains('fk') && firstFkOffset === 42) firstFkOffset = midY;
      });

      offsets['__pkDefault'] = firstPkOffset;
      offsets['__fkDefault'] = firstFkOffset;
    } else {
      offsets['__pkDefault'] = 18;
      offsets['__fkDefault'] = 18;
    }

    cardRowOffsetCache[entityName] = offsets;
  }

  // Render Canvas
  function renderCanvas() {
    cardsLayer.innerHTML = '';
    closeAllPopovers();
    const activeNames = Object.keys(activePositions);

    if (activeNames.length === 0 && notes.length === 0) {
      emptyPrompt.style.display = 'flex';
      linksSvg.innerHTML = '';
      updateMinimap();
      return;
    }

    emptyPrompt.style.display = 'none';

    for (const name of activeNames) {
      const entity = allEntities.find(e => e.name === name);
      if (!entity) continue;

      const pos = activePositions[name];
      const isMinimized = minimizedCards.has(entity.name);
      const isMultiSelected = selectedEntityNames.has(entity.name);
      const customColor = colorByEntity[entity.name];
      const hiddenSet = hiddenColumnsByEntity[entity.name] || new Set();

      const card = document.createElement('div');
      card.className = 'table-card' + (isMinimized ? ' minimized' : '') + (isMultiSelected ? ' multi-selected' : '');
      card.id = 'card-' + entity.name;
      card.style.left = pos.x + 'px';
      card.style.top = pos.y + 'px';

      if (customColor) {
        card.style.borderTop = \`3px solid \${customColor}\`;
      }

      const tableDisplay = entity.tableName ? (entity.schemaName ? entity.schemaName + '.' + entity.tableName : entity.tableName) : entity.name;

      const totalProps = entity.properties.length;
      let visibleCount = 0;
      const propRowsHtml = entity.properties.map(p => {
        const isHidden = isPropertyHidden(entity, p, hiddenSet);
        if (!isHidden) visibleCount++;
        return renderPropertyRow(entity, p, isHidden);
      }).join('');

      const hiddenCount = totalProps - visibleCount;
      const visibilityBadge = hiddenCount > 0 ? \`<span class="card-visibility-badge" title="\${hiddenCount} columns hidden">(\${visibleCount}/\${totalProps})</span>\` : '';

      card.innerHTML = \`
        <div class="card-header" data-entity-name="\${escapeHtml(entity.name)}">
          <div class="card-title-group">
            <span class="card-title">
              <svg class="icon-svg" style="color: \${customColor || 'var(--pk-color)'}; flex-shrink: 0;" viewBox="0 0 16 16" fill="currentColor">
                <path d="M2 3.5a1.5 1.5 0 0 1 1.5-1.5h9A1.5 1.5 0 0 1 14 3.5v9a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 12.5v-9zm1.5-.5a.5.5 0 0 0-.5.5v1h10v-1a.5.5 0 0 0-.5-.5h-9z"/>
              </svg>
              \${escapeHtml(entity.name)} \${visibilityBadge}
            </span>
            <span class="card-subtitle">\${escapeHtml(tableDisplay)}</span>
          </div>
          <div class="card-actions">
            <button class="card-action-btn card-columns-btn" title="Manage Columns (Show/Hide)">
              \${columnVisibilityIcon(true)}
            </button>
            <button class="card-action-btn card-minimize-btn" title="\${isMinimized ? 'Expand' : 'Minimize'}">\${isMinimized ? '▢' : '—'}</button>
            <button class="card-action-btn card-close-btn" title="Remove from Diagram">✕</button>
          </div>
        </div>
        <div class="card-body">
          \${propRowsHtml}
        </div>
        \${hiddenCount > 0 ? \`<div class="card-hidden-footer" title="Click to manage hidden columns"><span>\${columnVisibilityIcon(false)} + \${hiddenCount} hidden columns</span><span style="opacity:0.7;">manage ▸</span></div>\` : ''}
      \`;

      // Header double-click to toggle minimize
      const header = card.querySelector('.card-header');
      header.addEventListener('dblclick', e => {
        e.stopPropagation();
        toggleCardMinimize(entity.name);
      });

      // Header columns button
      const colsBtn = card.querySelector('.card-columns-btn');
      colsBtn.addEventListener('click', e => {
        e.stopPropagation();
        openColumnManagerPopover(entity, card, colsBtn);
      });

      // Footer hidden notice click
      const footer = card.querySelector('.card-hidden-footer');
      if (footer) {
        footer.addEventListener('click', e => {
          e.stopPropagation();
          openColumnManagerPopover(entity, card, colsBtn);
        });
      }

      // Minimize button
      const minBtn = card.querySelector('.card-minimize-btn');
      minBtn.addEventListener('click', e => {
        e.stopPropagation();
        toggleCardMinimize(entity.name);
      });

      // Close button
      const closeBtn = card.querySelector('.card-close-btn');
      closeBtn.addEventListener('click', e => {
        e.stopPropagation();
        removeEntityFromCanvas(entity.name);
      });

      // Right-Click Context Menu on Card
      card.addEventListener('contextmenu', e => {
        e.preventDefault();
        e.stopPropagation();
        openCardContextMenu(entity, card, e.clientX, e.clientY);
      });

      // Pointer-based High Performance Dragging with Multi-Select Batch Move Support
      header.addEventListener('pointerdown', e => {
        if (e.button !== 0 || e.target.closest('.card-actions')) return;
        draggedCard = card;
        header.setPointerCapture(e.pointerId);
        card.classList.add('dragging');
        card.style.zIndex = '100';

        if (!e.shiftKey && !selectedEntityNames.has(entity.name)) {
          selectedEntityNames.clear();
          cardsLayer.querySelectorAll('.table-card').forEach(c => c.classList.remove('multi-selected'));
        }
        selectedEntityNames.add(entity.name);
        card.classList.add('multi-selected');

        batchDragInitialPositions = {};
        selectedEntityNames.forEach(selName => {
          if (activePositions[selName]) {
            batchDragInitialPositions[selName] = { ...activePositions[selName] };
          }
        });

        const rect = card.getBoundingClientRect();
        dragOffsetX = (e.clientX - rect.left) / zoom;
        dragOffsetY = (e.clientY - rect.top) / zoom;
        closeAllPopovers();
        e.stopPropagation();
      });

      cardsLayer.appendChild(card);
    }

    // Attach row eye button & expand [+] buttons
    cardsLayer.querySelectorAll('.prop-eye-btn').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const card = btn.closest('.table-card');
        const entityName = card.querySelector('.card-header').dataset.entityName;
        const propName = btn.dataset.propName;
        togglePropertyVisibility(entityName, propName);
      });
    });

    cardsLayer.querySelectorAll('.prop-expand-btn').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const targetEntity = btn.dataset.targetEntity;
        if (targetEntity) {
          if (activePositions[targetEntity]) {
            focusCard(targetEntity);
            return;
          }
          const currentCard = btn.closest('.table-card');
          const currentLeft = parseInt(currentCard.style.left, 10) || 100;
          const currentTop = parseInt(currentCard.style.top, 10) || 100;
          const slot = findFreeCanvasSlot(currentLeft + 360, currentTop);
          addEntityToCanvas(targetEntity, slot.x, slot.y);
        }
      });
    });

    requestAnimationFrame(() => {
      activeNames.forEach(cacheCardLayout);
      buildAllSvgElements();
      updateMinimap();
    });
  }

  // Sticky Notes Lifecycle & Rendering
  function renderNotes() {
    notesLayer.innerHTML = '';
    for (const note of notes) {
      const noteEl = document.createElement('div');
      noteEl.className = 'sticky-note note-' + (note.color || 'yellow');
      noteEl.id = 'note-' + note.id;
      noteEl.style.left = note.x + 'px';
      noteEl.style.top = note.y + 'px';
      if (note.width) noteEl.style.width = note.width + 'px';

      noteEl.innerHTML = \`
        <div class="note-header" data-note-id="\${note.id}">
          <div class="note-color-dots">
            <div class="note-dot" data-color="yellow" style="background:#fef08a;" title="Yellow"></div>
            <div class="note-dot" data-color="emerald" style="background:#a7f3d0;" title="Emerald"></div>
            <div class="note-dot" data-color="blue" style="background:#bfdbfe;" title="Blue"></div>
            <div class="note-dot" data-color="rose" style="background:#fecdd3;" title="Rose"></div>
            <div class="note-dot" data-color="purple" style="background:#e9d5ff;" title="Purple"></div>
            <div class="note-dot" data-color="dark" style="background:#2d3748;" title="Dark"></div>
          </div>
          <button class="note-close-btn" title="Delete Note">✕</button>
        </div>
        <div class="note-body">
          <textarea class="note-textarea" placeholder="Add business logic note...">\${escapeHtml(note.text || '')}</textarea>
        </div>
      \`;

      const header = noteEl.querySelector('.note-header');
      header.addEventListener('pointerdown', e => {
        if (e.target.closest('.note-dot') || e.target.closest('.note-close-btn')) return;
        draggedNote = noteEl;
        header.setPointerCapture(e.pointerId);
        noteEl.classList.add('dragging');
        const rect = noteEl.getBoundingClientRect();
        noteDragOffsetX = (e.clientX - rect.left) / zoom;
        noteDragOffsetY = (e.clientY - rect.top) / zoom;
        e.stopPropagation();
      });

      noteEl.querySelectorAll('.note-dot').forEach(dot => {
        dot.addEventListener('click', e => {
          e.stopPropagation();
          note.color = dot.dataset.color;
          noteEl.className = 'sticky-note note-' + note.color;
        });
      });

      noteEl.querySelector('.note-close-btn').addEventListener('click', e => {
        e.stopPropagation();
        pushHistory();
        notes = notes.filter(n => n.id !== note.id);
        renderNotes();
      });

      const textarea = noteEl.querySelector('.note-textarea');
      textarea.addEventListener('input', () => {
        note.text = textarea.value;
      });

      notesLayer.appendChild(noteEl);
    }
  }

  function addStickyNote(clientX, clientY) {
    pushHistory();
    const vpRect = viewport.getBoundingClientRect();
    let posX = (clientX !== undefined ? clientX - vpRect.left - panX : 120 - panX) / zoom;
    let posY = (clientY !== undefined ? clientY - vpRect.top - panY : 120 - panY) / zoom;

    const newNote = {
      id: 'note_' + Date.now(),
      x: Math.round(posX),
      y: Math.round(posY),
      width: 220,
      height: 120,
      text: '',
      color: 'yellow'
    };

    notes.push(newNote);
    renderNotes();
    const noteEl = document.getElementById('note-' + newNote.id);
    if (noteEl) {
      const ta = noteEl.querySelector('.note-textarea');
      if (ta) ta.focus();
    }
  }

  if (btnAddNote) {
    btnAddNote.addEventListener('click', () => {
      addStickyNote();
    });
  }

  function isPropertyHidden(entity, prop, customHiddenSet) {
    if (customHiddenSet.has(prop.name)) {
      return true;
    }
    if (activeFilterMode === 'keys') {
      if (!prop.isPrimaryKey && !prop.isForeignKey) {
        return true;
      }
    } else if (activeFilterMode === 'no-audit') {
      if (!prop.isPrimaryKey && !prop.isForeignKey && AUDIT_FIELD_NAMES.has(prop.name.toLowerCase())) {
        return true;
      }
    }
    return false;
  }

  function togglePropertyVisibility(entityName, propName) {
    pushHistory();
    if (!hiddenColumnsByEntity[entityName]) {
      hiddenColumnsByEntity[entityName] = new Set();
    }
    const set = hiddenColumnsByEntity[entityName];
    if (set.has(propName)) {
      set.delete(propName);
    } else {
      set.add(propName);
    }
    renderCanvas();
  }

  function toggleCardMinimize(entityName) {
    pushHistory();
    if (minimizedCards.has(entityName)) {
      minimizedCards.delete(entityName);
    } else {
      minimizedCards.add(entityName);
    }
    renderCanvas();
  }

  function renderPropertyRow(entity, prop, isHidden) {
    let badge = '';
    let rowClass = 'prop-row' + (isHidden ? ' hidden-prop' : '');
    let expandBtn = '';

    if (prop.isPrimaryKey) {
      rowClass += ' pk';
      badge = '<span class="prop-badge pk">PK</span>';
    } else if (prop.isForeignKey) {
      rowClass += ' fk';
      badge = '<span class="prop-badge fk">FK</span>';
      if (prop.foreignKeyTargetEntity && allEntities.some(e => e.name === prop.foreignKeyTargetEntity)) {
        expandBtn = \`<button class="prop-expand-btn" data-target-entity="\${escapeHtml(prop.foreignKeyTargetEntity)}" title="Add \${escapeHtml(prop.foreignKeyTargetEntity)} to canvas">+</button>\`;
      }
    } else if (prop.isNavigation) {
      badge = '<span class="prop-badge nav">NAV</span>';
      if (prop.navigationTargetEntity && allEntities.some(e => e.name === prop.navigationTargetEntity)) {
        expandBtn = \`<button class="prop-expand-btn" data-target-entity="\${escapeHtml(prop.navigationTargetEntity)}" title="Add \${escapeHtml(prop.navigationTargetEntity)} to canvas">+</button>\`;
      }
    }

    return \`
      <div class="\${rowClass}" data-prop-name="\${escapeHtml(prop.name)}">
        <div class="prop-name">
          \${badge}
          <span>\${escapeHtml(prop.name)}</span>
        </div>
        <div class="prop-actions">
          <span class="prop-type">\${escapeHtml(prop.type)}</span>
          <button class="prop-eye-btn" data-prop-name="\${escapeHtml(prop.name)}" title="Hide column">
            \${columnVisibilityIcon(true)}
          </button>
          \${expandBtn}
        </div>
      </div>
    \`;
  }

  // GitNav-Style Floating Column Manager Popover (In-place multi-select)
  function openColumnManagerPopover(entity, card, triggerBtn) {
    const existing = document.getElementById('activePopover');
    if (existing && existing.dataset.entityName === entity.name) {
      existing.remove();
      return;
    }
    closeAllPopovers();

    const popover = document.createElement('div');
    popover.className = 'columns-popover';
    popover.id = 'activePopover';
    popover.dataset.entityName = entity.name;

    if (!hiddenColumnsByEntity[entity.name]) {
      hiddenColumnsByEntity[entity.name] = new Set();
    }
    const hiddenSet = hiddenColumnsByEntity[entity.name];

    popover.innerHTML = \`
      <div class="popover-header">
        <div style="display:flex; align-items:center; gap:6px;">
          \${columnVisibilityIcon(true)}
          <span>Manage Columns</span>
        </div>
        <div style="display:flex; align-items:center; gap:8px;">
          <span style="font-size: 10px; color: var(--text-muted);">\${entity.properties.length} total</span>
          <button class="popover-close-btn" title="Close">✕</button>
        </div>
      </div>
      <div class="popover-search">
        <input type="text" placeholder="Filter column name..." />
      </div>
      <div class="popover-list">
        \${entity.properties.map(p => {
          const isVisible = !hiddenSet.has(p.name);
          const keyLabel = p.isPrimaryKey ? ' (PK)' : (p.isForeignKey ? ' (FK)' : '');
          return \`
            <div class="column-toggle-row" role="menuitemcheckbox" aria-checked="\${isVisible}" data-prop-name="\${escapeHtml(p.name)}" title="Toggle \${escapeHtml(p.name)}">
              <div style="display:flex; align-items:center; gap:8px; overflow:hidden;">
                \${columnVisibilityIcon(isVisible)}
                <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap; \${p.isPrimaryKey ? 'color:var(--pk-color);font-weight:600;' : ''}">
                  \${escapeHtml(p.name)}\${keyLabel}
                </span>
              </div>
              <span style="font-size:10px; color:var(--type-color); font-family:monospace;">\${escapeHtml(p.type)}</span>
            </div>
          \`;
        }).join('')}
      </div>
      <div class="popover-actions">
        <button class="popover-btn" id="popShowAll">Show All</button>
        <button class="popover-btn" id="popKeysOnly">Keys Only</button>
        <button class="popover-btn" id="popHideAudit">Hide Audit</button>
      </div>
    \`;

    popover.querySelector('.popover-close-btn').addEventListener('click', () => {
      closeAllPopovers();
    });

    const searchInput = popover.querySelector('.popover-search input');
    searchInput.addEventListener('input', () => {
      const q = searchInput.value.trim().toLowerCase();
      popover.querySelectorAll('.column-toggle-row').forEach(item => {
        const name = item.dataset.propName.toLowerCase();
        item.style.display = name.includes(q) ? 'flex' : 'none';
      });
    });

    function syncCardVisibilityInPlace() {
      let visibleCount = 0;
      entity.properties.forEach(p => {
        const isHidden = isPropertyHidden(entity, p, hiddenSet);
        if (!isHidden) visibleCount++;
        const rowEl = card.querySelector(\`.prop-row[data-prop-name="\${p.name}"]\`);
        if (rowEl) {
          rowEl.classList.toggle('hidden-prop', isHidden);
        }
      });

      const totalProps = entity.properties.length;
      const hiddenCount = totalProps - visibleCount;

      let badgeEl = card.querySelector('.card-visibility-badge');
      if (hiddenCount > 0) {
        if (!badgeEl) {
          badgeEl = document.createElement('span');
          badgeEl.className = 'card-visibility-badge';
          card.querySelector('.card-title').appendChild(badgeEl);
        }
        badgeEl.textContent = \`(\${visibleCount}/\${totalProps})\`;
        badgeEl.title = \`\${hiddenCount} columns hidden\`;
      } else if (badgeEl) {
        badgeEl.remove();
      }

      let footer = card.querySelector('.card-hidden-footer');
      if (hiddenCount > 0) {
        if (!footer) {
          footer = document.createElement('div');
          footer.className = 'card-hidden-footer';
          footer.title = 'Click to manage hidden columns';
          footer.addEventListener('click', e => {
            e.stopPropagation();
            openColumnManagerPopover(entity, card, triggerBtn);
          });
          card.appendChild(footer);
        }
        footer.innerHTML = \`<span>\${columnVisibilityIcon(false)} + \${hiddenCount} hidden columns</span><span style="opacity:0.7;">manage ▸</span>\`;
      } else if (footer) {
        footer.remove();
      }

      cacheCardLayout(entity.name);
      buildAllSvgElements();
    }

    popover.querySelectorAll('.column-toggle-row').forEach(row => {
      row.addEventListener('click', e => {
        e.stopPropagation();
        const propName = row.dataset.propName;
        const currentlyVisible = !hiddenSet.has(propName);
        const nextVisible = !currentlyVisible;

        if (nextVisible) {
          hiddenSet.delete(propName);
        } else {
          hiddenSet.add(propName);
        }

        row.setAttribute('aria-checked', String(nextVisible));
        const iconSpan = row.querySelector('.column-toggle-icon');
        if (iconSpan) {
          iconSpan.outerHTML = columnVisibilityIcon(nextVisible);
        }

        syncCardVisibilityInPlace();
      });
    });

    popover.querySelector('#popShowAll').addEventListener('click', e => {
      e.stopPropagation();
      hiddenSet.clear();
      popover.querySelectorAll('.column-toggle-row').forEach(row => {
        row.setAttribute('aria-checked', 'true');
        const iconSpan = row.querySelector('.column-toggle-icon');
        if (iconSpan) iconSpan.outerHTML = columnVisibilityIcon(true);
      });
      syncCardVisibilityInPlace();
    });

    popover.querySelector('#popKeysOnly').addEventListener('click', e => {
      e.stopPropagation();
      hiddenSet.clear();
      entity.properties.forEach(p => {
        if (!p.isPrimaryKey && !p.isForeignKey) {
          hiddenSet.add(p.name);
        }
      });
      popover.querySelectorAll('.column-toggle-row').forEach(row => {
        const propName = row.dataset.propName;
        const visible = !hiddenSet.has(propName);
        row.setAttribute('aria-checked', String(visible));
        const iconSpan = row.querySelector('.column-toggle-icon');
        if (iconSpan) iconSpan.outerHTML = columnVisibilityIcon(visible);
      });
      syncCardVisibilityInPlace();
    });

    popover.querySelector('#popHideAudit').addEventListener('click', e => {
      e.stopPropagation();
      entity.properties.forEach(p => {
        if (!p.isPrimaryKey && !p.isForeignKey && AUDIT_FIELD_NAMES.has(p.name.toLowerCase())) {
          hiddenSet.add(p.name);
        }
      });
      popover.querySelectorAll('.column-toggle-row').forEach(row => {
        const propName = row.dataset.propName;
        const visible = !hiddenSet.has(propName);
        row.setAttribute('aria-checked', String(visible));
        const iconSpan = row.querySelector('.column-toggle-icon');
        if (iconSpan) iconSpan.outerHTML = columnVisibilityIcon(visible);
      });
      syncCardVisibilityInPlace();
    });

    card.appendChild(popover);
  }

  // Draggable Relationship Details Inspector Popover
  function openRelationshipInspector(rel, clientX, clientY) {
    closeAllPopovers();
    activeSelectedRelId = rel.id;

    linksSvg.querySelectorAll('.link-path').forEach(p => {
      p.classList.toggle('selected', p.dataset.relId === rel.id);
    });

    cardsLayer.querySelectorAll('.table-card').forEach(c => {
      c.classList.remove('rel-source', 'rel-target');
      if (c.id === 'card-' + rel.fromEntity) c.classList.add('rel-source');
      if (c.id === 'card-' + rel.toEntity) c.classList.add('rel-target');
    });

    const popover = document.createElement('div');
    popover.className = 'rel-inspector-popover';
    popover.id = 'activeRelInspector';

    const vpRect = viewport.getBoundingClientRect();
    let posX = clientX - vpRect.left + 15;
    let posY = clientY - vpRect.top - 20;

    if (posX + 350 > vpRect.width) posX = clientX - vpRect.left - 355;
    if (posY + 320 > vpRect.height) posY = vpRect.height - 330;
    if (posY < 10) posY = 10;

    popover.style.left = Math.max(10, posX) + 'px';
    popover.style.top = Math.max(10, posY) + 'px';

    const cardinalityLabel = rel.cardinality === 'one-to-one' ? '1 : 1 (One-to-One)' : '1 : N (One-to-Many)';
    const deleteRule = rel.deleteBehavior ? \`DeleteBehavior.\${rel.deleteBehavior}\` : 'ClientSetNull / Restrict';
    const isRequiredLabel = rel.isRequired === false ? 'Optional (Nullable FK)' : 'Required (NOT NULL)';
    const navText = (rel.fromEntity + '.' + (rel.inverseNavigationName || '...')) + ' ⟷ ' + (rel.toEntity + '.' + (rel.navigationName || '...'));

    popover.innerHTML = \`
      <div class="rel-inspector-header">
        <div style="display:flex; align-items:center; gap:6px;">
          <span style="color:#60a5fa;">🔗</span>
          <span>Relationship Details</span>
        </div>
        <button class="popover-close-btn" title="Close">✕</button>
      </div>
      <div class="rel-inspector-body">
        <div class="rel-inspector-entity-box">
          <div style="font-size:10px; color:#10b981; font-weight:600;">🟢 PRINCIPAL TABLE (Parent 1)</div>
          <div style="font-size:12px; font-weight:600; color:#ffffff;">\${escapeHtml(rel.fromEntity)} <span style="font-size:10px; color:var(--pk-color); font-family:monospace;">(PK \${escapeHtml(rel.fromProperty || 'Id')})</span></div>
        </div>

        <div class="rel-inspector-entity-box">
          <div style="font-size:10px; color:#3b82f6; font-weight:600;">🔵 DEPENDENT TABLE (Child ∞)</div>
          <div style="font-size:12px; font-weight:600; color:#ffffff;">\${escapeHtml(rel.toEntity)} <span style="font-size:10px; color:#60a5fa; font-family:monospace;">(FK \${escapeHtml(rel.toProperty || '')})</span></div>
        </div>

        <div class="rel-inspector-row">
          <span class="rel-inspector-label">Cardinality:</span>
          <span class="rel-inspector-value" style="color:#60a5fa;">\${escapeHtml(cardinalityLabel)}</span>
        </div>

        <div class="rel-inspector-row">
          <span class="rel-inspector-label">Delete Behavior:</span>
          <span class="rel-inspector-value" style="\${rel.deleteBehavior === 'Cascade' ? 'color:#ef4444;font-weight:700;' : ''}">\${escapeHtml(deleteRule)}</span>
        </div>

        <div class="rel-inspector-row">
          <span class="rel-inspector-label">FK Nullability:</span>
          <span class="rel-inspector-value">\${escapeHtml(isRequiredLabel)}</span>
        </div>

        <div class="rel-inspector-row">
          <span class="rel-inspector-label">Navigations:</span>
          <span class="rel-inspector-value" style="font-size:10px;">\${escapeHtml(navText)}</span>
        </div>

        \${rel.foreignKeyName ? \`
        <div class="rel-inspector-row">
          <span class="rel-inspector-label">FK Constraint:</span>
          <span class="rel-inspector-value" style="font-size:10px;">\${escapeHtml(rel.foreignKeyName)}</span>
        </div>
        \` : ''}
      </div>
      <div class="rel-inspector-footer">
        <button class="popover-btn" id="btnJumpPrincipal">📖 Jump Principal</button>
        <button class="popover-btn" id="btnJumpDependent">📖 Jump Dependent</button>
      </div>
    \`;

    popover.querySelector('.popover-close-btn').addEventListener('click', () => {
      closeAllPopovers();
    });

    popover.querySelector('#btnJumpPrincipal').addEventListener('click', () => {
      focusCard(rel.fromEntity);
    });

    popover.querySelector('#btnJumpDependent').addEventListener('click', () => {
      focusCard(rel.toEntity);
    });

    const inspHeader = popover.querySelector('.rel-inspector-header');
    inspHeader.addEventListener('pointerdown', e => {
      if (e.target.closest('.popover-close-btn')) return;
      draggedInspector = popover;
      inspHeader.setPointerCapture(e.pointerId);
      const rect = popover.getBoundingClientRect();
      inspectorDragOffsetX = e.clientX - rect.left;
      inspectorDragOffsetY = e.clientY - rect.top;
      e.stopPropagation();
    });

    viewport.appendChild(popover);
  }

  // Right-Click Context Menu
  function openCardContextMenu(entity, card, clientX, clientY) {
    closeAllPopovers();

    const menu = document.createElement('div');
    menu.className = 'card-context-menu';
    menu.id = 'activeContextMenu';
    menu.style.left = clientX + 'px';
    menu.style.top = clientY + 'px';

    menu.innerHTML = \`
      <div class="context-menu-item" id="ctxManageCols">
        \${columnVisibilityIcon(true)} Manage Columns...
      </div>
      <div class="context-menu-item" id="ctxKeysOnly">
        <span>🔑</span> Show Keys Only
      </div>
      <div class="context-menu-item" id="ctxHideAudit">
        <span>🛡️</span> Hide Audit Fields
      </div>
      <div class="context-menu-item" id="ctxAddConnected">
        <span>➕</span> Add All Connected Tables
      </div>
      <div class="context-menu-divider"></div>
      <div style="padding: 4px 12px; font-size: 10px; color: var(--text-muted); font-weight: 600;">SET DOMAIN COLOR:</div>
      <div class="color-palette-row">
        \${COLOR_PALETTE.map(c => \`
          <div class="color-dot" data-hex="\${c.hex}" title="\${c.name}" style="background:\${c.hex || '#3c4048'};"></div>
        \`).join('')}
      </div>
      <div class="context-menu-divider"></div>
      <div class="context-menu-item" id="ctxOpenCode">
        <span>📖</span> Open C# Code
      </div>
      <div class="context-menu-item" id="ctxRemove" style="color: #ef4444;">
        <span>✕</span> Remove from Diagram
      </div>
    \`;

    menu.querySelector('#ctxManageCols').addEventListener('click', () => {
      closeAllPopovers();
      const colsBtn = card.querySelector('.card-columns-btn');
      openColumnManagerPopover(entity, card, colsBtn);
    });

    menu.querySelector('#ctxKeysOnly').addEventListener('click', () => {
      pushHistory();
      if (!hiddenColumnsByEntity[entity.name]) hiddenColumnsByEntity[entity.name] = new Set();
      const set = hiddenColumnsByEntity[entity.name];
      set.clear();
      entity.properties.forEach(p => {
        if (!p.isPrimaryKey && !p.isForeignKey) set.add(p.name);
      });
      closeAllPopovers();
      renderCanvas();
    });

    menu.querySelector('#ctxHideAudit').addEventListener('click', () => {
      pushHistory();
      if (!hiddenColumnsByEntity[entity.name]) hiddenColumnsByEntity[entity.name] = new Set();
      const set = hiddenColumnsByEntity[entity.name];
      entity.properties.forEach(p => {
        if (!p.isPrimaryKey && !p.isForeignKey && AUDIT_FIELD_NAMES.has(p.name.toLowerCase())) {
          set.add(p.name);
        }
      });
      closeAllPopovers();
      renderCanvas();
    });

    menu.querySelector('#ctxAddConnected').addEventListener('click', () => {
      closeAllPopovers();
      pushHistory();
      const curPos = activePositions[entity.name] || { x: 100, y: 100 };
      let added = 0;
      allRelationships.forEach(rel => {
        let neighbor = null;
        if (rel.fromEntity === entity.name) neighbor = rel.toEntity;
        else if (rel.toEntity === entity.name) neighbor = rel.fromEntity;

        if (neighbor && !activePositions[neighbor]) {
          const slot = findFreeCanvasSlot(curPos.x + 360, curPos.y + added * 220);
          activePositions[neighbor] = { x: slot.x, y: slot.y };
          added++;
        }
      });
      renderEntityList(searchBox.value);
      renderCanvas();
    });

    menu.querySelectorAll('.color-dot').forEach(dot => {
      dot.addEventListener('click', () => {
        pushHistory();
        const hex = dot.dataset.hex;
        if (selectedEntityNames.has(entity.name)) {
          selectedEntityNames.forEach(selName => {
            colorByEntity[selName] = hex;
          });
        } else {
          colorByEntity[entity.name] = hex;
        }
        closeAllPopovers();
        renderCanvas();
      });
    });

    menu.querySelector('#ctxOpenCode').addEventListener('click', () => {
      vscode.postMessage({
        type: 'openFile',
        filePath: entity.filePath,
        line: entity.line
      });
      closeAllPopovers();
    });

    menu.querySelector('#ctxRemove').addEventListener('click', () => {
      removeEntityFromCanvas(entity.name);
      closeAllPopovers();
    });

    document.body.appendChild(menu);
  }

  function closeAllPopovers() {
    const p = document.getElementById('activePopover');
    if (p) p.remove();
    const m = document.getElementById('activeContextMenu');
    if (m) m.remove();
    const r = document.getElementById('activeRelInspector');
    if (r) r.remove();

    cardsLayer.querySelectorAll('.table-card').forEach(c => {
      c.classList.remove('rel-source', 'rel-target');
    });
    linksSvg.querySelectorAll('.link-path').forEach(p => {
      p.classList.remove('selected');
    });
    activeSelectedRelId = null;
  }

  window.addEventListener('pointerdown', e => {
    if (!e.target.closest('.columns-popover') && !e.target.closest('.card-columns-btn') && !e.target.closest('.card-hidden-footer')) {
      const p = document.getElementById('activePopover');
      if (p) p.remove();
    }
    if (!e.target.closest('.card-context-menu')) {
      const m = document.getElementById('activeContextMenu');
      if (m) m.remove();
    }
    if (!e.target.closest('.rel-inspector-popover') && !e.target.closest('.rel-hitbox') && !e.target.closest('.link-path')) {
      const r = document.getElementById('activeRelInspector');
      if (r) closeAllPopovers();
    }
  });

  // Calculate Geometry for a single relationship from pure cached offsets (Zero Layout Thrashing)
  function computeRelGeometry(rel) {
    const fromPos = activePositions[rel.fromEntity];
    const toPos = activePositions[rel.toEntity];
    if (!fromPos || !toPos) return null;

    const fromSize = cardSizeCache[rel.fromEntity] || { width: 310, height: 200 };
    const toSize = cardSizeCache[rel.toEntity] || { width: 310, height: 200 };

    const fromOffsets = cardRowOffsetCache[rel.fromEntity] || {};
    const toOffsets = cardRowOffsetCache[rel.toEntity] || {};

    const fromTargetProp = rel.fromProperty || 'Id';
    const toTargetProp = rel.toProperty || \`\${rel.fromEntity}Id\`;

    const fromRowOffsetY = fromOffsets[fromTargetProp] !== undefined ? fromOffsets[fromTargetProp] : (fromOffsets['__pkDefault'] || 20);
    const toRowOffsetY = toOffsets[toTargetProp] !== undefined ? toOffsets[toTargetProp] : (toOffsets['__fkDefault'] || 20);

    const fromLeft = fromPos.x;
    const fromRight = fromPos.x + fromSize.width;
    const fromCenterY = fromPos.y + fromRowOffsetY;

    const toLeft = toPos.x;
    const toRight = toPos.x + toSize.width;
    const toCenterY = toPos.y + toRowOffsetY;

    let x1, y1, x2, y2, cx1, cy1, cx2, cy2;

    y1 = fromCenterY;
    y2 = toCenterY;

    // Case 1: From-Card is to the Left of To-Card
    if (fromRight <= toLeft) {
      x1 = fromRight;
      x2 = toLeft;
      const dx = Math.max(30, (x2 - x1) * 0.5);
      cx1 = x1 + dx;
      cy1 = y1;
      cx2 = x2 - dx;
      cy2 = y2;
    } else if (toRight <= fromLeft) {
      // Case 2: From-Card is to the Right of To-Card
      x1 = fromLeft;
      x2 = toRight;
      const dx = Math.max(30, (x1 - x2) * 0.5);
      cx1 = x1 - dx;
      cy1 = y1;
      cx2 = x2 + dx;
      cy2 = y2;
    } else {
      // Case 3: Horizontal Overlap (e.g. vertically stacked or partial overlap)
      const fromMidX = (fromLeft + fromRight) / 2;
      const toMidX = (toLeft + toRight) / 2;

      if (fromMidX <= toMidX) {
        // Route via Right side
        x1 = fromRight;
        x2 = toRight;
        const maxRight = Math.max(fromRight, toRight);
        const loopOffset = Math.max(40, Math.min(100, Math.abs(y2 - y1) * 0.2));
        cx1 = maxRight + loopOffset;
        cy1 = y1;
        cx2 = maxRight + loopOffset;
        cy2 = y2;
      } else {
        // Route via Left side
        x1 = fromLeft;
        x2 = toLeft;
        const minLeft = Math.min(fromLeft, toLeft);
        const loopOffset = Math.max(40, Math.min(100, Math.abs(y2 - y1) * 0.2));
        cx1 = minLeft - loopOffset;
        cy1 = y1;
        cx2 = minLeft - loopOffset;
        cy2 = y2;
      }
    }

    return {
      pathData: \`M \${x1} \${y1} C \${cx1} \${cy1}, \${cx2} \${cy2}, \${x2} \${y2}\`,
      x1, y1, x2, y2, cx1, cy1, cx2, cy2
    };
  }

  // Build SVG Elements once with Smart Color-Coded & Patterned Relationship Lines
  function buildAllSvgElements() {
    linksSvg.innerHTML = '';
    const activeNames = new Set(Object.keys(activePositions));

    for (const rel of allRelationships) {
      if (activeNames.has(rel.fromEntity) && activeNames.has(rel.toEntity)) {
        const geom = computeRelGeometry(rel);
        if (!geom) continue;

        const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        group.id = 'rel-g-' + rel.id;

        // Hitbox for easy clicking
        const hitbox = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        hitbox.setAttribute('d', geom.pathData);
        hitbox.setAttribute('class', 'rel-hitbox');
        hitbox.dataset.relId = rel.id;
        hitbox.addEventListener('click', e => {
          e.stopPropagation();
          openRelationshipInspector(rel, e.clientX, e.clientY);
        });
        group.appendChild(hitbox);

        // Smart Styling: 1:1, 1:N, N:N and solid vs dashed for optional FK
        let cardinalityClass = 'rel-1-n';
        if (rel.cardinality === 'one-to-one') cardinalityClass = 'rel-1-1';
        else if (rel.cardinality === 'many-to-many') cardinalityClass = 'rel-n-n';

        const optionalClass = rel.isRequired === false ? ' optional-fk' : '';
        const isSelected = activeSelectedRelId === rel.id;

        const pathEl = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        pathEl.setAttribute('d', geom.pathData);
        pathEl.setAttribute('class', \`link-path \${cardinalityClass}\${optionalClass}\` + (isSelected ? ' selected' : ''));
        pathEl.dataset.relId = rel.id;
        pathEl.addEventListener('click', e => {
          e.stopPropagation();
          openRelationshipInspector(rel, e.clientX, e.clientY);
        });
        group.appendChild(pathEl);

        let endpointColor = '#3b82f6';
        if (rel.cardinality === 'one-to-one') endpointColor = '#a855f7';
        else if (rel.cardinality === 'many-to-many') endpointColor = '#f59e0b';
        if (isSelected) endpointColor = '#38bdf8';

        // Endpoints
        const c1 = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        c1.setAttribute('cx', geom.x1);
        c1.setAttribute('cy', geom.y1);
        c1.setAttribute('r', 3.5);
        c1.setAttribute('class', 'link-endpoint');
        c1.setAttribute('fill', endpointColor);
        group.appendChild(c1);

        const c2 = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        c2.setAttribute('cx', geom.x2);
        c2.setAttribute('cy', geom.y2);
        c2.setAttribute('r', 4.5);
        c2.setAttribute('class', 'link-crowfoot');
        c2.setAttribute('fill', endpointColor);
        group.appendChild(c2);

        linksSvg.appendChild(group);
      }
    }
  }

  // 60FPS High-Performance In-Place SVG Coordinate Update (Zero DOM Allocation / Zero Reflow)
  function updateSvgLinksInPlace() {
    rafScheduled = false;
    const activeNames = new Set(Object.keys(activePositions));

    for (const rel of allRelationships) {
      if (activeNames.has(rel.fromEntity) && activeNames.has(rel.toEntity)) {
        const group = document.getElementById('rel-g-' + rel.id);
        if (!group) continue;

        const geom = computeRelGeometry(rel);
        if (!geom) continue;

        const paths = group.querySelectorAll('path');
        paths.forEach(p => p.setAttribute('d', geom.pathData));

        const circles = group.querySelectorAll('circle');
        if (circles[0]) {
          circles[0].setAttribute('cx', geom.x1);
          circles[0].setAttribute('cy', geom.y1);
        }
        if (circles[1]) {
          circles[1].setAttribute('cx', geom.x2);
          circles[1].setAttribute('cy', geom.y2);
        }
      }
    }
    updateMinimap();
  }

  function scheduleSvgUpdate() {
    if (!rafScheduled) {
      rafScheduled = true;
      requestAnimationFrame(updateSvgLinksInPlace);
    }
  }

  // Stable Minimap Geometry & Calculation (No Jitter)
  function getMinimapGeometry() {
    const activeNames = Object.keys(activePositions);
    let minX = 0, minY = 0, maxX = 1200, maxY = 800;

    if (activeNames.length > 0 || notes.length > 0) {
      minX = Infinity; minY = Infinity; maxX = -Infinity; maxY = -Infinity;
      activeNames.forEach(name => {
        const p = activePositions[name];
        const s = cardSizeCache[name] || { width: 310, height: 200 };
        minX = Math.min(minX, p.x);
        minY = Math.min(minY, p.y);
        maxX = Math.max(maxX, p.x + s.width);
        maxY = Math.max(maxY, p.y + s.height);
      });

      notes.forEach(n => {
        minX = Math.min(minX, n.x);
        minY = Math.min(minY, n.y);
        maxX = Math.max(maxX, n.x + (n.width || 220));
        maxY = Math.max(maxY, n.y + (n.height || 120));
      });
    }

    const pad = 160;
    minX -= pad; minY -= pad; maxX += pad; maxY += pad;
    const worldW = Math.max(600, maxX - minX);
    const worldH = Math.max(400, maxY - minY);

    const scale = Math.min((minimapCanvas?.width || 190) / worldW, (minimapCanvas?.height || 125) / worldH);
    const offsetX = ((minimapCanvas?.width || 190) - worldW * scale) / 2;
    const offsetY = ((minimapCanvas?.height || 125) - worldH * scale) / 2;

    return { minX, minY, worldW, worldH, scale, offsetX, offsetY };
  }

  // Interactive Canvas Minimap
  function updateMinimap() {
    if (!minimapCanvas || !minimapLens) return;
    const ctx = minimapCanvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, minimapCanvas.width, minimapCanvas.height);

    const activeNames = Object.keys(activePositions);
    if (activeNames.length === 0 && notes.length === 0) {
      minimapLens.style.display = 'none';
      return;
    }
    minimapLens.style.display = 'block';

    const geom = getMinimapGeometry();

    // Draw Tables on Minimap
    activeNames.forEach(name => {
      const p = activePositions[name];
      const s = cardSizeCache[name] || { width: 310, height: 200 };
      const mx = geom.offsetX + (p.x - geom.minX) * geom.scale;
      const my = geom.offsetY + (p.y - geom.minY) * geom.scale;
      const mw = Math.max(3, s.width * geom.scale);
      const mh = Math.max(3, s.height * geom.scale);

      ctx.fillStyle = colorByEntity[name] || '#3c4048';
      ctx.fillRect(mx, my, mw, mh);
    });

    // Draw Notes on Minimap
    notes.forEach(n => {
      const mx = geom.offsetX + (n.x - geom.minX) * geom.scale;
      const my = geom.offsetY + (n.y - geom.minY) * geom.scale;
      const mw = Math.max(3, (n.width || 220) * geom.scale);
      const mh = Math.max(3, (n.height || 120) * geom.scale);

      ctx.fillStyle = '#fef08a';
      ctx.fillRect(mx, my, mw, mh);
    });

    // Update Minimap Lens for Viewport Area
    const viewWorldX = -panX / zoom;
    const viewWorldY = -panY / zoom;
    const viewWorldW = viewport.clientWidth / zoom;
    const viewWorldH = viewport.clientHeight / zoom;

    const lensX = geom.offsetX + (viewWorldX - geom.minX) * geom.scale;
    const lensY = geom.offsetY + (viewWorldY - geom.minY) * geom.scale;
    const lensW = Math.max(12, viewWorldW * geom.scale);
    const lensH = Math.max(12, viewWorldH * geom.scale);

    minimapLens.style.left = lensX + 'px';
    minimapLens.style.top = lensY + 'px';
    minimapLens.style.width = lensW + 'px';
    minimapLens.style.height = lensH + 'px';
  }

  // Smooth Live Pan from Minimap Coordinates
  function panFromMinimap(clientX, clientY) {
    if (!canvasMinimap) return;
    const geom = getMinimapGeometry();
    const rect = canvasMinimap.getBoundingClientRect();
    const clickX = clientX - rect.left;
    const clickY = clientY - rect.top;

    const targetWorldX = geom.minX + (clickX - geom.offsetX) / geom.scale;
    const targetWorldY = geom.minY + (clickY - geom.offsetY) / geom.scale;

    panX = Math.round(viewport.clientWidth / 2 - targetWorldX * zoom);
    panY = Math.round(viewport.clientHeight / 2 - targetWorldY * zoom);

    applyTransform();
    updateMinimap();
  }

  // Real-Time Pointer Dragging on Minimap
  let isDraggingMinimap = false;

  if (canvasMinimap) {
    canvasMinimap.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      isDraggingMinimap = true;
      canvasMinimap.setPointerCapture(e.pointerId);
      panFromMinimap(e.clientX, e.clientY);
      e.stopPropagation();
      e.preventDefault();
    });

    canvasMinimap.addEventListener('pointermove', e => {
      if (isDraggingMinimap) {
        panFromMinimap(e.clientX, e.clientY);
        e.stopPropagation();
        e.preventDefault();
      }
    });

    canvasMinimap.addEventListener('pointerup', e => {
      if (isDraggingMinimap) {
        isDraggingMinimap = false;
        e.stopPropagation();
      }
    });

    canvasMinimap.addEventListener('pointercancel', () => {
      isDraggingMinimap = false;
    });
  }

  // Pan & Zoom
  function applyTransform() {
    canvasTransform.style.transform = \`translate3d(\${panX}px, \${panY}px, 0) scale(\${zoom})\`;
    zoomDisplay.textContent = Math.round(zoom * 100) + '%';
  }

  viewport.addEventListener('wheel', e => {
    const scrollableTarget = e.target.closest('.card-body, .popover-list, .entity-list, .rel-inspector-body, .note-textarea');

    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const zoomFactor = e.deltaY < 0 ? 1.1 : 0.9;
      const newZoom = Math.min(Math.max(0.3, zoom * zoomFactor), 2.5);

      const rect = viewport.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      panX = mouseX - (mouseX - panX) * (newZoom / zoom);
      panY = mouseY - (mouseY - panY) * (newZoom / zoom);
      zoom = newZoom;

      applyTransform();
      updateMinimap();
    } else if (scrollableTarget) {
      return;
    } else {
      e.preventDefault();
      if (e.shiftKey) {
        panX -= (e.deltaY || e.deltaX);
      } else {
        panY -= e.deltaY;
        panX -= e.deltaX;
      }
      applyTransform();
      updateMinimap();
    }
  }, { passive: false });

  // Pointer Down for Pan / Marquee Selection
  viewport.addEventListener('pointerdown', e => {
    if (e.target === viewport || e.target === canvasTransform || e.target === linksSvg || e.target.closest('#emptyPrompt')) {
      if (e.button === 0) {
        if (e.shiftKey) {
          // Marquee Multi-Selection Box
          isMarqueeSelecting = true;
          viewport.setPointerCapture(e.pointerId);
          const vpRect = viewport.getBoundingClientRect();
          marqueeStartX = e.clientX - vpRect.left;
          marqueeStartY = e.clientY - vpRect.top;
          marqueeBox.style.left = marqueeStartX + 'px';
          marqueeBox.style.top = marqueeStartY + 'px';
          marqueeBox.style.width = '0px';
          marqueeBox.style.height = '0px';
          marqueeBox.style.display = 'block';
        } else {
          // Normal Canvas Pan
          isPanning = true;
          viewport.setPointerCapture(e.pointerId);
          startPanX = e.clientX - panX;
          startPanY = e.clientY - panY;
          viewport.style.cursor = 'grabbing';
          selectedEntityNames.clear();
          cardsLayer.querySelectorAll('.table-card').forEach(c => c.classList.remove('multi-selected'));
          closeAllPopovers();
        }
      }
    }
  });

  window.addEventListener('pointermove', e => {
    if (isPanning) {
      panX = e.clientX - startPanX;
      panY = e.clientY - startPanY;
      applyTransform();
      updateMinimap();
    } else if (isMarqueeSelecting) {
      const vpRect = viewport.getBoundingClientRect();
      const curX = e.clientX - vpRect.left;
      const curY = e.clientY - vpRect.top;

      const left = Math.min(marqueeStartX, curX);
      const top = Math.min(marqueeStartY, curY);
      const width = Math.abs(curX - marqueeStartX);
      const height = Math.abs(curY - marqueeStartY);

      marqueeBox.style.left = left + 'px';
      marqueeBox.style.top = top + 'px';
      marqueeBox.style.width = width + 'px';
      marqueeBox.style.height = height + 'px';

      // Hit-test cards with marquee box
      const worldBoxLeft = (left - panX) / zoom;
      const worldBoxTop = (top - panY) / zoom;
      const worldBoxRight = worldBoxLeft + width / zoom;
      const worldBoxBottom = worldBoxTop + height / zoom;

      selectedEntityNames.clear();
      for (const name in activePositions) {
        const p = activePositions[name];
        const s = cardSizeCache[name] || { width: 310, height: 200 };
        const collides = !(p.x + s.width < worldBoxLeft || p.x > worldBoxRight || p.y + s.height < worldBoxTop || p.y > worldBoxBottom);
        const cardEl = document.getElementById('card-' + name);
        if (collides) {
          selectedEntityNames.add(name);
          if (cardEl) cardEl.classList.add('multi-selected');
        } else if (cardEl) {
          cardEl.classList.remove('multi-selected');
        }
      }
    } else if (draggedCard) {
      const rect = viewport.getBoundingClientRect();
      const primaryName = draggedCard.querySelector('.card-header').dataset.entityName;
      const newX = (e.clientX - rect.left - panX) / zoom - dragOffsetX;
      const newY = (e.clientY - rect.top - panY) / zoom - dragOffsetY;

      const deltaX = Math.round(newX) - (batchDragInitialPositions[primaryName]?.x || activePositions[primaryName].x);
      const deltaY = Math.round(newY) - (batchDragInitialPositions[primaryName]?.y || activePositions[primaryName].y);

      // Move all selected cards in batch
      selectedEntityNames.forEach(selName => {
        const init = batchDragInitialPositions[selName];
        if (init) {
          const cardEl = document.getElementById('card-' + selName);
          const posX = init.x + deltaX;
          const posY = init.y + deltaY;
          activePositions[selName] = { x: posX, y: posY };
          if (cardEl) {
            cardEl.style.left = posX + 'px';
            cardEl.style.top = posY + 'px';
          }
        }
      });

      scheduleSvgUpdate();
    } else if (draggedNote) {
      const rect = viewport.getBoundingClientRect();
      const newX = Math.round((e.clientX - rect.left - panX) / zoom - noteDragOffsetX);
      const newY = Math.round((e.clientY - rect.top - panY) / zoom - noteDragOffsetY);

      draggedNote.style.left = newX + 'px';
      draggedNote.style.top = newY + 'px';

      const noteId = draggedNote.querySelector('.note-header').dataset.noteId;
      const note = notes.find(n => n.id === noteId);
      if (note) {
        note.x = newX;
        note.y = newY;
      }
      updateMinimap();
    } else if (draggedInspector) {
      const vpRect = viewport.getBoundingClientRect();
      let newLeft = e.clientX - inspectorDragOffsetX;
      let newTop = e.clientY - inspectorDragOffsetY;

      newLeft = Math.max(10, Math.min(vpRect.width - 350, newLeft));
      newTop = Math.max(10, Math.min(vpRect.height - 300, newTop));

      draggedInspector.style.left = newLeft + 'px';
      draggedInspector.style.top = newTop + 'px';
    }
  });

  window.addEventListener('pointerup', () => {
    if (isPanning) {
      isPanning = false;
      viewport.style.cursor = 'grab';
    }
    if (isMarqueeSelecting) {
      isMarqueeSelecting = false;
      marqueeBox.style.display = 'none';
    }
    if (draggedCard) {
      pushHistory();
      draggedCard.classList.remove('dragging');
      draggedCard.style.zIndex = '2';
      draggedCard = null;
    }
    if (draggedNote) {
      pushHistory();
      draggedNote.classList.remove('dragging');
      draggedNote = null;
    }
    if (draggedInspector) {
      draggedInspector = null;
    }
  });

  viewport.addEventListener('dragover', e => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  });

  viewport.addEventListener('drop', e => {
    e.preventDefault();
    const entityName = e.dataTransfer.getData('text/plain');
    if (entityName) {
      addEntityToCanvas(entityName, e.clientX, e.clientY);
    }
  });

  // Alignment & Distribution Tools
  function alignSelected(type) {
    if (selectedEntityNames.size < 2) {
      alert('Please select at least 2 tables (hold Shift and drag on canvas to multi-select).');
      return;
    }
    pushHistory();
    const names = Array.from(selectedEntityNames);

    if (type === 'left') {
      const minX = Math.min(...names.map(n => activePositions[n].x));
      names.forEach(n => {
        activePositions[n].x = minX;
        const c = document.getElementById('card-' + n);
        if (c) c.style.left = minX + 'px';
      });
    } else if (type === 'top') {
      const minY = Math.min(...names.map(n => activePositions[n].y));
      names.forEach(n => {
        activePositions[n].y = minY;
        const c = document.getElementById('card-' + n);
        if (c) c.style.top = minY + 'px';
      });
    } else if (type === 'distributeH') {
      names.sort((a, b) => activePositions[a].x - activePositions[b].x);
      const minX = activePositions[names[0]].x;
      const maxX = activePositions[names[names.length - 1]].x;
      const step = (maxX - minX) / (names.length - 1);
      names.forEach((n, idx) => {
        const x = Math.round(minX + idx * step);
        activePositions[n].x = x;
        const c = document.getElementById('card-' + n);
        if (c) c.style.left = x + 'px';
      });
    }

    scheduleSvgUpdate();
  }

  if (btnAlignLeft) btnAlignLeft.addEventListener('click', () => alignSelected('left'));
  if (btnAlignTop) btnAlignTop.addEventListener('click', () => alignSelected('top'));
  if (btnDistributeH) btnDistributeH.addEventListener('click', () => alignSelected('distributeH'));

  // Multi-Layout Engine: Column DAG, Hierarchical Tree, Radial Star, Compact Grid
  function autoLayoutEntities(explicitEntities, algorithm = 'column') {
    pushHistory();
    const activeKeys = Object.keys(activePositions);
    let targetEntities = explicitEntities;

    if (!targetEntities) {
      if (activeKeys.length > 0) {
        targetEntities = activeKeys
          .map(name => allEntities.find(e => e.name === name))
          .filter(Boolean);
      } else {
        targetEntities = allEntities.slice(0, 5);
      }
    }

    if (!targetEntities || targetEntities.length === 0) return;

    if (algorithm === 'grid') {
      const cols = Math.ceil(Math.sqrt(targetEntities.length));
      targetEntities.forEach((e, idx) => {
        const row = Math.floor(idx / cols);
        const col = idx % cols;
        activePositions[e.name] = {
          x: 60 + col * 360,
          y: 60 + row * 340
        };
      });
    } else if (algorithm === 'hierarchical') {
      // Tree Hierarchy: Roots at top, descendants cascade down
      const inDegree = {};
      const adj = {};
      targetEntities.forEach(e => {
        inDegree[e.name] = 0;
        adj[e.name] = [];
      });

      for (const rel of allRelationships) {
        if (adj[rel.fromEntity] && inDegree[rel.toEntity] !== undefined) {
          adj[rel.fromEntity].push(rel.toEntity);
          inDegree[rel.toEntity]++;
        }
      }

      const levels = [];
      const visited = new Set();

      let currentLevel = targetEntities.filter(e => inDegree[e.name] === 0).map(e => e.name);
      if (currentLevel.length === 0) currentLevel = [targetEntities[0].name];

      while (currentLevel.length > 0) {
        levels.push(currentLevel);
        currentLevel.forEach(name => visited.add(name));

        const nextLevel = [];
        for (const name of currentLevel) {
          for (const child of (adj[name] || [])) {
            if (!visited.has(child) && !nextLevel.includes(child)) {
              nextLevel.push(child);
            }
          }
        }
        currentLevel = nextLevel;
      }

      const remaining = targetEntities.filter(e => !visited.has(e.name)).map(e => e.name);
      if (remaining.length > 0) levels.push(remaining);

      levels.forEach((levelNodes, levelIdx) => {
        const totalW = levelNodes.length * 360;
        const startX = Math.max(60, 600 - totalW / 2);
        levelNodes.forEach((name, colIdx) => {
          activePositions[name] = {
            x: startX + colIdx * 360,
            y: 60 + levelIdx * 380
          };
        });
      });
    } else if (algorithm === 'radial') {
      // Radial Star: Most connected core node in center, satellite entities on ring
      const degree = {};
      targetEntities.forEach(e => { degree[e.name] = 0; });
      for (const rel of allRelationships) {
        if (degree[rel.fromEntity] !== undefined) degree[rel.fromEntity]++;
        if (degree[rel.toEntity] !== undefined) degree[rel.toEntity]++;
      }

      const sorted = [...targetEntities].sort((a, b) => degree[b.name] - degree[a.name]);
      const centerNode = sorted[0];
      const satellites = sorted.slice(1);

      activePositions[centerNode.name] = { x: 500, y: 400 };

      const radius = Math.max(380, satellites.length * 55);
      const angleStep = (2 * Math.PI) / satellites.length;

      satellites.forEach((e, idx) => {
        const angle = idx * angleStep;
        activePositions[e.name] = {
          x: Math.round(500 + radius * Math.cos(angle)),
          y: Math.round(400 + radius * Math.sin(angle))
        };
      });
    } else {
      // Default: Column DAG Flow
      const inDegree = {};
      const adj = {};
      targetEntities.forEach(e => {
        inDegree[e.name] = 0;
        adj[e.name] = [];
      });

      for (const rel of allRelationships) {
        if (adj[rel.fromEntity] && inDegree[rel.toEntity] !== undefined) {
          adj[rel.fromEntity].push(rel.toEntity);
          inDegree[rel.toEntity]++;
        }
      }

      const columns = [];
      const visited = new Set();

      let currentCol = targetEntities.filter(e => inDegree[e.name] === 0).map(e => e.name);
      if (currentCol.length === 0) currentCol = [targetEntities[0].name];

      while (currentCol.length > 0) {
        columns.push(currentCol);
        currentCol.forEach(name => visited.add(name));

        const nextCol = [];
        for (const name of currentCol) {
          for (const child of (adj[name] || [])) {
            if (!visited.has(child) && !nextCol.includes(child)) {
              nextCol.push(child);
            }
          }
        }
        currentCol = nextCol;
      }

      const remaining = targetEntities.filter(e => !visited.has(e.name)).map(e => e.name);
      if (remaining.length > 0) columns.push(remaining);

      columns.forEach((colEntities, colIdx) => {
        colEntities.forEach((name, rowIdx) => {
          activePositions[name] = {
            x: 60 + colIdx * 440,
            y: 60 + rowIdx * 380
          };
        });
      });
    }

    renderCanvas();
    renderNotes();
    Object.keys(activePositions).forEach(name => cacheCardLayout(name));
    scheduleSvgUpdate();
    updateMinimap();
  }

  if (btnAutoLayout) {
    btnAutoLayout.addEventListener('click', () => {
      const mode = layoutModeSelect ? layoutModeSelect.value : 'column';
      autoLayoutEntities(null, mode || 'column');
    });
  }

  if (layoutModeSelect) {
    layoutModeSelect.addEventListener('change', () => {
      const mode = layoutModeSelect.value;
      if (mode) {
        autoLayoutEntities(null, mode);
      }
    });
  }

  // Export Engine: High-DPI PNG, SVG Vector, Mermaid Syntax
  const NOTE_COLOR_MAP = {
    yellow:  { bg: '#fef08a', text: '#1f2937', headerBg: '#fde047', border: '#facc15' },
    emerald: { bg: '#a7f3d0', text: '#064e3b', headerBg: '#6ee7b7', border: '#34d399' },
    blue:    { bg: '#bfdbfe', text: '#1e3a8a', headerBg: '#93c5fd', border: '#60a5fa' },
    rose:    { bg: '#fecdd3', text: '#881337', headerBg: '#fda4af', border: '#fb7185' },
    purple:  { bg: '#e9d5ff', text: '#581c87', headerBg: '#d8b4fe', border: '#c084fc' },
    dark:    { bg: '#1e2430', text: '#f1f5f9', headerBg: '#151922', border: '#334155' }
  };

  function exportDiagram(type) {
    const activeNames = Object.keys(activePositions);
    if (activeNames.length === 0 && notes.length === 0) {
      alert('Cannot export an empty diagram. Please add tables or notes first.');
      return;
    }

    if (type === 'mermaid') {
      let mermaid = 'erDiagram\\n';
      for (const name of activeNames) {
        const entity = allEntities.find(e => e.name === name);
        if (!entity) continue;
        const hiddenSet = hiddenColumnsByEntity[entity.name] || new Set();

        mermaid += \`  \${entity.name} {\\n\`;
        for (const p of entity.properties) {
          if (hiddenSet.has(p.name)) continue;
          const cleanType = p.type.replace(/[^A-Za-z0-9_]/g, '_');
          const keyType = p.isPrimaryKey ? 'PK' : (p.isForeignKey ? 'FK' : '');
          mermaid += \`    \${cleanType} \${p.name} \${keyType}\\n\`;
        }
        mermaid += '  }\\n';
      }

      for (const rel of allRelationships) {
        if (activePositions[rel.fromEntity] && activePositions[rel.toEntity]) {
          mermaid += \`  \${rel.fromEntity} ||--o{ \${rel.toEntity} : contains\\n\`;
        }
      }

      navigator.clipboard.writeText(mermaid).then(() => {
        alert('Mermaid ERD code copied to clipboard!');
      });
      return;
    }

    if (type === 'png-dark' || type === 'png-light') {
      // Calculate Bounding Box of all tables and notes
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      activeNames.forEach(name => {
        const p = activePositions[name];
        const s = cardSizeCache[name] || { width: 310, height: 200 };
        minX = Math.min(minX, p.x);
        minY = Math.min(minY, p.y);
        maxX = Math.max(maxX, p.x + s.width);
        maxY = Math.max(maxY, p.y + s.height);
      });

      notes.forEach(n => {
        minX = Math.min(minX, n.x);
        minY = Math.min(minY, n.y);
        maxX = Math.max(maxX, n.x + (n.width || 220));
        maxY = Math.max(maxY, n.y + (n.height || 120));
      });

      const pad = 60;
      minX -= pad; minY -= pad; maxX += pad; maxY += pad;
      const width = Math.max(300, maxX - minX);
      const height = Math.max(300, maxY - minY);

      const dpr = 2; // High-DPI 2x
      const offscreen = document.createElement('canvas');
      offscreen.width = width * dpr;
      offscreen.height = height * dpr;
      const ctx = offscreen.getContext('2d');
      if (!ctx) return;

      ctx.scale(dpr, dpr);

      const isLight = type === 'png-light';
      ctx.fillStyle = isLight ? '#ffffff' : '#14161a';
      ctx.fillRect(0, 0, width, height);

      // Draw Grid dots
      ctx.fillStyle = isLight ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.06)';
      for (let gx = 0; gx < width; gx += 24) {
        for (let gy = 0; gy < height; gy += 24) {
          ctx.beginPath();
          ctx.arc(gx, gy, 1, 0, 2 * Math.PI);
          ctx.fill();
        }
      }

      // Draw SVG Relationship Lines on Canvas
      for (const rel of allRelationships) {
        if (activePositions[rel.fromEntity] && activePositions[rel.toEntity]) {
          const geom = computeRelGeometry(rel);
          if (geom) {
            ctx.beginPath();
            const startX = geom.x1 - minX;
            const startY = geom.y1 - minY;
            const endX = geom.x2 - minX;
            const endY = geom.y2 - minY;
            const c1x = geom.cx1 - minX;
            const c1y = geom.cy1 - minY;
            const c2x = geom.cx2 - minX;
            const c2y = geom.cy2 - minY;

            ctx.moveTo(startX, startY);
            ctx.bezierCurveTo(c1x, c1y, c2x, c2y, endX, endY);

            ctx.strokeStyle = rel.cardinality === 'one-to-one' ? '#a855f7' : (rel.cardinality === 'many-to-many' ? '#f59e0b' : '#3b82f6');
            ctx.lineWidth = 2;
            if (rel.isRequired === false) ctx.setLineDash([6, 4]);
            else ctx.setLineDash([]);
            ctx.stroke();
            ctx.setLineDash([]);

            // Draw circle endpoints
            ctx.fillStyle = rel.cardinality === 'one-to-one' ? '#a855f7' : (rel.cardinality === 'many-to-many' ? '#f59e0b' : '#3b82f6');
            ctx.beginPath(); ctx.arc(startX, startY, 4, 0, 2 * Math.PI); ctx.fill();
            ctx.beginPath(); ctx.arc(endX, endY, 5, 0, 2 * Math.PI); ctx.fill();
          }
        }
      }

      // Draw Table Cards with Pixel-Perfect UI Matching Webview
      activeNames.forEach(name => {
        const entity = allEntities.find(e => e.name === name);
        if (!entity) return;
        const p = activePositions[name];
        const hiddenSet = hiddenColumnsByEntity[name] || new Set();
        const visibleProps = entity.properties.filter(prop => !isPropertyHidden(entity, prop, hiddenSet));
        const w = 310;
        const h = Math.max(70, 48 + visibleProps.length * 26 + 10);
        const x = p.x - minX;
        const y = p.y - minY;
        const customColor = colorByEntity[name] || '#f59e0b';

        // Card Container
        ctx.fillStyle = isLight ? '#ffffff' : '#1c2028';
        ctx.strokeStyle = isLight ? '#cbd5e1' : '#2f3542';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.roundRect(x, y, w, h, 8);
        ctx.fill();
        ctx.stroke();

        // Card Top Color Stripe
        ctx.fillStyle = customColor;
        ctx.beginPath();
        ctx.roundRect(x, y, w, 3.5, [8, 8, 0, 0]);
        ctx.fill();

        // Header Background
        ctx.fillStyle = isLight ? '#f1f5f9' : '#232732';
        ctx.beginPath();
        ctx.roundRect(x, y + 3.5, w, 38, [4, 4, 0, 0]);
        ctx.fill();

        // Table Icon Square
        ctx.fillStyle = customColor;
        ctx.beginPath();
        ctx.roundRect(x + 12, y + 15, 10, 10, 2);
        ctx.fill();

        // Header Entity Name
        ctx.fillStyle = isLight ? '#0f172a' : '#f8fafc';
        ctx.font = 'bold 12.5px system-ui, -apple-system, sans-serif';
        ctx.fillText(entity.name, x + 28, y + 23);

        // Header Subname (Table Name)
        ctx.fillStyle = isLight ? '#64748b' : '#8892b0';
        ctx.font = '9.5px system-ui, sans-serif';
        const subname = entity.tableName || entity.name.toLowerCase();
        ctx.fillText(subname, x + 28, y + 36);

        // Properties List
        let curY = y + 62;
        visibleProps.forEach(prop => {
          // Badges for PK / FK
          if (prop.isPrimaryKey) {
            ctx.fillStyle = 'rgba(245, 158, 11, 0.18)';
            ctx.strokeStyle = 'rgba(245, 158, 11, 0.4)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.roundRect(x + 12, curY - 11, 22, 15, 3);
            ctx.fill();
            ctx.stroke();

            ctx.fillStyle = '#f59e0b';
            ctx.font = 'bold 8.5px system-ui, sans-serif';
            ctx.fillText('PK', x + 16, curY);

            ctx.fillStyle = isLight ? '#0f172a' : '#f8fafc';
            ctx.font = '11.5px system-ui, sans-serif';
            ctx.fillText(prop.name, x + 40, curY);
          } else if (prop.isForeignKey) {
            ctx.fillStyle = 'rgba(59, 130, 246, 0.18)';
            ctx.strokeStyle = 'rgba(59, 130, 246, 0.4)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.roundRect(x + 12, curY - 11, 22, 15, 3);
            ctx.fill();
            ctx.stroke();

            ctx.fillStyle = '#3b82f6';
            ctx.font = 'bold 8.5px system-ui, sans-serif';
            ctx.fillText('FK', x + 16, curY);

            ctx.fillStyle = isLight ? '#0f172a' : '#f8fafc';
            ctx.font = '11.5px system-ui, sans-serif';
            ctx.fillText(prop.name, x + 40, curY);
          } else {
            ctx.fillStyle = isLight ? '#334155' : '#cbd5e1';
            ctx.font = '11.5px system-ui, sans-serif';
            ctx.fillText(prop.name, x + 14, curY);
          }

          // Prop Type
          ctx.font = '10px "Cascadia Code", "Fira Code", monospace';
          ctx.fillStyle = isLight ? '#0284c7' : '#38bdf8';
          const typeW = ctx.measureText(prop.type).width;
          ctx.fillText(prop.type, x + w - typeW - 14, curY);

          curY += 26;
        });
      });

      // Draw Themed Notes
      notes.forEach(n => {
        const theme = NOTE_COLOR_MAP[n.color || 'yellow'] || NOTE_COLOR_MAP.yellow;
        const x = n.x - minX;
        const y = n.y - minY;
        const w = n.width || 220;
        const h = n.height || 120;

        // Note Card Container
        ctx.fillStyle = theme.bg;
        ctx.strokeStyle = theme.border;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.roundRect(x, y, w, h, 8);
        ctx.fill();
        ctx.stroke();

        // Note Header
        ctx.fillStyle = theme.headerBg;
        ctx.beginPath();
        ctx.roundRect(x, y, w, 22, [8, 8, 0, 0]);
        ctx.fill();

        // Color Dots
        const dotColors = ['#fef08a', '#a7f3d0', '#bfdbfe', '#fecdd3', '#e9d5ff', '#2d3748'];
        dotColors.forEach((dc, di) => {
          ctx.fillStyle = dc;
          ctx.beginPath();
          ctx.arc(x + 12 + di * 11, y + 11, 3.5, 0, 2 * Math.PI);
          ctx.fill();
        });

        // Note Text
        ctx.fillStyle = theme.text;
        ctx.font = '11.5px system-ui, -apple-system, sans-serif';
        const lines = (n.text || '').split('\\n');
        lines.forEach((line, idx) => {
          ctx.fillText(line, x + 12, y + 42 + idx * 17);
        });
      });

      // Trigger Download
      const dataUrl = offscreen.toDataURL('image/png');
      const a = document.createElement('a');
      a.download = \`\${activeDbContext}_\${currentDiagramName}_\${isLight ? 'light' : 'dark'}.png\`;
      a.href = dataUrl;
      a.click();
      return;
    }

    if (type === 'svg') {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      activeNames.forEach(name => {
        const p = activePositions[name];
        const s = cardSizeCache[name] || { width: 310, height: 200 };
        minX = Math.min(minX, p.x);
        minY = Math.min(minY, p.y);
        maxX = Math.max(maxX, p.x + s.width);
        maxY = Math.max(maxY, p.y + s.height);
      });

      notes.forEach(n => {
        minX = Math.min(minX, n.x);
        minY = Math.min(minY, n.y);
        maxX = Math.max(maxX, n.x + (n.width || 220));
        maxY = Math.max(maxY, n.y + (n.height || 120));
      });

      const pad = 60;
      minX -= pad; minY -= pad; maxX += pad; maxY += pad;
      const width = Math.max(300, maxX - minX);
      const height = Math.max(300, maxY - minY);

      let svgContent = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + width + ' ' + height + '" width="' + width + '" height="' + height + '" style="background:#14161a; font-family:system-ui, -apple-system, sans-serif;">\\n';

      // Paths
      for (const rel of allRelationships) {
        if (activePositions[rel.fromEntity] && activePositions[rel.toEntity]) {
          const geom = computeRelGeometry(rel);
          if (geom) {
            const startX = geom.x1 - minX;
            const startY = geom.y1 - minY;
            const endX = geom.x2 - minX;
            const endY = geom.y2 - minY;
            const c1x = geom.cx1 - minX;
            const c1y = geom.cy1 - minY;
            const c2x = geom.cx2 - minX;
            const c2y = geom.cy2 - minY;
            const d = 'M ' + startX + ' ' + startY + ' C ' + c1x + ' ' + c1y + ', ' + c2x + ' ' + c2y + ', ' + endX + ' ' + endY;
            const strokeColor = rel.cardinality === 'one-to-one' ? '#a855f7' : (rel.cardinality === 'many-to-many' ? '#f59e0b' : '#3b82f6');
            const dash = rel.isRequired === false ? 'stroke-dasharray="6,4"' : '';
            svgContent += '  <path d="' + d + '" fill="none" stroke="' + strokeColor + '" stroke-width="2" ' + dash + '/>\\n';
            svgContent += '  <circle cx="' + startX + '" cy="' + startY + '" r="3.5" fill="' + strokeColor + '"/>\\n';
            svgContent += '  <circle cx="' + endX + '" cy="' + endY + '" r="4.5" fill="' + strokeColor + '"/>\\n';
          }
        }
      }

      // Cards
      activeNames.forEach(name => {
        const entity = allEntities.find(e => e.name === name);
        if (!entity) return;
        const p = activePositions[name];
        const hiddenSet = hiddenColumnsByEntity[name] || new Set();
        const visibleProps = entity.properties.filter(prop => !isPropertyHidden(entity, prop, hiddenSet));
        const w = 310;
        const h = Math.max(70, 48 + visibleProps.length * 26 + 10);
        const x = p.x - minX;
        const y = p.y - minY;
        const customColor = colorByEntity[name] || '#f59e0b';
        const subname = entity.tableName || entity.name.toLowerCase();

        svgContent += '  <g transform="translate(' + x + ', ' + y + ')">\\n';
        svgContent += '    <rect width="' + w + '" height="' + h + '" rx="8" fill="#1c2028" stroke="#2f3542" stroke-width="1"/>\\n';
        svgContent += '    <rect width="' + w + '" height="3.5" rx="2" fill="' + customColor + '"/>\\n';
        svgContent += '    <path d="M 0 3.5 L ' + w + ' 3.5 L ' + w + ' 42 L 0 42 Z" fill="#232732"/>\\n';
        svgContent += '    <rect x="12" y="15" width="10" height="10" rx="2" fill="' + customColor + '"/>\\n';
        svgContent += '    <text x="28" y="23" fill="#f8fafc" font-size="12.5" font-weight="bold">' + escapeHtml(entity.name) + '</text>\\n';
        svgContent += '    <text x="28" y="36" fill="#8892b0" font-size="9.5">' + escapeHtml(subname) + '</text>\\n';

        let curY = 62;
        visibleProps.forEach(prop => {
          if (prop.isPrimaryKey) {
            svgContent += '    <rect x="12" y="' + (curY - 11) + '" width="22" height="15" rx="3" fill="rgba(245,158,11,0.18)" stroke="rgba(245,158,11,0.4)" stroke-width="1"/>\\n';
            svgContent += '    <text x="16" y="' + curY + '" fill="#f59e0b" font-size="8.5" font-weight="bold">PK</text>\\n';
            svgContent += '    <text x="40" y="' + curY + '" fill="#f8fafc" font-size="11.5">' + escapeHtml(prop.name) + '</text>\\n';
          } else if (prop.isForeignKey) {
            svgContent += '    <rect x="12" y="' + (curY - 11) + '" width="22" height="15" rx="3" fill="rgba(59,130,246,0.18)" stroke="rgba(59,130,246,0.4)" stroke-width="1"/>\\n';
            svgContent += '    <text x="16" y="' + curY + '" fill="#3b82f6" font-size="8.5" font-weight="bold">FK</text>\\n';
            svgContent += '    <text x="40" y="' + curY + '" fill="#f8fafc" font-size="11.5">' + escapeHtml(prop.name) + '</text>\\n';
          } else {
            svgContent += '    <text x="14" y="' + curY + '" fill="#cbd5e1" font-size="11.5">' + escapeHtml(prop.name) + '</text>\\n';
          }
          svgContent += '    <text x="' + (w - 14) + '" y="' + curY + '" fill="#38bdf8" font-size="10" text-anchor="end" font-family="monospace">' + escapeHtml(prop.type) + '</text>\\n';
          curY += 26;
        });
        svgContent += '  </g>\\n';
      });

      // Notes
      notes.forEach(n => {
        const theme = NOTE_COLOR_MAP[n.color || 'yellow'] || NOTE_COLOR_MAP.yellow;
        const x = n.x - minX;
        const y = n.y - minY;
        const w = n.width || 220;
        const h = n.height || 120;
        svgContent += '  <g transform="translate(' + x + ', ' + y + ')">\\n';
        svgContent += '    <rect width="' + w + '" height="' + h + '" rx="8" fill="' + theme.bg + '" stroke="' + theme.border + '" stroke-width="1"/>\\n';
        svgContent += '    <path d="M 0 0 Q 0 0 8 0 L ' + (w - 8) + ' 0 Q ' + w + 0 + ' ' + w + ' 8 L ' + w + ' 22 L 0 22 Z" fill="' + theme.headerBg + '"/>\\n';
        const lines = (n.text || '').split('\\n');
        lines.forEach((line, idx) => {
          svgContent += '    <text x="12" y="' + (42 + idx * 17) + '" fill="' + theme.text + '" font-size="11.5">' + escapeHtml(line) + '</text>\\n';
        });
        svgContent += '  </g>\\n';
      });

      svgContent += '</svg>';

      const blob = new Blob([svgContent], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.download = \`\${activeDbContext}_\${currentDiagramName}.svg\`;
      a.href = url;
      a.click();
      URL.revokeObjectURL(url);
      return;
    }
  }

  if (exportSelect) {
    exportSelect.addEventListener('change', () => {
      const val = exportSelect.value;
      if (val) {
        exportDiagram(val);
        exportSelect.value = '';
      }
    });
  }

  // Keyboard Shortcuts (Ctrl+Z, Ctrl+Y, Ctrl+S, Delete)
  window.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
      e.preventDefault();
      redo();
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      document.getElementById('btnSave')?.click();
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      if (selectedEntityNames.size > 0) {
        e.preventDefault();
        pushHistory();
        selectedEntityNames.forEach(name => {
          delete activePositions[name];
          delete cardSizeCache[name];
          delete cardRowOffsetCache[name];
        });
        selectedEntityNames.clear();
        renderEntityList(searchBox.value);
        renderCanvas();
      }
    }
  });

  // Toolbar Actions
  document.getElementById('btnNew').addEventListener('click', () => {
    pushHistory();
    activePositions = {};
    notes = [];
    minimizedCards.clear();
    hiddenColumnsByEntity = {};
    colorByEntity = {};
    selectedEntityNames.clear();
    activeSelectedRelId = null;
    currentDiagramName = 'New Diagram';
    renderEntityList(searchBox.value);
    renderCanvas();
    renderNotes();
  });

  document.getElementById('btnSave').addEventListener('click', () => {
    const payload = getSerializablePositions();
    vscode.postMessage({
      type: 'saveDiagram',
      name: \`\${activeDbContext}_\${currentDiagramName}\`,
      positions: payload,
      notes: notes
    });
  });

  document.getElementById('btnZoomIn').addEventListener('click', () => {
    zoom = Math.min(2.5, zoom * 1.2);
    applyTransform();
    updateMinimap();
  });

  document.getElementById('btnZoomOut').addEventListener('click', () => {
    zoom = Math.max(0.3, zoom / 1.2);
    applyTransform();
    updateMinimap();
  });

  document.getElementById('btnZoomReset').addEventListener('click', () => {
    zoom = 1.0;
    panX = 40;
    panY = 40;
    applyTransform();
    updateMinimap();
  });

  function escapeHtml(str) {
    if (!str) return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
})();
`;
}
