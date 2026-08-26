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
    <div class="sidebar">
      <div class="sidebar-header">
        <div class="sidebar-title">
          <span style="color: var(--pk-color);">🗄️</span>
          <span id="sidebarContextTitle">Entity Palette</span>
        </div>
        <input type="text" class="search-box" id="searchBox" placeholder="Filter entities in active DbContext..." autocomplete="off" />
        <button class="btn btn-secondary" id="btnAddAllToCanvas" style="width: 100%; font-size: 11px; padding: 5px;" title="Add all tables of active DbContext to canvas">➕ Add All to Canvas</button>
      </div>
      <div class="entity-list" id="entityList">
        <!-- Injected dynamically via client script -->
      </div>
    </div>

    <!-- Main Workspace -->
    <div class="main-area">
      <!-- Top Toolbar -->
      <div class="toolbar">
        <div class="toolbar-left">
          <div style="display: flex; align-items: center; gap: 6px; margin-right: 8px;">
            <span style="font-weight: 600; font-size: 11px; color: var(--pk-color);">🎯 DbContext:</span>
            <select class="diagram-select" id="dbContextSelect" style="font-weight: 600; min-width: 180px;" title="Select Active DbContext / Database"></select>
          </div>
          <span style="color: var(--card-border); margin: 0 4px;">|</span>
          <select class="diagram-select" id="diagramSelect" title="Select Diagram">
            <option value="Default">Default Diagram</option>
          </select>
          <button class="btn btn-secondary" id="btnNew" title="Create New Diagram">➕ New</button>
          <button class="btn" id="btnSave" title="Save Diagram Layout">💾 Save</button>
          <button class="btn btn-secondary" id="btnAutoLayout" title="Auto Arrange Tables">🔲 Auto Arrange</button>
        </div>

        <div class="toolbar-right">
          <button class="btn btn-secondary" id="btnExportMermaid" title="Copy as Mermaid ERD">📋 Export Mermaid</button>
          <div style="display: flex; align-items: center; gap: 4px; margin-left: 8px;">
            <button class="btn-icon" id="btnZoomOut" title="Zoom Out">−</button>
            <span id="zoomDisplay" style="font-size: 11px; min-width: 36px; text-align: center; color: var(--text-muted);">100%</span>
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
          <div style="font-size: 14px; font-weight: 500;">No Entities on Diagram</div>
          <div style="font-size: 12px; max-width: 280px;">Drag entities from the left sidebar into the canvas, or double-click to add.</div>
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
