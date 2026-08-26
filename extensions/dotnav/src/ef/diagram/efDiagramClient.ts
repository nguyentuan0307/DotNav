export function getEfDiagramClientScript(): string {
  return `
(function() {
  const vscode = acquireVsCodeApi();
  
  // State
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
  const diagramSelect = document.getElementById('diagramSelect');
  const emptyPrompt = document.getElementById('emptyPrompt');
  const zoomDisplay = document.getElementById('zoomDisplay');

  // Initialize
  window.addEventListener('message', event => {
    const msg = event.data;
    switch (msg.type) {
      case 'init':
        allEntities = msg.allEntities || [];
        allRelationships = msg.relationships || [];
        activePositions = msg.activePositions || {};
        currentDiagramName = msg.activeDiagramName || 'Default';
        updateDiagramSelect(msg.savedDiagramNames || []);
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
    vscode.postMessage({ type: 'loadDiagram', name: val });
  });

  // Render Sidebar Entity List
  function renderEntityList(filter = '') {
    entityListEl.innerHTML = '';
    const q = filter.trim().toLowerCase();

    const filtered = allEntities.filter(e => {
      if (!q) return true;
      return e.name.toLowerCase().includes(q) || (e.tableName && e.tableName.toLowerCase().includes(q));
    });

    for (const entity of filtered) {
      const item = document.createElement('div');
      item.className = 'entity-list-item' + (activePositions[entity.name] ? ' in-diagram' : '');
      item.draggable = true;
      item.dataset.entityName = entity.name;

      item.innerHTML = \`
        <div class="entity-item-info">
          <span style="color: var(--pk-color);">🔑</span>
          <span class="entity-item-name">\${escapeHtml(entity.name)}</span>
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
      posX = 60 + (count % 4) * 300;
      posY = 60 + Math.floor(count / 4) * 320;
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

      // Smart Expand Button on FK/Nav lines
      card.querySelectorAll('.col-expand-btn').forEach(btn => {
        btn.addEventListener('click', e => {
          e.stopPropagation();
          const target = btn.dataset.targetEntity;
          if (target) {
            // Position child near parent
            addEntityToCanvas(target, pos.x + 320, pos.y + 40);
          }
        });
      });

      // Drag Card
      header.addEventListener('mousedown', e => {
        if (e.button !== 0) return;
        draggedCard = card;
        const rect = card.getBoundingClientRect();
        dragOffsetX = (e.clientX - rect.left) / zoom;
        dragOffsetY = (e.clientY - rect.top) / zoom;
        card.classList.add('selected');
        e.stopPropagation();
      });

      cardsLayer.appendChild(card);
    }

    // Render Relationships
    updateConnectors();
    applyTransform();
  }

  function renderPropertyRow(entity, prop) {
    let icon = '<span class="col-icon-normal">📝</span>';
    let isPk = prop.isPrimaryKey;
    let isFk = prop.isForeignKey;
    let isNav = prop.isNavigation;

    if (isPk) icon = '<span class="col-icon-pk">🔑</span>';
    else if (isFk) icon = '<span class="col-icon-fk">🔗</span>';
    else if (isNav) icon = '<span class="col-icon-nav">🌐</span>';

    const expandBtn = (isFk && prop.foreignKeyTargetEntity && !activePositions[prop.foreignKeyTargetEntity])
      ? \`<button class="col-expand-btn" data-target-entity="\${escapeHtml(prop.foreignKeyTargetEntity)}" title="Add \${escapeHtml(prop.foreignKeyTargetEntity)} to Diagram">➕</button>\`
      : (isNav && prop.navigationTargetEntity && !activePositions[prop.navigationTargetEntity])
      ? \`<button class="col-expand-btn" data-target-entity="\${escapeHtml(prop.navigationTargetEntity)}" title="Add \${escapeHtml(prop.navigationTargetEntity)} to Diagram">➕</button>\`
      : '';

    return \`
      <div class="column-row">
        <div class="col-left">
          \${icon}
          <span class="col-name \${isPk ? 'pk' : ''}">\${escapeHtml(prop.name)}</span>
          <span class="col-type">\${escapeHtml(prop.type)}</span>
        </div>
        \${expandBtn}
      </div>
    \`;
  }

  // Update SVG Connectors
  function updateConnectors() {
    linksSvg.innerHTML = '';
    const activeNames = new Set(Object.keys(activePositions));

    for (const rel of allRelationships) {
      if (activeNames.has(rel.fromEntity) && activeNames.has(rel.toEntity)) {
        drawRelationshipLink(rel);
      }
    }
  }

  function drawRelationshipLink(rel) {
    const cardA = document.getElementById('card-' + rel.fromEntity);
    const cardB = document.getElementById('card-' + rel.toEntity);
    if (!cardA || !cardB) return;

    const posA = activePositions[rel.fromEntity];
    const posB = activePositions[rel.toEntity];
    const widthA = 260;
    const widthB = 260;
    const heightA = cardA.offsetHeight || 200;
    const heightB = cardB.offsetHeight || 200;

    // Calculate best anchor sides
    let x1, y1, x2, y2;
    if (posA.x + widthA < posB.x) {
      // A is left of B
      x1 = posA.x + widthA;
      y1 = posA.y + Math.min(heightA, 120);
      x2 = posB.x;
      y2 = posB.y + Math.min(heightB, 120);
    } else if (posB.x + widthB < posA.x) {
      // B is left of A
      x1 = posA.x;
      y1 = posA.y + Math.min(heightA, 120);
      x2 = posB.x + widthB;
      y2 = posB.y + Math.min(heightB, 120);
    } else {
      // Vertically stacked
      x1 = posA.x + widthA / 2;
      y1 = posA.y + heightA;
      x2 = posB.x + widthB / 2;
      y2 = posB.y;
    }

    const dx = Math.max(40, Math.abs(x2 - x1) * 0.5);
    const pathD = \`M \${x1} \${y1} C \${x1 + (x2 > x1 ? dx : -dx)} \${y1}, \${x2 + (x2 > x1 ? -dx : dx)} \${y2}, \${x2} \${y2}\`;

    const pathEl = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    pathEl.setAttribute('d', pathD);
    pathEl.setAttribute('class', 'rel-line');
    pathEl.innerHTML = \`<title>\${escapeHtml(rel.fromEntity)} (1) ➔ \${escapeHtml(rel.toEntity)} (∞)</title>\`;

    // Crow's foot circle markers
    const circleA = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circleA.setAttribute('cx', x1);
    circleA.setAttribute('cy', y1);
    circleA.setAttribute('r', '4');
    circleA.setAttribute('class', 'rel-marker');

    const circleB = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circleB.setAttribute('cx', x2);
    circleB.setAttribute('cy', y2);
    circleB.setAttribute('r', '4');
    circleB.setAttribute('class', 'rel-marker');

    linksSvg.appendChild(pathEl);
    linksSvg.appendChild(circleA);
    linksSvg.appendChild(circleB);
  }

  // Pan & Zoom
  function applyTransform() {
    canvasTransform.style.transform = \`translate(\${panX}px, \${panY}px) scale(\${zoom})\`;
    zoomDisplay.textContent = Math.round(zoom * 100) + '%';
  }

  viewport.addEventListener('wheel', e => {
    e.preventDefault();
    const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1;
    const newZoom = Math.min(2.0, Math.max(0.3, zoom * zoomFactor));

    const rect = viewport.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    panX = mouseX - (mouseX - panX) * (newZoom / zoom);
    panY = mouseY - (mouseY - panY) * (newZoom / zoom);
    zoom = newZoom;
    applyTransform();
  });

  viewport.addEventListener('mousedown', e => {
    if (e.button === 1 || (e.button === 0 && e.target === viewport)) {
      isPanning = true;
      startPanX = e.clientX - panX;
      startPanY = e.clientY - panY;
      viewport.classList.add('panning');
    }
  });

  window.addEventListener('mousemove', e => {
    if (isPanning) {
      panX = e.clientX - startPanX;
      panY = e.clientY - startPanY;
      applyTransform();
    } else if (draggedCard) {
      const rect = viewport.getBoundingClientRect();
      const newX = Math.round((e.clientX - rect.left - panX) / zoom - dragOffsetX);
      const newY = Math.round((e.clientY - rect.top - panY) / zoom - dragOffsetY);
      const entityName = draggedCard.id.replace(/^card-/, '');

      draggedCard.style.left = newX + 'px';
      draggedCard.style.top = newY + 'px';
      activePositions[entityName] = { x: newX, y: newY };
      updateConnectors();
    }
  });

  window.addEventListener('mouseup', () => {
    if (isPanning) {
      isPanning = false;
      viewport.classList.remove('panning');
    }
    if (draggedCard) {
      draggedCard.classList.remove('selected');
      draggedCard = null;
    }
  });

  // HTML5 Drag & Drop from Sidebar
  viewport.addEventListener('dragover', e => {
    e.preventDefault();
  });

  viewport.addEventListener('drop', e => {
    e.preventDefault();
    const entityName = e.dataTransfer.getData('text/plain');
    if (entityName) {
      addEntityToCanvas(entityName, e.clientX, e.clientY);
    }
  });

  // Toolbar Handlers
  document.getElementById('btnZoomIn').addEventListener('click', () => {
    zoom = Math.min(2.0, zoom * 1.15);
    applyTransform();
  });

  document.getElementById('btnZoomOut').addEventListener('click', () => {
    zoom = Math.max(0.3, zoom * 0.85);
    applyTransform();
  });

  document.getElementById('btnZoomReset').addEventListener('click', () => {
    zoom = 1.0;
    panX = 40;
    panY = 40;
    applyTransform();
  });

  document.getElementById('btnAutoLayout').addEventListener('click', () => {
    const names = Object.keys(activePositions);
    let col = 0;
    let row = 0;
    for (const name of names) {
      activePositions[name] = {
        x: 60 + col * 320,
        y: 60 + row * 340
      };
      col++;
      if (col >= 3) {
        col = 0;
        row++;
      }
    }
    renderCanvas();
  });

  document.getElementById('btnSave').addEventListener('click', () => {
    vscode.postMessage({
      type: 'saveDiagram',
      name: currentDiagramName,
      positions: activePositions
    });
  });

  document.getElementById('btnNew').addEventListener('click', () => {
    const name = prompt('Enter new diagram name:', 'Custom Diagram');
    if (name) {
      currentDiagramName = name.trim();
      activePositions = {};
      renderEntityList();
      renderCanvas();
      vscode.postMessage({
        type: 'saveDiagram',
        name: currentDiagramName,
        positions: {}
      });
    }
  });

  document.getElementById('btnExportMermaid').addEventListener('click', () => {
    let mermaid = 'erDiagram\\n';
    const activeNames = new Set(Object.keys(activePositions));

    for (const rel of allRelationships) {
      if (activeNames.has(rel.fromEntity) && activeNames.has(rel.toEntity)) {
        mermaid += \`  \${rel.fromEntity} ||--o{ \${rel.toEntity} : "\${rel.foreignKeyName || 'FK'}"\\n\`;
      }
    }

    for (const name of activeNames) {
      const entity = allEntities.find(e => e.name === name);
      if (entity) {
        mermaid += \`  \${entity.name} {\\n\`;
        for (const p of entity.properties.slice(0, 8)) {
          mermaid += \`    \${p.type.replace(/[^a-zA-Z0-9_]/g, '')} \${p.name}\\n\`;
        }
        mermaid += '  }\\n';
      }
    }

    navigator.clipboard.writeText(mermaid).then(() => {
      alert('Mermaid ERD copied to clipboard!');
    });
  });

  function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
})();
  `;
}
