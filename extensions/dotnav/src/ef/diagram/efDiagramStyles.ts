export function getEfDiagramCss(): string {
  return `
:root {
  --bg-main: var(--vscode-editor-background, #1e1e1e);
  --bg-sidebar: var(--vscode-sideBar-background, #252526);
  --border: var(--vscode-panel-border, #333333);
  --text-main: var(--vscode-editor-foreground, #d4d4d4);
  --text-muted: var(--vscode-descriptionForeground, #858585);
  --accent: var(--vscode-button-background, #0e639c);
  --accent-hover: var(--vscode-button-hoverBackground, #1177bb);
  --card-bg: #21252b;
  --card-header-bg: #282c34;
  --card-border: #3c4048;
  --card-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
  --card-selected-border: #3b82f6;
  --pk-color: #f59e0b;
  --fk-color: #3b82f6;
  --nav-color: #a855f7;
  --type-color: #4ec9b0;
  --row-hover-bg: rgba(255, 255, 255, 0.04);
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
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
  background-color: var(--bg-main);
  color: var(--text-main);
  font-size: 13px;
}

.diagram-container {
  display: flex;
  width: 100vw;
  height: 100vh;
  overflow: hidden;
  position: relative;
}

/* Draggable Sidebar */
.sidebar {
  width: 270px;
  min-width: 200px;
  max-width: 650px;
  height: 100%;
  background: var(--bg-sidebar);
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  z-index: 10;
  flex-shrink: 0;
}

.sidebar-resizer {
  width: 5px;
  cursor: col-resize;
  background: transparent;
  transition: background 0.15s ease;
  z-index: 20;
  flex-shrink: 0;
  position: relative;
  margin-left: -2px;
  margin-right: -3px;
}

.sidebar-resizer:hover, .sidebar-resizer.resizing {
  background: var(--accent);
}

.sidebar-header {
  padding: 12px;
  border-bottom: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.sidebar-title {
  font-weight: 600;
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--text-muted);
}

.search-box-wrapper {
  position: relative;
  width: 100%;
}

.search-icon-svg {
  position: absolute;
  left: 9px;
  top: 50%;
  transform: translateY(-50%);
  width: 13px;
  height: 13px;
  color: var(--text-muted);
  pointer-events: none;
}

.search-box {
  width: 100%;
  padding: 6px 10px 6px 28px;
  background: var(--vscode-input-background, #2d2d30);
  color: var(--vscode-input-foreground, #ffffff);
  border: 1px solid var(--vscode-input-border, #3f3f46);
  border-radius: 4px;
  outline: none;
  font-size: 12px;
  transition: border-color 0.15s ease;
}

.search-box:focus {
  border-color: var(--vscode-focusBorder, #3b82f6);
}

.entity-list {
  flex: 1;
  overflow-y: auto;
  padding: 8px 6px;
}

.entity-list-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 10px;
  margin-bottom: 3px;
  background: transparent;
  border: 1px solid transparent;
  border-radius: 5px;
  cursor: grab;
  transition: all 0.12s ease;
}

.entity-list-item:hover {
  background: rgba(255, 255, 255, 0.05);
  border-color: rgba(255, 255, 255, 0.08);
}

.entity-list-item.in-diagram {
  background: rgba(59, 130, 246, 0.08);
  border-color: rgba(59, 130, 246, 0.25);
  cursor: pointer;
}

.entity-item-info {
  display: flex;
  align-items: center;
  gap: 8px;
  overflow: hidden;
}

.entity-item-name {
  font-weight: 500;
  font-size: 12px;
  color: var(--text-main);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.entity-item-badge {
  font-size: 10px;
  color: var(--text-muted);
  background: rgba(255, 255, 255, 0.06);
  padding: 2px 6px;
  border-radius: 10px;
  white-space: nowrap;
}

/* Main Workspace */
.main-area {
  flex: 1;
  display: flex;
  flex-direction: column;
  height: 100%;
  position: relative;
  overflow: hidden;
}

/* Toolbar */
.toolbar {
  height: 42px;
  background: rgba(30, 30, 30, 0.85);
  backdrop-filter: blur(8px);
  border-bottom: 1px solid var(--border);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 12px;
  z-index: 5;
  flex-shrink: 0;
}

.toolbar-left, .toolbar-right {
  display: flex;
  align-items: center;
  gap: 6px;
}

.toolbar-divider {
  width: 1px;
  height: 18px;
  background: var(--border);
  margin: 0 4px;
}

.context-picker-group {
  display: flex;
  align-items: center;
  gap: 6px;
}

.context-label {
  font-weight: 600;
  font-size: 11px;
  color: var(--pk-color);
  display: flex;
  align-items: center;
  gap: 4px;
}

.diagram-select {
  background: var(--vscode-dropdown-background, #2d2d30);
  color: var(--vscode-dropdown-foreground, #ffffff);
  border: 1px solid var(--vscode-dropdown-border, #3f3f46);
  padding: 4px 8px;
  border-radius: 4px;
  font-size: 12px;
  outline: none;
  cursor: pointer;
  height: 28px;
}

.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  padding: 4px 10px;
  font-size: 12px;
  font-weight: 500;
  border-radius: 4px;
  cursor: pointer;
  border: 1px solid transparent;
  outline: none;
  height: 28px;
  transition: all 0.12s ease;
}

.btn-primary {
  background: #2563eb;
  color: #ffffff;
  border-color: #1d4ed8;
}

.btn-primary:hover {
  background: #1d4ed8;
}

.btn-secondary {
  background: rgba(255, 255, 255, 0.07);
  color: var(--text-main);
  border-color: rgba(255, 255, 255, 0.12);
}

.btn-secondary:hover {
  background: rgba(255, 255, 255, 0.12);
  border-color: rgba(255, 255, 255, 0.2);
}

.btn-icon {
  background: transparent;
  border: 1px solid transparent;
  color: var(--text-main);
  width: 26px;
  height: 26px;
  border-radius: 4px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  font-size: 13px;
  transition: background 0.12s ease;
}

.btn-icon:hover {
  background: rgba(255, 255, 255, 0.1);
  border-color: rgba(255, 255, 255, 0.15);
}

.icon-svg {
  width: 14px;
  height: 14px;
}

/* Filter Chips */
.filter-chips-group {
  display: flex;
  align-items: center;
  background: rgba(0, 0, 0, 0.25);
  border: 1px solid var(--border);
  border-radius: 5px;
  padding: 2px;
  gap: 2px;
}

.filter-chip {
  background: transparent;
  border: none;
  color: var(--text-muted);
  font-size: 11px;
  font-weight: 500;
  padding: 3px 8px;
  border-radius: 3px;
  cursor: pointer;
  transition: all 0.12s ease;
}

.filter-chip:hover {
  color: var(--text-main);
  background: rgba(255, 255, 255, 0.05);
}

.filter-chip.active {
  background: rgba(59, 130, 246, 0.25);
  color: #60a5fa;
  font-weight: 600;
}

.zoom-controls {
  display: flex;
  align-items: center;
  gap: 2px;
  background: rgba(0, 0, 0, 0.2);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 1px 3px;
}

.zoom-display {
  font-size: 11px;
  min-width: 36px;
  text-align: center;
  color: var(--text-muted);
  font-family: monospace;
}

/* Canvas Viewport */
.canvas-viewport {
  flex: 1;
  position: relative;
  overflow: hidden;
  background-color: #14161a;
  background-image: 
    radial-gradient(circle, rgba(255, 255, 255, 0.06) 1px, transparent 1px);
  background-size: 24px 24px;
  cursor: grab;
}

.canvas-viewport:active {
  cursor: grabbing;
}

.canvas-transform {
  position: absolute;
  top: 0;
  left: 0;
  transform-origin: 0 0;
  width: 10000px;
  height: 10000px;
  pointer-events: none;
}

/* SVG Connection Lines */
.links-svg {
  position: absolute;
  top: 0;
  left: 0;
  width: 10000px;
  height: 10000px;
  pointer-events: none;
  z-index: 1;
}

.link-path {
  fill: none;
  stroke: #3b82f6;
  stroke-width: 2px;
  stroke-linecap: round;
  transition: stroke 0.15s ease, stroke-width 0.15s ease;
}

.link-path:hover, .link-path.highlighted {
  stroke: #60a5fa;
  stroke-width: 3px;
  filter: drop-shadow(0 0 6px rgba(59, 130, 246, 0.6));
}

.link-endpoint {
  fill: #3b82f6;
}

.link-crowfoot {
  fill: #3b82f6;
}

/* Table Cards Layer */
#cardsLayer {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  z-index: 2;
}

/* Modern DataGrip Table Card */
.table-card {
  position: absolute;
  width: 310px;
  min-width: 240px;
  max-width: 600px;
  background: var(--card-bg);
  border: 1px solid var(--card-border);
  border-radius: 8px;
  box-shadow: var(--card-shadow);
  pointer-events: auto;
  cursor: default;
  transition: box-shadow 0.15s ease, border-color 0.15s ease;
  overflow: hidden;
  resize: horizontal;
}

.table-card.selected {
  border-color: var(--card-selected-border);
  box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.4), var(--card-shadow);
}

.table-card:hover {
  border-color: #555b66;
}

.card-header {
  padding: 8px 12px;
  background: var(--card-header-bg);
  border-bottom: 1px solid var(--card-border);
  display: flex;
  align-items: center;
  justify-content: space-between;
  cursor: move;
  gap: 8px;
}

.card-title-group {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-width: 0;
}

.card-title {
  font-weight: 600;
  font-size: 13px;
  color: #ffffff;
  display: flex;
  align-items: center;
  gap: 6px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.card-subtitle {
  font-size: 10px;
  color: var(--text-muted);
  font-family: monospace;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.card-actions {
  display: flex;
  align-items: center;
  gap: 2px;
}

.card-action-btn {
  background: transparent;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  width: 20px;
  height: 20px;
  border-radius: 3px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: all 0.12s ease;
}

.card-action-btn:hover {
  background: rgba(255, 255, 255, 0.1);
  color: #ffffff;
}

.card-close-btn:hover {
  background: rgba(239, 68, 68, 0.2);
  color: #ef4444;
}

/* Card Body & 2-Column Property Rows */
.card-body {
  max-height: 380px;
  overflow-y: auto;
  padding: 4px 0;
}

.table-card.minimized .card-body {
  display: none;
}

.prop-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 5px 12px;
  font-size: 12px;
  gap: 8px;
  transition: background 0.1s ease;
  position: relative;
}

.prop-row:hover {
  background: var(--row-hover-bg);
}

.prop-row.hidden-by-filter {
  display: none !important;
}

.prop-row.pk {
  background: rgba(245, 158, 11, 0.05);
}

.prop-row.fk {
  background: rgba(59, 130, 246, 0.04);
}

.prop-name {
  display: flex;
  align-items: center;
  gap: 6px;
  font-weight: 500;
  color: var(--text-main);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
}

.prop-type {
  font-family: 'JetBrains Mono', 'Fira Code', Consolas, Monaco, monospace;
  font-size: 11px;
  color: var(--type-color);
  white-space: nowrap;
}

.prop-badge {
  font-size: 9px;
  font-weight: 700;
  padding: 1px 4px;
  border-radius: 3px;
  letter-spacing: 0.5px;
  flex-shrink: 0;
}

.prop-badge.pk {
  background: rgba(245, 158, 11, 0.2);
  color: var(--pk-color);
  border: 1px solid rgba(245, 158, 11, 0.4);
}

.prop-badge.fk {
  background: rgba(59, 130, 246, 0.2);
  color: var(--fk-color);
  border: 1px solid rgba(59, 130, 246, 0.4);
}

.prop-badge.nav {
  background: rgba(168, 85, 247, 0.2);
  color: var(--nav-color);
  border: 1px solid rgba(168, 85, 247, 0.4);
}

.prop-expand-btn {
  background: rgba(59, 130, 246, 0.15);
  color: var(--fk-color);
  border: 1px solid rgba(59, 130, 246, 0.3);
  border-radius: 3px;
  width: 16px;
  height: 16px;
  font-size: 10px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.12s ease;
  margin-left: 4px;
}

.prop-expand-btn:hover {
  background: var(--fk-color);
  color: #ffffff;
}

/* Empty Prompt */
.empty-canvas-prompt {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 10px;
  pointer-events: none;
  z-index: 1;
}

.empty-icon {
  font-size: 42px;
  opacity: 0.4;
}
`;
}
