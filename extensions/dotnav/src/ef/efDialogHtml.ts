// Pure rendering for the EF Core dialog webview. No vscode imports so the
// markup, escaping, and option payloads can be unit-tested directly.

import { actionHelpFor } from './efActionHelp';
import { renderEfDialogClientScript } from './efDialogClientScript';
import { efDialogStyles } from './efDialogStyles';
import { EfActionIcon, efActionDefinition, efActionGroups } from './efActionRegistry';
import {
  EfLocale,
  LocalizedText,
  localizedEfText,
  localizeEfText
} from './efDialogI18n';

export interface EfDialogOption {
  readonly value: string;
  readonly label: string;
  /** Dim secondary text shown to the right of the label. */
  readonly description?: string;
}

export interface EfDialogAction {
  readonly id: string;
  readonly label: string;
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
  /** Button rendered next to the input, e.g. "Check database". */
  readonly action?: EfDialogAction;
}

export interface EfDialogSpec {
  readonly title: string;
  readonly submitLabel: string;
  /** Active action in the persistent EF Core Center navigation. */
  readonly actionId?: string;
  readonly projectLabel?: string;
  readonly contextLabel?: string;
  readonly toolLabel?: string;
  /** Omit the generated-command panel for source-only actions. */
  readonly hideCommandPreview?: boolean;
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

function localizedCopyHtml(copy: LocalizedText, locale: EfLocale, className?: string): string {
  const classAttribute = className ? ` class="${escapeHtml(className)}"` : '';
  return `<span${classAttribute} data-i18n data-en="${escapeHtml(copy.en)}" data-vi="${escapeHtml(copy.vi)}">` +
    `${escapeHtml(copy[locale])}</span>`;
}

function localizedTextHtml(text: string, locale: EfLocale, className?: string): string {
  return localizedCopyHtml(localizedEfText(text), locale, className);
}

function localizedInputAttribute(
  attribute: 'placeholder' | 'title' | 'aria-label',
  text: string,
  locale: EfLocale
): string {
  const copy = localizedEfText(text);
  const dataName = attribute === 'aria-label' ? 'aria' : attribute;
  return `${attribute}="${escapeHtml(copy[locale])}" ` +
    `data-${dataName}-en="${escapeHtml(copy.en)}" data-${dataName}-vi="${escapeHtml(copy.vi)}"`;
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

function renderField(field: EfDialogField, locale: EfLocale): string {
  const id = escapeHtml(field.id);
  const label = localizedTextHtml(field.label, locale);
  const required = field.required
    ? `<span class="required-mark" ${localizedInputAttribute('title', 'Required', locale)} aria-hidden="true">*</span>`
    : '';
  const hint = field.description
    ? `<p class="hint">${localizedTextHtml(field.description, locale)}</p>`
    : '';

  if (field.type === 'checkbox') {
    return `<div class="row checkbox-row">
      <label class="check">
        <input type="checkbox" id="${id}" data-field="${id}"${field.value === true ? ' checked' : ''} />
        <span class="check-control" aria-hidden="true"></span>
        <span class="check-copy"><span>${label}</span>${field.description
          ? localizedTextHtml(field.description, locale, 'check-hint')
          : ''}</span>
      </label>
    </div>`;
  }

  if (field.type === 'combo') {
    return `<div class="row">
      <div class="field-label-row"><label for="${id}-display">${label}${required}</label></div>
      <div class="field-line">
      <div class="combo" data-combo="${id}"${field.strict ? ' data-strict="true"' : ''}>
        <input type="text" id="${id}-display" class="combo-input" data-display="${id}"
          value="${escapeHtml(displayValueFor(field))}"
          ${localizedInputAttribute('placeholder', field.placeholder ?? '', locale)}
          autocomplete="off" spellcheck="false" role="combobox" aria-expanded="false"
          ${field.required ? 'aria-required="true"' : ''} />
        <span class="chevron" aria-hidden="true"></span>
        <input type="hidden" data-field="${id}"
          value="${escapeHtml(typeof field.value === 'string' ? field.value : '')}"
          ${field.required ? 'data-required="true"' : ''} />
        <div class="combo-list" id="${id}-listbox" data-list="${id}" role="listbox" hidden></div>
      </div>
      ${renderInlineAction(field, locale)}
      </div>
      ${hint}
    </div>`;
  }

  return `<div class="row">
    <div class="field-label-row"><label for="${id}">${label}${required}</label></div>
    <div class="field-line">
      <input type="${field.type === 'password' ? 'password' : 'text'}" id="${id}" data-field="${id}"
        value="${escapeHtml(typeof field.value === 'string' ? field.value : '')}"
        ${localizedInputAttribute('placeholder', field.placeholder ?? '', locale)}
        autocomplete="off" spellcheck="false"
        ${field.required ? 'data-required="true" aria-required="true"' : ''} />
      ${field.type === 'password'
        ? `<button type="button" class="secondary inline" data-reveal="${id}" ` +
          `${localizedInputAttribute('aria-label', 'Show value', locale)}>${localizedTextHtml('Show', locale)}</button>`
        : ''}
      ${renderInlineAction(field, locale)}
    </div>
    ${hint}
  </div>`;
}

function renderInlineAction(field: EfDialogField, locale: EfLocale): string {
  return field.action
    ? `<button type="button" class="secondary inline" data-action="${escapeHtml(field.action.id)}">` +
      `${localizedTextHtml(field.action.label, locale)}</button>`
    : '';
}

type IconName =
  | EfActionIcon
  | 'output' | 'refresh' | 'settings' | 'tool';

function iconSvg(name: IconName): string {
  const paths: Record<IconName, string> = {
    add: 'M7 2h2v5h5v2H9v5H7V9H2V7h5V2Z',
    back: 'M6.7 2.3 1 8l5.7 5.7 1.4-1.4L4.8 9H15V7H4.8l3.3-3.3-1.4-1.4Z',
    check: 'm6.4 12.1-4-4 1.4-1.4 2.6 2.6 5.8-5.8 1.4 1.4-7.2 7.2Z',
    code: 'm5.2 3.3-1.4-1.4L0 5.7l3.8 3.8 1.4-1.4-2.4-2.4 2.4-2.4Zm5.6 0 2.4 2.4-2.4 2.4 1.4 1.4L16 5.7l-3.8-3.8-1.4 1.4ZM6.2 14l2.9-13 1.9.4-2.9 13-1.9-.4Z',
    database: 'M8 1C4.1 1 1 2.3 1 4v8c0 1.7 3.1 3 7 3s7-1.3 7-3V4c0-1.7-3.1-3-7-3Zm0 2c3.1 0 5 .7 5 1s-1.9 1-5 1-5-.7-5-1 1.9-1 5-1Zm0 4c2 0 3.8-.4 5-1v2c0 .3-1.9 1-5 1s-5-.7-5-1V6c1.2.6 3 1 5 1Zm0 6c-3.1 0-5-.7-5-1v-2c1.2.6 3 1 5 1s3.8-.4 5-1v2c0 .3-1.9 1-5 1Z',
    delete: 'M5 1h6l1 2h3v2H1V3h3l1-2Zm-1 6h2v6H4V7Zm3 0h2v6H7V7Zm3 0h2v6h-2V7Z',
    info: 'M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1Zm0 2a5 5 0 1 1 0 10A5 5 0 0 1 8 3ZM7 7h2v5H7V7Zm0-3h2v2H7V4Z',
    list: 'M2 2h2v2H2V2Zm4 0h8v2H6V2ZM2 7h2v2H2V7Zm4 0h8v2H6V7Zm-4 5h2v2H2v-2Zm4 0h8v2H6v-2Z',
    output: 'M1 2h14v12H1V2Zm2 2v8h10V4H3Zm1 1.5 1.4-1.4L9.3 8l-3.9 3.9L4 10.5 6.5 8 4 5.5Zm5 4.5h3v1H9v-1Z',
    package: 'm8 1 6 3.2v7.6L8 15l-6-3.2V4.2L8 1Zm0 2.2L4.3 5.1 8 7l3.7-1.9L8 3.2ZM4 7v3.6l3 1.6V8.5L4 7Zm5 5.2 3-1.6V7L9 8.5v3.7Z',
    refresh: 'M13.7 3.7V1.5h2v5h-5v-2h1.6A5 5 0 1 0 13 10h2.1A7 7 0 1 1 13.7 3.7Z',
    settings: 'm9.1 1 .5 1.7c.4.1.8.3 1.1.5l1.6-.8 1.4 1.4-.8 1.6c.2.3.4.7.5 1.1l1.7.5v2l-1.7.5c-.1.4-.3.8-.5 1.1l.8 1.6-1.4 1.4-1.6-.8c-.3.2-.7.4-1.1.5L9.1 15h-2l-.5-1.7c-.4-.1-.8-.3-1.1-.5l-1.6.8-1.4-1.4.8-1.6c-.2-.3-.4-.7-.5-1.1L1.1 9V7l1.7-.5c.1-.4.3-.8.5-1.1l-.8-1.6 1.4-1.4 1.6.8c.3-.2.7-.4 1.1-.5L7.1 1h2ZM8.1 5a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z',
    spark: 'm8 0 1.2 4.8L14 6l-4.8 1.2L8 12 6.8 7.2 2 6l4.8-1.2L8 0Zm5 10 .6 2.4 2.4.6-2.4.6L13 16l-.6-2.4L10 13l2.4-.6L13 10Z',
    tool: 'M10.8 1.4a4 4 0 0 0-4.9 5L1.3 11a2.1 2.1 0 1 0 3 3l4.6-4.6a4 4 0 0 0 5-4.9l-2.5 2.4-2.3-.6-.6-2.3 2.3-2.6Z'
  };
  return `<svg class="icon" viewBox="0 0 16 16" aria-hidden="true"><path d="${paths[name]}"></path></svg>`;
}

function renderGuideList(items: readonly LocalizedText[], locale: EfLocale): string {
  return `<ul>${items.map(item => `<li>${localizedCopyHtml(item, locale)}</li>`).join('')}</ul>`;
}

function renderUsageGuide(spec: EfDialogSpec, locale: EfLocale): string {
  const help = actionHelpFor(spec.actionId);
  if (!help) {
    return '';
  }

  const fieldRows = spec.fields.map(field => {
    const fieldHelp = help.fields[field.id];
    if (!fieldHelp) {
      return '';
    }

    return `<div class="guide-field">
      <div class="guide-field-heading">
        ${localizedTextHtml(field.label, locale, 'guide-field-name')}
        ${localizedTextHtml(field.required ? 'Required' : 'Optional', locale,
          `field-badge ${field.required ? 'required' : 'optional'}`)}
      </div>
      <p>${localizedCopyHtml(fieldHelp.description, locale)}</p>
      ${fieldHelp.example
        ? `<p class="guide-example"><strong>${localizedTextHtml('Example', locale)}:</strong> ` +
          `${localizedCopyHtml(fieldHelp.example, locale)}</p>`
        : ''}
    </div>`;
  }).join('');

  return `<div class="help-backdrop" id="help-backdrop" aria-hidden="true"></div>
  <aside class="help-drawer" id="help-drawer" role="dialog" aria-modal="true"
    aria-labelledby="help-drawer-title help-action-title" aria-hidden="true" inert
    data-help-action="${escapeHtml(spec.actionId ?? '')}">
    <header class="help-drawer-header">
      <span class="guide-summary-icon">${iconSvg('info')}</span>
      <span class="guide-summary-copy">
        ${localizedTextHtml('How to use', locale, 'guide-title').replace(
          '<span',
          '<span id="help-drawer-title"'
        )}
        ${localizedTextHtml(spec.title, locale, 'guide-caption').replace(
          '<span',
          '<span id="help-action-title"'
        )}
      </span>
      <button type="button" class="help-close" id="help-close" data-help-control
        ${localizedInputAttribute('title', 'Close guide', locale)}
        ${localizedInputAttribute('aria-label', 'Close guide', locale)}>×</button>
    </header>
    <div class="guide-body">
      <section class="guide-purpose">
        <h2>${localizedTextHtml('What this does', locale)}</h2>
        <p>${localizedCopyHtml(help.purpose, locale)}</p>
      </section>
      <div class="guide-columns">
        <section>
          <h2>${localizedTextHtml('When to use it', locale)}</h2>
          ${renderGuideList(help.whenToUse, locale)}
        </section>
        <section>
          <h2>${localizedTextHtml('Before you run', locale)}</h2>
          ${renderGuideList(help.prerequisites, locale)}
        </section>
      </div>
      ${fieldRows
        ? `<section class="field-guide"><h2>${localizedTextHtml('Field guide', locale)}</h2>${fieldRows}</section>`
        : ''}
      <section class="guide-result">
        <h2>${localizedTextHtml('Expected result', locale)}</h2>
        <p>${localizedCopyHtml(help.result, locale)}</p>
      </section>
      ${help.caution
        ? `<section class="guide-caution">
          <h2>${localizedTextHtml('Safety note', locale)}</h2>
          <p>${localizedCopyHtml(help.caution, locale)}</p>
        </section>`
        : ''}
    </div>
  </aside>`;
}

export function renderDialogHtml(
  spec: EfDialogSpec,
  nonce: string,
  cspSource: string,
  initialLocale: EfLocale = 'en'
): string {
  const main = spec.fields.filter(field => !field.advanced);
  const advanced = spec.fields.filter(field => field.advanced);
  const usageGuide = renderUsageGuide(spec, initialLocale);
  const optionMap: Record<string, readonly EfDialogOption[]> = {};
  for (const field of spec.fields) {
    if (field.type === 'combo') {
      optionMap[field.id] = field.options ?? [];
    }
  }

  const advancedSection = advanced.length > 0
    ? `<details class="advanced">
        <summary>${localizedTextHtml('Advanced options', initialLocale)}</summary>
        <div class="advanced-body">${advanced.map(field => renderField(field, initialLocale)).join('')}</div>
      </details>`
    : '';
  const actions = (spec.actions ?? []).map(action =>
    `<button type="button" class="secondary" data-action="${escapeHtml(action.id)}">` +
    `${localizedTextHtml(action.label, initialLocale)}</button>`
  ).join('');
  const warning = spec.warning
    ? `<div class="warning">${localizedTextHtml(spec.warning, initialLocale)}</div>`
    : '';
  const activeAction = efActionDefinition(spec.actionId);
  const activeGroup = activeAction?.group ?? 'EF Core';
  const actionDescription = activeAction?.description ?? 'Configure and run this EF Core operation.';
  const navigationHtml = [...efActionGroups()].map(([group, entries]) =>
    `<section class="nav-group"><h2>${localizedTextHtml(group, initialLocale)}</h2>${entries.map(action =>
      `<button type="button" class="nav-item${spec.actionId === action.id ? ' active' : ''}" ` +
      `data-command="${action.id}"${spec.actionId === action.id ? ' aria-current="page"' : ''}>` +
      `<span class="nav-icon">${iconSvg(action.icon)}</span>` +
      `${localizedTextHtml(action.label, initialLocale)}</button>`
    ).join('')}</section>`
  ).join('');
  const targetSummary = [
    ['Project', spec.projectLabel],
    ['DbContext', spec.contextLabel],
    ['Runtime', spec.toolLabel]
  ].filter((entry): entry is [string, string] => Boolean(entry[1]))
    .map(([label, value]) =>
      `<span class="context-pill">${localizedTextHtml(label, initialLocale, 'context-label')}` +
      `<span class="context-value">${escapeHtml(value)}</span></span>`)
    .join('');

  return `<!DOCTYPE html>
<html lang="${initialLocale}">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy"
  content="default-src 'none'; style-src ${cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';" />
<title>${escapeHtml(localizeEfText(spec.title, initialLocale))}</title>
<style>${efDialogStyles}</style>
</head>
<body>
<header class="center-header">
  <div class="brand">
    <div class="brand-mark">${iconSvg('database')}</div>
    <div>
      ${localizedTextHtml('EF Core Center', initialLocale, 'center-title')}
      ${localizedTextHtml('Migration workspace', initialLocale, 'center-subtitle')}
    </div>
  </div>
  <div class="target-summary" ${localizedInputAttribute('aria-label', 'Active EF Core target', initialLocale)}>${targetSummary}</div>
  <div class="toolbar" ${localizedInputAttribute('aria-label', 'EF Core tools', initialLocale)}>
    <div class="locale-switch" role="group"
      ${localizedInputAttribute('aria-label', 'Language', initialLocale)}>
      <button type="button" class="locale-button${initialLocale === 'en' ? ' active' : ''}"
        data-locale="en" aria-pressed="${initialLocale === 'en'}">EN</button>
      <button type="button" class="locale-button${initialLocale === 'vi' ? ' active' : ''}"
        data-locale="vi" aria-pressed="${initialLocale === 'vi'}">VI</button>
    </div>
    <button type="button" class="toolbar-button" data-toolbar="refresh"
      ${localizedInputAttribute('title', 'Rescan projects, DbContexts and migrations', initialLocale)}
      ${localizedInputAttribute('aria-label', 'Refresh EF Core projects', initialLocale)}>
      ${iconSvg('refresh')}${localizedTextHtml('Refresh', initialLocale, 'toolbar-label')}
    </button>
    <button type="button" class="toolbar-button" data-toolbar="output"
      ${localizedInputAttribute('title', 'Show DotNav EF Core output', initialLocale)}
      ${localizedInputAttribute('aria-label', 'Show EF Core output', initialLocale)}>
      ${iconSvg('output')}${localizedTextHtml('Output', initialLocale, 'toolbar-label')}
    </button>
    <button type="button" class="toolbar-button" data-toolbar="tool"
      ${localizedInputAttribute('title', 'Install or update dotnet-ef', initialLocale)}
      ${localizedInputAttribute('aria-label', 'Manage dotnet-ef tool', initialLocale)}>
      ${iconSvg('tool')}<span class="toolbar-label">dotnet-ef</span>
    </button>
    <button type="button" class="toolbar-button" data-toolbar="settings"
      ${localizedInputAttribute('title', 'Open EF Core settings', initialLocale)}
      ${localizedInputAttribute('aria-label', 'Open EF Core settings', initialLocale)}>
      ${iconSvg('settings')}${localizedTextHtml('Settings', initialLocale, 'toolbar-label')}
    </button>
  </div>
</header>
<div class="center-layout">
<nav class="center-nav" aria-label="EF Core actions">${navigationHtml}</nav>
<main class="shell">
  <header class="action-heading">
    <div class="action-heading-copy">
      <div class="eyebrow">${localizedTextHtml(activeGroup, initialLocale)}</div>
      <h1>${localizedTextHtml(spec.title, initialLocale)}</h1>
      <p class="action-description">${localizedTextHtml(actionDescription, initialLocale)}</p>
    </div>
    ${usageGuide
      ? `<button type="button" class="help-open" id="help-open" data-help-control
          aria-expanded="false" aria-controls="help-drawer"
          ${localizedInputAttribute('title', 'Open feature guide', initialLocale)}
          ${localizedInputAttribute('aria-label', 'Open feature guide', initialLocale)}>
          ${iconSvg('info')}${localizedTextHtml('Guide', initialLocale, 'help-open-label')}
        </button>`
      : ''}
  </header>
  ${warning}
  <section class="operation-progress" id="operation-progress" aria-live="polite" hidden>
    <div class="progress-heading">
      ${iconSvg('spark')}
      <span class="progress-title" id="progress-title"></span>
      <span class="progress-state" id="progress-state"></span>
    </div>
    <div class="progress-track" aria-hidden="true">
      <span class="progress-bar" id="progress-bar"></span>
    </div>
    <ol class="progress-steps" id="progress-steps"></ol>
  </section>
  <section class="workspace-card${spec.danger ? ' danger-workspace' : ''}"
    aria-label="${escapeHtml(localizeEfText(spec.title, initialLocale))} configuration">
    <div class="card-heading">
      ${localizedTextHtml('Configuration', initialLocale, 'card-title')}
      ${localizedTextHtml('Review the execution target before running', initialLocale, 'card-caption')}
    </div>
    <form id="form">${main.map(field => renderField(field, initialLocale)).join('')}${advancedSection}</form>
    <div class="status" id="status" role="status" aria-live="polite"
      data-i18n data-en="" data-vi=""></div>
  </section>
  ${spec.hideCommandPreview ? '' : `<details class="command-panel">
    <summary>
      <span class="command-summary-icon">${iconSvg('code')}</span>
      <span class="command-summary-copy">
        ${localizedTextHtml('Generated command', initialLocale, 'command-title')}
        ${localizedTextHtml(
          'Inspect the exact dotnet ef command before execution',
          initialLocale,
          'command-caption'
        )}
      </span>
    </summary>
    <div class="command-body">
      <pre class="preview" id="preview"></pre>
      <button type="button" class="copy-command" id="copy-preview"
        ${localizedInputAttribute('title', 'Copy generated command', initialLocale)}
        ${localizedInputAttribute('aria-label', 'Copy generated command', initialLocale)}>${iconSvg('output')}</button>
    </div>
  </details>`}
  <div class="buttons">
    <span class="footer-hint">${iconSvg('info')}${localizedTextHtml(
      'Press Enter to run · Esc to cancel',
      initialLocale
    )}</span>
    <div class="action-buttons">
      ${actions}
      <button type="button" class="secondary" id="cancel">${localizedTextHtml('Cancel', initialLocale)}</button>
      <button type="button" id="submit" class="primary${spec.danger ? ' danger' : ''}">
        <span class="spinner" aria-hidden="true"></span>
        ${localizedTextHtml(spec.submitLabel, initialLocale, undefined).replace('<span', '<span id="submit-label"')}
      </button>
    </div>
  </div>
</main>
</div>
${usageGuide}
<script nonce="${nonce}">
${renderEfDialogClientScript(escapeJson(optionMap), escapeJson(initialLocale))}
</script>
</body>
</html>`;
}
