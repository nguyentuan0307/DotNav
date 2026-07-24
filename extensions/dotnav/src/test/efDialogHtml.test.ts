import assert from 'node:assert/strict';
import test from 'node:test';
import {
  EfDialogSpec,
  defaultValues,
  escapeHtml,
  renderDialogHtml
} from '../ef/efDialogHtml';

const spec: EfDialogSpec = {
  title: 'Add Migration',
  submitLabel: 'Create',
  fields: [
    { id: 'name', label: 'Migration name', type: 'text', value: '', required: true, placeholder: 'e.g. AddOrders' },
    {
      id: 'project', label: 'Migrations project', type: 'select', value: '/repo/Data.csproj',
      options: [
        { value: '/repo/Data.csproj', label: 'Data', description: 'Data/Data.csproj' },
        { value: '/repo/Web.csproj', label: 'Web' }
      ]
    },
    { id: 'noBuild', label: 'Skip build', type: 'checkbox', value: true },
    {
      id: 'target', label: 'Target migration', type: 'combo', value: '',
      options: [{ value: 'Init', label: 'Init', description: '20260101120000_Init' }]
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
      id: 'p', label: 'Project', type: 'select', value: '"><script>bad()</script>',
      options: [{ value: '"><img onerror=x>', label: '<b>Data</b>' }]
    }]
  };

  const html = renderDialogHtml(hostile, 'nonce123', 'vscode-resource:');
  assert.ok(!html.includes('<script>alert(1)</script>'));
  assert.ok(!html.includes('<img onerror=x>'));
  assert.ok(!html.includes('<b>Data</b>'));
  assert.ok(html.includes('&lt;b&gt;Data&lt;/b&gt;'));
});

test('renders each field type with its data-field hook', () => {
  const html = renderDialogHtml(spec, 'nonce123', 'vscode-resource:');
  assert.ok(html.includes('data-field="name"'));
  assert.ok(html.includes('data-required="true"'));
  assert.ok(html.includes('<select id="project" data-field="project">'));
  assert.ok(html.includes('type="checkbox" id="noBuild" data-field="noBuild" checked'));
  assert.ok(html.includes('list="target-list"'));
  assert.ok(html.includes('<datalist id="target-list">'));
  assert.ok(html.includes('data-action="check"'));
  assert.ok(html.includes('>Create<'));
});

test('marks the selected option and shows option descriptions', () => {
  const html = renderDialogHtml(spec, 'nonce123', 'vscode-resource:');
  assert.ok(html.includes('<option value="/repo/Data.csproj" selected>Data — Data/Data.csproj</option>'));
  assert.ok(html.includes('<option value="/repo/Web.csproj">Web</option>'));
});

test('locks the CSP to the given nonce and source', () => {
  const html = renderDialogHtml(spec, 'abc123', 'vscode-resource:');
  assert.ok(html.includes("default-src 'none'"));
  assert.ok(html.includes("script-src 'nonce-abc123'"));
  assert.ok(html.includes('style-src vscode-resource:'));
  assert.ok(html.includes('<script nonce="abc123">'));
});

test('shows a placeholder option when a select has no choices', () => {
  const empty: EfDialogSpec = {
    title: 'x', submitLabel: 'Go',
    fields: [{ id: 'context', label: 'DbContext', type: 'select', value: '', options: [] }]
  };
  assert.ok(renderDialogHtml(empty, 'n', 'c').includes('<option value="">(none found)</option>'));
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
  assert.ok(dangerous.includes('id="submit" class="danger"'));
  assert.ok(dangerous.includes('THIS CANNOT BE UNDONE.'));
});

test('defaultValues seeds strings and booleans per field type', () => {
  assert.deepEqual(defaultValues(spec.fields), {
    name: '',
    project: '/repo/Data.csproj',
    noBuild: true,
    target: ''
  });
});
