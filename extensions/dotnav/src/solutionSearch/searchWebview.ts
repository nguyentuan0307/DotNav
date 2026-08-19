import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { DotnetTreeProvider } from '../treeProvider';
import { UniversalSymbolIndex } from './searchScanner';
import { parseUniversalSearchQuery, searchUniversalSymbols } from './searchEngine';
import { UniversalSymbol } from './searchModel';
import { ensureUniversalIndexReady, openSymbolInEditor, resolveProjectForFile } from './searchCommands';
import { renderSearchEverywhereHtml } from './searchWebviewHtml';

let activeSearchPanel: vscode.WebviewPanel | undefined;

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function highlightCSharpLine(code: string): string {
  const escaped = escapeHtml(code);
  // Comments
  let res = escaped.replace(/(\/\/.*?$|\/\*[\s\S]*?\*\/)/gm, '<span style="color:#6A9955;font-style:italic;">$1</span>');
  // Strings
  res = res.replace(/(&quot;[\s\S]*?&quot;)/g, '<span style="color:#CE9178;">$1</span>');
  // Keywords
  const keywords = ['public', 'private', 'protected', 'internal', 'static', 'async', 'await', 'return', 'class', 'struct', 'record', 'interface', 'enum', 'void', 'int', 'string', 'bool', 'var', 'new', 'if', 'else', 'for', 'foreach', 'in', 'while', 'switch', 'case', 'break', 'try', 'catch', 'finally', 'throw', 'get', 'set', 'init', 'using', 'namespace', 'where', 'override', 'virtual', 'sealed', 'readonly', 'null', 'true', 'false', 'Task'];
  const kwRegex = new RegExp(`\\b(${keywords.join('|')})\\b`, 'g');
  res = res.replace(kwRegex, '<span style="color:#569CD6;font-weight:bold;">$1</span>');
  // Attributes [AttributeName]
  res = res.replace(/(\[[A-Za-z0-9_]+(?:\(.*?\))?\])/g, '<span style="color:#4EC9B0;">$1</span>');
  return res;
}

async function extractCodePreview(
  filePath: string,
  targetLine: number,
  contextBefore = 20,
  contextAfter = 35
): Promise<{ lines: string[]; startLine: number; targetLine: number }> {
  try {
    if (!fs.existsSync(filePath)) {
      return { lines: [], startLine: 1, targetLine };
    }
    const content = await fs.promises.readFile(filePath, 'utf8');
    const rawLines = content.split(/\r?\n/);
    const start = Math.max(0, targetLine - 1 - contextBefore);
    const end = Math.min(rawLines.length, targetLine + contextAfter);
    const slice = rawLines.slice(start, end);

    const isCSharp = filePath.endsWith('.cs');
    const lines = slice.map(l => (isCSharp ? highlightCSharpLine(l) : escapeHtml(l)));

    return {
      lines,
      startLine: start + 1,
      targetLine
    };
  } catch {
    return { lines: [], startLine: 1, targetLine };
  }
}

export async function openSearchEverywhereWebview(
  provider: DotnetTreeProvider,
  index: UniversalSymbolIndex,
  initialPrefix = '',
  context?: vscode.ExtensionContext
): Promise<void> {
  if (activeSearchPanel) {
    activeSearchPanel.reveal(vscode.ViewColumn.Active);
    return;
  }

  await ensureUniversalIndexReady(provider, index, context);

  const previousActiveEditor = vscode.window.activeTextEditor;
  const previousDocUri = previousActiveEditor?.document.uri;
  const previousSelection = previousActiveEditor?.selection;
  let didOpenSymbol = false;

  const panel = vscode.window.createWebviewPanel(
    'dotnav.searchEverywhereRider',
    'Search Everywhere',
    vscode.ViewColumn.Active,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: context ? [context.extensionUri] : []
    }
  );

  activeSearchPanel = panel;

  panel.webview.html = renderSearchEverywhereHtml(panel.webview.cspSource, initialPrefix);

  panel.onDidDispose(() => {
    if (activeSearchPanel === panel) {
      activeSearchPanel = undefined;
    }
    if (!didOpenSymbol && previousDocUri) {
      vscode.workspace.openTextDocument(previousDocUri).then(doc => {
        vscode.window.showTextDocument(doc, { preserveFocus: false }).then(editor => {
          if (previousSelection) {
            editor.selection = previousSelection;
          }
        });
      });
    }
  });

  const activeFilePath = previousActiveEditor ? previousActiveEditor.document.uri.fsPath : undefined;
  const solution = provider.getSolution();
  const activeProjectName = activeFilePath ? resolveProjectForFile(activeFilePath, solution?.projects) : undefined;
  const rankingContext = {
    activeProjectName,
    activeFilePath
  };

  panel.webview.onDidReceiveMessage(async message => {
    if (message.type === 'search') {
      let query: string = message.query || '';
      const filterMode: string = message.filterMode || 'all';

      if (filterMode === 'endpoints' && !query.startsWith('/')) {
        query = '/' + query;
      } else if (filterMode === 'cqrs' && !query.startsWith('$')) {
        query = '$' + query;
      } else if (filterMode === 'database' && !query.startsWith('%')) {
        query = '%' + query;
      } else if (filterMode === 'types' && !query.startsWith('#')) {
        query = '#' + query;
      } else if (filterMode === 'methods' && !query.startsWith('@')) {
        query = '@' + query;
      } else if (filterMode === 'files' && !query.startsWith('!')) {
        query = '!' + query;
      }

      const results = searchUniversalSymbols(index, query, 100, rankingContext);
      panel.webview.postMessage({
        type: 'results',
        results
      });
    } else if (message.type === 'getPreview') {
      const { filePath, line } = message;
      const preview = await extractCodePreview(filePath, line);
      panel.webview.postMessage({
        type: 'preview',
        filePath,
        targetLine: preview.targetLine,
        startLine: preview.startLine,
        lines: preview.lines
      });
    } else if (message.type === 'openSymbol') {
      const sym: UniversalSymbol = message.symbol;
      const rawQuery: string = message.rawQuery || '';
      const parsed = parseUniversalSearchQuery(rawQuery);
      didOpenSymbol = true;
      panel.dispose();
      await openSymbolInEditor(sym, parsed.targetLine, parsed.targetColumn);
    } else if (message.type === 'close') {
      panel.dispose();
    }
  });
}
