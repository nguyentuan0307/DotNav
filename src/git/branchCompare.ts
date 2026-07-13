import * as path from 'path';
import * as vscode from 'vscode';
import { findRepoRoot, runGit, toGitRelativePath } from './gitCli';

interface GitBranchItem extends vscode.QuickPickItem {
  readonly ref: string;
}

interface CompareDocument {
  readonly uri: vscode.Uri;
}

const scheme = 'dotnet-navigator-compare';

export class BranchCompareDocumentProvider implements vscode.TextDocumentContentProvider {
  private readonly documents = new Map<string, string>();
  private readonly onDidChangeEmitter = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange = this.onDidChangeEmitter.event;

  provideTextDocumentContent(uri: vscode.Uri): string {
    return this.documents.get(uri.toString()) ?? '';
  }

  createDocument(label: string, relPath: string, content: string): vscode.Uri {
    const uri = vscode.Uri.from({
      scheme,
      path: `/${path.basename(relPath)}`,
      query: `id=${encodeURIComponent(`${Date.now()}:${Math.random()}`)}&label=${encodeURIComponent(label)}`
    });
    this.documents.set(uri.toString(), content);
    this.onDidChangeEmitter.fire(uri);
    return uri;
  }
}

export async function compareFileWithBranch(provider: BranchCompareDocumentProvider): Promise<void> {
  await runCompareCommand(async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.uri.scheme !== 'file') {
      vscode.window.showInformationMessage('Open a file before comparing with a branch.');
      return;
    }

    await compareEditorDocumentWithBranch(provider, editor);
  });
}

export async function compareSelectionWithBranch(provider: BranchCompareDocumentProvider): Promise<void> {
  await runCompareCommand(async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.uri.scheme !== 'file') {
      vscode.window.showInformationMessage('Open a file and select a code range before comparing with a branch.');
      return;
    }

    const selection = editor.selection;
    if (selection.isEmpty) {
      vscode.window.showInformationMessage('Select a code range before comparing with a branch.');
      return;
    }

    await compareEditorDocumentWithBranch(provider, editor, selection);
  });
}

async function runCompareCommand(action: () => Promise<void>): Promise<void> {
  try {
    await action();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.trim().length > 0) {
      vscode.window.showErrorMessage(message);
    }
  }
}

async function compareEditorDocumentWithBranch(
  provider: BranchCompareDocumentProvider,
  editor: vscode.TextEditor,
  selection?: vscode.Selection
): Promise<void> {
  const repoRoot = await findRepoRoot(editor.document.uri.fsPath);
  if (!repoRoot) {
    vscode.window.showInformationMessage('This file is not inside a Git repository.');
    return;
  }

  const relPath = toGitRelativePath(repoRoot, editor.document.uri.fsPath);
  const branch = await pickBranch(repoRoot);
  if (!branch) {
    return;
  }

  const branchContent = await readFileAtBranch(repoRoot, branch, relPath);
  if (branchContent === undefined) {
    return;
  }

  const left = selection
    ? selectionDocument(provider, `Branch: ${branch.ref}`, relPath, branchContent, selection)
    : fullDocument(provider, `Branch: ${branch.ref}`, relPath, branchContent);
  const right = selection
    ? selectedWorktreeDocument(provider, relPath, editor, selection)
    : { uri: editor.document.uri };

  const title = selection
    ? `${path.basename(relPath)} selection: Branch ${branch.ref} ↔ Working Tree`
    : `${path.basename(relPath)}: Branch ${branch.ref} ↔ Working Tree`;
  await vscode.commands.executeCommand('vscode.diff', left.uri, right.uri, title, { preview: true });
}

async function pickBranch(repoRoot: string): Promise<GitBranchItem | undefined> {
  const branches = await listBranches(repoRoot);
  if (branches.length === 0) {
    vscode.window.showInformationMessage('No local or remote Git branches were found.');
    return undefined;
  }

  return vscode.window.showQuickPick(branches, {
    title: 'Compare With Branch',
    placeHolder: 'Select a local or remote branch'
  });
}

async function listBranches(repoRoot: string): Promise<GitBranchItem[]> {
  const result = await runGit(repoRoot, [
    'for-each-ref',
    '--format=%(refname:short)%00%(refname)%00%(objectname:short)',
    'refs/heads',
    'refs/remotes'
  ]);

  if (result.exitCode !== 0) {
    throw new Error(result.stderr.trim() || 'git branch listing failed.');
  }

  return result.stdout
    .split('\n')
    .map(line => parseBranchLine(line))
    .filter((item): item is GitBranchItem => item !== undefined)
    .sort((left, right) => branchRank(left.ref) - branchRank(right.ref) || left.ref.localeCompare(right.ref));
}

function parseBranchLine(line: string): GitBranchItem | undefined {
  const trimmed = line.trim();
  if (trimmed.length === 0) {
    return undefined;
  }

  const [shortRef, fullRef, shortHash] = trimmed.split('\0');
  if (!shortRef || shortRef.endsWith('/HEAD')) {
    return undefined;
  }

  const isRemote = fullRef?.startsWith('refs/remotes/');
  return {
    label: shortRef,
    description: isRemote ? 'remote' : 'local',
    detail: shortHash,
    ref: shortRef
  };
}

function branchRank(ref: string): number {
  return ref.includes('/') ? 1 : 0;
}

async function readFileAtBranch(repoRoot: string, branch: GitBranchItem, relPath: string): Promise<string | undefined> {
  const result = await runGit(repoRoot, ['show', `${branch.ref}:${relPath}`]);
  if (result.exitCode === 0) {
    return result.stdout;
  }

  vscode.window.showErrorMessage(result.stderr.trim() || `File ${relPath} was not found in ${branch.ref}.`);
  return undefined;
}

function fullDocument(
  provider: BranchCompareDocumentProvider,
  label: string,
  relPath: string,
  content: string
): CompareDocument {
  return {
    uri: provider.createDocument(`${label}/${relPath}`, relPath, content)
  };
}

function selectionDocument(
  provider: BranchCompareDocumentProvider,
  label: string,
  relPath: string,
  content: string,
  selection: vscode.Selection
): CompareDocument {
  const range = selectedLineRange(selection);
  const selectedContent = lineRangeText(content, range);
  return fullDocument(provider, `${label}/${relPath}:${range.start + 1}-${range.end + 1}`, relPath, selectedContent);
}

function selectedWorktreeDocument(
  provider: BranchCompareDocumentProvider,
  relPath: string,
  editor: vscode.TextEditor,
  selection: vscode.Selection
): CompareDocument {
  const range = selectedLineRange(selection);
  const content = lineRangeText(editor.document.getText(), range);
  return fullDocument(provider, `Working Tree/${relPath}:${range.start + 1}-${range.end + 1}`, relPath, content);
}

function lineRangeText(content: string, range: { start: number; end: number }): string {
  return content.split(/\r?\n/).slice(range.start, range.end + 1).join('\n');
}

function selectedLineRange(selection: vscode.Selection): { start: number; end: number } {
  let start = selection.start.line;
  let end = selection.end.line;
  if (selection.end.character === 0 && end > start) {
    end -= 1;
  }

  if (end < start) {
    [start, end] = [end, start];
  }

  return { start, end };
}
