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
  let currentDiagramName = 'Default';
  let zoom = 1.0;
  let panX = 40;
  let panY = 40;
  let isPanning = false;
  let startPanX = 0;
  let startPanY = 0;
  let draggedCard = null;
  let dragOffsetX = 0;
  let dragOffsetY = 0;

  // DOM Elements
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

      // Auto-place first 3 entities
      if (allEntities.length > 0) {
        allEntities.slice(0, 3).forEach((e, idx) => {
          activePositions[e.name] = { x: 60 + idx * 300, y: 60 };
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
      const item = document.createElement('div');
      item.className = 'entity-list-item' + (activePositions[entity.name] ? ' in-diagram' : '');
      item.draggable = true;
      item.dataset.entityName = entity.name;

      const tableLabel = entity.tableName ? (entity.schemaName ? entity.schemaName + '.' + entity.tableName : entity.tableName) : '';

      item.innerHTML = \`
        <div class="entity-item-info">
          <span style="color: var(--pk-color);">🔑</span>
          <div style="display: flex; flex-direction: column; overflow: hidden;">
            <span class="entity-item-name">\${escapeHtml(entity.name)}</span>
            \${tableLabel ? \`<span style="font-size: 10px; color: var(--text-muted);">\${escapeHtml(tableLabel)}</span>\` : ''}
          </div>
        </div>
        <div style="display: flex; align-items: center; gap: 4px;">
          <span class="entity-item-badge">\${entity.properties.length} cols</span>
          <button class="entity-add-btn" title="Add to Diagram">➕</button>
        </div>
      \`;

      // Drag start from sidebar
      item.addEventListener('dragstart', e => {
        e.dataTransfer.setData('text/plain', entity.name);
      });

      // Click add button
      const addBtn = item.querySelector('.entity-add-btn');
      addBtn.addEventListener('click', e => {
        e.stopPropagation();
        addEntityToCanvas(entity.name);
      });

      // Double-click to add
      item.addEventListener('dblclick', () => {
        addEntityToCanvas(entity.name);
      });

      entityListEl.appendChild(item);
    }
  }

  // Add All Button Click
  if (btnAddAllToCanvas) {
    btnAddAllToCanvas.addEventListener('click', () => {
      let currentCount = Object.keys(activePositions).length;
      let added = 0;

      for (const entity of allEntities) {
        if (!activePositions[entity.name]) {
          const idx = currentCount + added;
          const posX = 60 + (idx % 3) * 320;
          const posY = 60 + Math.floor(idx / 3) * 340;
          activePositions[entity.name] = { x: Math.round(posX), y: Math.round(posY) };
          added++;
        }
      }

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
      // Already on canvas, just highlight
      const card = document.getElementById('card-' + entityName);
      if (card) {
        card.classList.add('selected');
        setTimeout(() => card.classList.remove('selected'), 1000);
      }
      return;
    }

    let posX = 100;
    let posY = 100;

    if (clientX !== undefined && clientY !== undefined) {
      const rect = viewport.getBoundingClientRect();
      posX = (clientX - rect.left - panX) / zoom;
      posY = (clientY - rect.top - panY) / zoom;
    } else {
      // Auto position offset
      const count = Object.keys(activePositions).length;
      posX = 60 + (count % 3) * 320;
      posY = 60 + Math.floor(count / 3) * 340;
    }

    activePositions[entityName] = { x: Math.round(posX), y: Math.round(posY) };
    renderEntityList(searchBox.value);
    renderCanvas();
  }

  // Remove Entity from Canvas
  function removeEntityFromCanvas(entityName) {
    delete activePositions[entityName];
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
      const card = document.createElement('div');
      card.className = 'table-card';
      card.id = 'card-' + entity.name;
      card.style.left = pos.x + 'px';
      card.style.top = pos.y + 'px';

      const tableDisplay = entity.tableName ? (entity.schemaName ? entity.schemaName + '.' + entity.tableName : entity.tableName) : entity.name;

      card.innerHTML = \`
        <div class="card-header" data-entity-name="\${escapeHtml(entity.name)}">
          <div class="card-title-group">
            <span class="card-title">
              <span style="color: var(--pk-color);">🔑</span> \${escapeHtml(entity.name)}
            </span>
            <span class="card-subtitle">\${escapeHtml(tableDisplay)}</span>
          </div>
          <button class="card-close-btn" title="Remove from Diagram">✕</button>
        </div>
        <div class="card-body">
          \${entity.properties.map(p => renderPropertyRow(entity, p)).join('')}
        </div>
      \`;

      // Header double-click to open C# code
      const header = card.querySelector('.card-header');
      header.addEventListener('dblclick', e => {
        e.stopPropagation();
        vscode.postMessage({
          type: 'openFile',
          filePath: entity.filePath,
          line: entity.line
        });
      });

      // Close button
      const closeBtn = card.querySelector('.card-close-btn');
      closeBtn.addEventListener('click', e => {
        e.stopPropagation();
        removeEntityFromCanvas(entity.name);
      });

      // Card dragging
      header.addEventListener('mousedown', e => {
        if (e.button !== 0) return;
        draggedCard = card;
        const rect = card.getBoundingClientRect();
        dragOffsetX = (e.clientX - rect.left) / zoom;
        dragOffsetY = (e.clientY - rect.top) / zoom;
        card.style.zIndex = '100';
        e.stopPropagation();
      });

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
            activePositions[targetEntity] = {
              x: currentLeft + 340,
              y: currentTop
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

  function renderPropertyRow(entity, prop) {
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
        expandBtn = \`<button class="prop-expand-btn" data-target-entity="\${escapeHtml(prop.foreignKeyTargetEntity)}" title="Add \${escapeHtml(prop.foreignKeyTargetEntity)} to canvas">➕</button>\`;
      }
    } else if (prop.isNavigation) {
      badge = '<span class="prop-badge nav">NAV</span>';
      if (prop.navigationTargetEntity && allEntities.some(e => e.name === prop.navigationTargetEntity)) {
        expandBtn = \`<button class="prop-expand-btn" data-target-entity="\${escapeHtml(prop.navigationTargetEntity)}" title="Add \${escapeHtml(prop.navigationTargetEntity)} to canvas">➕</button>\`;
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

  // Draw Crow's Foot SVG Connectors
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

    const fromWidth = fromCard.offsetWidth;
    const fromHeight = fromCard.offsetHeight;
    const toWidth = toCard.offsetWidth;
    const toHeight = toCard.offsetHeight;

    // Anchor points: left or right side depending on relative position
    let x1, y1, x2, y2;
    if (fromPos.x + fromWidth / 2 < toPos.x + toWidth / 2) {
      // From right to Left
      x1 = fromPos.x + fromWidth;
      y1 = fromPos.y + Math.min(60, fromHeight / 2);
      x2 = toPos.x;
      y2 = toPos.y + Math.min(60, toHeight / 2);
    } else {
      // From left to Right
      x1 = fromPos.x;
      y1 = fromPos.y + Math.min(60, fromHeight / 2);
      x2 = toPos.x + toWidth;
      y2 = toPos.y + Math.min(60, toHeight / 2);
    }

    // Cubic bezier curve path
    const dx = Math.abs(x2 - x1) * 0.5;
    const cx1 = x1 < x2 ? x1 + dx : x1 - dx;
    const cx2 = x1 < x2 ? x2 - dx : x2 + dx;

    const pathData = \`M \${x1} \${y1} C \${cx1} \${y1}, \${cx2} \${y2}, \${x2} \${y2}\`;

    const pathEl = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    pathEl.setAttribute('d', pathData);
    pathEl.setAttribute('class', 'link-path');
    linksSvg.appendChild(pathEl);

    // One indicator (from 1)
    const circle1 = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle1.setAttribute('cx', x1);
    circle1.setAttribute('cy', y1);
    circle1.setAttribute('r', 3);
    circle1.setAttribute('class', 'link-endpoint');
    linksSvg.appendChild(circle1);

    // Many indicator (Crow's Foot at toEntity)
    const circle2 = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle2.setAttribute('cx', x2);
    circle2.setAttribute('cy', y2);
    circle2.setAttribute('r', 4);
    circle2.setAttribute('class', 'link-crowfoot');
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
      draggedCard.style.zIndex = '1';
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

  // Toolbar Actions
  document.getElementById('btnNew').addEventListener('click', async () => {
    activePositions = {};
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
    const names = Object.keys(activePositions);
    names.forEach((name, idx) => {
      const posX = 60 + (idx % 3) * 320;
      const posY = 60 + Math.floor(idx / 3) * 340;
      activePositions[name] = { x: posX, y: posY };
    });
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
