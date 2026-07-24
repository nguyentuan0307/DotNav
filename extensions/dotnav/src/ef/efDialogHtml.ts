// Pure rendering for the EF Core dialog webview. No vscode imports so the
// markup and escaping can be unit-tested directly.

export interface EfDialogOption {
  readonly value: string;
  readonly label: string;
  readonly description?: string;
}

export interface EfDialogField {
  readonly id: string;
  readonly label: string;
  readonly type: 'text' | 'select' | 'checkbox' | 'combo';
  readonly value?: string | boolean;
  readonly options?: readonly EfDialogOption[];
  readonly placeholder?: string;
  readonly description?: string;
  /** Text fields only: submit stays disabled while the value is empty. */
  readonly required?: boolean;
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

function renderField(field: EfDialogField): string {
  const id = escapeHtml(field.id);
  const label = escapeHtml(field.label);
  const description = field.description
    ? `<p class="hint">${escapeHtml(field.description)}</p>`
    : '';

  if (field.type === 'checkbox') {
    return `
      <div class="row checkbox-row">
        <label class="checkbox">
          <input type="checkbox" id="${id}" data-field="${id}"${field.value === true ? ' checked' : ''} />
          <span>${label}</span>
        </label>
        ${description}
      </div>`;
  }

  if (field.type === 'select') {
    const options = (field.options ?? []).map(option => {
      const selected = option.value === field.value ? ' selected' : '';
      const text = option.description
        ? `${option.label} — ${option.description}`
        : option.label;
      return `<option value="${escapeHtml(option.value)}"${selected}>${escapeHtml(text)}</option>`;
    }).join('');
    const empty = (field.options ?? []).length === 0
      ? '<option value="">(none found)</option>'
      : '';

    return `
      <div class="row">
        <label for="${id}">${label}</label>
        <select id="${id}" data-field="${id}">${empty}${options}</select>
        ${description}
      </div>`;
  }

  const listId = `${id}-list`;
  const list = field.type === 'combo'
    ? `<datalist id="${listId}">${(field.options ?? []).map(option =>
      `<option value="${escapeHtml(option.value)}">${escapeHtml(option.description ?? '')}</option>`).join('')}</datalist>`
    : '';

  return `
    <div class="row">
      <label for="${id}">${label}</label>
      <input type="text" id="${id}" data-field="${id}"
        value="${escapeHtml(typeof field.value === 'string' ? field.value : '')}"
        placeholder="${escapeHtml(field.placeholder ?? '')}"
        ${field.required ? 'data-required="true"' : ''}
        ${field.type === 'combo' ? `list="${listId}"` : ''} />
      ${list}
      ${description}
    </div>`;
}

export function renderDialogHtml(spec: EfDialogSpec, nonce: string, cspSource: string): string {
  const fields = spec.fields.map(renderField).join('');
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
  body {
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
    color: var(--vscode-foreground);
    background: var(--vscode-editor-background);
    padding: 16px 20px 20px;
    margin: 0;
  }
  h1 { font-size: 1.15em; font-weight: 600; margin: 0 0 14px; }
  .row { margin-bottom: 12px; display: flex; flex-direction: column; gap: 4px; max-width: 640px; }
  .checkbox-row { flex-direction: column; }
  label { color: var(--vscode-descriptionForeground); font-size: 0.92em; }
  .checkbox { display: flex; align-items: center; gap: 8px; color: var(--vscode-foreground); }
  .checkbox input { width: auto; margin: 0; }
  input[type="text"], select {
    width: 100%;
    box-sizing: border-box;
    padding: 4px 6px;
    color: var(--vscode-input-foreground);
    background: var(--vscode-input-background);
    border: 1px solid var(--vscode-input-border, transparent);
    border-radius: 2px;
    font-family: inherit;
    font-size: inherit;
  }
  input[type="text"]:focus, select:focus {
    outline: 1px solid var(--vscode-focusBorder);
    outline-offset: -1px;
  }
  .hint { margin: 0; color: var(--vscode-descriptionForeground); font-size: 0.85em; }
  .warning {
    margin: 0 0 14px;
    padding: 8px 10px;
    border-left: 3px solid var(--vscode-editorWarning-foreground, #cca700);
    background: var(--vscode-inputValidation-warningBackground, rgba(204,167,0,.1));
    max-width: 640px;
    white-space: pre-wrap;
  }
  .preview {
    margin: 16px 0 0;
    padding: 8px 10px;
    background: var(--vscode-textCodeBlock-background);
    border-radius: 3px;
    font-family: var(--vscode-editor-font-family, monospace);
    font-size: 0.88em;
    white-space: pre-wrap;
    word-break: break-all;
    max-width: 640px;
    color: var(--vscode-descriptionForeground);
  }
  .status { margin: 8px 0 0; max-width: 640px; font-size: 0.88em; color: var(--vscode-descriptionForeground); white-space: pre-wrap; }
  .buttons { margin-top: 18px; display: flex; gap: 8px; max-width: 640px; }
  button {
    padding: 5px 14px;
    border: none;
    border-radius: 2px;
    cursor: pointer;
    font-family: inherit;
    font-size: inherit;
    color: var(--vscode-button-foreground);
    background: var(--vscode-button-background);
  }
  button:hover { background: var(--vscode-button-hoverBackground); }
  button.secondary {
    color: var(--vscode-button-secondaryForeground);
    background: var(--vscode-button-secondaryBackground);
  }
  button.secondary:hover { background: var(--vscode-button-secondaryHoverBackground); }
  button.danger { background: var(--vscode-inputValidation-errorBorder, #be1100); color: #fff; }
  button:disabled { opacity: .5; cursor: default; }
  .spacer { flex: 1; }
</style>
</head>
<body>
  <h1>${escapeHtml(spec.title)}</h1>
  ${warning}
  <form id="form">${fields}</form>
  <div class="preview" id="preview"></div>
  <div class="status" id="status"></div>
  <div class="buttons">
    <button type="button" id="submit" class="${spec.danger ? 'danger' : ''}">${escapeHtml(spec.submitLabel)}</button>
    <button type="button" class="secondary" id="cancel">Cancel</button>
    <span class="spacer"></span>
    ${actions}
  </div>
<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
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
      if (!String(node.value || '').trim()) {
        valid = false;
      }
    }
    submitButton.disabled = !valid;
  }

  function notifyChange() {
    validate();
    vscode.postMessage({ type: 'change', values: readValues() });
  }

  form.addEventListener('input', notifyChange);
  form.addEventListener('change', notifyChange);

  submitButton.addEventListener('click', () => {
    if (!submitButton.disabled) {
      vscode.postMessage({ type: 'submit', values: readValues() });
    }
  });
  document.getElementById('cancel').addEventListener('click', () => vscode.postMessage({ type: 'cancel' }));

  for (const node of document.querySelectorAll('[data-action]')) {
    node.addEventListener('click', () => {
      vscode.postMessage({ type: 'action', action: node.dataset.action, values: readValues() });
    });
  }

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      vscode.postMessage({ type: 'cancel' });
    } else if (event.key === 'Enter' && event.target.tagName !== 'BUTTON' && !submitButton.disabled) {
      vscode.postMessage({ type: 'submit', values: readValues() });
    }
  });

  window.addEventListener('message', event => {
    const message = event.data;
    if (message.type === 'preview') {
      previewNode.textContent = message.text;
    } else if (message.type === 'status') {
      statusNode.textContent = message.text;
    } else if (message.type === 'busy') {
      for (const node of document.querySelectorAll('button')) {
        node.disabled = message.busy;
      }
      if (!message.busy) {
        validate();
      }
    } else if (message.type === 'options') {
      const node = form.querySelector('[data-field="' + message.field + '"]');
      if (node && node.tagName === 'SELECT') {
        node.innerHTML = '';
        for (const option of message.options) {
          const element = document.createElement('option');
          element.value = option.value;
          element.textContent = option.description ? option.label + ' — ' + option.description : option.label;
          if (option.value === message.selected) {
            element.selected = true;
          }
          node.appendChild(element);
        }
      } else if (node) {
        const list = document.getElementById(message.field + '-list');
        if (list) {
          list.innerHTML = '';
          for (const option of message.options) {
            const element = document.createElement('option');
            element.value = option.value;
            element.textContent = option.description || '';
            list.appendChild(element);
          }
        }
      }
      notifyChange();
    }
  });

  const first = form.querySelector('input[type="text"], select');
  if (first) {
    first.focus();
    if (first.select) {
      first.select();
    }
  }
  validate();
  vscode.postMessage({ type: 'ready', values: readValues() });
</script>
</body>
</html>`;
}
