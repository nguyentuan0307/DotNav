export function getEfDiagramCss(): string {
  return `
:root {
  --canvas-bg: var(--vscode-editor-background, #1e1e1e);
  --sidebar-bg: var(--vscode-sideBar-background, #252526);
  --card-bg: var(--vscode-editorWidget-background, #2d2d30);
  --card-border: var(--vscode-editorWidget-border, #454545);
  --card-header-bg: var(--vscode-sideBarSectionHeader-background, #333333);
  --pk-color: #ffd700;
  --fk-color: #4fc1ff;
  --nav-color: #9cdcfe;
  --text-main: var(--vscode-editor-foreground, #cccccc);
  --text-muted: var(--vscode-descriptionForeground, #858585);
  --accent: var(--vscode-button-background, #0e639c);
  --accent-hover: var(--vscode-button-hoverBackground, #1177bb);
  --link-color: var(--vscode-editorBracketHighlight-foreground1, #569cd6);
}

* {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
  user-select: none;
}

body, html {
  width: 100%;
  height: 100%;
  overflow: hidden;
  font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif);
  font-size: var(--vscode-font-size, 13px);
  color: var(--text-main);
  background: var(--canvas-bg);
}

.diagram-container {
  display: flex;
  width: 100vw;
  height: 100vh;
}

/* Sidebar */
.sidebar {
  width: 280px;
  min-width: 240px;
  max-width: 400px;
  height: 100%;
  background: var(--sidebar-bg);
  border-right: 1px solid var(--card-border);
  display: flex;
  flex-direction: column;
  z-index: 10;
}

.sidebar-header {
  padding: 12px 14px;
  border-bottom: 1px solid var(--card-border);
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.sidebar-title {
  font-weight: 600;
  font-size: 13px;
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--text-main);
}

.search-box {
  width: 100%;
  padding: 6px 10px;
  background: var(--vscode-input-background, #3c3c3c);
  color: var(--vscode-input-foreground, #cccccc);
  border: 1px solid var(--vscode-input-border, #3c3c3c);
  border-radius: 4px;
  outline: none;
  font-size: 12px;
}

.search-box:focus {
  border-color: var(--vscode-focusBorder, #007acc);
}

.entity-list {
  flex: 1;
  overflow-y: auto;
  padding: 8px 6px;
}

.entity-list-item {
  padding: 6px 10px;
  margin-bottom: 4px;
  border-radius: 4px;
  cursor: grab;
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: transparent;
  transition: background 0.15s ease;
}

.entity-list-item:hover {
  background: var(--vscode-list-hoverBackground, #2a2d2e);
}

.entity-list-item.in-diagram {
  opacity: 0.6;
}

.entity-item-info {
  display: flex;
  align-items: center;
  gap: 6px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.entity-item-name {
  font-weight: 500;
  font-size: 12px;
}

.entity-item-badge {
  font-size: 10px;
  padding: 2px 6px;
  background: var(--card-border);
  border-radius: 10px;
  color: var(--text-muted);
}

.entity-add-btn {
  background: transparent;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  padding: 2px 6px;
  border-radius: 3px;
  font-size: 13px;
}

.entity-add-btn:hover {
  background: var(--accent);
  color: #fff;
}

/* Main Area */
.main-area {
  flex: 1;
  height: 100%;
  display: flex;
  flex-direction: column;
  position: relative;
  overflow: hidden;
}

/* Toolbar */
.toolbar {
  height: 44px;
  background: var(--sidebar-bg);
  border-bottom: 1px solid var(--card-border);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 16px;
  z-index: 5;
}

.toolbar-left, .toolbar-right {
  display: flex;
  align-items: center;
  gap: 8px;
}

.diagram-select {
  padding: 4px 8px;
  background: var(--vscode-dropdown-background, #3c3c3c);
  color: var(--vscode-dropdown-foreground, #cccccc);
  border: 1px solid var(--vscode-dropdown-border, #3c3c3c);
  border-radius: 4px;
  font-size: 12px;
  outline: none;
}

.btn {
  padding: 4px 10px;
  background: var(--accent);
  color: var(--vscode-button-foreground, #ffffff);
  border: none;
  border-radius: 3px;
  cursor: pointer;
  font-size: 12px;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  transition: background 0.15s ease;
}

.btn:hover {
  background: var(--accent-hover);
}

.btn-secondary {
  background: var(--vscode-button-secondaryBackground, #3a3d41);
  color: var(--vscode-button-secondaryForeground, #ffffff);
}

.btn-secondary:hover {
  background: var(--vscode-button-secondaryHoverBackground, #45494e);
}

.btn-icon {
  padding: 4px 8px;
  background: transparent;
  color: var(--text-main);
  border: 1px solid var(--card-border);
}

.btn-icon:hover {
  background: var(--vscode-list-hoverBackground, #2a2d2e);
}

/* Canvas Viewport */
.canvas-viewport {
  flex: 1;
  position: relative;
  cursor: default;
  overflow: hidden;
  background-color: var(--canvas-bg);
  background-image: radial-gradient(var(--card-border) 1px, transparent 1px);
  background-size: 20px 20px;
}

.canvas-viewport.panning {
  cursor: grabbing !important;
}

.canvas-transform {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  transform-origin: 0 0;
}

/* SVG Links Layer */
.links-svg {
  position: absolute;
  top: 0;
  left: 0;
  width: 10000px;
  height: 10000px;
  pointer-events: none;
  z-index: 1;
}

.rel-line {
  fill: none;
  stroke: var(--link-color);
  stroke-width: 2px;
  stroke-linecap: round;
  transition: stroke 0.15s ease;
}

.rel-line:hover {
  stroke: #ffbb00;
  stroke-width: 3px;
}

.rel-marker {
  fill: var(--link-color);
}

/* Table Cards (SSMS Style) */
.table-card {
  position: absolute;
  width: 260px;
  background: var(--card-bg);
  border: 1px solid var(--card-border);
  border-radius: 6px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.35);
  display: flex;
  flex-direction: column;
  z-index: 2;
  cursor: default;
}

.table-card.selected {
  border-color: var(--vscode-focusBorder, #007acc);
  box-shadow: 0 0 0 2px var(--vscode-focusBorder, #007acc), 0 6px 16px rgba(0, 0, 0, 0.45);
}

.card-header {
  padding: 8px 10px;
  background: var(--card-header-bg);
  border-bottom: 1px solid var(--card-border);
  border-radius: 5px 5px 0 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  cursor: move;
}

.card-title-group {
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.card-title {
  font-weight: 600;
  font-size: 13px;
  color: var(--text-main);
  display: flex;
  align-items: center;
  gap: 5px;
  white-space: nowrap;
}

.card-subtitle {
  font-size: 10px;
  color: var(--text-muted);
  white-space: nowrap;
}

.card-close-btn {
  background: transparent;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  font-size: 14px;
  padding: 2px 4px;
  border-radius: 3px;
}

.card-close-btn:hover {
  background: rgba(255, 0, 0, 0.2);
  color: #ff5555;
}

.card-body {
  max-height: 280px;
  overflow-y: auto;
  padding: 4px 0;
}

.column-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 10px;
  font-size: 12px;
  font-family: var(--vscode-editor-font-family, monospace);
  transition: background 0.1s ease;
}

.column-row:hover {
  background: var(--vscode-list-hoverBackground, #2a2d2e);
}

.col-left {
  display: flex;
  align-items: center;
  gap: 6px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.col-icon-pk {
  color: var(--pk-color);
  font-size: 11px;
}

.col-icon-fk {
  color: var(--fk-color);
  font-size: 11px;
}

.col-icon-normal {
  color: var(--text-muted);
  font-size: 11px;
}

.col-icon-nav {
  color: var(--nav-color);
  font-size: 11px;
}

.col-name {
  color: var(--text-main);
}

.col-name.pk {
  font-weight: 600;
  color: var(--pk-color);
}

.col-type {
  font-size: 11px;
  color: var(--text-muted);
  margin-left: 4px;
}

.col-expand-btn {
  background: transparent;
  border: 1px solid var(--card-border);
  color: var(--fk-color);
  border-radius: 3px;
  cursor: pointer;
  font-size: 11px;
  padding: 1px 4px;
  display: none;
}

.column-row:hover .col-expand-btn {
  display: inline-block;
}

.col-expand-btn:hover {
  background: var(--accent);
  color: #fff;
  border-color: var(--accent);
}

/* Empty Canvas State */
.empty-canvas-prompt {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  color: var(--text-muted);
  pointer-events: none;
  text-align: center;
}

.empty-icon {
  font-size: 40px;
  opacity: 0.4;
}
  `;
}
