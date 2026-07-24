// Pure rendering for the EF Core dialog webview. No vscode imports so the
// markup, escaping, and option payloads can be unit-tested directly.

import { actionHelpFor } from './efActionHelp';
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
  | 'add' | 'back' | 'check' | 'code' | 'database' | 'delete' | 'info'
  | 'list' | 'output' | 'package' | 'refresh' | 'settings' | 'spark' | 'tool';

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
  const navigation = [
    ['Migrations', [
      ['dotnav.ef.addMigration', 'Add Migration', 'add'],
      ['dotnav.ef.removeLastMigration', 'Remove Last', 'back'],
      ['dotnav.ef.listMigrations', 'Browse Migrations', 'list']
    ]],
    ['Database', [
      ['dotnav.ef.updateDatabase', 'Update Database', 'database'],
      ['dotnav.ef.pendingModelChanges', 'Check Model', 'check'],
      ['dotnav.ef.dbContextInfo', 'DbContext Info', 'info']
    ]],
    ['Scripts', [
      ['dotnav.ef.generateScript', 'Generate SQL', 'code']
    ]],
    ['Advanced', [
      ['dotnav.ef.migrationsBundle', 'Migration Bundle', 'package'],
      ['dotnav.ef.optimizeDbContext', 'Optimize DbContext', 'spark']
    ]],
    ['Danger zone', [
      ['dotnav.ef.dropDatabase', 'Drop Database', 'delete']
    ]]
  ] as const;
  const actionDescriptions: Record<string, string> = {
    'dotnav.ef.addMigration': 'Capture the current model changes in a new migration.',
    'dotnav.ef.removeLastMigration': 'Remove the most recent migration from the project.',
    'dotnav.ef.listMigrations': 'Inspect migration history for the selected DbContext.',
    'dotnav.ef.updateDatabase': 'Bring the target database to a selected migration.',
    'dotnav.ef.pendingModelChanges': 'Verify whether the model needs a new migration.',
    'dotnav.ef.dbContextInfo': 'Inspect provider and database details for this DbContext.',
    'dotnav.ef.generateScript': 'Generate a reviewable SQL migration script.',
    'dotnav.ef.migrationsBundle': 'Create a deployable migration executable.',
    'dotnav.ef.optimizeDbContext': 'Generate a compiled model for faster startup.',
    'dotnav.ef.dropDatabase': 'Permanently delete the selected database.'
  };
  const activeGroup = navigation.find(([, entries]) =>
    entries.some(([command]) => command === spec.actionId))?.[0] ?? 'EF Core';
  const actionDescription = spec.actionId
    ? actionDescriptions[spec.actionId] ?? 'Configure and run this EF Core operation.'
    : 'Configure and run this EF Core operation.';
  const navigationHtml = navigation.map(([group, entries]) =>
    `<section class="nav-group"><h2>${localizedTextHtml(group, initialLocale)}</h2>${entries.map(([command, label, icon]) =>
      `<button type="button" class="nav-item${spec.actionId === command ? ' active' : ''}" ` +
      `data-command="${command}"${spec.actionId === command ? ' aria-current="page"' : ''}>` +
      `<span class="nav-icon">${iconSvg(icon)}</span>` +
      `${localizedTextHtml(label, initialLocale)}</button>`
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
<style>
  :root {
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
  }
</style>
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
const vscode = acquireVsCodeApi();
const OPTIONS = ${escapeJson(optionMap)};
const INITIAL_LOCALE = ${escapeJson(initialLocale)};
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
vscode.postMessage({ type: 'ready', values: readValues() });
</script>
</body>
</html>`;
}
