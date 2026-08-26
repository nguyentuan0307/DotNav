export function getEfDiagramCss(): string {
  return `
:root {
  --canvas-bg: var(--vscode-editor-background, #18181b);
  --sidebar-bg: var(--vscode-sideBar-background, #1f1f23);
  --card-bg: var(--vscode-editorWidget-background, #26262b);
  --card-border: var(--vscode-editorWidget-border, #3f3f46);
  --card-header-bg: #2d2d34;
  --pk-color: #facc15;
  --fk-color: #38bdf8;
  --nav-color: #c084fc;
  --type-color: #4ec9b0;
  --text-main: var(--vscode-editor-foreground, #f1f5f9);
  --text-muted: var(--vscode-descriptionForeground, #94a3b8);
  --accent: var(--vscode-button-background, #2563eb);
  --accent-hover: var(--vscode-button-hoverBackground, #1d4ed8);
  --link-color: #3b82f6;
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
  width: 300px;
  min-width: 260px;
  max-width: 420px;
  height: 100%;
  background: var(--sidebar-bg);
  border-right: 1px solid var(--card-border);
  display: flex;
  flex-direction: column;
  z-index: 10;
  box-shadow: 2px 0 8px rgba(0, 0, 0, 0.2);
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
  padding: 7px 10px;
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
  padding: 7px 10px;
  margin-bottom: 4px;
  background: transparent;
  border: 1px solid transparent;
  border-radius: 5px;
  cursor: grab;
  transition: all 0.12s ease;
}

.entity-list-item:hover {
  background: rgba(255, 255, 255, 0.05);
  border-color: rgba(255, 255, 255, 0.1);
}

.entity-list-item.in-diagram {
  opacity: 0.65;
  border-left: 3px solid var(--accent);
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

.entity-add-btn {
  background: transparent;
  border: 1px solid rgba(255, 255, 255, 0.15);
  color: var(--text-main);
  border-radius: 3px;
  font-size: 10px;
  padding: 2px 6px;
  cursor: pointer;
  transition: all 0.15s ease;
}

.entity-add-btn:hover {
  background: var(--accent);
  color: #ffffff;
  border-color: var(--accent);
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

/* Top Toolbar */
.toolbar {
  height: 44px;
  min-height: 44px;
  background: var(--sidebar-bg);
  border-bottom: 1px solid var(--card-border);
  padding: 0 16px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  z-index: 5;
}

.toolbar-left, .toolbar-right {
  display: flex;
  align-items: center;
  gap: 8px;
}

.diagram-select {
  padding: 5px 10px;
  background: var(--vscode-dropdown-background, #2d2d30);
  color: var(--vscode-dropdown-foreground, #ffffff);
  border: 1px solid var(--vscode-dropdown-border, #3f3f46);
  border-radius: 4px;
  font-size: 12px;
  outline: none;
  cursor: pointer;
}

.btn {
  padding: 5px 12px;
  background: var(--accent);
  color: #ffffff;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
  font-weight: 500;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  transition: background 0.15s ease;
}

.btn:hover {
  background: var(--accent-hover);
}

.btn-secondary {
  background: var(--vscode-button-secondaryBackground, #3f3f46);
  color: #ffffff;
}

.btn-secondary:hover {
  background: var(--vscode-button-secondaryHoverBackground, #52525b);
}

.btn-icon {
  padding: 4px 8px;
  background: transparent;
  color: var(--text-main);
  border: 1px solid var(--card-border);
  border-radius: 3px;
  cursor: pointer;
}

.btn-icon:hover {
  background: rgba(255, 255, 255, 0.08);
}

/* Canvas Viewport */
.canvas-viewport {
  flex: 1;
  position: relative;
  cursor: grab;
  overflow: hidden;
  background-color: var(--canvas-bg);
  background-image: radial-gradient(rgba(255, 255, 255, 0.1) 1px, transparent 1px);
  background-size: 24px 24px;
}

.canvas-viewport:active {
  cursor: grabbing;
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

.link-path {
  fill: none !important;
  stroke: var(--link-color) !important;
  stroke-width: 2px !important;
  stroke-linecap: round;
  stroke-linejoin: round;
  transition: stroke 0.15s ease, stroke-width 0.15s ease;
  pointer-events: stroke;
}

.link-path:hover {
  stroke: #f59e0b !important;
  stroke-width: 3.5px !important;
  filter: drop-shadow(0 0 5px rgba(245, 158, 11, 0.7));
  cursor: pointer;
}

.link-endpoint {
  fill: var(--link-color) !important;
  stroke: var(--canvas-bg) !important;
  stroke-width: 1.5px !important;
}

.link-crowfoot {
  fill: var(--link-color) !important;
  stroke: var(--canvas-bg) !important;
  stroke-width: 1.5px !important;
}

/* Table Cards (Modern DataGrip / drawSQL Style) */
.cards-layer {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  z-index: 2;
  pointer-events: none;
}

.table-card {
  position: absolute;
  width: 290px;
  background: var(--card-bg);
  border: 1px solid var(--card-border);
  border-radius: 6px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
  display: flex;
  flex-direction: column;
  pointer-events: auto;
  cursor: default;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}

.table-card:hover {
  border-color: rgba(255, 255, 255, 0.25);
}

.table-card.selected {
  border-color: #3b82f6;
  box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.5), 0 10px 30px rgba(0, 0, 0, 0.5);
}

.card-header {
  padding: 8px 12px;
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
  color: #ffffff;
  display: flex;
  align-items: center;
  gap: 6px;
  white-space: nowrap;
}

.card-subtitle {
  font-size: 10px;
  color: var(--text-muted);
  font-family: var(--vscode-editor-font-family, monospace);
  white-space: nowrap;
}

.card-close-btn {
  background: transparent;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  font-size: 13px;
  padding: 2px 5px;
  border-radius: 3px;
  transition: all 0.12s ease;
}

.card-close-btn:hover {
  background: rgba(239, 68, 68, 0.2);
  color: #ef4444;
}

.card-body {
  max-height: 320px;
  overflow-y: auto;
  padding: 2px 0;
}

/* 2-Column Property Row Layout */
.prop-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 5px 12px;
  font-size: 12px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.03);
  transition: background 0.1s ease;
}

.prop-row:hover {
  background: rgba(255, 255, 255, 0.06);
}

.prop-row.pk {
  background: rgba(250, 204, 21, 0.04);
}

.prop-row.fk {
  background: rgba(56, 189, 248, 0.04);
}

.prop-name {
  display: flex;
  align-items: center;
  gap: 6px;
  font-weight: 500;
  color: #e2e8f0;
  font-family: var(--vscode-editor-font-family, -apple-system, sans-serif);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.prop-type {
  font-family: var(--vscode-editor-font-family, 'Fira Code', 'Cascadia Code', monospace);
  font-size: 11px;
  color: var(--type-color);
  font-weight: 500;
  margin-left: 12px;
  white-space: nowrap;
  flex-shrink: 0;
}

.prop-badge {
  font-size: 9px;
  font-weight: 700;
  padding: 1px 4px;
  border-radius: 3px;
  line-height: 1;
  display: inline-flex;
  align-items: center;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  flex-shrink: 0;
}

.prop-badge.pk {
  background: rgba(250, 204, 21, 0.18);
  color: var(--pk-color);
  border: 1px solid rgba(250, 204, 21, 0.45);
}

.prop-badge.fk {
  background: rgba(56, 189, 248, 0.18);
  color: var(--fk-color);
  border: 1px solid rgba(56, 189, 248, 0.45);
}

.prop-badge.nav {
  background: rgba(192, 132, 252, 0.18);
  color: var(--nav-color);
  border: 1px solid rgba(192, 132, 252, 0.45);
}

.prop-expand-btn {
  background: transparent;
  border: 1px solid rgba(255, 255, 255, 0.15);
  color: var(--text-muted);
  border-radius: 3px;
  font-size: 9px;
  padding: 1px 4px;
  cursor: pointer;
  transition: all 0.15s ease;
  margin-left: 4px;
}

.prop-expand-btn:hover {
  background: var(--accent);
  color: #ffffff;
  border-color: var(--accent);
}

/* Empty Prompt */
.empty-prompt {
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
}

.empty-prompt-icon {
  font-size: 42px;
  opacity: 0.4;
}

.empty-prompt-text {
  font-size: 13px;
  text-align: center;
}
`;
}
