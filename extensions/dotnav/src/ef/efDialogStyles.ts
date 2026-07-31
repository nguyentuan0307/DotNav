export const efDialogStyles = `  :root {
    color-scheme: light dark;
    --surface-border: var(--vscode-panel-border, var(--vscode-widget-border, rgba(128, 128, 128, .28)));
    --surface-raised: var(--vscode-editorWidget-background, var(--vscode-editor-background));
    --surface-muted: var(--vscode-sideBar-background, var(--vscode-editor-background));
    --accent: var(--vscode-focusBorder, var(--vscode-button-background));
  }
  * { box-sizing: border-box; }
  html, body { min-height: 100%; overflow-x: hidden; }
  body {
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
    color: var(--vscode-foreground);
    background: var(--vscode-editor-background);
    margin: 0;
  }
  button, input { font: inherit; }
  button { border: 0; }
  .icon { width: 16px; height: 16px; display: block; fill: currentColor; flex: 0 0 auto; }

  .center-header {
    position: sticky;
    top: 0;
    z-index: 30;
    display: flex;
    align-items: center;
    gap: 18px;
    min-height: 66px;
    padding: 10px 20px;
    border-bottom: 1px solid var(--surface-border);
    background: var(--vscode-titleBar-activeBackground, var(--vscode-editor-background));
    box-shadow: 0 1px 8px rgba(0, 0, 0, .12);
  }
  .brand { display: flex; align-items: center; gap: 10px; min-width: 180px; }
  .brand-mark {
    display: grid;
    place-items: center;
    width: 34px;
    height: 34px;
    border-radius: 9px;
    color: var(--vscode-button-foreground);
    background: var(--vscode-button-background);
    box-shadow: inset 0 0 0 1px rgba(255, 255, 255, .12);
  }
  .brand-mark .icon { width: 19px; height: 19px; }
  .center-title { font-weight: 650; line-height: 1.25; white-space: nowrap; }
  .center-subtitle {
    margin-top: 1px;
    color: var(--vscode-descriptionForeground);
    font-size: .78em;
    white-space: nowrap;
  }
  .target-summary {
    display: flex;
    align-items: center;
    gap: 7px;
    min-width: 0;
    overflow: hidden;
  }
  .context-pill {
    display: inline-flex;
    align-items: center;
    min-width: 0;
    max-width: 280px;
    height: 30px;
    border: 1px solid var(--surface-border);
    border-radius: 15px;
    background: var(--vscode-badge-background);
    color: var(--vscode-badge-foreground);
    overflow: hidden;
  }
  .context-label {
    padding: 0 6px 0 10px;
    color: inherit;
    font-size: .68em;
    font-weight: 700;
    letter-spacing: .06em;
    opacity: .68;
    text-transform: uppercase;
  }
  .context-value {
    min-width: 0;
    padding: 0 10px 0 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: .84em;
    font-weight: 550;
  }
  .toolbar { margin-left: auto; display: flex; align-items: center; gap: 4px; }
  .toolbar-button {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-height: 32px;
    padding: 5px 8px;
    border-radius: 5px;
    cursor: pointer;
    color: var(--vscode-foreground);
    background: transparent;
  }
  .toolbar-button:hover:not(:disabled) { background: var(--vscode-toolbar-hoverBackground); }
  .toolbar-button:focus-visible {
    outline: 1px solid var(--vscode-focusBorder);
    outline-offset: 1px;
  }
  .toolbar-label { font-size: .86em; }
  .locale-switch {
    display: flex;
    align-items: center;
    height: 28px;
    margin-right: 4px;
    padding: 2px;
    border: 1px solid var(--surface-border);
    border-radius: 6px;
    background: var(--surface-muted);
  }
  .locale-button {
    min-width: 31px;
    height: 22px;
    padding: 2px 6px;
    border-radius: 4px;
    cursor: pointer;
    color: var(--vscode-descriptionForeground);
    background: transparent;
    font-size: .72em;
    font-weight: 700;
  }
  .locale-button.active {
    color: var(--vscode-button-foreground);
    background: var(--vscode-button-background);
  }

  .center-layout {
    display: grid;
    grid-template-columns: 224px minmax(0, 760px);
    justify-content: center;
    gap: 36px;
    width: 100%;
    max-width: 1120px;
    margin: 0 auto;
    padding: 32px 28px 56px;
  }
  .center-nav {
    position: sticky;
    top: 94px;
    align-self: start;
    max-height: calc(100vh - 116px);
    padding: 4px 18px 12px 0;
    border-right: 1px solid var(--surface-border);
    overflow-y: auto;
  }
  .nav-group { margin: 0 0 20px; }
  .nav-group h2 {
    margin: 0 9px 6px;
    color: var(--vscode-descriptionForeground);
    font-size: .7em;
    font-weight: 700;
    letter-spacing: .1em;
    text-transform: uppercase;
  }
  button.nav-item {
    position: relative;
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    min-height: 34px;
    margin: 2px 0;
    padding: 7px 10px;
    border-radius: 6px;
    text-align: left;
    cursor: pointer;
    color: var(--vscode-foreground);
    background: transparent;
  }
  button.nav-item::before {
    content: '';
    position: absolute;
    left: 0;
    top: 7px;
    bottom: 7px;
    width: 2px;
    border-radius: 2px;
    background: transparent;
  }
  button.nav-item:hover { background: var(--vscode-list-hoverBackground); }
  button.nav-item:focus-visible {
    outline: 1px solid var(--vscode-focusBorder);
    outline-offset: -1px;
  }
  button.nav-item.active {
    color: var(--vscode-list-activeSelectionForeground);
    background: var(--vscode-list-activeSelectionBackground);
    font-weight: 600;
  }
  button.nav-item.active::before { background: currentColor; }
  .nav-icon { color: var(--vscode-descriptionForeground); opacity: .9; }
  button.nav-item.active .nav-icon { color: inherit; opacity: 1; }
  .nav-group:last-child .nav-item { color: var(--vscode-errorForeground); }

  .shell { width: 100%; min-width: 0; }
  .action-heading {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 20px;
    margin: 1px 2px 22px;
  }
  .action-heading-copy { min-width: 0; }
  .eyebrow {
    margin-bottom: 7px;
    color: var(--vscode-textLink-foreground);
    font-size: .72em;
    font-weight: 700;
    letter-spacing: .11em;
    text-transform: uppercase;
  }
  h1 {
    margin: 0;
    color: var(--vscode-foreground);
    font-size: 1.75em;
    font-weight: 650;
    line-height: 1.25;
    letter-spacing: -.015em;
  }
  .action-description {
    max-width: 640px;
    margin: 8px 0 0;
    color: var(--vscode-descriptionForeground);
    font-size: .96em;
    line-height: 1.55;
  }
  .operation-progress {
    margin: 0 0 16px;
    padding: 14px 16px;
    border: 1px solid var(--surface-border);
    border-radius: 9px;
    background: var(--surface-raised);
    box-shadow: 0 4px 18px rgba(0, 0, 0, .08);
  }
  .operation-progress[hidden] { display: none; }
  .progress-heading {
    display: flex;
    align-items: center;
    gap: 9px;
    margin-bottom: 11px;
  }
  .progress-heading .icon { color: var(--vscode-textLink-foreground); }
  .progress-title { font-size: .9em; font-weight: 650; }
  .progress-state {
    margin-left: auto;
    color: var(--vscode-descriptionForeground);
    font-size: .75em;
  }
  .progress-track {
    position: relative;
    height: 3px;
    margin-bottom: 13px;
    border-radius: 2px;
    background: var(--vscode-progressBar-background, var(--surface-border));
    overflow: hidden;
    opacity: .45;
  }
  .progress-bar {
    position: absolute;
    inset: 0 auto 0 0;
    width: 0;
    background: var(--vscode-progressBar-background, var(--vscode-textLink-foreground));
    transition: width .18s ease;
  }
  .operation-progress.running .progress-track { opacity: 1; }
  .operation-progress.running .progress-bar.indeterminate {
    width: 36%;
    animation: progress-slide 1.15s ease-in-out infinite;
  }
  .operation-progress.success .progress-bar { width: 100%; }
  .operation-progress.error .progress-bar,
  .operation-progress.cancelled .progress-bar {
    width: 100%;
    background: var(--vscode-statusBarItem-errorBackground, var(--vscode-inputValidation-errorBorder));
  }
  @keyframes progress-slide {
    from { transform: translateX(-110%); }
    to { transform: translateX(310%); }
  }
  .progress-steps {
    display: flex;
    flex-wrap: wrap;
    gap: 8px 18px;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .progress-step {
    display: grid;
    grid-template-columns: 16px auto;
    column-gap: 6px;
    color: var(--vscode-descriptionForeground);
    font-size: .78em;
  }
  .progress-step.active { color: var(--vscode-foreground); font-weight: 600; }
  .progress-step.complete .step-mark { color: var(--vscode-testing-iconPassed, #4caf50); }
  .progress-step.error .step-mark { color: var(--vscode-errorForeground); }
  .step-detail {
    grid-column: 2;
    margin-top: 1px;
    color: var(--vscode-descriptionForeground);
    font-size: .9em;
    font-weight: 400;
  }
  .help-open {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 7px;
    flex: 0 0 auto;
    min-height: 32px;
    margin-top: 17px;
    padding: 5px 11px;
    border: 1px solid var(--surface-border);
    border-radius: 5px;
    color: var(--vscode-button-secondaryForeground);
    background: var(--vscode-button-secondaryBackground);
    cursor: pointer;
  }
  .help-open:hover { background: var(--vscode-button-secondaryHoverBackground); }
  .help-open .icon { width: 14px; height: 14px; }
  .help-backdrop {
    position: fixed;
    inset: 0;
    z-index: 40;
    opacity: 0;
    visibility: hidden;
    background: rgba(0, 0, 0, .42);
    backdrop-filter: blur(1px);
    transition: opacity .16s ease, visibility .16s ease;
  }
  .help-backdrop.open {
    opacity: 1;
    visibility: visible;
  }
  .help-drawer {
    position: fixed;
    inset: 0 0 0 auto;
    z-index: 41;
    display: flex;
    flex-direction: column;
    width: min(480px, calc(100vw - 32px));
    height: 100vh;
    color: var(--vscode-foreground);
    background: var(--surface-raised);
    border-left: 1px solid var(--surface-border);
    box-shadow: -16px 0 42px rgba(0, 0, 0, .28);
    transform: translateX(102%);
    visibility: hidden;
    transition: transform .18s ease, visibility .18s ease;
  }
  .help-drawer.open {
    transform: translateX(0);
    visibility: visible;
  }
  body.help-open { overflow: hidden; }
  .help-drawer-header {
    display: flex;
    align-items: center;
    gap: 11px;
    flex: 0 0 auto;
    min-height: 64px;
    padding: 10px 12px 10px 16px;
    border-bottom: 1px solid var(--surface-border);
  }
  .guide-summary-icon {
    display: grid;
    place-items: center;
    flex: 0 0 auto;
    width: 30px;
    height: 30px;
    border-radius: 7px;
    color: var(--vscode-button-foreground);
    background: var(--vscode-button-background);
  }
  .guide-summary-copy { display: grid; gap: 2px; }
  .guide-title { color: var(--vscode-foreground); font-size: .9em; font-weight: 650; }
  .guide-caption { color: var(--vscode-descriptionForeground); font-size: .78em; font-weight: 400; }
  .help-close {
    display: grid;
    place-items: center;
    flex: 0 0 auto;
    width: 32px;
    height: 32px;
    margin-left: auto;
    padding: 0;
    border-radius: 5px;
    color: var(--vscode-foreground);
    background: transparent;
    font-size: 1.35em;
    line-height: 1;
    cursor: pointer;
  }
  .help-close:hover { background: var(--vscode-toolbar-hoverBackground); }
  .guide-body {
    flex: 1 1 auto;
    padding: 20px;
    background: var(--surface-muted);
    overflow-y: auto;
    overscroll-behavior: contain;
  }
  .guide-body section { min-width: 0; }
  .guide-body h2 {
    margin: 0 0 7px;
    color: var(--vscode-foreground);
    font-size: .8em;
    font-weight: 700;
    letter-spacing: .035em;
    text-transform: uppercase;
  }
  .guide-body p {
    margin: 0;
    color: var(--vscode-descriptionForeground);
    font-size: .84em;
    line-height: 1.55;
  }
  .guide-purpose, .guide-result { padding: 0 0 15px; }
  .guide-columns {
    display: grid;
    grid-template-columns: 1fr;
    gap: 16px;
    padding: 15px 0;
    border-top: 1px solid var(--surface-border);
    border-bottom: 1px solid var(--surface-border);
  }
  .guide-body ul {
    margin: 0;
    padding-left: 18px;
    color: var(--vscode-descriptionForeground);
    font-size: .84em;
    line-height: 1.5;
  }
  .guide-body li + li { margin-top: 5px; }
  .field-guide { padding: 16px 0 4px; }
  .guide-field {
    display: grid;
    grid-template-columns: 1fr;
    gap: 5px;
    padding: 10px 0;
    border-top: 1px solid var(--surface-border);
  }
  .guide-field-heading { display: flex; align-items: flex-start; gap: 7px; min-width: 0; }
  .guide-field-name { font-size: .84em; font-weight: 600; overflow-wrap: anywhere; }
  .field-badge {
    flex: 0 0 auto;
    padding: 1px 5px;
    border: 1px solid var(--surface-border);
    border-radius: 8px;
    color: var(--vscode-descriptionForeground);
    font-size: .62em;
    font-weight: 650;
    line-height: 1.4;
    text-transform: uppercase;
  }
  .field-badge.required {
    color: var(--vscode-inputValidation-warningForeground, var(--vscode-editorWarning-foreground));
    border-color: var(--vscode-editorWarning-foreground);
  }
  .guide-field > p { grid-column: 1; }
  .guide-example { margin-top: 4px !important; font-family: var(--vscode-editor-font-family, monospace); }
  .guide-result {
    padding-top: 15px;
    border-top: 1px solid var(--surface-border);
  }
  .guide-caution {
    margin-top: 2px;
    padding: 11px 12px;
    border-left: 3px solid var(--vscode-editorWarning-foreground);
    border-radius: 4px;
    background: var(--vscode-inputValidation-warningBackground, var(--surface-raised));
  }
  .workspace-card, .command-panel {
    border: 1px solid var(--surface-border);
    border-radius: 9px;
    background: var(--surface-raised);
    box-shadow: 0 4px 18px rgba(0, 0, 0, .08);
    overflow: visible;
  }
  .workspace-card.danger-workspace {
    border-color: var(--vscode-inputValidation-errorBorder, var(--vscode-errorForeground));
  }
  .card-heading {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding: 15px 18px;
    border-bottom: 1px solid var(--surface-border);
  }
  .card-title { font-size: .94em; font-weight: 650; }
  .card-caption { color: var(--vscode-descriptionForeground); font-size: .8em; }
  #form { padding: 19px 18px 4px; }
  .row { position: relative; margin: 0 0 17px; }
  .field-label-row { display: flex; justify-content: space-between; margin-bottom: 6px; }
  .field-line { display: flex; align-items: center; gap: 8px; }
  .field-line > .combo, .field-line > input { flex: 1 1 auto; min-width: 0; }
  label {
    display: block;
    color: var(--vscode-foreground);
    font-size: .86em;
    font-weight: 600;
  }
  .required-mark { margin-left: 4px; color: var(--vscode-errorForeground); }
  input[type="text"], input[type="password"] {
    width: 100%;
    height: 34px;
    padding: 6px 10px;
    border: 1px solid var(--vscode-input-border, var(--surface-border));
    border-radius: 5px;
    color: var(--vscode-input-foreground);
    background: var(--vscode-input-background);
    transition: border-color 100ms ease, box-shadow 100ms ease;
  }
  input::placeholder { color: var(--vscode-input-placeholderForeground); }
  input:focus {
    outline: none;
    border-color: var(--vscode-focusBorder);
    box-shadow: 0 0 0 1px var(--vscode-focusBorder);
  }
  .hint {
    margin: 6px 0 0;
    color: var(--vscode-descriptionForeground);
    font-size: .8em;
    line-height: 1.45;
  }
  button.inline {
    min-height: 34px;
    padding: 6px 11px;
    white-space: nowrap;
    font-size: .84em;
  }

  .checkbox-row {
    padding: 10px 11px;
    border: 1px solid var(--surface-border);
    border-radius: 6px;
    background: var(--surface-muted);
  }
  label.check {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    margin: 0;
    cursor: pointer;
    color: var(--vscode-foreground);
    font-weight: 500;
  }
  label.check input {
    position: absolute;
    width: 1px;
    height: 1px;
    opacity: 0;
  }
  .check-control {
    position: relative;
    flex: 0 0 auto;
    width: 16px;
    height: 16px;
    margin-top: 1px;
    border: 1px solid var(--vscode-checkbox-border, var(--surface-border));
    border-radius: 3px;
    background: var(--vscode-checkbox-background, var(--vscode-input-background));
  }
  label.check input:checked + .check-control {
    border-color: var(--vscode-checkbox-selectBorder, var(--vscode-focusBorder));
    background: var(--vscode-checkbox-selectBackground, var(--vscode-button-background));
  }
  label.check input:checked + .check-control::after {
    content: '';
    position: absolute;
    left: 4px;
    top: 1px;
    width: 5px;
    height: 9px;
    border: solid var(--vscode-checkbox-foreground, var(--vscode-button-foreground));
    border-width: 0 2px 2px 0;
    transform: rotate(45deg);
  }
  label.check input:focus-visible + .check-control {
    outline: 1px solid var(--vscode-focusBorder);
    outline-offset: 2px;
  }
  .check-copy { display: grid; gap: 3px; }
  .check-hint {
    color: var(--vscode-descriptionForeground);
    font-size: .82em;
    font-weight: 400;
    line-height: 1.4;
  }

  .combo { position: relative; }
  .combo-input { padding-right: 30px !important; cursor: pointer; text-overflow: ellipsis; }
  .chevron {
    position: absolute;
    right: 11px;
    top: 50%;
    width: 7px;
    height: 7px;
    margin-top: -5px;
    border-right: 1px solid var(--vscode-descriptionForeground);
    border-bottom: 1px solid var(--vscode-descriptionForeground);
    transform: rotate(45deg);
    pointer-events: none;
  }
  .combo-list {
    position: absolute;
    z-index: 40;
    left: 0;
    right: 0;
    top: 38px;
    max-height: 280px;
    padding: 4px;
    border: 1px solid var(--vscode-focusBorder);
    border-radius: 6px;
    background: var(--vscode-dropdown-background, var(--vscode-editorWidget-background));
    box-shadow: 0 8px 24px rgba(0, 0, 0, .32);
    overflow-y: auto;
  }
  .combo-option {
    display: flex;
    align-items: baseline;
    gap: 12px;
    min-height: 30px;
    padding: 6px 8px;
    border-radius: 4px;
    cursor: pointer;
    color: var(--vscode-dropdown-foreground, var(--vscode-foreground));
  }
  .combo-option .opt-label {
    flex: 0 1 auto;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .combo-option .opt-desc {
    flex: 1 1 auto;
    color: var(--vscode-descriptionForeground);
    font-size: .8em;
    text-align: right;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    direction: rtl;
  }
  .combo-option.active, .combo-option:hover {
    color: var(--vscode-list-activeSelectionForeground);
    background: var(--vscode-list-activeSelectionBackground);
  }
  .combo-option.active .opt-desc, .combo-option:hover .opt-desc { color: inherit; opacity: .75; }
  .combo-empty { padding: 8px 10px; color: var(--vscode-descriptionForeground); font-size: .86em; }

  details.advanced {
    margin: 4px 0 14px;
    border: 1px solid var(--surface-border);
    border-radius: 6px;
    background: var(--surface-muted);
  }
  details.advanced > summary {
    position: relative;
    padding: 10px 34px 10px 12px;
    cursor: pointer;
    list-style: none;
    color: var(--vscode-foreground);
    font-size: .85em;
    font-weight: 600;
    user-select: none;
  }
  details.advanced > summary::-webkit-details-marker { display: none; }
  details.advanced > summary::after {
    content: '';
    position: absolute;
    right: 14px;
    top: 13px;
    width: 7px;
    height: 7px;
    border-right: 1px solid currentColor;
    border-bottom: 1px solid currentColor;
    transform: rotate(45deg);
  }
  details.advanced[open] > summary::after { top: 16px; transform: rotate(225deg); }
  .advanced-body {
    padding: 15px 12px 1px;
    border-top: 1px solid var(--surface-border);
  }

  .warning {
    position: relative;
    margin: 0 0 16px;
    padding: 11px 14px 11px 38px;
    border: 1px solid var(--vscode-inputValidation-warningBorder, var(--vscode-editorWarning-foreground));
    border-radius: 7px;
    color: var(--vscode-foreground);
    background: var(--vscode-inputValidation-warningBackground, var(--surface-muted));
    white-space: pre-wrap;
    font-size: .88em;
    line-height: 1.45;
  }
  .warning::before {
    content: '!';
    position: absolute;
    left: 13px;
    top: 10px;
    display: grid;
    place-items: center;
    width: 17px;
    height: 17px;
    border-radius: 50%;
    color: var(--vscode-editor-background);
    background: var(--vscode-editorWarning-foreground);
    font-size: .76em;
    font-weight: 800;
  }
  .status {
    margin: 0 18px 15px;
    padding: 9px 11px;
    border-radius: 5px;
    color: var(--vscode-descriptionForeground);
    background: var(--surface-muted);
    font-size: .84em;
    line-height: 1.45;
    white-space: pre-wrap;
  }
  .status:empty { display: none; }
  .status.error {
    color: var(--vscode-inputValidation-errorForeground, var(--vscode-errorForeground));
    background: var(--vscode-inputValidation-errorBackground, var(--surface-muted));
    border: 1px solid var(--vscode-inputValidation-errorBorder, var(--vscode-errorForeground));
  }

  .command-panel {
    margin-top: 14px;
    overflow: hidden;
    box-shadow: none;
  }
  .command-panel > summary {
    position: relative;
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 44px;
    padding: 10px 42px 10px 13px;
    cursor: pointer;
    list-style: none;
    user-select: none;
  }
  .command-panel > summary::-webkit-details-marker { display: none; }
  .command-panel > summary::after {
    content: '';
    position: absolute;
    right: 16px;
    width: 7px;
    height: 7px;
    border-right: 1px solid currentColor;
    border-bottom: 1px solid currentColor;
    transform: rotate(45deg);
  }
  .command-panel[open] > summary::after { transform: rotate(225deg); }
  .command-summary-icon {
    display: grid;
    place-items: center;
    width: 26px;
    height: 26px;
    border-radius: 5px;
    color: var(--vscode-textLink-foreground);
    background: var(--vscode-textCodeBlock-background, var(--surface-muted));
  }
  .command-summary-copy { display: grid; gap: 2px; }
  .command-title { font-size: .86em; font-weight: 650; }
  .command-caption { color: var(--vscode-descriptionForeground); font-size: .76em; font-weight: 400; }
  .command-body {
    position: relative;
    padding: 12px 46px 12px 14px;
    border-top: 1px solid var(--surface-border);
    background: var(--vscode-textCodeBlock-background, var(--surface-muted));
  }
  .preview {
    max-height: 170px;
    margin: 0;
    color: var(--vscode-descriptionForeground);
    font-family: var(--vscode-editor-font-family, monospace);
    font-size: .8em;
    line-height: 1.55;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    overflow-y: auto;
  }
  .copy-command {
    position: absolute;
    right: 10px;
    top: 10px;
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
    padding: 0;
    border-radius: 4px;
    cursor: pointer;
    color: var(--vscode-foreground);
    background: transparent;
  }
  .copy-command:hover { background: var(--vscode-toolbar-hoverBackground); }

  .buttons {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 16px;
    padding: 14px 16px;
    border: 1px solid var(--surface-border);
    border-radius: 8px;
    background: var(--surface-muted);
  }
  .footer-hint {
    display: flex;
    align-items: center;
    gap: 7px;
    min-width: 0;
    color: var(--vscode-descriptionForeground);
    font-size: .78em;
  }
  .footer-hint .icon { width: 14px; height: 14px; }
  .action-buttons { margin-left: auto; display: flex; align-items: center; gap: 8px; }
  button.primary, button.secondary {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 7px;
    min-height: 32px;
    padding: 6px 14px;
    border-radius: 5px;
    cursor: pointer;
  }
  button.primary {
    color: var(--vscode-button-foreground);
    background: var(--vscode-button-background);
    font-weight: 600;
  }
  button.primary:hover:not(:disabled) { background: var(--vscode-button-hoverBackground); }
  button.secondary {
    color: var(--vscode-button-secondaryForeground);
    background: var(--vscode-button-secondaryBackground);
  }
  button.secondary:hover:not(:disabled) { background: var(--vscode-button-secondaryHoverBackground); }
  button.danger {
    color: var(--vscode-statusBarItem-errorForeground, var(--vscode-button-foreground));
    background: var(--vscode-statusBarItem-errorBackground, var(--vscode-inputValidation-errorBorder));
  }
  button.danger:hover:not(:disabled) { filter: brightness(1.12); }
  button:disabled { cursor: default; opacity: .48; }
  button:focus-visible {
    outline: 1px solid var(--vscode-focusBorder);
    outline-offset: 2px;
  }
  .spinner {
    display: none;
    width: 13px;
    height: 13px;
    border: 2px solid currentColor;
    border-right-color: transparent;
    border-radius: 50%;
    animation: spin .75s linear infinite;
  }
  #submit.busy .spinner { display: block; }
  @keyframes spin { to { transform: rotate(360deg); } }

  @media (max-width: 1040px) {
    .center-header { gap: 12px; }
    .context-label { display: none; }
    .context-value { padding-left: 10px; }
    .toolbar-label { display: none; }
    .toolbar-button { width: 32px; justify-content: center; padding: 5px; }
    .center-layout { grid-template-columns: 208px minmax(0, 700px); gap: 24px; }
  }
  @media (max-width: 760px) {
    .center-header { min-height: 58px; padding: 9px 12px; }
    .brand { min-width: 0; }
    .center-subtitle, .target-summary { display: none; }
    .center-layout { grid-template-columns: 1fr; gap: 18px; padding: 16px 14px 36px; }
    .center-nav {
      position: static;
      display: flex;
      gap: 6px;
      max-height: none;
      padding: 0 0 11px;
      border-right: 0;
      border-bottom: 1px solid var(--surface-border);
      overflow-x: auto;
    }
    .nav-group { display: flex; gap: 4px; margin: 0; }
    .nav-group h2 { display: none; }
    button.nav-item { width: auto; min-width: max-content; }
    h1 { font-size: 1.5em; }
    .action-heading { margin-bottom: 17px; }
    .card-heading { padding: 13px 14px; }
    #form { padding: 15px 14px 1px; }
    .buttons { align-items: stretch; flex-direction: column; }
    .footer-hint { display: none; }
    .action-buttons { width: 100%; margin-left: 0; flex-wrap: wrap; }
    .action-buttons button { flex: 1 1 auto; }
  }
  @media (max-width: 480px) {
    .toolbar { gap: 1px; }
    .locale-switch { margin-right: 1px; }
    .locale-button { min-width: 27px; padding: 2px 4px; }
    .brand-mark { width: 30px; height: 30px; border-radius: 7px; }
    .center-title { font-size: .92em; }
    .action-heading { gap: 10px; }
    .help-open {
      width: 32px;
      margin-top: 14px;
      padding: 5px;
    }
    .help-open-label { display: none; }
    .help-drawer { inset: 0; width: auto; }
    .guide-body { padding: 17px 15px; }
    .progress-steps { display: grid; gap: 7px; }
    .field-line { align-items: stretch; flex-direction: column; }
    button.inline { align-self: flex-start; }
  }
  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after { scroll-behavior: auto !important; transition: none !important; animation: none !important; }
  }
  @media (forced-colors: active) {
    .workspace-card, .command-panel, .help-drawer, input, .combo-list, button, .warning, .buttons {
      border: 1px solid CanvasText;
    }
    button.nav-item.active { outline: 2px solid Highlight; }
  }`;
