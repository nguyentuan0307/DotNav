import assert from 'node:assert/strict';
import test from 'node:test';
import {
  EfDialogSpec,
  defaultValues,
  displayValueFor,
  escapeHtml,
  escapeJson,
  renderDialogHtml
} from '../ef/efDialogHtml';

const spec: EfDialogSpec = {
  title: 'Add Migration',
  submitLabel: 'Create',
  fields: [
    { id: 'name', label: 'Migration name', type: 'text', value: '', required: true, placeholder: 'e.g. AddOrders' },
    {
      id: 'project', label: 'Migrations project', type: 'combo', strict: true, value: '/repo/Data/Data.csproj',
      options: [
        { value: '/repo/Data/Data.csproj', label: 'Data', description: 'src/Data' },
        { value: '/repo/Web/Web.csproj', label: 'Web', description: 'src/Web' }
      ]
    },
    { id: 'secret', label: 'Connection string', type: 'password', value: '' },
    { id: 'noBuild', label: 'Skip build', type: 'checkbox', value: true, advanced: true },
    { id: 'extraArgs', label: 'Additional arguments', type: 'text', value: '', advanced: true },
    {
      id: 'target', label: 'Target migration', type: 'combo', value: '',
      options: [{ value: 'Init', label: 'Init', description: '2026-01-01' }]
    }
  ],
  actions: [{ id: 'check', label: 'Check database' }]
};

test('escapes markup in every interpolated string', () => {
  assert.equal(escapeHtml('<script>"x"&\'y\''), '&lt;script&gt;&quot;x&quot;&amp;&#39;y&#39;');

  const hostile: EfDialogSpec = {
    title: '</title><script>alert(1)</script>',
    submitLabel: 'Go',
    fields: [{
      id: 'p', label: 'Project', type: 'combo', strict: true, value: '"><script>bad()</script>',
      options: [{ value: '"><img onerror=x>', label: '<b>Data</b>' }]
    }]
  };

  const html = renderDialogHtml(hostile, 'nonce123', 'vscode-resource:');
  assert.ok(!html.includes('<script>alert(1)</script>'));
  assert.ok(!html.includes('<img onerror=x>'));
  assert.ok(!html.includes('<b>Data</b>'));
});

test('option payloads cannot break out of the script block', () => {
  const payload = escapeJson({ p: [{ value: 'a', label: '</script><script>bad()</script>' }] });
  assert.ok(!payload.includes('</script>'));
  assert.ok(payload.includes('\\u003c'));

  const html = renderDialogHtml(
    {
      title: 'x', submitLabel: 'Go',
      fields: [{
        id: 'p', label: 'P', type: 'combo', value: '',
        options: [{ value: 'a', label: '</script><script>bad()</script>' }]
      }]
    },
    'n',
    'c'
  );
  assert.ok(!html.includes('<script>bad()</script>'));
});

test('escapeJson leaves ordinary text untouched', () => {
  assert.equal(escapeJson({ label: 'Data Access Layer' }), '{"label":"Data Access Layer"}');
});

test('renders combos as searchable inputs backed by a hidden value', () => {
  const html = renderDialogHtml(spec, 'nonce123', 'vscode-resource:');
  // The searchable input carries the label; the submitted value is hidden.
  assert.ok(html.includes('data-display="project"'));
  assert.ok(html.includes('value="Data"'));
  assert.ok(html.includes('<input type="hidden" data-field="project"'));
  assert.ok(html.includes('data-combo="project" data-strict="true"'));
  assert.ok(html.includes('data-list="project"'));
  // Free-text combos are not strict.
  assert.ok(html.includes('data-combo="target"'));
  assert.ok(!/data-combo="target" data-strict/.test(html));
  // No native select or datalist survives.
  assert.ok(!html.includes('<select'));
  assert.ok(!html.includes('<datalist'));
});

test('embeds option data for the client-side filter', () => {
  const html = renderDialogHtml(spec, 'nonce123', 'vscode-resource:');
  assert.ok(html.includes('const OPTIONS = {'));
  assert.ok(html.includes('"src/Data"'));
  assert.ok(html.includes('"label":"Web"'));
});

test('renders passwords masked and other fields as text', () => {
  const html = renderDialogHtml(spec, 'n', 'c');
  assert.ok(html.includes('<input type="password" id="secret" data-field="secret"'));
  assert.ok(html.includes('<input type="text" id="name" data-field="name"'));
});

test('moves advanced fields into a collapsed section', () => {
  const html = renderDialogHtml(spec, 'n', 'c');
  assert.ok(html.includes('<details class="advanced">'));
  assert.ok(html.includes('data-en="Advanced options"'));

  const advancedStart = html.indexOf('<details class="advanced">');
  assert.ok(html.indexOf('data-field="noBuild"') > advancedStart, 'noBuild is advanced');
  assert.ok(html.indexOf('data-field="extraArgs"') > advancedStart, 'extraArgs is advanced');
  assert.ok(html.indexOf('data-field="name"') < advancedStart, 'the primary field stays on top');
});

test('omits the advanced section when nothing is advanced', () => {
  const html = renderDialogHtml(
    { title: 'x', submitLabel: 'Go', fields: [{ id: 'a', label: 'A', type: 'text', value: '' }] },
    'n',
    'c'
  );
  assert.ok(!html.includes('<details class="advanced">'));
});

test('locks the CSP to the given nonce and source', () => {
  const html = renderDialogHtml(spec, 'abc123', 'vscode-resource:');
  assert.ok(html.includes("default-src 'none'"));
  assert.ok(html.includes("script-src 'nonce-abc123'"));
  assert.ok(html.includes('style-src vscode-resource:'));
  assert.ok(html.includes('<script nonce="abc123">'));
});

test('renders the danger style and warning banner only when asked', () => {
  const plain = renderDialogHtml(spec, 'n', 'c');
  assert.ok(!plain.includes('class="danger"'));
  assert.ok(!plain.includes('class="warning"'));

  const dangerous = renderDialogHtml(
    { ...spec, danger: true, warning: 'THIS CANNOT BE UNDONE.' },
    'n',
    'c'
  );
  assert.ok(dangerous.includes('id="submit" class="primary danger"'));
  assert.ok(dangerous.includes('class="workspace-card danger-workspace"'));
  assert.ok(dangerous.includes('THIS CANNOT BE UNDONE.'));
});

test('displayValueFor shows the option label, not the raw value', () => {
  assert.equal(displayValueFor(spec.fields[1]), 'Data');
  assert.equal(displayValueFor(spec.fields[0]), '');
  assert.equal(
    displayValueFor({ id: 'x', label: 'X', type: 'combo', value: 'Typed', options: [] }),
    'Typed',
    'free-text combos keep whatever was typed'
  );
});

test('defaultValues seeds strings and booleans per field type', () => {
  assert.deepEqual(defaultValues(spec.fields), {
    name: '',
    project: '/repo/Data/Data.csproj',
    secret: '',
    noBuild: true,
    extraArgs: '',
    target: ''
  });
});

test('renders a field-level action button beside its input', () => {
  const html = renderDialogHtml(
    {
      title: 'Update Database',
      submitLabel: 'Update',
      fields: [{
        id: 'target', label: 'Target migration', type: 'combo', value: '',
        options: [],
        action: { id: 'check', label: 'Check database' }
      }]
    },
    'n',
    'c'
  );

  assert.ok(html.includes('class="field-line"'));
  assert.ok(html.includes('class="secondary inline" data-action="check"'));
  // The action sits inside the field row, not down in the button bar.
  const line = html.indexOf('class="field-line"');
  const buttons = html.indexOf('class="buttons"');
  assert.ok(line < html.indexOf('data-action="check"'));
  assert.ok(html.indexOf('data-action="check"') < buttons);
});

test('autofocus skips combo inputs so no dropdown opens on load', () => {
  const html = renderDialogHtml(
    {
      title: 'x', submitLabel: 'Go',
      fields: [
        { id: 'target', label: 'Target', type: 'combo', value: '', options: [] },
        { id: 'name', label: 'Name', type: 'text', value: '' }
      ]
    },
    'n',
    'c'
  );
  assert.ok(html.includes("input[type=\"text\"]:not(.combo-input)"));
});

test('Enter is swallowed while a combo list is open', () => {
  const html = renderDialogHtml(
    { title: 'x', submitLabel: 'Go', fields: [{ id: 'a', label: 'A', type: 'combo', value: '', options: [] }] },
    'n',
    'c'
  );
  assert.ok(html.includes('function anyListOpen()'));
  assert.ok(html.includes('if (anyListOpen()) { return; }'));
});

test('the danger button uses a background token, not a foreground colour', () => {
  const html = renderDialogHtml({ ...spec, danger: true }, 'n', 'c');
  assert.ok(html.includes('--vscode-statusBarItem-errorBackground'));
  assert.ok(!html.includes('background: var(--vscode-errorForeground'));
});

test('autofocus never lands inside the collapsed Advanced section', () => {
  // Remove Last Migration shape: no plain text field outside Advanced.
  const html = renderDialogHtml(
    {
      title: 'Remove Last Migration',
      submitLabel: 'Remove',
      fields: [
        { id: 'force', label: 'Force', type: 'checkbox', value: false },
        { id: 'project', label: 'Project', type: 'combo', strict: true, value: '', options: [] },
        { id: 'configuration', label: 'Configuration', type: 'text', value: 'Debug', advanced: true }
      ]
    },
    'n',
    'c'
  );

  assert.ok(html.includes("!node.closest('details.advanced')"));
});

test('renders the persistent EF Core Center navigation and toolbar', () => {
  const html = renderDialogHtml(
    {
      ...spec,
      actionId: 'dotnav.ef.addMigration',
      projectLabel: 'Data',
      contextLabel: 'AppDbContext',
      toolLabel: 'EF Core 8'
    },
    'n',
    'c'
  );
  assert.ok(html.includes('aria-label="EF Core actions"'));
  assert.ok(html.includes('data-command="dotnav.ef.addMigration"'));
  assert.ok(html.includes('nav-item active'));
  assert.ok(html.includes('data-command="dotnav.ef.migrationsBundle"'));
  assert.ok(html.includes('data-command="dotnav.ef.optimizeDbContext"'));
  assert.ok(html.includes('data-command="dotnav.ef.dropDatabase"'));
  assert.ok(html.includes('data-toolbar="refresh"'));
  assert.ok(html.includes('data-toolbar="settings"'));
  assert.ok(html.includes('aria-label="Manage dotnet-ef tool"'));
  assert.ok(html.includes('aria-current="page"'));
  assert.ok(html.includes('Migration workspace'));
});

test('renders a polished action workspace with a collapsible command preview', () => {
  const html = renderDialogHtml(
    { ...spec, actionId: 'dotnav.ef.addMigration' },
    'n',
    'c'
  );

  assert.ok(html.includes('class="action-heading"'));
  assert.ok(html.includes('Capture the current model changes in a new migration.'));
  assert.ok(html.includes('class="workspace-card"'));
  assert.ok(html.includes('<details class="command-panel">'));
  assert.ok(!html.includes('<details class="command-panel" open'));
  assert.ok(html.includes('id="copy-preview"'));
  assert.ok(html.includes("type: 'copy'"));
  assert.ok(html.includes('white-space: pre-wrap'));
  assert.ok(html.includes('overflow-wrap: anywhere'));
});

test('renders bilingual guidance in an on-demand drawer without changing form values', () => {
  const html = renderDialogHtml(
    { ...spec, actionId: 'dotnav.ef.addMigration' },
    'n',
    'c',
    'vi'
  );

  assert.ok(html.includes('class="help-open"'));
  assert.ok(html.includes('aria-expanded="false"'));
  assert.ok(html.includes('class="help-backdrop"'));
  assert.ok(html.includes('class="help-drawer"'));
  assert.ok(html.includes('role="dialog" aria-modal="true"'));
  assert.ok(html.includes('aria-hidden="true" inert'));
  assert.ok(html.includes('data-help-action="dotnav.ef.addMigration"'));
  assert.ok(html.includes('Hướng dẫn sử dụng'));
  assert.ok(html.includes('Hướng dẫn các field'));
  assert.ok(html.includes('Tên migration'));
  assert.ok(html.includes('data-locale="en"'));
  assert.ok(html.includes('data-locale="vi"'));
  assert.ok(html.includes('data-placeholder-en="e.g. AddOrders"'));
  assert.ok(html.includes('data-placeholder-vi="ví dụ: AddOrders"'));
  assert.ok(html.includes("vscode.postMessage({ type: 'locale'"));
  assert.ok(!html.includes('persistedState.helpOpen'));
  assert.ok(html.includes('value="Data"'), 'changing locale must not replace submitted values');
});

test('guide drawer supports close controls, Escape, F1, focus restoration, and focus trapping', () => {
  const html = renderDialogHtml(
    { ...spec, actionId: 'dotnav.ef.addMigration' },
    'n',
    'c'
  );

  assert.ok(html.includes("helpOpenButton.addEventListener('click', openHelp)"));
  assert.ok(html.includes("helpCloseButton.addEventListener('click'"));
  assert.ok(html.includes("helpBackdrop.addEventListener('click'"));
  assert.ok(html.includes("event.key === 'Escape' && isHelpOpen()"));
  assert.ok(html.includes("event.key === 'F1' && helpDrawer"));
  assert.ok(html.includes('helpPreviouslyFocused'));
  assert.ok(html.includes("event.key !== 'Tab'"));
  assert.ok(html.includes("helpDrawer.setAttribute('inert', '')"));
});

test('renders an initially hidden, localized operation progress surface', () => {
  const html = renderDialogHtml(
    { ...spec, actionId: 'dotnav.ef.addMigration' },
    'n',
    'c'
  );

  assert.ok(html.includes('class="operation-progress"'));
  assert.ok(html.includes('id="operation-progress" aria-live="polite" hidden'));
  assert.ok(html.includes('id="progress-bar"'));
  assert.ok(html.includes('id="progress-steps"'));
  assert.ok(html.includes("message.type === 'progress'"));
  assert.ok(html.includes('renderProgress(message.progress)'));
  assert.ok(html.includes("'Running': { en: 'Running', vi: 'Đang chạy' }"));
  assert.ok(html.includes('@keyframes progress-slide'));
  assert.ok(html.includes('progress.state === \'running\' ? \'Running\''));
});

test('can omit command preview for source-only Center actions', () => {
  const html = renderDialogHtml(
    {
      ...spec,
      actionId: 'dotnav.ef.listMigrations',
      hideCommandPreview: true
    },
    'n',
    'c'
  );

  assert.ok(html.includes('data-help-action="dotnav.ef.listMigrations"'));
  assert.ok(!html.includes('<details class="command-panel">'));
  assert.ok(html.includes('if (previewNode)'));
});

test('uses responsive and reduced-motion styles for the Center shell', () => {
  const html = renderDialogHtml(spec, 'n', 'c');
  assert.ok(html.includes('@media (max-width: 1040px)'));
  assert.ok(html.includes('@media (max-width: 760px)'));
  assert.ok(html.includes('@media (max-width: 480px)'));
  assert.ok(html.includes('@media (prefers-reduced-motion: reduce)'));
  assert.ok(html.includes('@media (forced-colors: active)'));
});

test('comboboxes expose listbox and active-descendant accessibility wiring', () => {
  const html = renderDialogHtml(spec, 'n', 'c');
  assert.ok(html.includes('role="listbox"'));
  assert.ok(html.includes("display.setAttribute('aria-controls', list.id)"));
  assert.ok(html.includes("row.setAttribute('role', 'option')"));
  assert.ok(html.includes("display.setAttribute('aria-activedescendant', active.id)"));
  assert.ok(html.includes('aria-live="polite"'));
});

test('busy state leaves Cancel enabled and host validation controls submit', () => {
  const html = renderDialogHtml(spec, 'n', 'c');
  assert.ok(html.includes("querySelectorAll('button:not(#cancel):not([data-help-control])')"));
  assert.ok(html.includes("document.getElementById('cancel').disabled = false"));
  assert.ok(html.includes("submitButton.classList.toggle('busy', busy)"));
  assert.ok(html.includes("submitButton.setAttribute('aria-busy'"));
  assert.ok(html.includes('!valid || !hostValid'));
  assert.ok(html.includes("message.type === 'validity'"));
});

test('password fields have a temporary reveal control', () => {
  const html = renderDialogHtml(spec, 'n', 'c');
  assert.ok(html.includes('data-reveal="secret"'));
  assert.ok(html.includes('aria-label="Show value"'));
  assert.ok(html.includes("input.type = showing ? 'password' : 'text'"));
});

test('generated Center JavaScript is syntactically valid', () => {
  const html = renderDialogHtml(spec, 'n', 'c');
  const scripts = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)];
  assert.ok(scripts.length > 0);
  for (const script of scripts) {
    assert.doesNotThrow(() => new Function(script[1]));
  }
});
