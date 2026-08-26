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
            <select class="diagram-select" id="dbContextSelect" style="font-weight: 600; min-width: 190px;" title="Select Active DbContext"></select>
          </div>

          <div class="toolbar-divider"></div>

          <select class="diagram-select" id="diagramSelect" title="Select Diagram">
            <option value="Default">Default Diagram</option>
          </select>

          <button class="btn btn-secondary" id="btnNew" title="Create New Diagram">
            <svg class="icon-svg" viewBox="0 0 16 16" fill="currentColor"><path d="M8 2a.5.5 0 0 1 .5.5v5h5a.5.5 0 0 1 0 1h-5v5a.5.5 0 0 1-1 0v-5h-5a.5.5 0 0 1 0-1h5v-5A.5.5 0 0 1 8 2z"/></svg>
            New
          </button>

          <button class="btn btn-primary" id="btnSave" title="Save Diagram Layout">
            <svg class="icon-svg" viewBox="0 0 16 16" fill="currentColor"><path d="M2 1a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V4.414a1 1 0 0 0-.293-.707l-2.414-2.414A1 1 0 0 0 11.586 1H2zm3 1h6v4H5V2zm7 6v6H4V8h8z"/></svg>
            Save
          </button>

          <button class="btn btn-secondary" id="btnAutoLayout" title="Auto Arrange Tables (Hierarchy DAG Layout)">
            <svg class="icon-svg" viewBox="0 0 16 16" fill="currentColor"><path d="M1 2.5A1.5 1.5 0 0 1 2.5 1h3A1.5 1.5 0 0 1 7 2.5v3A1.5 1.5 0 0 1 5.5 7h-3A1.5 1.5 0 0 1 1 5.5v-3zm8 0A1.5 1.5 0 0 1 10.5 1h3A1.5 1.5 0 0 1 15 2.5v3A1.5 1.5 0 0 1 13.5 7h-3A1.5 1.5 0 0 1 9 5.5v-3zm-8 8A1.5 1.5 0 0 1 2.5 9h3A1.5 1.5 0 0 1 7 10.5v3A1.5 1.5 0 0 1 5.5 15h-3A1.5 1.5 0 0 1 1 13.5v-3zm8 0A1.5 1.5 0 0 1 10.5 9h3a1.5 1.5 0 0 1 1.5 1.5v3a1.5 1.5 0 0 1-1.5 1.5h-3A1.5 1.5 0 0 1 9 13.5v-3z"/></svg>
            Auto Arrange
          </button>

          <div class="toolbar-divider"></div>

          <!-- Column View Mode Filter Chips -->
          <div class="filter-chips-group" title="Column Visibility Mode">
            <button class="filter-chip active" id="chipAll" data-mode="all">All Columns</button>
            <button class="filter-chip" id="chipKeys" data-mode="keys">🔑 Keys Only</button>
            <button class="filter-chip" id="chipNoAudit" data-mode="no-audit">🛡️ No Audit</button>
          </div>
        </div>

        <div class="toolbar-right">
          <button class="btn btn-secondary" id="btnExportMermaid" title="Copy Mermaid ERD Syntax">
            <svg class="icon-svg" viewBox="0 0 16 16" fill="currentColor"><path d="M4 1.5H3a2 2 0 0 0-2 2V14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V3.5a2 2 0 0 0-2-2h-1v1h1a1 1 0 0 1 1 1V14a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V3.5a1 1 0 0 1 1-1h1v-1z"/><path d="M9.5 1a.5.5 0 0 1 .5.5v1a.5.5 0 0 1-.5.5h-3a.5.5 0 0 1-.5-.5v-1a.5.5 0 0 1 .5-.5h3zm-3-1A1.5 1.5 0 0 0 5 1.5v1A1.5 1.5 0 0 0 6.5 4h3A1.5 1.5 0 0 0 11 2.5v-1A1.5 1.5 0 0 0 9.5 0h-3z"/></svg>
            Mermaid
          </button>
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
        <div class="canvas-transform" id="canvasTransform">
          <!-- SVG Relationships Layer -->
          <svg class="links-svg" id="linksSvg"></svg>

          <!-- DOM Table Cards Layer -->
          <div id="cardsLayer"></div>
        </div>

        <!-- Empty Canvas Prompt -->
        <div class="empty-canvas-prompt" id="emptyPrompt">
          <div class="empty-icon">🗄️</div>
          <div style="font-size: 15px; font-weight: 600; color: var(--text-main);">No Entities on Canvas</div>
          <div style="font-size: 12px; max-width: 300px; color: var(--text-muted); line-height: 1.5;">Drag tables from the palette on the left or double-click to add them to your interactive ERD diagram.</div>
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
