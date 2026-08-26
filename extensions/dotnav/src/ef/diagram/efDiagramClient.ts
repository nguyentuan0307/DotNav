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
  let minimizedCards = new Set();
  let hiddenColumnsByEntity = {}; // { [entityName]: Set<propName> }
  let colorByEntity = {}; // { [entityName]: hexColor }
  let activeSelectedRelId = null;

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
  const entityListEl = document.getElementById('entityList');
  const searchBox = document.getElementById('searchBox');
  const dbContextSelect = document.getElementById('dbContextSelect');
  const diagramSelect = document.getElementById('diagramSelect');
  const sidebarContextTitle = document.getElementById('sidebarContextTitle');
  const btnAddAllToCanvas = document.getElementById('btnAddAllToCanvas');
  const emptyPrompt = document.getElementById('emptyPrompt');
  const zoomDisplay = document.getElementById('zoomDisplay');

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

  // Initialize
  window.addEventListener('message', event => {
    const msg = event.data;
    switch (msg.type) {
      case 'init':
        availableDbContexts = msg.availableDbContexts || [];
        entitiesByContext = msg.entitiesByContext || {};
        relationshipsByContext = msg.relationshipsByContext || {};
        activeDbContext = msg.activeDbContext || (availableDbContexts.length > 0 ? availableDbContexts[0] : 'Default');

        allEntities = entitiesByContext[activeDbContext] || msg.allEntities || [];
        allRelationships = relationshipsByContext[activeDbContext] || msg.relationships || [];
        activePositions = {};
        hiddenColumnsByEntity = {};
        colorByEntity = {};
        minimizedCards.clear();
        activeSelectedRelId = null;

        restoreEntityStates(msg.activePositions || {});
        currentDiagramName = msg.activeDiagramName || 'Default';

        updateDbContextSelect();
        updateDiagramSelect(msg.savedDiagramNames || []);
        updateSidebarTitle();
        renderEntityList();
        renderCanvas();
        break;

      case 'diagramLoaded':
        activePositions = {};
        hiddenColumnsByEntity = {};
        colorByEntity = {};
        minimizedCards.clear();
        activeSelectedRelId = null;

        restoreEntityStates(msg.activePositions || {});
        currentDiagramName = msg.diagramName || 'Default';
        renderEntityList();
        renderCanvas();
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
      activeDbContext = dbContextSelect.value;
      allEntities = entitiesByContext[activeDbContext] || [];
      allRelationships = relationshipsByContext[activeDbContext] || [];
      activePositions = {};
      minimizedCards.clear();
      hiddenColumnsByEntity = {};
      colorByEntity = {};
      activeSelectedRelId = null;

      if (allEntities.length > 0) {
        allEntities.slice(0, 3).forEach((e, idx) => {
          activePositions[e.name] = { x: 60 + idx * 360, y: 60 };
        });
      }

      updateSidebarTitle();
      renderEntityList();
      renderCanvas();
    });
  }

  function updateSidebarTitle() {
    if (sidebarContextTitle) {
      sidebarContextTitle.textContent = \`\${activeDbContext || 'Entity Palette'} (\${allEntities.length})\`;
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
      for (const e of allEntities) {
        if (!activePositions[e.name]) {
          activePositions[e.name] = { x: 0, y: 0 };
        }
      }
      autoLayoutEntities(allEntities);
      renderEntityList(searchBox.value);
      renderCanvas();
    });
  }

  searchBox.addEventListener('input', () => {
    renderEntityList(searchBox.value);
  });

  function addEntityToCanvas(entityName, clientX, clientY) {
    if (activePositions[entityName]) {
      focusCard(entityName);
      return;
    }

    let posX = 80;
    let posY = 80;

    if (clientX !== undefined && clientY !== undefined) {
      const rect = viewport.getBoundingClientRect();
      posX = (clientX - rect.left - panX) / zoom;
      posY = (clientY - top - panY) / zoom;
    } else {
      const slot = findFreeCanvasSlot(80, 80);
      posX = slot.x;
      posY = slot.y;
    }

    activePositions[entityName] = { x: Math.round(posX), y: Math.round(posY) };
    renderEntityList(searchBox.value);
    renderCanvas();
  }

  function removeEntityFromCanvas(entityName) {
    delete activePositions[entityName];
    minimizedCards.delete(entityName);
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

    if (activeNames.length === 0) {
      emptyPrompt.style.display = 'flex';
      linksSvg.innerHTML = '';
      return;
    }

    emptyPrompt.style.display = 'none';

    for (const name of activeNames) {
      const entity = allEntities.find(e => e.name === name);
      if (!entity) continue;

      const pos = activePositions[name];
      const isMinimized = minimizedCards.has(entity.name);
      const customColor = colorByEntity[entity.name];
      const hiddenSet = hiddenColumnsByEntity[entity.name] || new Set();

      const card = document.createElement('div');
      card.className = 'table-card' + (isMinimized ? ' minimized' : '');
      card.id = 'card-' + entity.name;
      card.style.left = pos.x + 'px';
      card.style.top = pos.y + 'px';

      if (customColor) {
        card.style.borderTop = \`3px solid \${customColor}\`;
      }

      const tableDisplay = entity.tableName ? (entity.schemaName ? entity.schemaName + '.' + entity.tableName : entity.tableName) : entity.name;

      // Count visible vs total
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

      // Pointer-based High Performance Dragging
      header.addEventListener('pointerdown', e => {
        if (e.button !== 0 || e.target.closest('.card-actions')) return;
        draggedCard = card;
        header.setPointerCapture(e.pointerId);
        card.classList.add('dragging');
        card.style.zIndex = '100';

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
          const currentCard = btn.closest('.table-card');
          const currentLeft = parseInt(currentCard.style.left, 10) || 100;
          const currentTop = parseInt(currentCard.style.top, 10) || 100;
          
          if (!activePositions[targetEntity]) {
            const slot = findFreeCanvasSlot(currentLeft + 360, currentTop);
            activePositions[targetEntity] = {
              x: slot.x,
              y: slot.y
            };
            renderEntityList(searchBox.value);
            renderCanvas();
          }
        }
      });
    });

    // Populate layout caches and render initial SVG links
    requestAnimationFrame(() => {
      activeNames.forEach(cacheCardLayout);
      buildAllSvgElements();
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

    // Make inspector header draggable anywhere on screen
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

    menu.querySelectorAll('.color-dot').forEach(dot => {
      dot.addEventListener('click', () => {
        const hex = dot.dataset.hex;
        colorByEntity[entity.name] = hex;
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

    let x1, y1, x2, y2, cx1, cy1, cx2, cy2;

    if (fromPos.x + fromSize.width + 40 <= toPos.x) {
      x1 = fromPos.x + fromSize.width;
      y1 = fromPos.y + fromRowOffsetY;
      x2 = toPos.x;
      y2 = toPos.y + toRowOffsetY;

      const dx = Math.max(50, (x2 - x1) * 0.45);
      cx1 = x1 + dx;
      cy1 = y1;
      cx2 = x2 - dx;
      cy2 = y2;
    } else if (toPos.x + toSize.width + 40 <= fromPos.x) {
      x1 = fromPos.x;
      y1 = fromPos.y + fromRowOffsetY;
      x2 = toPos.x + toSize.width;
      y2 = toPos.y + toRowOffsetY;

      const dx = Math.max(50, (x1 - x2) * 0.45);
      cx1 = x1 - dx;
      cy1 = y1;
      cx2 = x2 + dx;
      cy2 = y2;
    } else {
      x1 = fromPos.x + fromSize.width;
      y1 = fromPos.y + fromRowOffsetY;
      x2 = toPos.x + toSize.width;
      y2 = toPos.y + toRowOffsetY;

      const offsetDist = Math.max(70, Math.abs(y2 - y1) * 0.3);
      cx1 = Math.max(x1, x2) + offsetDist;
      cy1 = y1;
      cx2 = Math.max(x1, x2) + offsetDist;
      cy2 = y2;
    }

    return {
      pathData: \`M \${x1} \${y1} C \${cx1} \${cy1}, \${cx2} \${cy2}, \${x2} \${y2}\`,
      x1, y1, x2, y2
    };
  }

  // Build SVG Elements once
  function buildAllSvgElements() {
    linksSvg.innerHTML = '';
    const activeNames = new Set(Object.keys(activePositions));

    for (const rel of allRelationships) {
      if (activeNames.has(rel.fromEntity) && activeNames.has(rel.toEntity)) {
        const geom = computeRelGeometry(rel);
        if (!geom) continue;

        const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        group.id = 'rel-g-' + rel.id;

        // Hitbox
        const hitbox = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        hitbox.setAttribute('d', geom.pathData);
        hitbox.setAttribute('class', 'rel-hitbox');
        hitbox.dataset.relId = rel.id;
        hitbox.addEventListener('click', e => {
          e.stopPropagation();
          openRelationshipInspector(rel, e.clientX, e.clientY);
        });
        group.appendChild(hitbox);

        // Path
        const isSelected = activeSelectedRelId === rel.id;
        const pathEl = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        pathEl.setAttribute('d', geom.pathData);
        pathEl.setAttribute('class', 'link-path' + (isSelected ? ' selected' : ''));
        pathEl.dataset.relId = rel.id;
        pathEl.addEventListener('click', e => {
          e.stopPropagation();
          openRelationshipInspector(rel, e.clientX, e.clientY);
        });
        group.appendChild(pathEl);

        // Endpoints
        const c1 = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        c1.setAttribute('cx', geom.x1);
        c1.setAttribute('cy', geom.y1);
        c1.setAttribute('r', 3.5);
        c1.setAttribute('class', 'link-endpoint');
        c1.setAttribute('fill', isSelected ? '#38bdf8' : '#3b82f6');
        group.appendChild(c1);

        const c2 = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        c2.setAttribute('cx', geom.x2);
        c2.setAttribute('cy', geom.y2);
        c2.setAttribute('r', 4.5);
        c2.setAttribute('class', 'link-crowfoot');
        c2.setAttribute('fill', isSelected ? '#38bdf8' : '#3b82f6');
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
  }

  function scheduleSvgUpdate() {
    if (!rafScheduled) {
      rafScheduled = true;
      requestAnimationFrame(updateSvgLinksInPlace);
    }
  }

  // Pan & Zoom
  function applyTransform() {
    canvasTransform.style.transform = \`translate3d(\${panX}px, \${panY}px, 0) scale(\${zoom})\`;
    zoomDisplay.textContent = Math.round(zoom * 100) + '%';
  }

  viewport.addEventListener('wheel', e => {
    const scrollableTarget = e.target.closest('.card-body, .popover-list, .entity-list, .rel-inspector-body');

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
    }
  }, { passive: false });

  viewport.addEventListener('pointerdown', e => {
    if (e.target === viewport || e.target === canvasTransform || e.target === linksSvg || e.target.closest('#emptyPrompt')) {
      if (e.button === 0 || e.button === 1) {
        isPanning = true;
        viewport.setPointerCapture(e.pointerId);
        startPanX = e.clientX - panX;
        startPanY = e.clientY - panY;
        viewport.style.cursor = 'grabbing';
        closeAllPopovers();
      }
    }
  });

  window.addEventListener('pointermove', e => {
    if (isPanning) {
      panX = e.clientX - startPanX;
      panY = e.clientY - startPanY;
      applyTransform();
    } else if (draggedCard) {
      const rect = viewport.getBoundingClientRect();
      const newX = (e.clientX - rect.left - panX) / zoom - dragOffsetX;
      const newY = (e.clientY - rect.top - panY) / zoom - dragOffsetY;

      const roundedX = Math.round(newX);
      const roundedY = Math.round(newY);

      draggedCard.style.left = roundedX + 'px';
      draggedCard.style.top = roundedY + 'px';

      const entityName = draggedCard.querySelector('.card-header').dataset.entityName;
      activePositions[entityName] = { x: roundedX, y: roundedY };

      scheduleSvgUpdate();
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
    if (draggedCard) {
      draggedCard.classList.remove('dragging');
      draggedCard.style.zIndex = '2';
      draggedCard = null;
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

  // Scope-Aware Auto Layout
  function autoLayoutEntities(explicitEntities) {
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
    if (currentCol.length === 0) {
      currentCol = [targetEntities[0].name];
    }

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
    if (remaining.length > 0) {
      columns.push(remaining);
    }

    const colWidth = 440;
    const rowHeight = 380;

    columns.forEach((colEntities, colIdx) => {
      colEntities.forEach((name, rowIdx) => {
        activePositions[name] = {
          x: 60 + colIdx * colWidth,
          y: 60 + rowIdx * rowHeight
        };
      });
    });
  }

  // Toolbar Actions
  document.getElementById('btnNew').addEventListener('click', async () => {
    activePositions = {};
    minimizedCards.clear();
    hiddenColumnsByEntity = {};
    colorByEntity = {};
    activeSelectedRelId = null;
    currentDiagramName = 'New Diagram';
    renderEntityList(searchBox.value);
    renderCanvas();
  });

  document.getElementById('btnSave').addEventListener('click', () => {
    const payload = getSerializablePositions();
    vscode.postMessage({
      type: 'saveDiagram',
      name: \`\${activeDbContext}_\${currentDiagramName}\`,
      positions: payload
    });
  });

  document.getElementById('btnAutoLayout').addEventListener('click', () => {
    autoLayoutEntities();
    renderEntityList(searchBox.value);
    renderCanvas();
  });

  document.getElementById('btnExportMermaid').addEventListener('click', () => {
    let mermaid = 'erDiagram\\n';
    const activeNames = new Set(Object.keys(activePositions));

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
      if (activeNames.has(rel.fromEntity) && activeNames.has(rel.toEntity)) {
        mermaid += \`  \${rel.fromEntity} ||--o{ \${rel.toEntity} : contains\\n\`;
      }
    }

    navigator.clipboard.writeText(mermaid).then(() => {
      vscode.postMessage({
        type: 'saveDiagram',
        name: 'mermaid_copied',
        positions: {}
      });
      alert('Mermaid ERD code copied to clipboard!');
    });
  });

  document.getElementById('btnZoomIn').addEventListener('click', () => {
    zoom = Math.min(2.5, zoom * 1.2);
    applyTransform();
  });

  document.getElementById('btnZoomOut').addEventListener('click', () => {
    zoom = Math.max(0.3, zoom / 1.2);
    applyTransform();
  });

  document.getElementById('btnZoomReset').addEventListener('click', () => {
    zoom = 1.0;
    panX = 40;
    panY = 40;
    applyTransform();
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
