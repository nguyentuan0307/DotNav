import * as vscode from 'vscode';
import { evaluateDapExpression, getActiveStackFrame, getLocalVariables } from './evaluateEngine';
import { inspectSqlFromDebugSession } from './sqlInspector';
import { getEvaluateWebviewHtml } from './evaluateDialogHtml';

let currentEvaluatePanel: vscode.WebviewPanel | undefined;

export function registerEvaluateCommands(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('dotnav.evaluateExpression', async () => {
      await showEvaluateDialog(context);
    })
  );
}

export async function showEvaluateDialog(context: vscode.ExtensionContext): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  let initialExpression = '';

  if (editor) {
    const selection = editor.selection;
    if (!selection.isEmpty) {
      initialExpression = editor.document.getText(selection).trim();
    } else {
      const line = editor.document.lineAt(selection.active.line).text.trim();
      // Remove variable assignment prefix if present (var x = ...)
      initialExpression = line.replace(/^(?:var|[a-zA-Z0-9_<>[\]]+)\s+[a-zA-Z0-9_]+\s*=\s*(?:await\s+)?/, '').replace(/;+$/, '').trim();
    }
  }

  const session = vscode.debug.activeDebugSession;
  if (!session) {
    vscode.window.showInformationMessage(
      'DotNav Evaluate: Start debugging (F5) and pause at a breakpoint to evaluate expressions and inspect EF Core SQL.',
      'OK'
    );
    return;
  }

  // Get active stack frame
  const frame = await getActiveStackFrame(session);
  const frameId = frame?.id || 0;
  const localVars = await getLocalVariables(session, frameId);

  // If user selected nothing and there are queryable variables in scope, prefill with the first queryable variable
  if (!initialExpression && localVars.size > 0) {
    for (const [vName, vInfo] of localVars.entries()) {
      if (vInfo.type?.includes('IQueryable') || vInfo.type?.includes('EntityQueryable') || vInfo.type?.includes('DbSet')) {
        initialExpression = vName;
        break;
      }
    }
  }

  // Initial evaluation
  let sqlQuery = initialExpression ? await inspectSqlFromDebugSession(session, frameId, initialExpression, localVars) : undefined;
  let evalResponse = initialExpression ? await evaluateDapExpression(session, frameId, initialExpression, localVars) : undefined;

  if (currentEvaluatePanel) {
    currentEvaluatePanel.reveal(vscode.ViewColumn.Beside);
  } else {
    currentEvaluatePanel = vscode.window.createWebviewPanel(
      'dotnav.evaluateDialog',
      'DotNav: Evaluate & SQL Inspector',
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [context.extensionUri]
      }
    );

    currentEvaluatePanel.onDidDispose(() => {
      currentEvaluatePanel = undefined;
    });
  }

  const panel = currentEvaluatePanel;

  const updateView = (expr: string, sql?: any, resp?: any) => {
    panel.webview.html = getEvaluateWebviewHtml(panel.webview, expr, sql, resp);
  };

  let activeRequestId = 0;

  panel.webview.onDidReceiveMessage(async message => {
    if (message.command === 'evaluate') {
      const thisRequestId = ++activeRequestId;
      const expr = (message.expression || '').trim();
      const currentSession = vscode.debug.activeDebugSession;
      if (!currentSession) {
        vscode.window.showWarningMessage('No active debug session.');
        return;
      }
      const currentFrame = await getActiveStackFrame(currentSession);
      const currentFrameId = currentFrame?.id || 0;
      const currentLocals = await getLocalVariables(currentSession, currentFrameId);

      const newSql = await inspectSqlFromDebugSession(currentSession, currentFrameId, expr, currentLocals);
      let newResp = await evaluateDapExpression(currentSession, currentFrameId, expr, currentLocals);

      if (thisRequestId !== activeRequestId) {
        return; // Stale request, discard to prevent race conditions
      }

      if (!newResp.success && newSql) {
        newResp = {
          result: `EF Core Query successfully resolved. Switch to 'SQL Inspector' tab to view the formatted SQL statement with parameter values.`,
          type: 'Microsoft.EntityFrameworkCore.Query.IQueryable',
          success: true,
          usedExpression: expr
        };
      }

      updateView(expr, newSql, newResp);
    } else if (message.command === 'copySql') {
      await vscode.env.clipboard.writeText(message.text || '');
      vscode.window.showInformationMessage('SQL copied to clipboard!');
    } else if (message.command === 'close') {
      panel.dispose();
    }
  });

  updateView(initialExpression, sqlQuery, evalResponse);
}
