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
  width: 100%;
  height: 100%;
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

.sidebar-context-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.sidebar-title {
  font-weight: 600;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.6px;
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
  min-width: 0;
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  position: relative;
  overflow: hidden;
}

/* Toolbar */
.toolbar {
  width: 100%;
  min-width: 0;
  height: 42px;
  background: rgba(30, 30, 30, 0.85);
  backdrop-filter: blur(8px);
  border-bottom: 1px solid var(--border);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 12px;
  z-index: 100;
  position: relative;
  flex-shrink: 0;
  gap: 8px;
  overflow: visible;
}

.toolbar-left, .toolbar-right {
  display: flex;
  align-items: center;
  gap: 5px;
  overflow: visible;
  position: relative;
}

.toolbar-divider {
  width: 1px;
  height: 18px;
  background: var(--border);
  margin: 0 3px;
  flex-shrink: 0;
}

.context-picker-group {
  display: flex;
  align-items: center;
  gap: 5px;
  flex-shrink: 0;
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
  padding: 3px 6px;
  border-radius: 4px;
  font-size: 11.5px;
  outline: none;
  cursor: pointer;
  height: 27px;
}

/* Custom Floating Dropdown Menu */
.dropdown-wrapper {
  position: relative;
  display: inline-block;
}

.dropdown-menu {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  background: rgba(28, 32, 40, 0.98);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border: 1px solid #3c4048;
  border-radius: 8px;
  box-shadow: 0 16px 36px rgba(0, 0, 0, 0.75);
  min-width: 270px;
  padding: 5px;
  z-index: 2000;
  display: none;
  flex-direction: column;
  gap: 2px;
}

.dropdown-menu.show {
  display: flex;
}

.dropdown-item {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 8px 10px;
  border-radius: 5px;
  cursor: pointer;
  transition: all 0.12s ease;
  color: var(--text-main);
  user-select: none;
}

.dropdown-item:hover {
  background: rgba(59, 130, 246, 0.2);
  color: #ffffff;
}

.dropdown-icon {
  font-size: 16px;
  line-height: 1.2;
  flex-shrink: 0;
}

.dropdown-text {
  display: flex;
  flex-direction: column;
}

.dropdown-title {
  font-size: 12px;
  font-weight: 600;
  color: #f1f5f9;
}

.dropdown-desc {
  font-size: 10.5px;
  color: var(--text-muted);
  margin-top: 1px;
}

.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 3px 8px;
  font-size: 11.5px;
  font-weight: 500;
  border-radius: 4px;
  cursor: pointer;
  border: 1px solid transparent;
  outline: none;
  height: 27px;
  transition: all 0.12s ease;
  white-space: nowrap;
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
  font-size: 12px;
  transition: background 0.12s ease;
  flex-shrink: 0;
}

.btn-icon:hover {
  background: rgba(255, 255, 255, 0.1);
  border-color: rgba(255, 255, 255, 0.15);
}

.btn-icon:disabled {
  opacity: 0.35;
  cursor: not-allowed;
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
  padding: 3px 7px;
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
  min-width: 0;
  min-height: 0;
  width: 100%;
  height: 100%;
  position: relative;
  overflow: hidden;
  background-color: #14161a;
  background-image: 
    radial-gradient(circle, rgba(255, 255, 255, 0.06) 1px, transparent 1px);
  background-size: 24px 24px;
  cursor: grab;
  touch-action: none;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  text-rendering: optimizeLegibility;
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
  overflow: visible;
}

.canvas-transform.is-panning {
  will-change: transform;
}

/* SVG Relationships Layer */
.links-svg {
  position: absolute;
  top: 0;
  left: 0;
  width: 10000px;
  height: 10000px;
  pointer-events: none;
  z-index: 1;
  shape-rendering: geometricPrecision;
  overflow: visible;
}

.rel-hitbox {
  fill: none;
  stroke: transparent;
  stroke-width: 18px;
  pointer-events: stroke;
  cursor: pointer;
}

/* Smart Color-Coded & Patterned Relationship Lines */
.link-path {
  fill: none;
  stroke: #3b82f6;
  stroke-width: 2px;
  stroke-linecap: round;
  transition: stroke 0.15s ease, stroke-width 0.15s ease, filter 0.15s ease;
  pointer-events: stroke;
  cursor: pointer;
}

.link-path.rel-1-1 {
  stroke: #a855f7;
}

.link-path.rel-1-n {
  stroke: #3b82f6;
}

.link-path.rel-n-n {
  stroke: #f59e0b;
}

.link-path.optional-fk {
  stroke-dasharray: 6 4;
}

.link-path:hover, .link-path.highlighted {
  stroke: #60a5fa !important;
  stroke-width: 3px;
  filter: drop-shadow(0 0 6px rgba(59, 130, 246, 0.8));
}

.link-path.selected {
  stroke: #38bdf8 !important;
  stroke-width: 3.5px !important;
  filter: drop-shadow(0 0 10px rgba(56, 189, 248, 0.9)) !important;
}

.link-endpoint {
  fill: #3b82f6;
  transition: fill 0.15s ease;
}

.link-crowfoot {
  fill: #3b82f6;
  transition: fill 0.15s ease;
}

/* Table Cards Layer */
#cardsLayer, #notesLayer {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
}

#cardsLayer {
  z-index: 2;
}

#notesLayer {
  z-index: 3;
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
  overflow: visible;
  touch-action: none;
}

.table-card.layout-transitioning {
  transition: left 0.45s cubic-bezier(0.16, 1, 0.3, 1), top 0.45s cubic-bezier(0.16, 1, 0.3, 1) !important;
}

.table-card.dragging {
  box-shadow: 0 14px 36px rgba(0, 0, 0, 0.65), 0 0 0 1px var(--card-selected-border);
  opacity: 0.96;
}

/* Floating Layout Toast Notification */
.diagram-toast {
  position: absolute;
  top: 56px;
  left: 50%;
  transform: translateX(-50%) translateY(-12px);
  background: rgba(30, 34, 43, 0.95);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border: 1px solid rgba(56, 189, 248, 0.4);
  color: #f1f5f9;
  padding: 6px 14px;
  border-radius: 20px;
  font-size: 11.5px;
  font-weight: 500;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5), 0 0 12px rgba(56, 189, 248, 0.25);
  z-index: 1000;
  display: flex;
  align-items: center;
  gap: 6px;
  opacity: 0;
  pointer-events: none;
  transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
}

.diagram-toast.show {
  opacity: 1;
  transform: translateX(-50%) translateY(0);
}

.table-card.selected, .table-card.multi-selected {
  border-color: var(--card-selected-border) !important;
  box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.45), var(--card-shadow) !important;
}

.table-card.rel-source {
  border-color: #10b981 !important;
  box-shadow: 0 0 0 2px rgba(16, 185, 129, 0.5), var(--card-shadow) !important;
}

.table-card.rel-target {
  border-color: #3b82f6 !important;
  box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.5), var(--card-shadow) !important;
}

.table-card:hover {
  border-color: #555b66;
}

/* Card Header with Color Tag Support */
.card-header {
  padding: 8px 12px;
  background: var(--card-header-bg);
  border-bottom: 1px solid var(--card-border);
  border-top-left-radius: 7px;
  border-top-right-radius: 7px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  cursor: grab;
  gap: 8px;
  position: relative;
}

.card-header:active {
  cursor: grabbing;
}

.table-card.minimized .card-header {
  border-bottom-left-radius: 7px;
  border-bottom-right-radius: 7px;
  border-bottom: none;
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

.card-visibility-badge {
  font-size: 10px;
  color: #60a5fa;
  font-family: monospace;
  background: rgba(59, 130, 246, 0.15);
  padding: 1px 4px;
  border-radius: 3px;
  margin-left: 4px;
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
  width: 22px;
  height: 22px;
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

.table-card.minimized .card-body, .table-card.minimized .card-hidden-footer {
  display: none !important;
}

.prop-row {
  display: grid;
  grid-template-columns: 1fr auto;
  align-items: center;
  padding: 5px 12px;
  font-size: 12px;
  gap: 10px;
  transition: background 0.1s ease;
  position: relative;
}

.prop-row:hover {
  background: var(--row-hover-bg);
}

.prop-row.hidden-prop {
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
  min-width: 0;
}

.prop-type-col {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  text-align: right;
  flex-shrink: 0;
}

.prop-type {
  font-family: 'JetBrains Mono', 'Fira Code', Consolas, Monaco, monospace;
  font-size: 11px;
  color: var(--type-color);
  white-space: nowrap;
  text-align: right;
}

/* Property Type Syntax Color-Coding */
.prop-type.type-num { color: #60a5fa !important; }
.prop-type.type-str { color: #34d399 !important; }
.prop-type.type-date { color: #fb923c !important; }
.prop-type.type-guid { color: #c084fc !important; }
.prop-type.type-bool { color: #fde047 !important; }

/* Interactive Two-Way Relationship Hover */
.link-path.hovered-rel {
  stroke: #38bdf8 !important;
  stroke-width: 3.5px !important;
  filter: drop-shadow(0 0 8px rgba(56, 189, 248, 0.9)) drop-shadow(0 0 16px rgba(56, 189, 248, 0.5));
  z-index: 25;
}

.table-card.hovered-rel-card {
  border-color: #38bdf8 !important;
  box-shadow: 0 0 0 2px rgba(56, 189, 248, 0.5), 0 8px 24px rgba(56, 189, 248, 0.25) !important;
}

.prop-row.hovered-rel-prop {
  background: rgba(56, 189, 248, 0.18) !important;
  color: #38bdf8 !important;
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

/* Floating Hover Actions (Hidden by default, smooth slide-in on hover) */
.prop-hover-actions {
  position: absolute;
  right: 6px;
  top: 50%;
  transform: translateY(-50%);
  display: flex;
  align-items: center;
  gap: 3px;
  opacity: 0;
  pointer-events: none;
  background: #1e222a;
  padding: 2px 4px 2px 8px;
  border-radius: 4px;
  box-shadow: -10px 0 10px #1e222a, 0 2px 6px rgba(0, 0, 0, 0.4);
  transition: opacity 0.12s ease;
  z-index: 2;
}

.prop-row:hover .prop-hover-actions {
  opacity: 1;
  pointer-events: auto;
}

/* Inline 1-Click Eye Hide Button in Hover Bar */
.prop-eye-btn {
  background: transparent;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  width: 18px;
  height: 18px;
  border-radius: 3px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: all 0.12s ease;
}

.prop-eye-btn:hover {
  color: #60a5fa;
  background: rgba(255, 255, 255, 0.12);
}

.prop-expand-btn {
  background: rgba(59, 130, 246, 0.2);
  color: #60a5fa;
  border: 1px solid rgba(59, 130, 246, 0.4);
  border-radius: 3px;
  width: 18px;
  height: 18px;
  font-size: 11px;
  font-weight: bold;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.12s ease;
}

.prop-expand-btn:hover {
  background: #3b82f6;
  color: #ffffff;
  border-color: #3b82f6;
  transform: scale(1.08);
}

/* Hidden Columns Footer Notice */
.card-hidden-footer {
  padding: 5px 12px;
  background: rgba(0, 0, 0, 0.25);
  border-top: 1px dashed var(--card-border);
  font-size: 10px;
  color: var(--text-muted);
  display: flex;
  align-items: center;
  justify-content: space-between;
  cursor: pointer;
  transition: background 0.12s ease, color 0.12s ease;
}

.card-hidden-footer:hover {
  background: rgba(59, 130, 246, 0.1);
  color: #60a5fa;
}

/* Sticky Notes on Canvas */
.sticky-note {
  position: absolute;
  width: 220px;
  min-height: 120px;
  background: #fef08a;
  color: #1f2937;
  border-radius: 6px;
  box-shadow: 0 8px 20px rgba(0, 0, 0, 0.35);
  display: flex;
  flex-direction: column;
  pointer-events: auto;
  z-index: 20;
  overflow: hidden;
  transition: box-shadow 0.15s ease;
  touch-action: none;
}

.sticky-note.dragging {
  box-shadow: 0 14px 30px rgba(0, 0, 0, 0.5);
  opacity: 0.95;
}

.sticky-note.note-emerald { background: #a7f3d0; color: #064e3b; }
.sticky-note.note-blue { background: #bfdbfe; color: #1e3a8a; }
.sticky-note.note-rose { background: #fecdd3; color: #881337; }
.sticky-note.note-purple { background: #e9d5ff; color: #581c87; }
.sticky-note.note-dark { background: #2d3748; color: #f7fafc; }

.note-header {
  padding: 6px 8px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  cursor: grab;
  background: rgba(0, 0, 0, 0.06);
}

.note-header:active {
  cursor: grabbing;
}

.note-color-dots {
  display: flex;
  align-items: center;
  gap: 4px;
}

.note-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  cursor: pointer;
  border: 1px solid rgba(0,0,0,0.15);
}

.note-close-btn {
  background: transparent;
  border: none;
  cursor: pointer;
  font-size: 11px;
  color: inherit;
  opacity: 0.6;
  padding: 1px 3px;
  border-radius: 3px;
}

.note-close-btn:hover {
  opacity: 1;
  background: rgba(0,0,0,0.1);
}

.note-body {
  flex: 1;
  padding: 8px;
}

.note-textarea {
  width: 100%;
  height: 100%;
  min-height: 80px;
  background: transparent;
  border: none;
  outline: none;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  font-size: 12px;
  line-height: 1.4;
  color: inherit;
  resize: none;
}

/* Marquee Multi-Select Box */
.marquee-box {
  position: absolute;
  border: 1px dashed #3b82f6;
  background: rgba(59, 130, 246, 0.15);
  pointer-events: none;
  z-index: 1000;
  display: none;
}

/* Floating Canvas Controls Dock (Bottom-Right) */
.floating-canvas-controls {
  position: absolute;
  bottom: 16px;
  right: 16px;
  display: flex;
  align-items: center;
  gap: 3px;
  background: rgba(24, 26, 32, 0.92);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 8px;
  padding: 3px 6px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
  z-index: 30;
  user-select: none;
}

/* Interactive Canvas Minimap */
.canvas-minimap {
  position: absolute;
  bottom: 48px;
  right: 16px;
  background: rgba(24, 26, 32, 0.92);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 8px;
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.6);
  z-index: 25;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.minimap-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 3px 8px;
  background: rgba(255, 255, 255, 0.04);
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  user-select: none;
  cursor: grab;
}

.minimap-header:active {
  cursor: grabbing;
}

.minimap-title {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-muted);
  letter-spacing: 0.3px;
}

.minimap-toggle-btn {
  font-size: 11px;
  padding: 0 4px;
  line-height: 1;
  color: var(--text-muted);
}

.minimap-body {
  position: relative;
  width: 190px;
  height: 125px;
  cursor: pointer;
}

.minimap-canvas {
  width: 100%;
  height: 100%;
  display: block;
}

.minimap-lens {
  position: absolute;
  border: 1.5px solid #60a5fa;
  background: rgba(96, 165, 250, 0.2);
  border-radius: 2px;
  pointer-events: none;
  box-shadow: 0 0 8px rgba(96, 165, 250, 0.3);
}

.canvas-minimap.collapsed .minimap-body {
  display: none;
}

.canvas-minimap.collapsed .minimap-header {
  border-bottom: none;
}

/* GitNav-Style Floating Column Visibility Popover */
.columns-popover {
  position: absolute;
  top: 100%;
  right: 0;
  margin-top: 6px;
  width: 290px;
  background: #1e2227;
  border: 1px solid #4b5263;
  border-radius: 6px;
  box-shadow: 0 12px 36px rgba(0, 0, 0, 0.7);
  z-index: 200;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  cursor: default;
}

.popover-header {
  padding: 8px 12px;
  background: #282c34;
  border-bottom: 1px solid #3c4048;
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-weight: 600;
  font-size: 11px;
  color: #ffffff;
}

.popover-close-btn {
  background: transparent;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  padding: 2px 4px;
  font-size: 11px;
  border-radius: 3px;
}

.popover-close-btn:hover {
  color: #ffffff;
  background: rgba(255, 255, 255, 0.1);
}

.popover-search {
  padding: 8px 10px;
  border-bottom: 1px solid #3c4048;
  background: #1e2227;
}

.popover-search input {
  width: 100%;
  background: #14161a;
  border: 1px solid #3c4048;
  border-radius: 4px;
  padding: 5px 8px;
  font-size: 11px;
  color: #ffffff;
  outline: none;
}

.popover-search input:focus {
  border-color: #3b82f6;
}

.popover-list {
  max-height: 240px;
  overflow-y: auto;
  padding: 4px 0;
}

.column-toggle-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 12px;
  font-size: 12px;
  cursor: pointer;
  transition: background 0.1s ease, color 0.1s ease;
  color: var(--text-main);
  gap: 8px;
}

.column-toggle-row:hover {
  background: rgba(255, 255, 255, 0.07);
}

.column-toggle-row[aria-checked="false"] {
  color: var(--text-muted);
  opacity: 0.75;
}

.column-toggle-icon {
  display: inline-flex;
  width: 16px;
  height: 16px;
  flex: 0 0 16px;
  align-items: center;
  justify-content: center;
  color: #60a5fa;
}

.column-toggle-row[aria-checked="false"] .column-toggle-icon {
  color: var(--text-muted);
}

.column-toggle-icon svg {
  width: 15px;
  height: 15px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.4;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.popover-actions {
  padding: 8px 10px;
  background: #181a1f;
  border-top: 1px solid #3c4048;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 4px;
}

.popover-btn {
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.12);
  color: var(--text-main);
  padding: 4px 8px;
  border-radius: 4px;
  font-size: 11px;
  cursor: pointer;
  transition: all 0.1s ease;
}

.popover-btn:hover {
  background: rgba(255, 255, 255, 0.15);
  color: #ffffff;
}

/* Draggable Relationship Metadata Inspector Popover */
.rel-inspector-popover {
  position: fixed;
  width: 340px;
  background: rgba(28, 31, 38, 0.95);
  backdrop-filter: blur(12px);
  border: 1px solid #4b5263;
  border-radius: 8px;
  box-shadow: 0 16px 40px rgba(0, 0, 0, 0.75);
  z-index: 500;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  font-size: 12px;
  touch-action: none;
}

.rel-inspector-header {
  padding: 10px 12px;
  background: #252830;
  border-bottom: 1px solid #3c4048;
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-weight: 600;
  font-size: 12px;
  color: #ffffff;
  cursor: grab;
}

.rel-inspector-header:active {
  cursor: grabbing;
}

.rel-inspector-body {
  padding: 10px 14px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 400px;
  overflow-y: auto;
}

.rel-inspector-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  font-size: 11.5px;
  gap: 8px;
}

.rel-inspector-label {
  color: var(--text-muted);
  font-weight: 500;
  flex-shrink: 0;
  min-width: 105px;
}

.rel-inspector-value {
  color: var(--text-main);
  font-weight: 500;
  text-align: right;
  word-break: break-all;
  font-family: 'JetBrains Mono', Consolas, monospace;
  font-size: 11px;
}

.rel-inspector-entity-box {
  padding: 6px 8px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.07);
  border-radius: 5px;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.rel-inspector-footer {
  padding: 8px 12px;
  background: #181a1f;
  border-top: 1px solid #3c4048;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
}

/* Custom Right-Click Context Menu */
.card-context-menu {
  position: fixed;
  background: #1e2227;
  border: 1px solid #4b5263;
  border-radius: 6px;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.6);
  z-index: 1000;
  min-width: 180px;
  padding: 4px 0;
  display: flex;
  flex-direction: column;
}

.context-menu-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  font-size: 12px;
  color: var(--text-main);
  cursor: pointer;
  transition: background 0.1s ease;
}

.context-menu-item:hover {
  background: #2563eb;
  color: #ffffff;
}

.context-menu-divider {
  height: 1px;
  background: #3c4048;
  margin: 4px 0;
}

.color-palette-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
}

.color-dot {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  cursor: pointer;
  border: 1px solid rgba(255, 255, 255, 0.3);
  transition: transform 0.12s ease;
}

.color-dot:hover {
  transform: scale(1.2);
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

/* High-Fidelity Glassmorphism Loading & Error Overlay */
.diagram-loading-overlay {
  position: absolute;
  inset: 0;
  background: rgba(18, 20, 26, 0.82);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9999;
  opacity: 1;
  visibility: visible;
  transition: opacity 0.28s cubic-bezier(0.16, 1, 0.3, 1), visibility 0.28s cubic-bezier(0.16, 1, 0.3, 1);
}

.diagram-loading-overlay.hidden {
  opacity: 0;
  visibility: hidden;
  pointer-events: none;
}

.loading-card {
  background: #1c2028;
  border: 1px solid #2f3542;
  border-radius: 12px;
  padding: 28px 36px;
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 12px;
  box-shadow: 0 16px 40px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(255, 255, 255, 0.05);
  max-width: 360px;
}

.loading-spinner {
  width: 38px;
  height: 38px;
  border: 3.5px solid rgba(56, 189, 248, 0.15);
  border-top-color: #38bdf8;
  border-right-color: #3b82f6;
  border-radius: 50%;
  animation: diagramSpinner 0.75s linear infinite;
}

@keyframes diagramSpinner {
  to {
    transform: rotate(360deg);
  }
}

.loading-title {
  font-size: 14.5px;
  font-weight: 600;
  color: #f1f5f9;
  letter-spacing: -0.01em;
}

.btn-danger-icon:hover {
  color: #ef4444 !important;
  background: rgba(239, 68, 68, 0.15) !important;
  border-color: rgba(239, 68, 68, 0.3) !important;
}

/* Empty Diagram Hero (Shown when no diagram exists) */
.empty-diagram-hero {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 12px;
  background: rgba(28, 32, 40, 0.95);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 14px;
  padding: 36px 44px;
  box-shadow: 0 20px 50px rgba(0, 0, 0, 0.7);
  max-width: 440px;
  z-index: 50;
}

.empty-hero-icon {
  font-size: 52px;
  line-height: 1;
  filter: drop-shadow(0 4px 12px rgba(59, 130, 246, 0.3));
}

.empty-hero-title {
  font-size: 16px;
  font-weight: 700;
  color: #f8fafc;
  letter-spacing: -0.01em;
}

.empty-hero-desc {
  font-size: 12.5px;
  color: var(--text-muted);
  line-height: 1.5;
}

/* Create Diagram Modal Dialog */
.modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(10, 12, 16, 0.75);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
  display: none;
  align-items: center;
  justify-content: center;
  z-index: 10000;
}

.modal-backdrop.show {
  display: flex;
}

.modal-card {
  background: #1e222a;
  border: 1px solid #3c4048;
  border-radius: 10px;
  box-shadow: 0 16px 40px rgba(0, 0, 0, 0.8);
  width: 360px;
  max-width: 90vw;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  animation: modalPop 0.18s cubic-bezier(0.16, 1, 0.3, 1);
}

@keyframes modalPop {
  from { transform: scale(0.94); opacity: 0; }
  to { transform: scale(1); opacity: 1; }
}

.modal-header {
  padding: 12px 16px;
  background: #252830;
  border-bottom: 1px solid #3c4048;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.modal-title {
  font-size: 13px;
  font-weight: 600;
  color: #f1f5f9;
}

.modal-body {
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.modal-label {
  font-size: 12px;
  color: var(--text-muted);
  font-weight: 500;
}

.modal-input {
  background: #14161b;
  border: 1px solid #3c4048;
  border-radius: 5px;
  padding: 8px 10px;
  font-size: 12.5px;
  color: #ffffff;
  outline: none;
  transition: border-color 0.15s ease;
}

.modal-input:focus {
  border-color: #3b82f6;
  box-shadow: 0 0 0 1px #3b82f6;
}

.modal-footer {
  padding: 12px 16px;
  background: #181a1f;
  border-top: 1px solid #3c4048;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
}

/* Floating Property DB Info Tooltip */
.prop-tooltip {
  position: absolute;
  bottom: calc(100% + 4px);
  left: 12px;
  background: rgba(15, 17, 23, 0.96);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  border: 1px solid rgba(255, 255, 255, 0.16);
  border-radius: 6px;
  padding: 5px 9px;
  font-size: 11px;
  color: #f1f5f9;
  white-space: nowrap;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.7);
  pointer-events: none;
  z-index: 1000;
  display: none;
  line-height: 1.4;
}

.prop-row:hover .prop-tooltip {
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.prop-tooltip-title {
  font-weight: 600;
  color: #60a5fa;
  font-family: 'JetBrains Mono', Consolas, Monaco, monospace;
}

.prop-tooltip-type {
  color: #94a3b8;
  font-size: 10.5px;
  font-family: 'JetBrains Mono', Consolas, Monaco, monospace;
}

.prop-unmigrated-badge {
  font-size: 9px;
  font-weight: 600;
  padding: 1px 4px;
  border-radius: 3px;
  background: rgba(234, 179, 8, 0.2);
  color: #facc15;
  border: 1px solid rgba(234, 179, 8, 0.4);
}

/* Print and PDF Generation Stylesheet */
@media print {
  body, .main-area, .canvas-viewport {
    background: #ffffff !important;
    color: #000000 !important;
    overflow: visible !important;
  }

  .sidebar, .toolbar, .canvas-minimap, .floating-canvas-controls,
  .diagram-toast, .diagram-modal, .empty-canvas-prompt, .prop-eye-btn, .prop-expand-btn {
    display: none !important;
  }

  .canvas-transform {
    transform: none !important;
    position: static !important;
  }

  .table-card {
    background: #ffffff !important;
    border: 1.5px solid #334155 !important;
    box-shadow: none !important;
    color: #0f172a !important;
    break-inside: avoid;
    page-break-inside: avoid;
    margin-bottom: 20px;
  }

  .card-header {
    background: #f1f5f9 !important;
    border-bottom: 1.5px solid #334155 !important;
    color: #0f172a !important;
  }

  .card-title {
    color: #0f172a !important;
  }

  .prop-row {
    border-bottom: 1px solid #e2e8f0 !important;
  }

  .prop-row.pk {
    background: #fef3c7 !important;
  }

  .prop-row.fk {
    background: #dbeafe !important;
  }

  .prop-name, .prop-type {
    color: #0f172a !important;
  }

  .links-svg {
    display: block !important;
  }

  .rel-path {
    stroke: #475569 !important;
  }
}

/* Code Jump Action & C# Navigation */
.card-code-btn:hover {
  background: rgba(96, 165, 250, 0.2);
  color: #60a5fa;
}

.card-focus-btn:hover {
  background: rgba(234, 179, 8, 0.2);
  color: #eab308;
}

.card-title-group {
  cursor: pointer;
}

.card-title-group:hover .card-title {
  color: #60a5fa;
}

.prop-name-text {
  cursor: pointer;
  transition: color 0.12s ease;
}

.prop-name-text:hover {
  color: #60a5fa;
  text-decoration: underline;
}

/* ======================================================== */
/* 2. Interactive Focus Mode & Neon Relationship Glow       */
/* ======================================================== */
.canvas-viewport.focus-active .table-card:not(.focused-primary):not(.focused-connected) {
  opacity: 0.14 !important;
  filter: grayscale(0.7) blur(0.5px);
  pointer-events: none;
  transition: opacity 0.25s cubic-bezier(0.16, 1, 0.3, 1), filter 0.25s cubic-bezier(0.16, 1, 0.3, 1);
}

.canvas-viewport.focus-active .sticky-note {
  opacity: 0.12 !important;
  filter: grayscale(0.8);
  pointer-events: none;
  transition: opacity 0.25s ease;
}

.canvas-viewport.focus-active .link-path:not(.focused-rel) {
  opacity: 0.05 !important;
  transition: opacity 0.25s ease;
}

.table-card.focused-primary {
  box-shadow: 0 0 0 2.5px #38bdf8, 0 16px 48px rgba(56, 189, 248, 0.45) !important;
  z-index: 60 !important;
  transition: box-shadow 0.25s ease, transform 0.25s ease;
}

.table-card.focused-connected {
  box-shadow: 0 0 0 2px #34d399, 0 12px 36px rgba(52, 211, 153, 0.35) !important;
  z-index: 50 !important;
  transition: box-shadow 0.25s ease;
}

.link-path.focused-rel {
  stroke: #38bdf8 !important;
  stroke-width: 3.5px !important;
  filter: drop-shadow(0 0 8px rgba(56, 189, 248, 0.8)) drop-shadow(0 0 16px rgba(56, 189, 248, 0.4));
  z-index: 25;
  transition: stroke 0.2s ease, stroke-width 0.2s ease;
}

/* Floating Focus Mode Banner */
.focus-mode-banner {
  position: absolute;
  top: 14px;
  left: 50%;
  transform: translateX(-50%);
  background: rgba(15, 23, 42, 0.9);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  border: 1px solid rgba(56, 189, 248, 0.4);
  color: #e2e8f0;
  padding: 6px 16px;
  border-radius: 20px;
  font-size: 12px;
  font-weight: 500;
  display: none;
  align-items: center;
  gap: 8px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5), 0 0 12px rgba(56, 189, 248, 0.2);
  z-index: 500;
  animation: slideDownFocus 0.2s ease-out;
}

.focus-mode-banner.show {
  display: flex;
}

.focus-banner-badge {
  background: rgba(56, 189, 248, 0.2);
  color: #38bdf8;
  padding: 1px 6px;
  border-radius: 10px;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.5px;
}

.focus-banner-btn {
  background: rgba(255, 255, 255, 0.1);
  border: none;
  color: #e2e8f0;
  border-radius: 4px;
  padding: 2px 8px;
  font-size: 11px;
  cursor: pointer;
  transition: all 0.12s ease;
}

.focus-banner-btn:hover {
  background: rgba(239, 68, 68, 0.2);
  color: #ef4444;
}

@keyframes slideDownFocus {
  from { opacity: 0; transform: translate(-50%, -10px); }
  to { opacity: 1; transform: translate(-50%, 0); }
}

/* ======================================================== */
/* 3. Canvas Quick Finder Modal & Smooth Navigation         */
/* ======================================================== */
.canvas-quick-finder {
  position: absolute;
  top: 16px;
  left: 50%;
  transform: translateX(-50%);
  width: 480px;
  max-width: 92vw;
  background: rgba(20, 24, 33, 0.94);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 12px;
  box-shadow: 0 24px 60px rgba(0, 0, 0, 0.7), 0 0 0 1px rgba(255, 255, 255, 0.06);
  z-index: 1000;
  display: none;
  flex-direction: column;
  overflow: hidden;
  animation: finderPopIn 0.18s cubic-bezier(0.16, 1, 0.3, 1);
}

.canvas-quick-finder.show {
  display: flex;
}

@keyframes finderPopIn {
  from { opacity: 0; transform: translate(-50%, -14px) scale(0.97); }
  to { opacity: 1; transform: translate(-50%, 0) scale(1); }
}

.finder-header {
  display: flex;
  align-items: center;
  padding: 10px 14px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  gap: 10px;
}

.finder-search-icon {
  width: 16px;
  height: 16px;
  color: #60a5fa;
  flex-shrink: 0;
}

.finder-input {
  flex: 1;
  background: transparent;
  border: none;
  outline: none;
  color: #f1f5f9;
  font-size: 13.5px;
  font-family: inherit;
}

.finder-input::placeholder {
  color: #64748b;
}

.finder-esc-badge {
  background: rgba(255, 255, 255, 0.08);
  color: #94a3b8;
  font-size: 10px;
  font-family: monospace;
  padding: 2px 6px;
  border-radius: 4px;
  border: 1px solid rgba(255, 255, 255, 0.1);
}

.finder-results {
  max-height: 280px;
  overflow-y: auto;
  padding: 6px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.finder-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 12.5px;
  color: #e2e8f0;
  transition: background 0.1s ease, color 0.1s ease;
}

.finder-item:hover, .finder-item.active {
  background: rgba(59, 130, 246, 0.2);
  color: #ffffff;
}

.finder-item-left {
  display: flex;
  align-items: center;
  gap: 8px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.finder-item-title {
  font-weight: 500;
}

.finder-item-sub {
  font-size: 11px;
  color: #94a3b8;
  font-family: monospace;
}

.finder-item-badge {
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 4px;
  font-weight: 600;
  text-transform: uppercase;
}

.finder-item-badge.table {
  background: rgba(59, 130, 246, 0.15);
  color: #60a5fa;
  border: 1px solid rgba(59, 130, 246, 0.3);
}

.finder-item-badge.column {
  background: rgba(16, 185, 129, 0.15);
  color: #34d399;
  border: 1px solid rgba(16, 185, 129, 0.3);
}

.finder-item-badge.note {
  background: rgba(234, 179, 8, 0.15);
  color: #facc15;
  border: 1px solid rgba(234, 179, 8, 0.3);
}

.finder-empty {
  padding: 20px;
  text-align: center;
  color: #64748b;
  font-size: 12px;
}

/* Pulse Highlight on Target Card */
.card-target-highlight {
  animation: cardPulseGlow 1.8s cubic-bezier(0.16, 1, 0.3, 1) forwards !important;
}

@keyframes cardPulseGlow {
  0% {
    box-shadow: 0 0 0 0 rgba(56, 189, 248, 0.9), 0 0 30px rgba(56, 189, 248, 0.8);
    transform: scale(1.04);
  }
  50% {
    box-shadow: 0 0 0 8px rgba(56, 189, 248, 0.5), 0 0 50px rgba(56, 189, 248, 0.6);
    transform: scale(1.02);
  }
  100% {
    box-shadow: 0 0 0 0 rgba(56, 189, 248, 0);
    transform: scale(1);
  }
}

.prop-target-highlight {
  animation: propPulseFlash 2s ease-out forwards;
}

@keyframes propPulseFlash {
  0% { background: rgba(56, 189, 248, 0.4); }
  50% { background: rgba(56, 189, 248, 0.25); }
  100% { background: transparent; }
}
`;
};
