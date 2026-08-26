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
  let activePopoverEntity = null;

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

  let isResizingSidebar = false;

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
    sidebarResizer.addEventListener('mousedown', e => {
      isResizingSidebar = true;
      sidebarResizer.classList.add('resizing');
      document.body.style.cursor = 'col-resize';
      e.preventDefault();
    });

    window.addEventListener('mousemove', e => {
      if (isResizingSidebar) {
        const newWidth = Math.max(200, Math.min(650, e.clientX));
        sidebar.style.width = newWidth + 'px';
      }
    });

    window.addEventListener('mouseup', () => {
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
    closeAllPopovers();
    renderEntityList(searchBox.value);
    renderCanvas();
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
            <button class="card-action-btn card-columns-btn" title="Manage Columns (Show/Hide)">👁️</button>
            <button class="card-action-btn card-minimize-btn" title="\${isMinimized ? 'Expand' : 'Minimize'}">\${isMinimized ? '▢' : '—'}</button>
            <button class="card-action-btn card-close-btn" title="Remove from Diagram">✕</button>
          </div>
        </div>
        <div class="card-body">
          \${propRowsHtml}
        </div>
        \${hiddenCount > 0 ? \`<div class="card-hidden-footer" title="Click to manage hidden columns"><span>👁️ + \${hiddenCount} hidden columns</span><span style="opacity:0.7;">manage ▸</span></div>\` : ''}
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

      // Card dragging
      header.addEventListener('mousedown', e => {
        if (e.button !== 0 || e.target.closest('.card-actions')) return;
        draggedCard = card;
        const rect = card.getBoundingClientRect();
        dragOffsetX = (e.clientX - rect.left) / zoom;
        dragOffsetY = (e.clientY - rect.top) / zoom;
        card.style.zIndex = '100';
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

    requestAnimationFrame(updateSvgLinks);
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
          <button class="prop-eye-btn" data-prop-name="\${escapeHtml(prop.name)}" title="Hide column">👁️</button>
          \${expandBtn}
        </div>
      </div>
    \`;
  }

  // Floating Column Manager Popover
  function openColumnManagerPopover(entity, card, triggerBtn) {
    closeAllPopovers();

    const popover = document.createElement('div');
    popover.className = 'columns-popover';
    popover.id = 'activePopover';

    if (!hiddenColumnsByEntity[entity.name]) {
      hiddenColumnsByEntity[entity.name] = new Set();
    }
    const hiddenSet = hiddenColumnsByEntity[entity.name];

    popover.innerHTML = \`
      <div class="popover-header">
        <span>👁️ Manage Columns</span>
        <span style="font-size: 10px; color: var(--text-muted);">\${entity.properties.length} total</span>
      </div>
      <div class="popover-search">
        <input type="text" placeholder="Filter column name..." />
      </div>
      <div class="popover-list">
        \${entity.properties.map(p => {
          const isChecked = !hiddenSet.has(p.name);
          const keyLabel = p.isPrimaryKey ? ' (PK)' : (p.isForeignKey ? ' (FK)' : '');
          return \`
            <label class="popover-item" data-prop-name="\${escapeHtml(p.name)}">
              <div style="display:flex; align-items:center; gap:6px; overflow:hidden;">
                <input type="checkbox" \${isChecked ? 'checked' : ''} style="cursor:pointer;" />
                <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap; \${p.isPrimaryKey ? 'color:var(--pk-color);font-weight:600;' : ''}">
                  \${escapeHtml(p.name)}\${keyLabel}
                </span>
              </div>
              <span style="font-size:10px; color:var(--type-color); font-family:monospace;">\${escapeHtml(p.type)}</span>
            </label>
          \`;
        }).join('')}
      </div>
      <div class="popover-actions">
        <button class="popover-btn" id="popShowAll">Show All</button>
        <button class="popover-btn" id="popKeysOnly">Keys Only</button>
        <button class="popover-btn" id="popHideAudit">Hide Audit</button>
      </div>
    \`;

    // Filter input search inside popover
    const searchInput = popover.querySelector('.popover-search input');
    searchInput.addEventListener('input', () => {
      const q = searchInput.value.trim().toLowerCase();
      popover.querySelectorAll('.popover-item').forEach(item => {
        const name = item.dataset.propName.toLowerCase();
        item.style.display = name.includes(q) ? 'flex' : 'none';
      });
    });

    // Checkbox toggles
    popover.querySelectorAll('.popover-item input[type="checkbox"]').forEach(chk => {
      chk.addEventListener('change', e => {
        const propName = chk.closest('.popover-item').dataset.propName;
        if (chk.checked) {
          hiddenSet.delete(propName);
        } else {
          hiddenSet.add(propName);
        }
        renderCanvas();
      });
    });

    // Quick action buttons
    popover.querySelector('#popShowAll').addEventListener('click', () => {
      hiddenSet.clear();
      renderCanvas();
    });

    popover.querySelector('#popKeysOnly').addEventListener('click', () => {
      hiddenSet.clear();
      entity.properties.forEach(p => {
        if (!p.isPrimaryKey && !p.isForeignKey) {
          hiddenSet.add(p.name);
        }
      });
      renderCanvas();
    });

    popover.querySelector('#popHideAudit').addEventListener('click', () => {
      entity.properties.forEach(p => {
        if (!p.isPrimaryKey && !p.isForeignKey && AUDIT_FIELD_NAMES.has(p.name.toLowerCase())) {
          hiddenSet.add(p.name);
        }
      });
      renderCanvas();
    });

    card.appendChild(popover);
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
        <span>👁️</span> Manage Columns...
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
  }

  window.addEventListener('click', e => {
    if (!e.target.closest('.columns-popover') && !e.target.closest('.card-columns-btn') && !e.target.closest('.card-hidden-footer')) {
      const p = document.getElementById('activePopover');
      if (p) p.remove();
    }
    if (!e.target.closest('.card-context-menu')) {
      const m = document.getElementById('activeContextMenu');
      if (m) m.remove();
    }
  });

  // Draw Crow's Foot SVG Connectors with Exact Row-Level Pin Anchors
  function updateSvgLinks() {
    linksSvg.innerHTML = '';
    const activeNames = new Set(Object.keys(activePositions));

    for (const rel of allRelationships) {
      if (activeNames.has(rel.fromEntity) && activeNames.has(rel.toEntity)) {
        drawCrowFootLink(rel);
      }
    }
  }

  function drawCrowFootLink(rel) {
    const fromCard = document.getElementById('card-' + rel.fromEntity);
    const toCard = document.getElementById('card-' + rel.toEntity);
    if (!fromCard || !toCard) return;

    const fromPos = activePositions[rel.fromEntity];
    const toPos = activePositions[rel.toEntity];
    if (!fromPos || !toPos) return;

    const fromMinimized = fromCard.classList.contains('minimized');
    const toMinimized = toCard.classList.contains('minimized');

    const fromWidth = fromCard.offsetWidth || 310;
    const fromHeight = fromCard.offsetHeight || 200;
    const toWidth = toCard.offsetWidth || 310;
    const toHeight = toCard.offsetHeight || 200;

    let fromRowOffsetY = fromMinimized ? 18 : 42;
    let toRowOffsetY = toMinimized ? 18 : 42;

    if (!fromMinimized) {
      const fromTargetProp = rel.fromProperty || 'Id';
      const fromRowEl = fromCard.querySelector(\`[data-prop-name="\${fromTargetProp}"]:not(.hidden-prop)\`);
      if (fromRowEl) {
        fromRowOffsetY = fromRowEl.offsetTop + fromRowEl.offsetHeight / 2;
      } else {
        const firstPk = fromCard.querySelector('.prop-row.pk:not(.hidden-prop)');
        if (firstPk) {
          fromRowOffsetY = firstPk.offsetTop + firstPk.offsetHeight / 2;
        } else {
          fromRowOffsetY = 20; // Fallback to header anchor if row is hidden
        }
      }
    }

    if (!toMinimized) {
      const toTargetProp = rel.toProperty || \`\${rel.fromEntity}Id\`;
      const toRowEl = toCard.querySelector(\`[data-prop-name="\${toTargetProp}"]:not(.hidden-prop)\`);
      if (toRowEl) {
        toRowOffsetY = toRowEl.offsetTop + toRowEl.offsetHeight / 2;
      } else {
        const firstFk = toCard.querySelector('.prop-row.fk:not(.hidden-prop)');
        if (firstFk) {
          toRowOffsetY = firstFk.offsetTop + firstFk.offsetHeight / 2;
        } else {
          toRowOffsetY = 20; // Fallback to header anchor if row is hidden
        }
      }
    }

    fromRowOffsetY = Math.max(16, Math.min(fromHeight - 8, fromRowOffsetY));
    toRowOffsetY = Math.max(16, Math.min(toHeight - 8, toRowOffsetY));

    let x1, y1, x2, y2, cx1, cy1, cx2, cy2;

    if (fromPos.x + fromWidth + 40 <= toPos.x) {
      x1 = fromPos.x + fromWidth;
      y1 = fromPos.y + fromRowOffsetY;
      x2 = toPos.x;
      y2 = toPos.y + toRowOffsetY;

      const dx = Math.max(50, (x2 - x1) * 0.45);
      cx1 = x1 + dx;
      cy1 = y1;
      cx2 = x2 - dx;
      cy2 = y2;
    } else if (toPos.x + toWidth + 40 <= fromPos.x) {
      x1 = fromPos.x;
      y1 = fromPos.y + fromRowOffsetY;
      x2 = toPos.x + toWidth;
      y2 = toPos.y + toRowOffsetY;

      const dx = Math.max(50, (x1 - x2) * 0.45);
      cx1 = x1 - dx;
      cy1 = y1;
      cx2 = x2 + dx;
      cy2 = y2;
    } else {
      x1 = fromPos.x + fromWidth;
      y1 = fromPos.y + fromRowOffsetY;
      x2 = toPos.x + toWidth;
      y2 = toPos.y + toRowOffsetY;

      const offsetDist = Math.max(70, Math.abs(y2 - y1) * 0.3);
      cx1 = Math.max(x1, x2) + offsetDist;
      cy1 = y1;
      cx2 = Math.max(x1, x2) + offsetDist;
      cy2 = y2;
    }

    const pathData = \`M \${x1} \${y1} C \${cx1} \${cy1}, \${cx2} \${cy2}, \${x2} \${y2}\`;

    const pathEl = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    pathEl.setAttribute('d', pathData);
    pathEl.setAttribute('class', 'link-path');
    pathEl.setAttribute('fill', 'none');
    pathEl.setAttribute('stroke', '#3b82f6');
    pathEl.setAttribute('stroke-width', '2');
    linksSvg.appendChild(pathEl);

    const circle1 = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle1.setAttribute('cx', x1);
    circle1.setAttribute('cy', y1);
    circle1.setAttribute('r', 3.5);
    circle1.setAttribute('class', 'link-endpoint');
    circle1.setAttribute('fill', '#3b82f6');
    linksSvg.appendChild(circle1);

    const circle2 = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle2.setAttribute('cx', x2);
    circle2.setAttribute('cy', y2);
    circle2.setAttribute('r', 4.5);
    circle2.setAttribute('class', 'link-crowfoot');
    circle2.setAttribute('fill', '#3b82f6');
    linksSvg.appendChild(circle2);
  }

  // Pan & Zoom
  function applyTransform() {
    canvasTransform.style.transform = \`translate(\${panX}px, \${panY}px) scale(\${zoom})\`;
    zoomDisplay.textContent = Math.round(zoom * 100) + '%';
  }

  viewport.addEventListener('wheel', e => {
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
  }, { passive: false });

  viewport.addEventListener('mousedown', e => {
    if (e.target === viewport || e.target === canvasTransform || e.target === linksSvg || e.target.closest('#emptyPrompt')) {
      if (e.button === 0 || e.button === 1) {
        isPanning = true;
        startPanX = e.clientX - panX;
        startPanY = e.clientY - panY;
        viewport.style.cursor = 'grabbing';
        closeAllPopovers();
      }
    }
  });

  window.addEventListener('mousemove', e => {
    if (isPanning) {
      panX = e.clientX - startPanX;
      panY = e.clientY - startPanY;
      applyTransform();
    } else if (draggedCard) {
      const rect = viewport.getBoundingClientRect();
      const newX = (e.clientX - rect.left - panX) / zoom - dragOffsetX;
      const newY = (e.clientY - rect.top - panY) / zoom - dragOffsetY;

      draggedCard.style.left = Math.round(newX) + 'px';
      draggedCard.style.top = Math.round(newY) + 'px';

      const entityName = draggedCard.querySelector('.card-header').dataset.entityName;
      activePositions[entityName] = { x: Math.round(newX), y: Math.round(newY) };

      updateSvgLinks();
    }
  });

  window.addEventListener('mouseup', () => {
    if (isPanning) {
      isPanning = false;
      viewport.style.cursor = 'grab';
    }
    if (draggedCard) {
      draggedCard.style.zIndex = '2';
      draggedCard = null;
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
