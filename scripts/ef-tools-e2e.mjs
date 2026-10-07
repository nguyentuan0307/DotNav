import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { EfToolsHarness } = require('../extensions/dotnav/out/test/fixtures/efToolsHarness.js');
const harness = new EfToolsHarness();
let mode = 'pending';
harness.run = async request => {
  if (mode === 'hang') {
    return new Promise(resolve => {
      const stop = () => setTimeout(() => resolve({ kind: 'cancelled', stdout: '', stderr: '', durationMs: 50 }), 50);
      if (request.signal.aborted) { stop(); }
      else { request.signal.addEventListener('abort', stop, { once: true }); }
    });
  }
  if (mode === 'error') {
    return { kind: 'error', errorSummary: 'Connection refused (mock)', stdout: '', stderr: '', durationMs: 1 };
  }
  return harness.migrations(mode === 'unknown' ? null : mode === 'applied');
};
const panel = await harness.open();

// This bridge drives the actual extension host callbacks; no EF process or DB exists.
const bootstrap = String.raw`
window.__efApi = {
  getState: () => ({}), setState: () => {},
  postMessage: message => { void fetch('/message', { method: 'POST', body: JSON.stringify(message) }); }
};
window.acquireVsCodeApi = () => window.__efApi;
let eventCursor = 0;
let polling = false;
setInterval(async () => {
  if (polling) return;
  polling = true;
  try {
    const batch = await (await fetch('/events?cursor=' + eventCursor)).json();
    eventCursor += batch.length;
    for (const message of batch) window.dispatchEvent(new MessageEvent('message', { data: message }));
  } finally { polling = false; }
}, 20);
window.addEventListener('load', async () => {
  const button = () => document.getElementById('submit');
  const check = () => document.querySelector('[data-action="check"]');
  const wait = async (condition, name) => {
    for (let attempt = 0; attempt < 200; attempt++) {
      if (condition()) return;
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    throw new Error('Timeout: ' + name);
  };
  const expect = (condition, name) => { if (!condition) throw new Error(name); };
  const scenario = async value => { await fetch('/scenario?mode=' + value); };
  const label = () => document.getElementById('submit-label').textContent;
  const finish = (state, text) => {
    const result = document.createElement('div');
    result.id = 'ef-e2e-result'; result.dataset.result = state; result.textContent = text;
    document.body.appendChild(result);
  };
  try {
    if (sessionStorage.getItem('ef-reload') !== 'yes') {
      await wait(() => !button().disabled, 'initial host validation');
      await scenario('error'); check().click();
      await wait(() => document.getElementById('status').textContent.includes('Could not read') && !button().classList.contains('busy'), 'failed Check');
      expect(!button().disabled && label() === 'Update', 'failed Check must permit Update');
      expect(document.getElementById('status').classList.contains('error'), 'failed Check must display error');

      await scenario('applied'); check().click();
      await wait(() => label() === 'Database Is Up to Date' && !button().classList.contains('busy'), 'up-to-date Check');
      expect(button().disabled, 'successful no-op must be disabled');
      const connection = document.querySelector('[data-field="connection"]');
      connection.value = 'Database=B'; connection.dispatchEvent(new Event('input', { bubbles: true }));
      await wait(() => label() === 'Update' && !button().disabled, 'connection change');

      const add = document.querySelector('[data-field="add"]');
      add.checked = true; add.dispatchEvent(new Event('change', { bubbles: true }));
      await wait(() => label() === 'Create and Apply Migration' && button().disabled, 'invalid --add');
      add.checked = false; add.dispatchEvent(new Event('change', { bubbles: true }));
      await wait(() => label() === 'Update' && !button().disabled, 'disable --add');

      await scenario('unknown'); check().click();
      await wait(() => document.getElementById('status').textContent.includes('Could not determine') && !button().classList.contains('busy'), 'unknown applied state');
      expect(!button().disabled && label() === 'Update', 'unknown applied state must not claim up-to-date');

      await scenario('error'); button().click();
      await wait(() => document.getElementById('progress-state').textContent === 'Failed' && !button().classList.contains('busy'), 'Update failure');
      expect(!button().disabled, 'unanswered error notification must not lock Update');

      await scenario('hang'); check().click();
      await wait(() => button().classList.contains('busy') && document.getElementById('progress-state').textContent === 'Running', 'running Check');
      expect(connection.disabled && add.disabled, 'form fields must be locked');
      expect(!document.getElementById('cancel').disabled, 'Cancel must be available');
      expect(!document.querySelector('[data-toolbar="output"]').disabled, 'Output must be available');
      expect(!document.getElementById('help-open').disabled, 'Help must be available');
      document.getElementById('help-open').click();
      expect(document.getElementById('help-drawer').classList.contains('open'), 'Help opens during work');
      document.getElementById('help-close').click();
      sessionStorage.setItem('ef-reload', 'yes');
      location.reload();
      return;
    }

    await wait(() => document.getElementById('progress-state').textContent === 'Running' && button().classList.contains('busy'), 'rehydrate active operation');
    expect(document.querySelector('[data-field="connection"]').disabled, 'restored fields must remain locked');
    document.getElementById('cancel').click();
    await wait(() => document.getElementById('progress-state').textContent === 'Cancelled' && !button().classList.contains('busy'), 'cancel completes');
    expect(document.getElementById('form') && !button().disabled, 'Cancel keeps a retryable form');
    await scenario('pending'); check().click();
    await wait(() => label() === 'Apply 2 Migrations' && !button().disabled, 'retry after Cancel');
    finish('pass', 'EF Tools: failure recovery, Check states, --add, field locking, Help/Output, reload, Cancel and retry passed.');
  } catch (error) { finish('fail', error.stack || String(error)); }
});
`;
const html = panel.webview.html
  .replace("default-src 'none';", "default-src 'none'; connect-src 'self';")
  .replace(/(<script nonce="[^"]+">)/, (_match, prefix) => prefix + bootstrap);
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/') {
      res.setHeader('Content-Type', 'text/html'); res.end(html);
    } else if (url.pathname === '/events') {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(panel.messages.slice(Number(url.searchParams.get('cursor') || 0))));
    } else if (url.pathname === '/scenario') {
      mode = url.searchParams.get('mode'); res.end('ok');
    } else if (url.pathname === '/message') {
      let body = '';
      for await (const chunk of req) body += chunk;
      // Like VS Code postMessage, acknowledge delivery without waiting for work.
      void panel.receive(JSON.parse(body)).catch(error => console.error('Mock host message failed:', error));
      res.end('ok');
    } else { res.statusCode = 404; res.end(); }
  } catch (error) { res.statusCode = 500; res.end(String(error)); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const profile = await mkdtemp(path.join(tmpdir(), 'dotnav-ef-e2e-'));
let child;
let timedOut = false;
try {
  const address = server.address();
  const args = ['--headless', '--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--no-first-run',
    '--user-data-dir=' + profile, '--dump-dom', '--virtual-time-budget=15000', 'http://127.0.0.1:' + address.port];
  child = spawn(process.env.EF_E2E_CHROME || 'google-chrome', args, { detached: process.platform !== 'win32' });
  let stdout = ''; let stderr = '';
  child.stdout.on('data', data => { stdout += data; });
  child.stderr.on('data', data => { stderr += data; });
  const timer = setTimeout(() => {
    timedOut = true;
    if (process.platform !== 'win32') { process.kill(-child.pid, 'SIGKILL'); }
    else { child.kill('SIGKILL'); }
  }, 30000);
  const exit = await new Promise((resolve, reject) => {
    child.once('error', reject); child.once('close', resolve);
  }).finally(() => clearTimeout(timer));
  const result = /<div id="ef-e2e-result" data-result="(pass|fail)">([^<]*)<\/div>/.exec(stdout);
  if (!result || result[1] !== 'pass') {
    await writeFile(path.join(profile, 'failure.html'), stdout);
    throw new Error((result?.[2] || 'No completion marker') + '\nChrome exit=' + exit + ', timeout=' + timedOut + '\n' + stderr.slice(-600) + '\nDOM: ' + path.join(profile, 'failure.html'));
  }
  assert.equal(exit, 0);
  console.log(result[2]);
  await rm(profile, { recursive: true, force: true });
} finally {
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  await harness.close();
}
