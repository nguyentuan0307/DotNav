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
        <div class="sidebar-context-group">
          <div class="sidebar-title">
            <svg class="icon-svg" viewBox="0 0 16 16" fill="currentColor">
              <path d="M2 3.5a1.5 1.5 0 0 1 1.5-1.5h9A1.5 1.5 0 0 1 14 3.5v9a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 12.5v-9zm1.5-.5a.5.5 0 0 0-.5.5v1h10v-1a.5.5 0 0 0-.5-.5h-9zm10 2.5H2.5v6.5a.5.5 0 0 0 .5.5h9a.5.5 0 0 0 .5-.5V5.5z"/>
            </svg>
            <span id="sidebarContextTitle">DbContext</span>
          </div>
          <select class="diagram-select" id="dbContextSelect" style="width: 100%; font-weight: 600;" title="Select Active DbContext"></select>
        </div>

        <div class="search-box-wrapper">
          <svg class="search-icon-svg" viewBox="0 0 16 16" fill="currentColor">
            <path d="M11.742 10.344a6.5 6.5 0 1 0-1.397 1.398h-.001c.03.04.062.078.098.115l3.85 3.85a1 1 0 0 0 1.415-1.414l-3.85-3.85a1.007 1.007 0 0 0-.115-.1zM12 6.5a5.5 5.5 0 1 1-11 0 5.5 5.5 0 0 1 11 0z"/>
          </svg>
          <input type="text" class="search-box" id="searchBox" placeholder="Filter entities..." autocomplete="off" />
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
          <select class="diagram-select" id="diagramSelect" title="Select Saved Diagram" style="min-width: 130px;">
            <option value="">(No Diagram)</option>
          </select>

          <button class="btn-icon btn-danger-icon" id="btnDeleteDiagram" title="Delete Active Diagram">
            <svg class="icon-svg" viewBox="0 0 16 16" fill="currentColor"><path d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0V6z"/><path fill-rule="evenodd" d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1h3.5a1 1 0 0 1 1 1v1zM4.118 4 4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4H4.118zM2.5 3V2h11v1h-11z"/></svg>
          </button>

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

          <!-- Auto-Arrange Dropdown Menu -->
          <div class="dropdown-wrapper" id="arrangeDropdownWrapper">
            <button class="btn btn-secondary" id="btnArrangeDropdown" title="Select and apply diagram layout">
              <svg class="icon-svg" viewBox="0 0 16 16" fill="currentColor"><path d="M1 2.5A1.5 1.5 0 0 1 2.5 1h3A1.5 1.5 0 0 1 7 2.5v3A1.5 1.5 0 0 1 5.5 7h-3A1.5 1.5 0 0 1 1 5.5v-3zM9 2.5A1.5 1.5 0 0 1 10.5 1h3A1.5 1.5 0 0 1 15 2.5v3A1.5 1.5 0 0 1 13.5 7h-3A1.5 1.5 0 0 1 9 5.5v-3zM1 10.5A1.5 1.5 0 0 1 2.5 9h3A1.5 1.5 0 0 1 7 10.5v3A1.5 1.5 0 0 1 5.5 15h-3A1.5 1.5 0 0 1 1 13.5v-3zM9 10.5A1.5 1.5 0 0 1 10.5 9h3a1.5 1.5 0 0 1 1.5 1.5v3a1.5 1.5 0 0 1-1.5 1.5h-3A1.5 1.5 0 0 1 9 13.5v-3z"/></svg>
              Arrange ▾
            </button>
            <div class="dropdown-menu" id="arrangeDropdownMenu">
              <div class="dropdown-item" data-layout="column">
                <span class="dropdown-icon">📐</span>
                <div class="dropdown-text">
                  <div class="dropdown-title">Columns (DAG Flow)</div>
                  <div class="dropdown-desc">Left-to-right dependency columns</div>
                </div>
              </div>
              <div class="dropdown-item" data-layout="hierarchical">
                <span class="dropdown-icon">🌲</span>
                <div class="dropdown-text">
                  <div class="dropdown-title">Tree Hierarchy</div>
                  <div class="dropdown-desc">Roots at top, descendants cascade down</div>
                </div>
              </div>
              <div class="dropdown-item" data-layout="radial">
                <span class="dropdown-icon">⭐</span>
                <div class="dropdown-text">
                  <div class="dropdown-title">Radial Star</div>
                  <div class="dropdown-desc">Central hub entity with satellites in orbit</div>
                </div>
              </div>
              <div class="dropdown-item" data-layout="grid">
                <span class="dropdown-icon">▦</span>
                <div class="dropdown-text">
                  <div class="dropdown-title">Compact Grid</div>
                  <div class="dropdown-desc">Clean square grid matrix layout</div>
                </div>
              </div>
            </div>
          </div>

          <!-- Add Sticky Note Button -->
          <button class="btn btn-secondary" id="btnAddNote" title="Add Sticky Note to Canvas">
            <svg class="icon-svg" viewBox="0 0 16 16" fill="currentColor"><path d="M2.5 1A1.5 1.5 0 0 0 1 2.5v11A1.5 1.5 0 0 0 2.5 15h6.086a1.5 1.5 0 0 0 1.06-.44l4.915-4.914A1.5 1.5 0 0 0 15 8.586V2.5A1.5 1.5 0 0 0 13.5 1h-11zM2 2.5a.5.5 0 0 1 .5-.5h11a.5.5 0 0 1 .5.5V8H9.5A1.5 1.5 0 0 0 8 9.5V14H2.5a.5.5 0 0 1-.5-.5v-11zm7 7V14l5-5H9.5a.5.5 0 0 1-.5-.5z"/></svg>
            + Note
          </button>

          <!-- Quick Finder Button -->
          <button class="btn btn-secondary" id="btnQuickFind" title="Quick Find Table or Column (Ctrl+F / Cmd+F)">
            <svg class="icon-svg" viewBox="0 0 16 16" fill="currentColor"><path d="M11.742 10.344a6.5 6.5 0 1 0-1.397 1.398h-.001c.03.04.062.078.098.115l3.85 3.85a1 1 0 0 0 1.415-1.414l-3.85-3.85a1.007 1.007 0 0 0-.115-.1zM12 6.5a5.5 5.5 0 1 1-11 0 5.5 5.5 0 0 1 11 0z"/></svg>
            Find
          </button>

          <div class="toolbar-divider"></div>

          <!-- Column View Mode Segmented Control -->
          <div class="filter-chips-group" title="Column Visibility Mode">
            <button class="filter-chip active" id="chipAll" data-mode="all">All</button>
            <button class="filter-chip" id="chipKeys" data-mode="keys">🔑 Keys</button>
            <button class="filter-chip" id="chipNoAudit" data-mode="no-audit">🛡️ No Audit</button>
          </div>

          <div class="toolbar-divider"></div>

          <!-- Snap to Grid & Line Style Controls -->
          <div class="filter-chips-group">
            <button class="filter-chip active" id="btnToggleSnap" title="Snap to Grid (20px) — Hold Alt to bypass">🧲 Snap</button>
            <button class="filter-chip" id="btnToggleLineStyle" title="Switch Line Style: Curved / Right-Angle" data-style="curved">🌊 Curved</button>
          </div>
        </div>

        <div class="toolbar-right">
          <!-- Custom Floating Export Dropdown Menu -->
          <div class="dropdown-wrapper" id="exportDropdownWrapper">
            <button class="btn btn-secondary" id="btnExportDropdown" title="Export diagram image or ERD code">
              <svg class="icon-svg" viewBox="0 0 16 16" fill="currentColor"><path fill-rule="evenodd" d="M3.5 6a.5.5 0 0 0-.5.5v5a.5.5 0 0 0 .5.5h9a.5.5 0 0 0 .5-.5v-5a.5.5 0 0 0-1 0v4.5h-8V6.5a.5.5 0 0 0-.5-.5z"/><path fill-rule="evenodd" d="M7.646 1.146a.5.5 0 0 1 .708 0l3 3a.5.5 0 0 1-.708.708L8.5 2.707V10.5a.5.5 0 0 1-1 0V2.707L5.354 4.854a.5.5 0 1 1-.708-.708l3-3z"/></svg>
              Export ▾
            </button>
            <div class="dropdown-menu" id="exportDropdownMenu" style="right: 0; left: auto; min-width: 290px;">
              <div class="dropdown-item" data-export="png-dark">
                <span class="dropdown-icon">📸</span>
                <div class="dropdown-text">
                  <div class="dropdown-title">PNG Image (Dark Theme)</div>
                  <div class="dropdown-desc">High-DPI transparent dark background</div>
                </div>
              </div>
              <div class="dropdown-item" data-export="png-light">
                <span class="dropdown-icon">📄</span>
                <div class="dropdown-text">
                  <div class="dropdown-title">PNG Image (Light Print)</div>
                  <div class="dropdown-desc">High-DPI crisp white background</div>
                </div>
              </div>
              <div class="dropdown-item" data-export="svg">
                <span class="dropdown-icon">📐</span>
                <div class="dropdown-text">
                  <div class="dropdown-title">Vector Graphic (SVG)</div>
                  <div class="dropdown-desc">Infinitely scalable vector format</div>
                </div>
              </div>
              <div class="dropdown-item" data-export="drawio">
                <span class="dropdown-icon">📊</span>
                <div class="dropdown-text">
                  <div class="dropdown-title">Draw.io Diagram (.drawio)</div>
                  <div class="dropdown-desc">Editable diagram for diagrams.net & VS Code</div>
                </div>
              </div>
              <div class="dropdown-item" data-export="markdown">
                <span class="dropdown-icon">📝</span>
                <div class="dropdown-text">
                  <div class="dropdown-title">Markdown Data Dictionary (.md)</div>
                  <div class="dropdown-desc">Table schema documentation & types</div>
                </div>
              </div>
              <div class="dropdown-item" data-export="print">
                <span class="dropdown-icon">🖨️</span>
                <div class="dropdown-text">
                  <div class="dropdown-title">Print / PDF Document</div>
                  <div class="dropdown-desc">Export via native print dialog</div>
                </div>
              </div>
              <div class="dropdown-item" data-export="mermaid">
                <span class="dropdown-icon">📋</span>
                <div class="dropdown-text">
                  <div class="dropdown-title">Copy Mermaid ERD Code</div>
                  <div class="dropdown-desc">Copy markdown ERD syntax to clipboard</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Canvas Viewport -->
      <div class="canvas-viewport" id="viewport">
        <!-- Floating Toast Message -->
        <div class="diagram-toast" id="diagramToast">✨ Layout Applied</div>

        <!-- Floating Focus Mode Banner -->
        <div class="focus-mode-banner" id="focusModeBanner">
          <span class="focus-banner-badge">FOCUS MODE</span>
          <span id="focusBannerText">Focusing on Entity</span>
          <button class="focus-banner-btn" id="btnExitFocusMode" title="Exit Focus Mode (Esc)">✕ Exit Focus</button>
        </div>

        <!-- Floating Canvas Quick Finder Modal -->
        <div class="canvas-quick-finder" id="canvasQuickFinder">
          <div class="finder-header">
            <svg class="finder-search-icon" style="width: 16px; height: 16px; min-width: 16px; min-height: 16px; flex-shrink: 0;" viewBox="0 0 16 16" fill="currentColor"><path d="M11.742 10.344a6.5 6.5 0 1 0-1.397 1.398h-.001c.03.04.062.078.098.115l3.85 3.85a1 1 0 0 0 1.415-1.414l-3.85-3.85a1.007 1.007 0 0 0-.115-.1zM12 6.5a5.5 5.5 0 1 1-11 0 5.5 5.5 0 0 1 11 0z"/></svg>
            <input type="text" id="finderInput" class="finder-input" placeholder="Find table, column, or note... (↑↓ to navigate, Enter to jump)" autocomplete="off" spellcheck="false" />
            <span class="finder-esc-badge">ESC</span>
          </div>
          <div class="finder-results" id="finderResults"></div>
        </div>

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

        <!-- Floating Canvas Controls Dock (Bottom-Right) -->
        <div class="floating-canvas-controls" id="floatingZoomControls">
          <button class="btn-icon" id="btnZoomOut" title="Zoom Out">−</button>
          <span id="zoomDisplay" class="zoom-display">100%</span>
          <button class="btn-icon" id="btnZoomIn" title="Zoom In">+</button>
          <button class="btn-icon" id="btnZoomReset" title="Reset Zoom (Fit)">⛶</button>
        </div>

        <!-- Interactive Canvas Minimap -->
        <div class="canvas-minimap" id="canvasMinimap" title="Click or drag to pan canvas">
          <div class="minimap-header" id="minimapHeader">
            <span class="minimap-title">🗺️ Map</span>
            <button class="btn-icon minimap-toggle-btn" id="btnToggleMinimap" title="Toggle Minimap">▾</button>
          </div>
          <div class="minimap-body" id="minimapBody">
            <canvas class="minimap-canvas" id="minimapCanvas" width="190" height="125"></canvas>
            <div class="minimap-lens" id="minimapLens"></div>
          </div>
        </div>

        <!-- Empty Canvas Prompt (When diagram exists but has no entities) -->
        <div class="empty-canvas-prompt" id="emptyPrompt">
          <div class="empty-icon">🗄️</div>
          <div style="font-size: 15px; font-weight: 600; color: var(--text-main);">No Entities on Canvas</div>
          <div style="font-size: 12px; max-width: 300px; color: var(--text-muted); line-height: 1.5;">Drag tables from the palette on the left or click <b>Add All to Canvas</b> to explore your interactive ERD diagram.</div>
        </div>

        <!-- Empty Diagram Hero (Shown when NO diagram exists yet) -->
        <div class="empty-diagram-hero" id="emptyDiagramHero" style="display: none;">
          <div class="empty-hero-icon">📐</div>
          <div class="empty-hero-title">No Diagram Selected</div>
          <div class="empty-hero-desc">Create a new diagram to start mapping entity relationships, layouts, and custom architecture.</div>
          <button class="btn btn-primary" id="btnHeroCreateDiagram" style="padding: 7px 20px; font-size: 12.5px; margin-top: 10px;">
            ➕ Create New Diagram
          </button>
        </div>

        <!-- Create Diagram Modal Dialog -->
        <div class="modal-backdrop" id="createDiagramModal">
          <div class="modal-card">
            <div class="modal-header">
              <span class="modal-title">Create New Diagram</span>
              <button class="btn-icon" id="btnModalClose" title="Close">✕</button>
            </div>
            <div class="modal-body">
              <label class="modal-label" for="modalDiagramNameInput">Diagram Name:</label>
              <input type="text" class="modal-input" id="modalDiagramNameInput" placeholder="e.g. Overview, OrderModule, Auth..." autocomplete="off" />
            </div>
            <div class="modal-footer">
              <button class="btn btn-secondary" id="btnModalCancel">Cancel</button>
              <button class="btn btn-primary" id="btnModalConfirmCreate">Create Diagram</button>
            </div>
          </div>
        </div>

        <!-- High-Fidelity Glassmorphism Loading & Error Overlay -->
        <div class="diagram-loading-overlay" id="loadingOverlay">
          <div class="loading-card" id="loadingCard">
            <div class="loading-spinner" id="loadingSpinner"></div>
            <div class="loading-title" id="loadingTitle">Scanning EF Core Models...</div>
            <div class="loading-subtitle" id="loadingStatusText">Discovering DbContexts, entities, and relationships in solution</div>
            <button class="btn btn-primary" id="btnRetryScan" style="display: none; margin-top: 8px; font-size: 12px; padding: 6px 16px;">
              🔄 Retry Scan
            </button>
          </div>
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
