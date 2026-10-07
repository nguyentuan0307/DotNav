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
  postMessage: message => {
    window.__efMessages.push(message);
    void fetch('/message', { method: 'POST', body: JSON.stringify(message) });
  }
};
window.__efMessages = [];
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
    if (location.pathname === '/preview') {
      await wait(() => !button().disabled, 'preview ready');
      document.querySelector('[data-locale="vi"]').click();
      document.getElementById('help-open').click();
      document.body.dataset.previewLayout = JSON.stringify({
        scrollY, bodyScroll: document.body.scrollTop,
        body: document.body.getBoundingClientRect().toJSON(),
        guide: document.getElementById('help-drawer').getBoundingClientRect().toJSON()
      });
      return;
    }
    if (sessionStorage.getItem('ef-reload') !== 'yes') {
      await wait(() => !button().disabled, 'initial host validation');
      const guide = document.getElementById('help-drawer');
      document.getElementById('help-open').click();
      expect(guide.classList.contains('open') && !guide.hasAttribute('aria-modal'), 'guide is non-modal');
      expect(!document.getElementById('help-backdrop'), 'no backdrop may block the form');
      const shellBounds = document.querySelector('.shell').getBoundingClientRect();
      const guideBounds = guide.getBoundingClientRect();
      if (innerWidth > 1100) {
        expect(guideBounds.left >= shellBounds.right, 'desktop guide must sit beside the form');
        window.scrollTo(0, 200);
        await new Promise(resolve => requestAnimationFrame(resolve));
        expect(guide.getBoundingClientRect().top >= 65 && guide.getBoundingClientRect().top < 150,
          'desktop guide must remain visible when the form scrolls: ' + JSON.stringify({
            scrollY, guide: guide.getBoundingClientRect().toJSON(), shell: document.querySelector('.shell').getBoundingClientRect().toJSON(),
            layout: document.querySelector('.center-layout').getBoundingClientRect().toJSON()
          }));
        window.scrollTo(0, 0);
      } else {
        expect(guideBounds.top >= shellBounds.bottom, 'narrow guide must sit below the form');
      }
      expect(document.documentElement.scrollWidth <= innerWidth, 'guide must not create horizontal overflow: ' +
        document.documentElement.scrollWidth + '/' + innerWidth + ' ' + JSON.stringify(
          Array.from(document.querySelectorAll('body *')).filter(node => node.getBoundingClientRect().right > innerWidth + 1)
            .slice(0, 8).map(node => ({ tag: node.tagName, id: node.id, class: node.className, right: node.getBoundingClientRect().right }))));
      expect(getComputedStyle(document.body).overflowY !== 'hidden', 'form remains scrollable');
      const guideSummary = guide.querySelector('summary');
      guideSummary.focus();
      const submitCount = window.__efMessages.filter(m => m.type === 'submit').length;
      guideSummary.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
      expect(window.__efMessages.filter(m => m.type === 'submit').length === submitCount, 'Enter in guide must not execute EF');
      const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
      document.getElementById('help-close').dispatchEvent(tab);
      expect(!tab.defaultPrevented, 'guide must not trap Tab');
      const editConnection = document.querySelector('[data-field="connection"]');
      editConnection.focus();
      expect(document.activeElement === editConnection, 'form can receive focus with guide open');
      const fieldGuide = guide.querySelector('[data-guide-field="connection"]');
      expect(fieldGuide.open && fieldGuide.classList.contains('active'), 'focused field explanation is expanded and highlighted');
      editConnection.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      fieldGuide.open = false;
      editConnection.dispatchEvent(new KeyboardEvent('keydown', { key: 'F1', bubbles: true, cancelable: true }));
      expect(guide.classList.contains('open') && fieldGuide.open && fieldGuide.classList.contains('active'),
        'F1 from an already focused field must reveal its explanation');
      expect(document.activeElement === editConnection, 'F1 must retain input focus');
      editConnection.value = 'Database=GuideTest';
      editConnection.dispatchEvent(new Event('input', { bubbles: true }));
      await wait(() => !button().disabled, 'edit while guide open');
      document.querySelector('[data-locale="vi"]').click();
      expect(guide.querySelector('.guide-steps h2').textContent === 'Cách thực hiện', 'guide steps switch to Vietnamese');
      expect(editConnection.value === 'Database=GuideTest', 'locale change preserves inputs');
      document.querySelector('[data-locale="en"]').click();
      await scenario('error'); check().click();
      await wait(() => document.getElementById('status').textContent.includes('Could not read') && !button().classList.contains('busy'), 'failed Check');
      expect(!button().disabled && label() === 'Update', 'failed Check must permit Update');
      expect(document.getElementById('status').classList.contains('error'), 'failed Check must display error');
      expect(guide.classList.contains('open'), 'guide stays open while Check runs');
      editConnection.focus();
      editConnection.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      expect(!guide.classList.contains('open') && document.activeElement === editConnection, 'Escape closes guide without losing form focus');
      expect(editConnection.value === 'Database=GuideTest', 'closing guide preserves inputs');

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

      document.getElementById('help-open').click();
      await scenario('error'); button().click();
      await wait(() => document.getElementById('progress-state').textContent === 'Failed' && !button().classList.contains('busy'), 'Update failure');
      expect(!button().disabled, 'unanswered error notification must not lock Update');
      expect(guide.classList.contains('open'), 'Update can run while the guide stays open');
      document.getElementById('help-close').click();

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
    finish('pass', 'EF Tools: side guide layout, form interaction, focus, keyboard, bilingual steps, failure recovery, reload, Cancel and retry passed.');
  } catch (error) { finish('fail', error.stack || String(error)); }
});
`;
const html = panel.webview.html
  .replace("default-src 'none';", "default-src 'none'; connect-src 'self';")
  // VS Code normally supplies these theme/font variables to every webview.
  .replace('</style>', `:root {
    --vscode-font-family: system-ui, sans-serif; --vscode-font-size: 13px;
    --vscode-foreground: #d4d4d4; --vscode-descriptionForeground: #a5abb5;
    --vscode-editor-background: #1e1e1e; --vscode-editorWidget-background: #252526;
    --vscode-sideBar-background: #252526; --vscode-titleBar-activeBackground: #181818;
    --vscode-panel-border: #3d4149; --vscode-focusBorder: #007fd4;
    --vscode-button-background: #0e639c; --vscode-button-foreground: #fff;
    --vscode-button-hoverBackground: #1177bb; --vscode-button-secondaryBackground: #3a3d41;
    --vscode-button-secondaryForeground: #fff; --vscode-button-secondaryHoverBackground: #45494e;
    --vscode-input-background: #313135; --vscode-input-foreground: #ddd; --vscode-input-border: #4c4c50;
    --vscode-list-hoverBackground: #303238; --vscode-list-activeSelectionBackground: #04395e;
    --vscode-list-activeSelectionForeground: #fff; --vscode-toolbar-hoverBackground: #31353b;
    --vscode-badge-background: #343941; --vscode-badge-foreground: #ddd;
    --vscode-textLink-foreground: #75beff; --vscode-progressBar-background: #0e70c0;
    --vscode-editorWarning-foreground: #cca700; --vscode-errorForeground: #f48771;
  }</style>`)
  .replace(/(<script nonce="[^"]+">)/, (_match, prefix) => prefix + bootstrap);
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/' || url.pathname === '/preview') {
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
    '--window-size=' + (process.env.EF_E2E_VIEWPORT || '1440,1000'),
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
  if (process.env.EF_GUIDE_SCREENSHOT) {
    const screenshot = spawn(process.env.EF_E2E_CHROME || 'google-chrome', [
      '--headless', '--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--no-first-run',
      '--remote-debugging-port=0', '--user-data-dir=' + profile,
      '--window-size=' + (process.env.EF_E2E_VIEWPORT || '1440,1000'), 'about:blank'
    ], { detached: process.platform !== 'win32' });
    const closed = new Promise(resolve => screenshot.once('close', resolve));
    const screenshotTimer = setTimeout(() => {
      if (process.platform !== 'win32') { process.kill(-screenshot.pid, 'SIGKILL'); }
      else { screenshot.kill('SIGKILL'); }
    }, 30000);
    screenshot.stdout.resume();
    let socket;
    try {
      const endpoint = await new Promise((resolve, reject) => {
        let diagnostics = '';
        screenshot.once('error', reject);
        screenshot.once('close', () => reject(new Error('Screenshot Chrome closed before DevTools was ready')));
        screenshot.stderr.on('data', data => {
          diagnostics += data;
          const match = /DevTools listening on (ws:\/\/[^\s]+)/.exec(diagnostics);
          if (match) { resolve(match[1]); }
        });
      });
      socket = new WebSocket(endpoint);
      await new Promise((resolve, reject) => { socket.addEventListener('open', resolve); socket.addEventListener('error', reject); });
      let nextId = 0;
      const pending = new Map();
      socket.addEventListener('message', event => {
        const message = JSON.parse(event.data);
        const request = pending.get(message.id);
        if (request) {
          pending.delete(message.id);
          if (message.error) { request.reject(new Error(JSON.stringify(message.error))); }
          else { request.resolve(message.result); }
        }
      });
      socket.addEventListener('close', () => {
        for (const request of pending.values()) { request.reject(new Error('Screenshot DevTools connection closed')); }
        pending.clear();
      });
      const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
        const id = ++nextId;
        pending.set(id, { resolve, reject });
        socket.send(JSON.stringify({ id, method, params, sessionId }));
      });
      const target = await send('Target.createTarget', { url: 'http://127.0.0.1:' + address.port + '/preview' });
      const attached = await send('Target.attachToTarget', { targetId: target.targetId, flatten: true });
      const session = attached.sessionId;
      let ready = false;
      for (let attempt = 0; attempt < 100; attempt++) {
        const state = await send('Runtime.evaluate', { expression: "document.body?.dataset.previewLayout !== undefined", returnByValue: true }, session);
        if (state.result.value) { ready = true; break; }
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      assert.ok(ready, 'Screenshot preview must finish loading');
      // Wait for real animation frames after scrolling; virtual-time dump-dom can capture stale paint.
      await send('Runtime.evaluate', { expression: 'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))', awaitPromise: true }, session);
      const captured = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }, session);
      await writeFile(path.resolve(process.env.EF_GUIDE_SCREENSHOT), Buffer.from(captured.data, 'base64'));
      const dom = await send('Runtime.evaluate', { expression: 'document.documentElement.outerHTML', returnByValue: true }, session);
      await writeFile(path.resolve(process.env.EF_GUIDE_SCREENSHOT) + '.html', dom.result.value);
      await send('Browser.close');
      await closed;
    } finally {
      clearTimeout(screenshotTimer);
      socket?.close();
      if (screenshot.pid && screenshot.exitCode === null && screenshot.signalCode === null) {
        if (process.platform !== 'win32') { process.kill(-screenshot.pid, 'SIGKILL'); }
        else { screenshot.kill('SIGKILL'); }
        await closed;
      }
    }
    console.log('Guide screenshot: ' + process.env.EF_GUIDE_SCREENSHOT);
  }
  await rm(profile, { recursive: true, force: true });
} finally {
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  await harness.close();
}
