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

  // Sidebar Resizing State
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
        activePositions = msg.activePositions || {};
        currentDiagramName = msg.activeDiagramName || 'Default';

        updateDbContextSelect();
        updateDiagramSelect(msg.savedDiagramNames || []);
        updateSidebarTitle();
        renderEntityList();
        renderCanvas();
        break;

      case 'diagramLoaded':
        activePositions = msg.activePositions || {};
        currentDiagramName = msg.diagramName || 'Default';
        renderEntityList();
        renderCanvas();
        break;

      case 'diagramListUpdated':
        updateDiagramSelect(msg.savedDiagramNames || []);
        break;
    }
  });

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

      // Auto-place first 3 entities
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

      // Drag start from sidebar
      if (!isInDiagram) {
        item.addEventListener('dragstart', e => {
          e.dataTransfer.setData('text/plain', entity.name);
        });
      }

      // Click action button
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

      // Click item to add or focus
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

  // Find free non-overlapping position near a reference point
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

  // Add All Button Click (In Sidebar)
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

  // Add Entity to Canvas
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
      posY = (clientY - rect.top - panY) / zoom;
    } else {
      const slot = findFreeCanvasSlot(80, 80);
      posX = slot.x;
      posY = slot.y;
    }

    activePositions[entityName] = { x: Math.round(posX), y: Math.round(posY) };
    renderEntityList(searchBox.value);
    renderCanvas();
  }

  // Remove Entity from Canvas
  function removeEntityFromCanvas(entityName) {
    delete activePositions[entityName];
    minimizedCards.delete(entityName);
    renderEntityList(searchBox.value);
    renderCanvas();
  }

  // Render Canvas (Table Cards + SVG Links)
  function renderCanvas() {
    cardsLayer.innerHTML = '';
    const activeNames = Object.keys(activePositions);

    if (activeNames.length === 0) {
      emptyPrompt.style.display = 'flex';
      linksSvg.innerHTML = '';
      return;
    }

    emptyPrompt.style.display = 'none';

    // Render Table Cards
    for (const name of activeNames) {
      const entity = allEntities.find(e => e.name === name);
      if (!entity) continue;

      const pos = activePositions[name];
      const isMinimized = minimizedCards.has(entity.name);

      const card = document.createElement('div');
      card.className = 'table-card' + (isMinimized ? ' minimized' : '');
      card.id = 'card-' + entity.name;
      card.style.left = pos.x + 'px';
      card.style.top = pos.y + 'px';

      const tableDisplay = entity.tableName ? (entity.schemaName ? entity.schemaName + '.' + entity.tableName : entity.tableName) : entity.name;

      card.innerHTML = \`
        <div class="card-header" data-entity-name="\${escapeHtml(entity.name)}">
          <div class="card-title-group">
            <span class="card-title">
              <svg class="icon-svg" style="color: var(--pk-color); flex-shrink: 0;" viewBox="0 0 16 16" fill="currentColor">
                <path d="M2 3.5a1.5 1.5 0 0 1 1.5-1.5h9A1.5 1.5 0 0 1 14 3.5v9a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 12.5v-9zm1.5-.5a.5.5 0 0 0-.5.5v1h10v-1a.5.5 0 0 0-.5-.5h-9z"/>
              </svg>
              \${escapeHtml(entity.name)}
            </span>
            <span class="card-subtitle">\${escapeHtml(tableDisplay)}</span>
          </div>
          <div class="card-actions">
            <button class="card-action-btn card-minimize-btn" title="\${isMinimized ? 'Expand' : 'Minimize'}">\${isMinimized ? '▢' : '—'}</button>
            <button class="card-action-btn card-close-btn" title="Remove from Diagram">✕</button>
          </div>
        </div>
        <div class="card-body">
          \${entity.properties.map(p => renderPropertyRow(entity, p)).join('')}
        </div>
      \`;

      // Header double-click to toggle minimize
      const header = card.querySelector('.card-header');
      header.addEventListener('dblclick', e => {
        e.stopPropagation();
        toggleCardMinimize(entity.name);
      });

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

      // Card dragging
      header.addEventListener('mousedown', e => {
        if (e.button !== 0 || e.target.closest('.card-actions')) return;
        draggedCard = card;
        const rect = card.getBoundingClientRect();
        dragOffsetX = (e.clientX - rect.left) / zoom;
        dragOffsetY = (e.clientY - rect.top) / zoom;
        card.style.zIndex = '100';
        e.stopPropagation();
      });

      // Resize observer to update SVG links when card width is dragged
      if (window.ResizeObserver) {
        const ro = new ResizeObserver(() => {
          updateSvgLinks();
        });
        ro.observe(card);
      }

      cardsLayer.appendChild(card);
    }

    // Attach expandable [+] buttons inside card rows
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

    // Redraw SVG Crow's Foot connection lines
    requestAnimationFrame(updateSvgLinks);
  }

  function toggleCardMinimize(entityName) {
    if (minimizedCards.has(entityName)) {
      minimizedCards.delete(entityName);
    } else {
      minimizedCards.add(entityName);
    }
    renderCanvas();
  }

  function renderPropertyRow(entity, prop) {
    // Check Active Column Filter Mode
    if (activeFilterMode === 'keys') {
      if (!prop.isPrimaryKey && !prop.isForeignKey) {
        return '';
      }
    } else if (activeFilterMode === 'no-audit') {
      if (!prop.isPrimaryKey && !prop.isForeignKey && AUDIT_FIELD_NAMES.has(prop.name.toLowerCase())) {
        return '';
      }
    }

    let badge = '';
    let rowClass = 'prop-row';
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
        <div style="display: flex; align-items: center; gap: 4px;">
          <span class="prop-type">\${escapeHtml(prop.type)}</span>
          \${expandBtn}
        </div>
      </div>
    \`;
  }

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

    // 1. Calculate Exact Row-Level Anchor Y offsets
    let fromRowOffsetY = fromMinimized ? 18 : 42;
    let toRowOffsetY = toMinimized ? 18 : 42;

    if (!fromMinimized) {
      const fromTargetProp = rel.fromProperty || 'Id';
      const fromRowEl = fromCard.querySelector(\`[data-prop-name="\${fromTargetProp}"]\`);
      if (fromRowEl) {
        fromRowOffsetY = fromRowEl.offsetTop + fromRowEl.offsetHeight / 2;
      } else {
        const firstPk = fromCard.querySelector('.prop-row.pk');
        if (firstPk) fromRowOffsetY = firstPk.offsetTop + firstPk.offsetHeight / 2;
      }
    }

    if (!toMinimized) {
      const toTargetProp = rel.toProperty || \`\${rel.fromEntity}Id\`;
      const toRowEl = toCard.querySelector(\`[data-prop-name="\${toTargetProp}"]\`);
      if (toRowEl) {
        toRowOffsetY = toRowEl.offsetTop + toRowEl.offsetHeight / 2;
      } else {
        const firstFk = toCard.querySelector('.prop-row.fk');
        if (firstFk) toRowOffsetY = firstFk.offsetTop + firstFk.offsetHeight / 2;
      }
    }

    fromRowOffsetY = Math.max(16, Math.min(fromHeight - 8, fromRowOffsetY));
    toRowOffsetY = Math.max(16, Math.min(toHeight - 8, toRowOffsetY));

    // 2. Determine Smart Side Routing
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

    // 3. Render Smooth Cubic Bezier Path
    const pathData = \`M \${x1} \${y1} C \${cx1} \${cy1}, \${cx2} \${cy2}, \${x2} \${y2}\`;

    const pathEl = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    pathEl.setAttribute('d', pathData);
    pathEl.setAttribute('class', 'link-path');
    pathEl.setAttribute('fill', 'none');
    pathEl.setAttribute('stroke', '#3b82f6');
    pathEl.setAttribute('stroke-width', '2');
    linksSvg.appendChild(pathEl);

    // One indicator (from 1)
    const circle1 = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle1.setAttribute('cx', x1);
    circle1.setAttribute('cy', y1);
    circle1.setAttribute('r', 3.5);
    circle1.setAttribute('class', 'link-endpoint');
    circle1.setAttribute('fill', '#3b82f6');
    linksSvg.appendChild(circle1);

    // Many indicator (Crow's Foot at toEntity)
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

  // Pan Canvas
  viewport.addEventListener('mousedown', e => {
    if (e.target === viewport || e.target === canvasTransform || e.target === linksSvg || e.target.closest('#emptyPrompt')) {
      if (e.button === 0 || e.button === 1) {
        isPanning = true;
        startPanX = e.clientX - panX;
        startPanY = e.clientY - panY;
        viewport.style.cursor = 'grabbing';
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

  // Drag & Drop from Sidebar to Canvas
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

    // Calculate In-Degree (how many FKs point to this entity)
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

    // Topological Column Layers
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
    currentDiagramName = 'New Diagram';
    renderEntityList(searchBox.value);
    renderCanvas();
  });

  document.getElementById('btnSave').addEventListener('click', () => {
    vscode.postMessage({
      type: 'saveDiagram',
      name: \`\${activeDbContext}_\${currentDiagramName}\`,
      positions: activePositions
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
      mermaid += \`  \${entity.name} {\\n\`;
      for (const p of entity.properties) {
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
