import * as vscode from 'vscode';
import { BranchCompareDocumentProvider, compareFileWithBranch, compareSelectionWithBranch } from './git/branchCompare';
import { findRepoRoot, runGit, toGitRelativePath } from './git/gitCli';
import { GitOperationCancelledError, LineHistoryQuery, getLineHistory, lineHistoryLabel } from './git/lineHistory';
import { LineHistoryPanel } from './git/lineHistoryPanel';
import { mapWorktreeRangeToHead } from './git/lineMapping';
import { GitLogViewProvider } from './git/gitLogViewProvider';
import { GitRepositoryService } from './git/gitRepositoryService';
import { GitRevisionProvider, gitRevisionScheme } from './git/gitRevisionProvider';

export function activate(context: vscode.ExtensionContext): void {
  const branchCompareProvider = new BranchCompareDocumentProvider();
  const repositoryService = new GitRepositoryService();
  const gitLogProvider = new GitLogViewProvider(repositoryService, context.extensionUri);

  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider('gitnav-compare', branchCompareProvider),
    vscode.workspace.registerTextDocumentContentProvider(gitRevisionScheme, new GitRevisionProvider(repositoryService)),
    vscode.window.registerWebviewViewProvider(GitLogViewProvider.viewId, gitLogProvider, {
      webviewOptions: { retainContextWhenHidden: true }
    }),
    gitLogProvider,
    vscode.commands.registerCommand('gitnav.showHistoryForSelection', () => showHistoryForSelection(context)),
    vscode.commands.registerCommand('gitnav.compareFileWithBranch', () => compareFileWithBranch(branchCompareProvider)),
    vscode.commands.registerCommand('gitnav.compareSelectionWithBranch', () => compareSelectionWithBranch(branchCompareProvider)),
    vscode.commands.registerCommand('gitnav.openSettings', () =>
      vscode.commands.executeCommand('workbench.action.openSettings', '@ext:tuna-ex.gitnav')),
    vscode.workspace.onDidChangeConfiguration(event => {
      if (event.affectsConfiguration('gitnav')) {
        gitLogProvider.configureAutoFetch();
      }
    })
  );
}

async function showHistoryForSelection(context: vscode.ExtensionContext): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.uri.scheme !== 'file') {
    vscode.window.showInformationMessage('Open a file and select a code range first.');
    return;
  }

  const selection = editor.selection;
  if (selection.isEmpty) {
    vscode.window.showInformationMessage('Select a code range first.');
    return;
  }

  let startLine = selection.start.line + 1;
  let endLine = selection.end.line + 1;
  if (selection.end.character === 0 && endLine > startLine) {
    endLine -= 1;
  }

  if (endLine < startLine) {
    [startLine, endLine] = [endLine, startLine];
  }

  const repoRoot = await findRepoRoot(editor.document.uri.fsPath);
  if (!repoRoot) {
    vscode.window.showInformationMessage('This file is not inside a Git repository.');
    return;
  }

  const relPath = toGitRelativePath(repoRoot, editor.document.uri.fsPath);
  const query = await resolveLineHistoryQuery(repoRoot, relPath, startLine, endLine);
  if (!query) {
    vscode.window.showInformationMessage('This selected range has not been committed yet.');
    return;
  }

  await runLineHistoryQuery(context, query);
}

async function resolveLineHistoryQuery(
  repoRoot: string,
  relPath: string,
  startLine: number,
  endLine: number
): Promise<LineHistoryQuery | undefined> {
  const dirty = await runGit(repoRoot, ['diff', '--quiet', '--', relPath]);
  if (dirty.exitCode === 0) {
    return { repoRoot, relPath, headStart: startLine, headEnd: endLine };
  }

  const diff = await runGit(repoRoot, ['diff', '--no-color', '-U0', '--', relPath]);
  if (diff.exitCode !== 0) {
    throw new Error(diff.stderr.trim() || 'git diff failed.');
  }

  const mapped = mapWorktreeRangeToHead(diff.stdout, startLine, endLine);
  return mapped ? { repoRoot, relPath, headStart: mapped.start, headEnd: mapped.end } : undefined;
}

async function runLineHistoryQuery(context: vscode.ExtensionContext, query: LineHistoryQuery): Promise<void> {
  const maxCommits = vscode.workspace.getConfiguration('gitnav').get<number>('history.maxCommits', 50);

  try {
    const entries = await vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      cancellable: true,
      title: 'Loading line history'
    }, (_progress, token) => getLineHistory(query, Math.max(1, maxCommits), token));

    if (entries.length === 0) {
      vscode.window.showInformationMessage('No commit touched this selected range.');
      return;
    }

    LineHistoryPanel.show(entries, lineHistoryLabel(query), context.extensionUri);
  } catch (error) {
    if (error instanceof GitOperationCancelledError) {
      return;
    }

    const message = error instanceof Error ? error.message : String(error);
    if (message.trim().length > 0) {
      vscode.window.showErrorMessage(message);
    }
  }
}

export function deactivate(): void {}
