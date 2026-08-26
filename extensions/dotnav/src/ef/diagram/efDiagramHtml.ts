import { getEfDiagramCss } from './efDiagramStyles';
import { getEfDiagramClientScript } from './efDiagramClient';

export function renderEfDiagramHtml(): string {
  const css = getEfDiagramCss();
  const script = getEfDiagramClientScript();

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>DotNav: EF Core Entity Relationship Diagram</title>
  <style>
    ${css}
  </style>
</head>
<body>
  <div class="diagram-container">
    <!-- Left Sidebar: Searchable Entity Catalog -->
    <div class="sidebar" id="sidebar">
      <div class="sidebar-header">
        <div class="sidebar-title">
          <svg class="icon-svg" viewBox="0 0 16 16" fill="currentColor">
            <path d="M2 3.5a1.5 1.5 0 0 1 1.5-1.5h9A1.5 1.5 0 0 1 14 3.5v9a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 12.5v-9zm1.5-.5a.5.5 0 0 0-.5.5v1h10v-1a.5.5 0 0 0-.5-.5h-9zm10 2.5H2.5v6.5a.5.5 0 0 0 .5.5h9a.5.5 0 0 0 .5-.5V5.5z"/>
          </svg>
          <span id="sidebarContextTitle">Entity Palette</span>
        </div>
        <div class="search-box-wrapper">
          <svg class="search-icon-svg" viewBox="0 0 16 16" fill="currentColor">
            <path d="M11.742 10.344a6.5 6.5 0 1 0-1.397 1.398h-.001c.03.04.062.078.098.115l3.85 3.85a1 1 0 0 0 1.415-1.414l-3.85-3.85a1.007 1.007 0 0 0-.115-.1zM12 6.5a5.5 5.5 0 1 1-11 0 5.5 5.5 0 0 1 11 0z"/>
          </svg>
          <input type="text" class="search-box" id="searchBox" placeholder="Filter entities in active DbContext..." autocomplete="off" />
        </div>
        <button class="btn btn-secondary" id="btnAddAllToCanvas" style="width: 100%; font-size: 11px; padding: 6px;" title="Add all tables of active DbContext to canvas">
          <svg class="icon-svg" viewBox="0 0 16 16" fill="currentColor"><path d="M8 2a.5.5 0 0 1 .5.5v5h5a.5.5 0 0 1 0 1h-5v5a.5.5 0 0 1-1 0v-5h-5a.5.5 0 0 1 0-1h5v-5A.5.5 0 0 1 8 2z"/></svg>
          Add All to Canvas
        </button>
      </div>
      <div class="entity-list" id="entityList">
        <!-- Injected dynamically via client script -->
      </div>
    </div>

    <!-- Draggable Sidebar Resizer Splitter -->
    <div class="sidebar-resizer" id="sidebarResizer" title="Drag to resize sidebar"></div>

    <!-- Main Workspace -->
    <div class="main-area">
      <!-- Top Toolbar -->
      <div class="toolbar">
        <div class="toolbar-left">
          <div class="context-picker-group">
            <span class="context-label">
              <svg class="icon-svg" viewBox="0 0 16 16" fill="currentColor"><path d="M2 3.5a1.5 1.5 0 0 1 1.5-1.5h9A1.5 1.5 0 0 1 14 3.5v9a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 12.5v-9z"/></svg>
              DbContext:
            </span>
            <select class="diagram-select" id="dbContextSelect" style="font-weight: 600; min-width: 170px;" title="Select Active DbContext"></select>
          </div>

          <div class="toolbar-divider"></div>

          <select class="diagram-select" id="diagramSelect" title="Select Saved Diagram">
            <option value="Default">Default Diagram</option>
          </select>

          <button class="btn btn-secondary" id="btnNew" title="Create New Diagram">
            <svg class="icon-svg" viewBox="0 0 16 16" fill="currentColor"><path d="M8 2a.5.5 0 0 1 .5.5v5h5a.5.5 0 0 1 0 1h-5v5a.5.5 0 0 1-1 0v-5h-5a.5.5 0 0 1 0-1h5v-5A.5.5 0 0 1 8 2z"/></svg>
            New
          </button>

          <button class="btn btn-primary" id="btnSave" title="Save Diagram Layout (Ctrl+S)">
            <svg class="icon-svg" viewBox="0 0 16 16" fill="currentColor"><path d="M2 1a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V4.414a1 1 0 0 0-.293-.707l-2.414-2.414A1 1 0 0 0 11.586 1H2zm3 1h6v4H5V2zm7 6v6H4V8h8z"/></svg>
            Save
          </button>

          <div class="toolbar-divider"></div>

          <!-- Undo / Redo Buttons -->
          <button class="btn-icon" id="btnUndo" title="Undo (Ctrl+Z)" disabled>
            <svg class="icon-svg" viewBox="0 0 16 16" fill="currentColor"><path fill-rule="evenodd" d="M8 3a5 5 0 1 0 4.546 2.914.5.5 0 0 1 .908-.417A6 6 0 1 1 8 2v1z"/><path d="M8 4.466V.534a.25.25 0 0 1 .41-.192l2.36 1.966c.12.1.12.284 0 .384L8.41 4.658A.25.25 0 0 1 8 4.466z"/></svg>
          </button>
          <button class="btn-icon" id="btnRedo" title="Redo (Ctrl+Y)" disabled>
            <svg class="icon-svg" viewBox="0 0 16 16" fill="currentColor"><path fill-rule="evenodd" d="M8 3a5 5 0 1 1-4.546 2.914.5.5 0 0 0-.908-.417A6 6 0 1 0 8 2v1z"/><path d="M8 4.466V.534a.25.25 0 0 0-.41-.192L5.23 2.308a.25.25 0 0 0 0 .384l2.36 1.966A.25.25 0 0 0 8 4.466z"/></svg>
          </button>

          <div class="toolbar-divider"></div>

          <!-- Multi-Layout Selector Dropdown -->
          <select class="diagram-select" id="layoutModeSelect" title="Select Auto Layout Algorithm">
            <option value="column">📐 Layout: Columns (DAG)</option>
            <option value="hierarchical">🌲 Layout: Tree Hierarchy</option>
            <option value="radial">⭐ Layout: Radial Star</option>
            <option value="grid">▦ Layout: Compact Grid</option>
          </select>

          <button class="btn btn-secondary" id="btnAutoLayout" title="Apply Auto Layout Algorithm">
            Arrange
          </button>

          <!-- Add Sticky Note Button -->
          <button class="btn btn-secondary" id="btnAddNote" title="Add Sticky Note to Canvas">
            <svg class="icon-svg" viewBox="0 0 16 16" fill="currentColor"><path d="M2.5 1A1.5 1.5 0 0 0 1 2.5v11A1.5 1.5 0 0 0 2.5 15h6.086a1.5 1.5 0 0 0 1.06-.44l4.915-4.914A1.5 1.5 0 0 0 15 8.586V2.5A1.5 1.5 0 0 0 13.5 1h-11zM2 2.5a.5.5 0 0 1 .5-.5h11a.5.5 0 0 1 .5.5V8H9.5A1.5 1.5 0 0 0 8 9.5V14H2.5a.5.5 0 0 1-.5-.5v-11zm7 7V14l5-5H9.5a.5.5 0 0 1-.5-.5z"/></svg>
            + Note
          </button>

          <div class="toolbar-divider"></div>

          <!-- Column View Mode Filter Chips -->
          <div class="filter-chips-group" title="Column Visibility Mode">
            <button class="filter-chip active" id="chipAll" data-mode="all">All Columns</button>
            <button class="filter-chip" id="chipKeys" data-mode="keys">🔑 Keys</button>
            <button class="filter-chip" id="chipNoAudit" data-mode="no-audit">🛡️ No Audit</button>
          </div>
        </div>

        <div class="toolbar-right">
          <!-- Align & Distribute Group -->
          <button class="btn-icon" id="btnAlignLeft" title="Align Selected Left">⇤</button>
          <button class="btn-icon" id="btnAlignTop" title="Align Selected Top">⇡</button>
          <button class="btn-icon" id="btnDistributeH" title="Distribute Horizontally">⇹</button>

          <div class="toolbar-divider"></div>

          <!-- Export Actions -->
          <select class="diagram-select" id="exportSelect" title="Export Diagram">
            <option value="" disabled selected>📤 Export...</option>
            <option value="png-dark">📸 Image (PNG Dark)</option>
            <option value="png-light">📄 Image (PNG Light Print)</option>
            <option value="svg">📐 Vector (SVG)</option>
            <option value="mermaid">📋 Copy Mermaid ERD</option>
          </select>

          <div class="zoom-controls">
            <button class="btn-icon" id="btnZoomOut" title="Zoom Out">−</button>
            <span id="zoomDisplay" class="zoom-display">100%</span>
            <button class="btn-icon" id="btnZoomIn" title="Zoom In">+</button>
            <button class="btn-icon" id="btnZoomReset" title="Reset Zoom">Fit</button>
          </div>
        </div>
      </div>

      <!-- Canvas Viewport -->
      <div class="canvas-viewport" id="viewport">
        <!-- Marquee Selection Rectangle Box -->
        <div class="marquee-box" id="marqueeBox"></div>

        <div class="canvas-transform" id="canvasTransform">
          <!-- SVG Relationships Layer -->
          <svg class="links-svg" id="linksSvg"></svg>

          <!-- DOM Notes Layer -->
          <div id="notesLayer"></div>

          <!-- DOM Table Cards Layer -->
          <div id="cardsLayer"></div>
        </div>

        <!-- Interactive Canvas Minimap -->
        <div class="canvas-minimap" id="canvasMinimap" title="Click or drag to pan canvas">
          <canvas class="minimap-canvas" id="minimapCanvas" width="190" height="125"></canvas>
          <div class="minimap-lens" id="minimapLens"></div>
        </div>

        <!-- Empty Canvas Prompt -->
        <div class="empty-canvas-prompt" id="emptyPrompt">
          <div class="empty-icon">🗄️</div>
          <div style="font-size: 15px; font-weight: 600; color: var(--text-main);">No Entities on Canvas</div>
          <div style="font-size: 12px; max-width: 300px; color: var(--text-muted); line-height: 1.5;">Drag tables from the palette on the left or click <b>Add All to Canvas</b> to explore your interactive ERD diagram.</div>
        </div>
      </div>
    </div>
  </div>

  <script>
    ${script}
  </script>
</body>
</html>`;
}
