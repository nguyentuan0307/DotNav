// Pure rendering for the EF Core dialog webview. No vscode imports so the
// markup, escaping, and option payloads can be unit-tested directly.

export interface EfDialogOption {
  readonly value: string;
  readonly label: string;
  /** Dim secondary text shown to the right of the label. */
  readonly description?: string;
}

export type EfDialogFieldType = 'text' | 'password' | 'checkbox' | 'combo';

export interface EfDialogField {
  readonly id: string;
  readonly label: string;
  readonly type: EfDialogFieldType;
  readonly value?: string | boolean;
  readonly options?: readonly EfDialogOption[];
  readonly placeholder?: string;
  readonly description?: string;
  /** Submit stays disabled while the value is empty. */
  readonly required?: boolean;
  /** Combo only: reject values that are not in the option list. */
  readonly strict?: boolean;
  /** Render inside the collapsed "Advanced options" section. */
  readonly advanced?: boolean;
}

export interface EfDialogAction {
  readonly id: string;
  readonly label: string;
}

export interface EfDialogSpec {
  readonly title: string;
  readonly submitLabel: string;
  /** Renders the submit button in the destructive style. */
  readonly danger?: boolean;
  readonly warning?: string;
  readonly fields: readonly EfDialogField[];
  readonly actions?: readonly EfDialogAction[];
}

export type EfDialogValues = Record<string, string | boolean>;

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Safe to inline inside a <script> block: no `</script>` can escape it. */
export function escapeJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    // Line/paragraph separators are raw line breaks inside a <script> block.
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

export function defaultValues(fields: readonly EfDialogField[]): EfDialogValues {
  const values: EfDialogValues = {};
  for (const field of fields) {
    if (field.type === 'checkbox') {
      values[field.id] = field.value === true;
    } else {
      values[field.id] = typeof field.value === 'string' ? field.value : '';
    }
  }

  return values;
}

/** Display text for a combo: the matching option's label, else the raw value. */
export function displayValueFor(field: EfDialogField): string {
  const value = typeof field.value === 'string' ? field.value : '';
  if (field.type !== 'combo') {
    return value;
  }

  return field.options?.find(option => option.value === value)?.label ?? value;
}

function renderField(field: EfDialogField): string {
  const id = escapeHtml(field.id);
  const label = escapeHtml(field.label);
  const hint = field.description
    ? `<p class="hint">${escapeHtml(field.description)}</p>`
    : '';

  if (field.type === 'checkbox') {
    return `<div class="row">
      <label class="check">
        <input type="checkbox" id="${id}" data-field="${id}"${field.value === true ? ' checked' : ''} />
        <span>${label}</span>
      </label>
      ${hint}
    </div>`;
  }

  if (field.type === 'combo') {
    return `<div class="row">
      <label for="${id}-display">${label}</label>
      <div class="combo" data-combo="${id}"${field.strict ? ' data-strict="true"' : ''}>
        <input type="text" id="${id}-display" class="combo-input" data-display="${id}"
          value="${escapeHtml(displayValueFor(field))}"
          placeholder="${escapeHtml(field.placeholder ?? '')}"
          autocomplete="off" spellcheck="false" role="combobox" aria-expanded="false" />
        <span class="chevron" aria-hidden="true">⌄</span>
        <input type="hidden" data-field="${id}"
          value="${escapeHtml(typeof field.value === 'string' ? field.value : '')}"
          ${field.required ? 'data-required="true"' : ''} />
        <div class="combo-list" data-list="${id}" hidden></div>
      </div>
      ${hint}
    </div>`;
  }

  return `<div class="row">
    <label for="${id}">${label}</label>
    <input type="${field.type === 'password' ? 'password' : 'text'}" id="${id}" data-field="${id}"
      value="${escapeHtml(typeof field.value === 'string' ? field.value : '')}"
      placeholder="${escapeHtml(field.placeholder ?? '')}"
      autocomplete="off" spellcheck="false"
      ${field.required ? 'data-required="true"' : ''} />
    ${hint}
  </div>`;
}

export function renderDialogHtml(spec: EfDialogSpec, nonce: string, cspSource: string): string {
  const main = spec.fields.filter(field => !field.advanced);
  const advanced = spec.fields.filter(field => field.advanced);
  const optionMap: Record<string, readonly EfDialogOption[]> = {};
  for (const field of spec.fields) {
    if (field.type === 'combo') {
      optionMap[field.id] = field.options ?? [];
    }
  }

  const advancedSection = advanced.length > 0
    ? `<details class="advanced">
        <summary>Advanced options</summary>
        <div class="advanced-body">${advanced.map(renderField).join('')}</div>
      </details>`
    : '';
  const actions = (spec.actions ?? []).map(action =>
    `<button type="button" class="secondary" data-action="${escapeHtml(action.id)}">${escapeHtml(action.label)}</button>`
  ).join('');
  const warning = spec.warning
    ? `<div class="warning">${escapeHtml(spec.warning)}</div>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy"
  content="default-src 'none'; style-src ${cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';" />
<title>${escapeHtml(spec.title)}</title>
<style>
  :root { --field-width: 520px; }
  * { box-sizing: border-box; }
  body {
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
    color: var(--vscode-foreground);
    background: var(--vscode-editor-background);
    margin: 0;
    padding: 20px 24px 28px;
  }
  .shell { max-width: var(--field-width); }
  h1 {
    font-size: 1.05em;
    font-weight: 600;
    margin: 0 0 16px;
    padding-bottom: 10px;
    border-bottom: 1px solid var(--vscode-panel-border, rgba(128,128,128,.25));
  }
  .row { margin-bottom: 11px; position: relative; }
  label {
    display: block;
    margin-bottom: 3px;
    color: var(--vscode-descriptionForeground);
    font-size: .9em;
  }
  label.check { display: flex; align-items: center; gap: 7px; margin: 0; color: var(--vscode-foreground); }
  label.check input { width: auto; margin: 0; }
  input[type="text"], input[type="password"] {
    width: 100%;
    padding: 4px 8px;
    height: 26px;
    color: var(--vscode-input-foreground);
    background: var(--vscode-input-background);
    border: 1px solid var(--vscode-input-border, rgba(128,128,128,.35));
    border-radius: 2px;
    font-family: inherit;
    font-size: inherit;
  }
  input::placeholder { color: var(--vscode-input-placeholderForeground); }
  input:focus { outline: none; border-color: var(--vscode-focusBorder); }
  .hint { margin: 3px 0 0; color: var(--vscode-descriptionForeground); font-size: .85em; opacity: .85; }

  .combo { position: relative; }
  .combo-input { padding-right: 22px; cursor: pointer; text-overflow: ellipsis; }
  .chevron {
    position: absolute; right: 7px; top: 3px;
    color: var(--vscode-descriptionForeground);
    pointer-events: none; font-size: .9em;
  }
  .combo-list {
    position: absolute; z-index: 20; left: 0; right: 0; top: 27px;
    max-height: 260px; overflow-y: auto;
    background: var(--vscode-dropdown-background, var(--vscode-editorWidget-background));
    border: 1px solid var(--vscode-focusBorder);
    border-radius: 2px;
    box-shadow: 0 3px 10px rgba(0,0,0,.35);
  }
  .combo-option {
    display: flex; align-items: baseline; gap: 10px;
    padding: 4px 8px; cursor: pointer;
    color: var(--vscode-dropdown-foreground, var(--vscode-foreground));
  }
  .combo-option .opt-label { flex: 0 1 auto; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .combo-option .opt-desc {
    flex: 1 1 auto; text-align: right;
    color: var(--vscode-descriptionForeground);
    font-size: .85em;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis; direction: rtl;
  }
  .combo-option.active, .combo-option:hover {
    background: var(--vscode-list-activeSelectionBackground);
    color: var(--vscode-list-activeSelectionForeground);
  }
  .combo-option.active .opt-desc, .combo-option:hover .opt-desc { color: inherit; opacity: .75; }
  .combo-empty { padding: 6px 8px; color: var(--vscode-descriptionForeground); font-size: .9em; }

  details.advanced { margin: 4px 0 0; }
  details.advanced > summary {
    cursor: pointer; list-style: none;
    color: var(--vscode-textLink-foreground);
    font-size: .9em; padding: 4px 0; user-select: none;
  }
  details.advanced > summary::-webkit-details-marker { display: none; }
  details.advanced > summary::before { content: '▸ '; }
  details.advanced[open] > summary::before { content: '▾ '; }
  .advanced-body {
    padding: 10px 0 2px 12px;
    border-left: 1px solid var(--vscode-panel-border, rgba(128,128,128,.25));
  }

  .warning {
    margin: 0 0 14px; padding: 8px 10px;
    border-left: 3px solid var(--vscode-editorWarning-foreground, #cca700);
    background: var(--vscode-inputValidation-warningBackground, rgba(204,167,0,.08));
    white-space: pre-wrap; font-size: .92em;
  }
  .preview {
    margin: 14px 0 0; padding: 8px 10px;
    background: var(--vscode-textCodeBlock-background, rgba(128,128,128,.1));
    border-radius: 3px;
    font-family: var(--vscode-editor-font-family, monospace);
    font-size: .85em; line-height: 1.5;
    white-space: pre-wrap; word-break: break-word;
    color: var(--vscode-descriptionForeground);
    max-height: 120px; overflow-y: auto;
  }
  .status { margin: 8px 0 0; font-size: .88em; white-space: pre-wrap; min-height: 1.2em; }
  .status.error { color: var(--vscode-inputValidation-errorForeground, var(--vscode-errorForeground)); }
  .buttons { margin-top: 18px; display: flex; gap: 8px; align-items: center; }
  button {
    padding: 5px 16px; border: none; border-radius: 2px; cursor: pointer;
    font-family: inherit; font-size: inherit;
    color: var(--vscode-button-foreground); background: var(--vscode-button-background);
  }
  button:hover:not(:disabled) { background: var(--vscode-button-hoverBackground); }
  button.secondary { color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground); }
  button.secondary:hover:not(:disabled) { background: var(--vscode-button-secondaryHoverBackground); }
  button.danger { background: var(--vscode-errorForeground, #be1100); color: #fff; }
  button:disabled { opacity: .45; cursor: default; }
  .spacer { flex: 1; }
</style>
</head>
<body>
<div class="shell">
  <h1>${escapeHtml(spec.title)}</h1>
  ${warning}
  <form id="form">${main.map(renderField).join('')}${advancedSection}</form>
  <div class="preview" id="preview"></div>
  <div class="status" id="status"></div>
  <div class="buttons">
    <button type="button" id="submit"${spec.danger ? ' class="danger"' : ''}>${escapeHtml(spec.submitLabel)}</button>
    <button type="button" class="secondary" id="cancel">Cancel</button>
    <span class="spacer"></span>
    ${actions}
  </div>
</div>
<script nonce="${nonce}">
const vscode = acquireVsCodeApi();
const OPTIONS = ${escapeJson(optionMap)};
const form = document.getElementById('form');
const submitButton = document.getElementById('submit');
const previewNode = document.getElementById('preview');
const statusNode = document.getElementById('status');

function readValues() {
  const values = {};
  for (const node of form.querySelectorAll('[data-field]')) {
    values[node.dataset.field] = node.type === 'checkbox' ? node.checked : node.value;
  }
  return values;
}

function validate() {
  let valid = true;
  for (const node of form.querySelectorAll('[data-required="true"]')) {
    if (!String(node.value || '').trim()) { valid = false; }
  }
  submitButton.disabled = !valid;
  return valid;
}

function notifyChange() {
  validate();
  vscode.postMessage({ type: 'change', values: readValues() });
}

// ── Searchable combo boxes ──────────────────────────────────────────────────
function setupCombo(root) {
  const id = root.dataset.combo;
  const strict = root.dataset.strict === 'true';
  const display = root.querySelector('[data-display]');
  const hidden = root.querySelector('[data-field]');
  const list = root.querySelector('[data-list]');
  let activeIndex = -1;
  let filtered = [];

  const labelFor = value => (OPTIONS[id] || []).find(o => o.value === value);

  function close() {
    list.hidden = true;
    activeIndex = -1;
    display.setAttribute('aria-expanded', 'false');
  }

  function commit(option) {
    hidden.value = option.value;
    display.value = option.label;
    close();
    notifyChange();
  }

  function render(query) {
    const needle = String(query || '').trim().toLowerCase();
    const all = OPTIONS[id] || [];
    filtered = needle
      ? all.filter(o => (o.label + ' ' + (o.description || '')).toLowerCase().includes(needle))
      : all.slice();

    list.innerHTML = '';
    if (filtered.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'combo-empty';
      empty.textContent = all.length === 0 ? 'No entries found' : 'No match';
      list.appendChild(empty);
    } else {
      filtered.forEach((option, index) => {
        const row = document.createElement('div');
        row.className = 'combo-option' + (index === activeIndex ? ' active' : '');
        const label = document.createElement('span');
        label.className = 'opt-label';
        label.textContent = option.label;
        row.appendChild(label);
        if (option.description) {
          const desc = document.createElement('span');
          desc.className = 'opt-desc';
          desc.textContent = option.description;
          row.appendChild(desc);
        }
        row.addEventListener('mousedown', event => { event.preventDefault(); commit(option); });
        list.appendChild(row);
      });
    }
    list.hidden = false;
    display.setAttribute('aria-expanded', 'true');
  }

  function move(delta) {
    if (list.hidden) { render(''); }
    if (filtered.length === 0) { return; }
    activeIndex = (activeIndex + delta + filtered.length) % filtered.length;
    const rows = list.querySelectorAll('.combo-option');
    rows.forEach((row, index) => row.classList.toggle('active', index === activeIndex));
    const active = rows[activeIndex];
    if (active) { active.scrollIntoView({ block: 'nearest' }); }
  }

  display.addEventListener('focus', () => { activeIndex = -1; render(''); });
  display.addEventListener('mousedown', () => {
    if (!list.hidden) { close(); } else { activeIndex = -1; render(''); }
  });
  display.addEventListener('input', () => {
    activeIndex = -1;
    if (!strict) { hidden.value = display.value; notifyChange(); }
    render(display.value);
  });
  display.addEventListener('blur', () => {
    setTimeout(() => {
      close();
      if (strict) {
        // Restore the label of whatever value is actually selected.
        const current = labelFor(hidden.value);
        display.value = current ? current.label : '';
      }
    }, 0);
  });
  display.addEventListener('keydown', event => {
    if (event.key === 'ArrowDown') { event.preventDefault(); move(1); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); move(-1); }
    else if (event.key === 'Enter') {
      if (!list.hidden && activeIndex >= 0 && filtered[activeIndex]) {
        event.preventDefault();
        event.stopPropagation();
        commit(filtered[activeIndex]);
      }
    } else if (event.key === 'Escape') {
      if (!list.hidden) { event.preventDefault(); event.stopPropagation(); close(); }
    }
  });

  root._refresh = selected => {
    if (selected !== undefined) { hidden.value = selected; }
    const current = labelFor(hidden.value);
    if (strict || current) { display.value = current ? current.label : hidden.value; }
    if (!list.hidden) { render(display.value); }
  };
}

for (const root of document.querySelectorAll('[data-combo]')) { setupCombo(root); }

form.addEventListener('input', event => {
  if (!event.target.classList.contains('combo-input')) { notifyChange(); }
});
form.addEventListener('change', event => {
  if (!event.target.classList.contains('combo-input')) { notifyChange(); }
});

submitButton.addEventListener('click', () => {
  if (!submitButton.disabled) { vscode.postMessage({ type: 'submit', values: readValues() }); }
});
document.getElementById('cancel').addEventListener('click', () => vscode.postMessage({ type: 'cancel' }));
for (const node of document.querySelectorAll('[data-action]')) {
  node.addEventListener('click', () => {
    vscode.postMessage({ type: 'action', action: node.dataset.action, values: readValues() });
  });
}

document.addEventListener('keydown', event => {
  if (event.key === 'Escape') { vscode.postMessage({ type: 'cancel' }); }
  else if (event.key === 'Enter' && event.target.tagName !== 'BUTTON' && !submitButton.disabled) {
    vscode.postMessage({ type: 'submit', values: readValues() });
  }
});

window.addEventListener('message', event => {
  const message = event.data;
  if (message.type === 'preview') {
    previewNode.textContent = message.text;
  } else if (message.type === 'status') {
    statusNode.textContent = message.text;
    statusNode.classList.toggle('error', Boolean(message.error));
  } else if (message.type === 'busy') {
    for (const node of document.querySelectorAll('button')) { node.disabled = message.busy; }
    if (!message.busy) { validate(); }
  } else if (message.type === 'options') {
    OPTIONS[message.field] = message.options || [];
    const root = document.querySelector('[data-combo="' + message.field + '"]');
    if (root && root._refresh) { root._refresh(message.selected); }
    notifyChange();
  }
});

const first = form.querySelector('input[type="text"], input[type="password"]');
if (first) { first.focus(); first.select(); }
validate();
vscode.postMessage({ type: 'ready', values: readValues() });
</script>
</body>
</html>`;
}
