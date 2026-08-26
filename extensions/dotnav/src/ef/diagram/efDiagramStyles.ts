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
  z-index: 5;
  flex-shrink: 0;
  gap: 8px;
}

.toolbar-left, .toolbar-right {
  display: flex;
  align-items: center;
  gap: 5px;
  overflow-x: auto;
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

.table-card.dragging {
  box-shadow: 0 14px 36px rgba(0, 0, 0, 0.65), 0 0 0 1px var(--card-selected-border);
  opacity: 0.96;
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

.prop-actions {
  display: flex;
  align-items: center;
  gap: 4px;
}

/* Inline 1-Click Eye Hide Button on Row Hover */
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
  opacity: 0;
  transition: opacity 0.12s ease, color 0.12s ease;
}

.prop-row:hover .prop-eye-btn {
  opacity: 0.7;
}

.prop-eye-btn:hover {
  opacity: 1 !important;
  color: #60a5fa;
  background: rgba(255, 255, 255, 0.08);
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
}

.prop-expand-btn:hover {
  background: var(--fk-color);
  color: #ffffff;
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

/* Floating Canvas Controls Dock (Bottom-Right, above Minimap) */
.floating-canvas-controls {
  position: absolute;
  bottom: 152px;
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
  bottom: 16px;
  right: 16px;
  width: 190px;
  height: 125px;
  background: rgba(24, 26, 32, 0.92);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 8px;
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.6);
  z-index: 25;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
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
  background: rgba(96, 165, 250, 0.15);
  border-radius: 2px;
  pointer-events: none;
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

.loading-subtitle {
  font-size: 12px;
  color: #94a3b8;
  line-height: 1.5;
}
`;
}
