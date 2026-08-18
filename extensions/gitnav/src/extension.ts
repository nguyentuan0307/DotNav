import * as path from 'path';
import * as vscode from 'vscode';
import { BranchCompareDocumentProvider, compareFileWithBranch, compareFileWithCommit, compareSelectionWithBranch } from './git/branchCompare';
import { findRepoRoot, runGit, toGitRelativePath } from './git/gitCli';
import { FileHistoryQuery, GitOperationCancelledError, LineHistoryQuery, fileHistoryLabel, getFileHistory, getLineHistory, lineHistoryLabel } from './git/lineHistory';
import { LineHistoryPanel } from './git/lineHistoryPanel';
import { mapWorktreeRangeToHead } from './git/lineMapping';
import { GitLogViewProvider } from './git/gitLogViewProvider';
import { GitRepositoryService } from './git/gitRepositoryService';
import { GitRevisionProvider, gitRevisionScheme } from './git/gitRevisionProvider';
import { subscribeToBuiltInGitChanges } from './git/gitLocalSync';
import { InlineBlameController } from './git/inlineBlameController';
import { openFileAtRevision } from './git/revisionCommands';
import { createWorktreeInteractive, pruneWorktreesInteractive, showWorktreeManager } from './git/worktreeManager';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const branchCompareProvider = new BranchCompareDocumentProvider();
  const repositoryService = new GitRepositoryService();
  const gitLogProvider = new GitLogViewProvider(repositoryService, context.extensionUri, context.workspaceState);
  const inlineBlameController = new InlineBlameController((repoRoot, hash) =>
    gitLogProvider.revealCommit(repoRoot, hash)
  );

  const resolveTargetRoot = async (): Promise<string | undefined> => {
    const editor = vscode.window.activeTextEditor;
    if (editor && editor.document.uri.scheme === 'file') {
      const root = await findRepoRoot(editor.document.uri.fsPath);
      if (root) return root;
    }
    const repos = await repositoryService.discoverRepositories();
    if (repos.length === 1) return repos[0];
    if (repos.length > 1) {
      const pick = await vscode.window.showQuickPick(
        repos.map(r => ({ label: path.basename(r), description: r, root: r })),
        { placeHolder: 'Select a Git repository' }
      );
      return pick?.root;
    }
    vscode.window.showInformationMessage('No Git repository found in the current workspace.');
    return undefined;
  };

  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider('gitnav-compare', branchCompareProvider),
    vscode.workspace.registerTextDocumentContentProvider(gitRevisionScheme, new GitRevisionProvider(repositoryService)),
    vscode.window.registerWebviewViewProvider(GitLogViewProvider.viewId, gitLogProvider, {
      webviewOptions: { retainContextWhenHidden: true }
    }),
    gitLogProvider,
    inlineBlameController,
    vscode.commands.registerCommand('gitnav.manageWorktrees', async () => {
      const root = await resolveTargetRoot();
      if (root) await showWorktreeManager(repositoryService, root);
    }),
    vscode.commands.registerCommand('gitnav.createWorktree', async () => {
      const root = await resolveTargetRoot();
      if (root) await createWorktreeInteractive(repositoryService, root);
    }),
    vscode.commands.registerCommand('gitnav.pruneWorktrees', async () => {
      const root = await resolveTargetRoot();
      if (root) await pruneWorktreesInteractive(repositoryService, root);
    }),
    vscode.commands.registerCommand('gitnav.showFileHistory', () => showFileHistory(context)),
    vscode.commands.registerCommand('gitnav.showHistoryForCurrentLine', () => showHistoryForCurrentLine(context)),
    vscode.commands.registerCommand('gitnav.showHistoryForSelection', () => showHistoryForSelection(context)),
    vscode.commands.registerCommand('gitnav.compareFileWithBranch', () => compareFileWithBranch(branchCompareProvider)),
    vscode.commands.registerCommand('gitnav.compareFileWithCommit', () => compareFileWithCommit(branchCompareProvider)),
    vscode.commands.registerCommand('gitnav.compareSelectionWithBranch', () => compareSelectionWithBranch(branchCompareProvider)),
    vscode.commands.registerCommand('gitnav.revealLastChangeInGitLog', () => revealLastChangeInGitLog(gitLogProvider)),
    vscode.commands.registerCommand('gitnav.toggleInlineBlame', async () => {
      const enabled = await inlineBlameController.toggle();
      vscode.window.showInformationMessage(`GitNav: Inline Blame ${enabled ? 'enabled' : 'disabled'}`);
    }),
    vscode.commands.registerCommand('gitnav.showBlameDetails', () => inlineBlameController.showBlameDetails()),
    vscode.commands.registerCommand('gitnav.revealCommitFromBlame', async (repoRoot: string, hash: string) => {
      await gitLogProvider.revealCommit(repoRoot, hash);
    }),
    vscode.commands.registerCommand('gitnav.copyCommitSha', async (hash: string) => {
      await vscode.env.clipboard.writeText(hash);
      vscode.window.showInformationMessage(`Copied commit SHA: ${hash.substring(0, 7)}`);
    }),
    vscode.commands.registerCommand('gitnav.openFileAtRevision', openFileAtRevision),
    vscode.commands.registerCommand('gitnav.openSettings', () =>
      vscode.commands.executeCommand('workbench.action.openSettings', '@ext:tuna-ex.gitnav-workflows')),
    vscode.workspace.onDidChangeConfiguration(event => {
      if (event.affectsConfiguration('gitnav')) {
        gitLogProvider.configureAutoFetch();
      }
    })
  );

  try {
    const gitEvents = await subscribeToBuiltInGitChanges((root, kind) => {
      gitLogProvider.scheduleLocalRepositoryChange(root, kind);
    }, () => gitLogProvider.scheduleRepositoryDiscoveryRefresh());
    gitLogProvider.setBuiltInGitSyncAvailable(gitEvents !== undefined);
    if (gitEvents) context.subscriptions.push(gitEvents);
  } catch (error) {
    gitLogProvider.setBuiltInGitSyncAvailable(false);
    console.warn(`GitNav could not subscribe to the built-in Git extension: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function showFileHistory(context: vscode.ExtensionContext): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.uri.scheme !== 'file') {
    vscode.window.showInformationMessage('Open a file before viewing its history.');
    return;
  }

  const repoRoot = await findRepoRoot(editor.document.uri.fsPath);
  if (!repoRoot) {
    vscode.window.showInformationMessage('This file is not inside a Git repository.');
    return;
  }

  const query: FileHistoryQuery = {
    repoRoot,
    relPath: toGitRelativePath(repoRoot, editor.document.uri.fsPath)
  };
  const maxCommits = historyMaxCommits();

  try {
    const entries = await vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      cancellable: true,
      title: 'Loading file history'
    }, (_progress, token) => getFileHistory(query, maxCommits, token));
    if (entries.length === 0) {
      vscode.window.showInformationMessage('No committed history was found for this file.');
      return;
    }
    LineHistoryPanel.show(entries, fileHistoryLabel(query), context.extensionUri, 'File History');
  } catch (error) {
    showHistoryError(error);
  }
}

async function showHistoryForCurrentLine(context: vscode.ExtensionContext): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.uri.scheme !== 'file') {
    vscode.window.showInformationMessage('Open a file before viewing line history.');
    return;
  }

  const line = editor.selection.active.line + 1;
  const query = await resolveEditorLineHistoryQuery(editor, line, line);
  if (query) {
    await runLineHistoryQuery(context, query, 'History for Current Line');
  }
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

  const range = selectedLineRange(selection);
  const query = await resolveEditorLineHistoryQuery(editor, range.startLine, range.endLine);
  if (query) {
    await runLineHistoryQuery(context, query, 'History for Selection');
  }
}

async function revealLastChangeInGitLog(provider: GitLogViewProvider): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.uri.scheme !== 'file') {
    vscode.window.showInformationMessage('Open a file before revealing its last change.');
    return;
  }

  const range = editor.selection.isEmpty
    ? { startLine: editor.selection.active.line + 1, endLine: editor.selection.active.line + 1 }
    : selectedLineRange(editor.selection);
  const query = await resolveEditorLineHistoryQuery(editor, range.startLine, range.endLine);
  if (!query) {
    return;
  }

  try {
    const entries = await vscode.window.withProgress({
      location: vscode.ProgressLocation.Window,
      title: 'Finding last change'
    }, (_progress, token) => getLineHistory(query, 1, token));
    if (entries.length === 0) {
      vscode.window.showInformationMessage('No commit touched this line or selection.');
      return;
    }
    await provider.revealCommit(query.repoRoot, entries[0].hash);
  } catch (error) {
    showHistoryError(error);
  }
}

async function resolveEditorLineHistoryQuery(
  editor: vscode.TextEditor,
  startLine: number,
  endLine: number
): Promise<LineHistoryQuery | undefined> {
  try {
    const repoRoot = await findRepoRoot(editor.document.uri.fsPath);
    if (!repoRoot) {
      vscode.window.showInformationMessage('This file is not inside a Git repository.');
      return undefined;
    }

    const relPath = toGitRelativePath(repoRoot, editor.document.uri.fsPath);
    const query = await resolveLineHistoryQuery(repoRoot, relPath, startLine, endLine);
    if (!query) {
      vscode.window.showInformationMessage('This line or selection has not been committed yet.');
    }
    return query;
  } catch (error) {
    showHistoryError(error);
    return undefined;
  }
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

async function runLineHistoryQuery(
  context: vscode.ExtensionContext,
  query: LineHistoryQuery,
  title: string
): Promise<void> {
  try {
    const entries = await vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      cancellable: true,
      title: 'Loading line history'
    }, (_progress, token) => getLineHistory(query, historyMaxCommits(), token));

    if (entries.length === 0) {
      vscode.window.showInformationMessage('No commit touched this line or selection.');
      return;
    }

    LineHistoryPanel.show(entries, lineHistoryLabel(query), context.extensionUri, title);
  } catch (error) {
    showHistoryError(error);
  }
}

function selectedLineRange(selection: vscode.Selection): { startLine: number; endLine: number } {
  let startLine = selection.start.line + 1;
  let endLine = selection.end.line + 1;
  if (selection.end.character === 0 && endLine > startLine) {
    endLine -= 1;
  }
  if (endLine < startLine) {
    [startLine, endLine] = [endLine, startLine];
  }
  return { startLine, endLine };
}

function historyMaxCommits(): number {
  return Math.max(1, vscode.workspace.getConfiguration('gitnav').get<number>('history.maxCommits', 50));
}

function showHistoryError(error: unknown): void {
  if (error instanceof GitOperationCancelledError || error instanceof vscode.CancellationError) {
    return;
  }
  const message = error instanceof Error ? error.message : String(error);
  if (message.trim().length > 0) {
    vscode.window.showErrorMessage(message);
  }
}

export function deactivate(): void {}
