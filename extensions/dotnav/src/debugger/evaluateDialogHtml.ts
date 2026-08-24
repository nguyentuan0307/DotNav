import * as vscode from 'vscode';
import { ExtractedSqlQuery } from './sqlInspector';
import { DapEvaluateResponse } from './evaluateEngine';

export function getEvaluateWebviewHtml(
  webview: vscode.Webview,
  initialExpression: string,
  sqlQuery?: ExtractedSqlQuery,
  evalResponse?: DapEvaluateResponse
): string {
  const nonce = getNonce();

  const escapedInitialExpr = escapeHtml(initialExpression);
  const formattedSql = sqlQuery ? escapeHtml(sqlQuery.formattedSql) : '';
  const boundSql = sqlQuery ? escapeHtml(sqlQuery.boundSql) : '';
  const hasSql = Boolean(sqlQuery && sqlQuery.formattedSql);

  const evalResult = evalResponse ? escapeHtml(evalResponse.result) : '';
  const evalType = evalResponse?.type ? escapeHtml(evalResponse.type) : '';
  const evalError = evalResponse?.error ? escapeHtml(evalResponse.error) : '';
  const isSuccess = evalResponse?.success ?? false;

  const paramsHtml = (sqlQuery?.parameters || [])
    .map(p => `<span class="param-badge"><code>${escapeHtml(p.name)}</code> = <strong>${escapeHtml(p.value)}</strong></span>`)
    .join(' ');

  const tablesHtml = (sqlQuery?.tables || [])
    .map(t => `<span class="table-badge"><span class="codicon codicon-database"></span> ${escapeHtml(t)}</span>`)
    .join(' ');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>DotNav: Evaluate Expression & SQL Inspector</title>
  <style>
    :root {
      --bg-color: var(--vscode-editor-background);
      --fg-color: var(--vscode-editor-foreground);
      --border-color: var(--vscode-panel-border, #333);
      --input-bg: var(--vscode-input-background, #1e1e1e);
      --input-fg: var(--vscode-input-foreground, #ccc);
      --btn-bg: var(--vscode-button-background, #0e639c);
      --btn-fg: var(--vscode-button-foreground, #fff);
      --btn-hover: var(--vscode-button-hoverBackground, #1177bb);
      --card-bg: var(--vscode-editorWidget-background, #252526);
      --badge-bg: var(--vscode-badge-background, #4d4d4d);
      --badge-fg: var(--vscode-badge-foreground, #ffffff);
      --sql-kw: var(--vscode-symbolIcon-keywordForeground, #569cd6);
      --sql-str: var(--vscode-symbolIcon-stringForeground, #ce9178);
      --sql-num: var(--vscode-symbolIcon-numberForeground, #b5cea8);
    }
    body {
      background-color: var(--bg-color);
      color: var(--fg-color);
      font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif);
      font-size: var(--vscode-font-size, 13px);
      margin: 0;
      padding: 16px;
      display: flex;
      flex-direction: column;
      height: 100vh;
      box-sizing: border-box;
    }
    .header-bar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 12px;
    }
    .title {
      font-size: 15px;
      font-weight: 600;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .shortcuts {
      font-size: 11px;
      opacity: 0.7;
    }
    .input-section {
      display: flex;
      gap: 8px;
      margin-bottom: 14px;
    }
    .expression-input {
      flex: 1;
      background-color: var(--input-bg);
      color: var(--input-fg);
      border: 1px solid var(--border-color);
      border-radius: 4px;
      padding: 8px 12px;
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: 13px;
      resize: vertical;
      min-height: 48px;
      outline: none;
    }
    .expression-input:focus {
      border-color: var(--btn-bg);
    }
    .btn {
      background-color: var(--btn-bg);
      color: var(--btn-fg);
      border: none;
      border-radius: 4px;
      padding: 8px 16px;
      cursor: pointer;
      font-weight: 500;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-size: 12px;
    }
    .btn:hover {
      background-color: var(--btn-hover);
    }
    .btn-secondary {
      background-color: var(--badge-bg);
      color: var(--badge-fg);
    }
    .btn-secondary:hover {
      opacity: 0.85;
    }
    .tabs-bar {
      display: flex;
      gap: 8px;
      border-bottom: 1px solid var(--border-color);
      margin-bottom: 12px;
    }
    .tab-btn {
      background: none;
      border: none;
      border-bottom: 2px solid transparent;
      color: var(--fg-color);
      opacity: 0.7;
      padding: 6px 12px;
      cursor: pointer;
      font-size: 13px;
      font-weight: 500;
    }
    .tab-btn.active {
      opacity: 1;
      border-bottom-color: var(--btn-bg);
      color: var(--btn-bg);
    }
    .content-area {
      flex: 1;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .card {
      background-color: var(--card-bg);
      border: 1px solid var(--border-color);
      border-radius: 6px;
      padding: 12px;
    }
    .card-title {
      font-size: 12px;
      font-weight: 600;
      margin-bottom: 8px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      opacity: 0.85;
    }
    pre.code-view {
      margin: 0;
      padding: 10px;
      background-color: var(--input-bg);
      border: 1px solid var(--border-color);
      border-radius: 4px;
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: 12.5px;
      line-height: 1.45;
      overflow-x: auto;
      white-space: pre-wrap;
      word-break: break-all;
    }
    .badges-row {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin-top: 8px;
    }
    .param-badge, .table-badge {
      background-color: var(--badge-bg);
      color: var(--badge-fg);
      padding: 3px 8px;
      border-radius: 4px;
      font-size: 11px;
    }
    .error-box {
      background-color: rgba(235, 87, 87, 0.15);
      border: 1px solid #eb5757;
      color: #ff8080;
      padding: 10px;
      border-radius: 4px;
      font-family: monospace;
      font-size: 12px;
    }
    .actions-bar {
      display: flex;
      gap: 8px;
      margin-top: 12px;
    }
    .hidden {
      display: none !important;
    }
  </style>
</head>
<body>
  <div class="header-bar">
    <div class="title">
      <span>⚡ DotNav Expression Evaluator & SQL Inspector</span>
    </div>
    <div class="shortcuts">
      <span>Alt+F8 / Enter to evaluate • Esc to close</span>
    </div>
  </div>

  <div class="input-section">
    <textarea id="expressionInput" class="expression-input" placeholder="Enter C# / LINQ expression or query...">${escapedInitialExpr}</textarea>
    <button id="btnEvaluate" class="btn">
      <span>Evaluate</span>
    </button>
  </div>

  <div class="tabs-bar">
    <button id="tabSqlBtn" class="tab-btn ${hasSql ? 'active' : ''}">🗄️ SQL Inspector</button>
    <button id="tabResultBtn" class="tab-btn ${!hasSql ? 'active' : ''}">⚡ Evaluated Value</button>
  </div>

  <div class="content-area">
    <!-- SQL Inspector Tab -->
    <div id="tabSql" class="${hasSql ? '' : 'hidden'}">
      ${hasSql ? `
      <div class="card">
        <div class="card-title">
          <span>Generated SQL Statement</span>
          <div style="display:flex; gap:6px;">
            <button id="btnCopyBoundSql" class="btn btn-secondary" style="padding:4px 10px; font-size:11px;">📋 Copy Executable SQL</button>
            <button id="btnCopyRawSql" class="btn btn-secondary" style="padding:4px 10px; font-size:11px;">📋 Copy Raw SQL</button>
          </div>
        </div>
        <pre class="code-view" id="sqlOutputView">${formattedSql}</pre>
        
        ${sqlQuery?.tables && sqlQuery.tables.length > 0 ? `
        <div style="margin-top:8px;">
          <div style="font-size:11px; opacity:0.8; margin-bottom:4px;">Target Tables:</div>
          <div class="badges-row">${tablesHtml}</div>
        </div>` : ''}

        ${sqlQuery?.parameters && sqlQuery.parameters.length > 0 ? `
        <div style="margin-top:10px;">
          <div style="font-size:11px; opacity:0.8; margin-bottom:4px;">Injected Parameters:</div>
          <div class="badges-row">${paramsHtml}</div>
        </div>` : ''}
      </div>
      ` : `
      <div class="card" style="text-align:center; padding:30px 10px; opacity:0.7;">
        <span>No Entity Framework Core query detected in this expression. Switch to <strong>Evaluated Value</strong> tab to view object data.</span>
      </div>
      `}
    </div>

    <!-- Evaluated Value Tab -->
    <div id="tabResult" class="${!hasSql ? '' : 'hidden'}">
      <div class="card">
        <div class="card-title">
          <span>Result Value</span>
          ${evalType ? `<span class="table-badge">Type: ${evalType}</span>` : ''}
        </div>
        ${evalError ? `
          <div class="error-box">${evalError}</div>
        ` : `
          <pre class="code-view">${evalResult || '(null or empty)'}</pre>
        `}
      </div>
    </div>
  </div>

  <div class="actions-bar">
    <button id="btnClose" class="btn btn-secondary">Close</button>
  </div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();

    const input = document.getElementById('expressionInput');
    const btnEvaluate = document.getElementById('btnEvaluate');
    const btnClose = document.getElementById('btnClose');
    const tabSqlBtn = document.getElementById('tabSqlBtn');
    const tabResultBtn = document.getElementById('tabResultBtn');
    const tabSql = document.getElementById('tabSql');
    const tabResult = document.getElementById('tabResult');
    const btnCopyBoundSql = document.getElementById('btnCopyBoundSql');
    const btnCopyRawSql = document.getElementById('btnCopyRawSql');

    function doEvaluate() {
      const expr = input.value.trim();
      if (expr) {
        vscode.postMessage({ command: 'evaluate', expression: expr });
      }
    }

    btnEvaluate.addEventListener('click', doEvaluate);

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        doEvaluate();
      }
    });

    btnClose.addEventListener('click', () => {
      vscode.postMessage({ command: 'close' });
    });

    tabSqlBtn.addEventListener('click', () => {
      tabSqlBtn.classList.add('active');
      tabResultBtn.classList.remove('active');
      tabSql.classList.remove('hidden');
      tabResult.classList.add('hidden');
    });

    tabResultBtn.addEventListener('click', () => {
      tabResultBtn.classList.add('active');
      tabSqlBtn.classList.remove('active');
      tabResult.classList.remove('hidden');
      tabSql.classList.add('hidden');
    });

    if (btnCopyBoundSql) {
      btnCopyBoundSql.addEventListener('click', () => {
        vscode.postMessage({ command: 'copySql', text: ${JSON.stringify(boundSql || formattedSql)} });
      });
    }

    if (btnCopyRawSql) {
      btnCopyRawSql.addEventListener('click', () => {
        vscode.postMessage({ command: 'copySql', text: ${JSON.stringify(formattedSql)} });
      });
    }

    // Auto-focus input on load
    input.focus();
    input.select();
  </script>
</body>
</html>`;
}

function escapeHtml(str: string): string {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function getNonce(): string {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
