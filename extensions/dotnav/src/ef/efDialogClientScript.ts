export function renderEfDialogClientScript(serializedOptions: string, serializedLocale: string): string {
  return `const vscode = acquireVsCodeApi();
const OPTIONS = ${serializedOptions};
const INITIAL_LOCALE = ${serializedLocale};
const CLIENT_TEXT = {
  'No entries found': { en: 'No entries found', vi: 'Không tìm thấy dữ liệu' },
  'No match': { en: 'No match', vi: 'Không có kết quả phù hợp' },
  'Show': { en: 'Show', vi: 'Hiện' },
  'Hide': { en: 'Hide', vi: 'Ẩn' },
  'Show value': { en: 'Show value', vi: 'Hiển thị giá trị' },
  'Hide value': { en: 'Hide value', vi: 'Ẩn giá trị' },
  'Running': { en: 'Running', vi: 'Đang chạy' },
  'Completed': { en: 'Completed', vi: 'Hoàn tất' },
  'Failed': { en: 'Failed', vi: 'Thất bại' },
  'Cancelled': { en: 'Cancelled', vi: 'Đã hủy' }
};
const form = document.getElementById('form');
const submitButton = document.getElementById('submit');
const submitLabelNode = document.getElementById('submit-label');
const previewNode = document.getElementById('preview');
const statusNode = document.getElementById('status');
const progressPanel = document.getElementById('operation-progress');
const progressTitle = document.getElementById('progress-title');
const progressState = document.getElementById('progress-state');
const progressBar = document.getElementById('progress-bar');
const progressSteps = document.getElementById('progress-steps');
const helpOpenButton = document.getElementById('help-open');
const helpDrawer = document.getElementById('help-drawer');
const helpCloseButton = document.getElementById('help-close');
const helpBackdrop = document.getElementById('help-backdrop');
const persistedState = vscode.getState() || {};
let currentLocale = INITIAL_LOCALE;
let hostValid = true;
let busy = false;
let helpPreviouslyFocused = null;
let currentProgress;

function clientText(key) {
  const copy = CLIENT_TEXT[key];
  return copy ? copy[currentLocale] : key;
}

function renderProgress(progress) {
  currentProgress = progress;
  if (!progress) {
    progressPanel.hidden = true;
    return;
  }
  progressPanel.hidden = false;
  progressPanel.className = 'operation-progress ' + progress.state;
  progressTitle.textContent = currentLocale === 'vi'
    ? progress.titleVi || progress.title
    : progress.title;
  progressState.textContent = clientText(
    progress.state === 'running' ? 'Running' :
      progress.state === 'success' ? 'Completed' :
        progress.state === 'cancelled' ? 'Cancelled' : 'Failed'
  );
  progressBar.className = 'progress-bar' + (progress.state === 'running' ? ' indeterminate' : '');
  progressSteps.innerHTML = '';
  for (const step of progress.steps || []) {
    const row = document.createElement('li');
    row.className = 'progress-step ' + step.state;
    const mark = document.createElement('span');
    mark.className = 'step-mark';
    mark.textContent = step.state === 'complete' ? '✓' :
      step.state === 'error' ? '×' :
        step.state === 'active' ? '●' : '○';
    const label = document.createElement('span');
    label.textContent = currentLocale === 'vi' ? step.labelVi || step.label : step.label;
    row.append(mark, label);
    const detailText = currentLocale === 'vi' ? step.detailVi || step.detail : step.detail;
    if (detailText) {
      const detail = document.createElement('span');
      detail.className = 'step-detail';
      detail.textContent = detailText;
      row.appendChild(detail);
    }
    progressSteps.appendChild(row);
  }
}

function persistUiState(patch) {
  Object.assign(persistedState, patch);
  vscode.setState(persistedState);
}

function applyLocale(locale, notifyHost) {
  currentLocale = locale === 'vi' ? 'vi' : 'en';
  document.documentElement.lang = currentLocale;
  for (const node of document.querySelectorAll('[data-i18n]')) {
    node.textContent = node.dataset[currentLocale] || node.dataset.en || '';
  }
  for (const node of document.querySelectorAll('[data-placeholder-en]')) {
    node.placeholder = node.dataset['placeholder' + (currentLocale === 'vi' ? 'Vi' : 'En')] || '';
  }
  for (const node of document.querySelectorAll('[data-title-en]')) {
    node.title = node.dataset['title' + (currentLocale === 'vi' ? 'Vi' : 'En')] || '';
  }
  for (const node of document.querySelectorAll('[data-aria-en]')) {
    node.setAttribute('aria-label', node.dataset['aria' + (currentLocale === 'vi' ? 'Vi' : 'En')] || '');
  }
  for (const node of document.querySelectorAll('[data-locale]')) {
    const active = node.dataset.locale === currentLocale;
    node.classList.toggle('active', active);
    node.setAttribute('aria-pressed', active ? 'true' : 'false');
  }
  persistUiState({ locale: currentLocale });
  if (currentProgress) { renderProgress(currentProgress); }
  if (notifyHost) {
    vscode.postMessage({ type: 'locale', locale: currentLocale });
  }
}

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
  submitButton.disabled = busy || !valid || !hostValid;
  return valid && hostValid;
}

function notifyChange() {
  validate();
  vscode.postMessage({ type: 'change', values: readValues() });
}

function isHelpOpen() {
  return Boolean(helpDrawer && helpDrawer.classList.contains('open'));
}

function openHelp() {
  if (!helpDrawer || !helpBackdrop || !helpOpenButton || isHelpOpen()) { return; }
  helpPreviouslyFocused = document.activeElement;
  helpDrawer.removeAttribute('inert');
  helpDrawer.setAttribute('aria-hidden', 'false');
  helpBackdrop.setAttribute('aria-hidden', 'false');
  helpDrawer.classList.add('open');
  helpBackdrop.classList.add('open');
  helpOpenButton.setAttribute('aria-expanded', 'true');
  document.body.classList.add('help-open');
  setTimeout(() => helpCloseButton?.focus({ preventScroll: true }), 0);
}

function closeHelp(restoreFocus = true) {
  if (!helpDrawer || !helpBackdrop || !helpOpenButton || !isHelpOpen()) { return; }
  helpDrawer.classList.remove('open');
  helpBackdrop.classList.remove('open');
  helpDrawer.setAttribute('aria-hidden', 'true');
  helpDrawer.setAttribute('inert', '');
  helpBackdrop.setAttribute('aria-hidden', 'true');
  helpOpenButton.setAttribute('aria-expanded', 'false');
  document.body.classList.remove('help-open');
  if (restoreFocus) {
    const target = helpPreviouslyFocused instanceof HTMLElement ? helpPreviouslyFocused : helpOpenButton;
    target.focus();
  }
  helpPreviouslyFocused = null;
}

// ── Searchable combo boxes ──────────────────────────────────────────────────
function setupCombo(root) {
  const id = root.dataset.combo;
  const strict = root.dataset.strict === 'true';
  const display = root.querySelector('[data-display]');
  const hidden = root.querySelector('[data-field]');
  const list = root.querySelector('[data-list]');
  display.setAttribute('aria-controls', list.id);
  let activeIndex = -1;
  let filtered = [];

  const labelFor = value => (OPTIONS[id] || []).find(o => o.value === value);

  function close() {
    list.hidden = true;
    activeIndex = -1;
    display.setAttribute('aria-expanded', 'false');
    display.removeAttribute('aria-activedescendant');
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
      empty.textContent = clientText(all.length === 0 ? 'No entries found' : 'No match');
      list.appendChild(empty);
    } else {
      filtered.forEach((option, index) => {
        const row = document.createElement('div');
        row.className = 'combo-option' + (index === activeIndex ? ' active' : '');
        row.id = id + '-option-' + index;
        row.setAttribute('role', 'option');
        row.setAttribute('aria-selected', index === activeIndex ? 'true' : 'false');
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
    rows.forEach((row, index) => row.setAttribute('aria-selected', index === activeIndex ? 'true' : 'false'));
    if (active) {
      display.setAttribute('aria-activedescendant', active.id);
      active.scrollIntoView({ block: 'nearest' });
    }
  }

  display.addEventListener('focus', () => {
    // Programmatic focus (dialog open, option refresh) must not pop the list.
    if (root.dataset.suppressOpen === 'true') { root.dataset.suppressOpen = 'false'; return; }
    activeIndex = -1;
    render('');
  });
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
    root.dataset.suppressOpen = 'true';
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
const copyPreviewButton = document.getElementById('copy-preview');
if (copyPreviewButton) {
  copyPreviewButton.addEventListener('click', () => {
    vscode.postMessage({ type: 'copy', text: previewNode ? previewNode.textContent || '' : '' });
  });
}
for (const node of document.querySelectorAll('[data-command]')) {
  node.addEventListener('click', () => vscode.postMessage({
    type: 'navigate', command: node.dataset.command, values: readValues()
  }));
}
for (const node of document.querySelectorAll('[data-toolbar]')) {
  node.addEventListener('click', () => vscode.postMessage({
    type: 'toolbar', action: node.dataset.toolbar, values: readValues()
  }));
}
for (const node of document.querySelectorAll('[data-locale]')) {
  node.addEventListener('click', () => applyLocale(node.dataset.locale, true));
}
for (const node of document.querySelectorAll('[data-action]')) {
  node.addEventListener('click', () => {
    vscode.postMessage({ type: 'action', action: node.dataset.action, values: readValues() });
  });
}
for (const node of document.querySelectorAll('[data-reveal]')) {
  node.addEventListener('click', () => {
    const input = document.getElementById(node.dataset.reveal);
    const showing = input.type === 'text';
    input.type = showing ? 'password' : 'text';
    const labelKey = showing ? 'Show' : 'Hide';
    const ariaKey = showing ? 'Show value' : 'Hide value';
    const label = node.querySelector('[data-i18n]');
    if (label) {
      label.dataset.en = CLIENT_TEXT[labelKey].en;
      label.dataset.vi = CLIENT_TEXT[labelKey].vi;
      label.textContent = clientText(labelKey);
    }
    node.dataset.ariaEn = CLIENT_TEXT[ariaKey].en;
    node.dataset.ariaVi = CLIENT_TEXT[ariaKey].vi;
    node.setAttribute('aria-label', clientText(ariaKey));
    input.focus();
  });
}

if (helpOpenButton && helpDrawer && helpCloseButton && helpBackdrop) {
  helpOpenButton.addEventListener('click', openHelp);
  helpCloseButton.addEventListener('click', () => closeHelp());
  helpBackdrop.addEventListener('click', () => closeHelp());
  helpDrawer.addEventListener('keydown', event => {
    if (event.key !== 'Tab') { return; }
    const focusable = Array.from(helpDrawer.querySelectorAll(
      'button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )).filter(node => !node.hasAttribute('hidden'));
    if (focusable.length === 0) { return; }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });
}

function anyListOpen() {
  return Array.from(document.querySelectorAll('.combo-list')).some(list => !list.hidden);
}

document.addEventListener('keydown', event => {
  if (event.key === 'F1' && helpDrawer) {
    event.preventDefault();
    openHelp();
    return;
  }
  if (event.key === 'Escape' && isHelpOpen()) {
    event.preventDefault();
    event.stopPropagation();
    closeHelp();
    return;
  }
  if (anyListOpen()) { return; }
  if (event.key === 'Escape') { vscode.postMessage({ type: 'cancel' }); }
  else if (event.key === 'Enter' && event.target.tagName !== 'BUTTON' && !submitButton.disabled) {
    vscode.postMessage({ type: 'submit', values: readValues() });
  }
});

window.addEventListener('message', event => {
  const message = event.data;
  if (message.type === 'preview') {
    if (previewNode) { previewNode.textContent = message.text; }
  } else if (message.type === 'status') {
    statusNode.dataset.en = message.text || '';
    statusNode.dataset.vi = message.textVi || message.text || '';
    statusNode.textContent = currentLocale === 'vi' ? statusNode.dataset.vi : statusNode.dataset.en;
    statusNode.classList.toggle('error', Boolean(message.error));
  } else if (message.type === 'busy') {
    busy = Boolean(message.busy);
    for (const node of document.querySelectorAll('button:not(#cancel):not([data-help-control])')) {
      node.disabled = busy;
    }
    document.getElementById('cancel').disabled = false;
    submitButton.classList.toggle('busy', busy);
    submitButton.setAttribute('aria-busy', busy ? 'true' : 'false');
    if (!busy) { validate(); }
  } else if (message.type === 'progress') {
    renderProgress(message.progress);
  } else if (message.type === 'validity') {
    hostValid = Boolean(message.valid);
    validate();
  } else if (message.type === 'submit') {
    submitLabelNode.dataset.en = message.label || '';
    submitLabelNode.dataset.vi = message.labelVi || message.label || '';
    submitLabelNode.textContent = currentLocale === 'vi' ? submitLabelNode.dataset.vi : submitLabelNode.dataset.en;
    submitButton.classList.toggle('danger', Boolean(message.danger));
  } else if (message.type === 'value') {
    const node = form.querySelector('[data-field="' + message.field + '"]');
    if (node) {
      node.value = message.value || '';
      const root = document.querySelector('[data-combo="' + message.field + '"]');
      if (root && root._refresh) { root._refresh(message.value); }
      notifyChange();
    }
  } else if (message.type === 'values') {
    let changed = false;
    for (const [field, value] of Object.entries(message.values || {})) {
      const node = form.querySelector('[data-field="' + field + '"]');
      if (!node) { continue; }
      if (node.type === 'checkbox') {
        const checked = Boolean(value);
        changed = changed || node.checked !== checked;
        node.checked = checked;
      } else {
        const text = typeof value === 'string' ? value : '';
        changed = changed || node.value !== text;
        node.value = text;
      }
      const root = document.querySelector('[data-combo="' + field + '"]');
      if (root && root._refresh) { root._refresh(typeof value === 'string' ? value : undefined); }
    }
    if (changed) { notifyChange(); }
  } else if (message.type === 'options') {
    OPTIONS[message.field] = message.options || [];
    const root = document.querySelector('[data-combo="' + message.field + '"]');
    if (root && root._refresh) { root._refresh(message.selected); }
    notifyChange();
  }
});

// Focus the first real text input. Combo displays are skipped so the dialog
// never opens with a dropdown covering the form, and anything inside the
// collapsed Advanced section is skipped so focus never lands out of sight.
const focusable = Array.from(
  form.querySelectorAll('input[type="text"]:not(.combo-input), input[type="password"]')
).filter(node => !node.closest('details.advanced'));
if (focusable.length > 0) { focusable[0].focus(); focusable[0].select(); }
applyLocale(INITIAL_LOCALE, false);
validate();
vscode.postMessage({ type: 'ready', values: readValues() });`;
}
