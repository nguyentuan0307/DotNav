import * as vscode from 'vscode';
import { findRepoRoot, toGitRelativePath } from './gitCli';
import { pickFileRevision } from './fileRevisionPicker';
import { revisionUri } from './gitRevisionProvider';

export async function openFileAtRevision(): Promise<void> {
  try {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.uri.scheme !== 'file') {
      vscode.window.showInformationMessage('Open a file before selecting a revision.');
      return;
    }

    const repoRoot = await findRepoRoot(editor.document.uri.fsPath);
    if (!repoRoot) {
      vscode.window.showInformationMessage('This file is not inside a Git repository.');
      return;
    }

    const relPath = toGitRelativePath(repoRoot, editor.document.uri.fsPath);
    const revision = await pickFileRevision(repoRoot, relPath, 'Open File at Revision');
    if (!revision) {
      return;
    }

    await vscode.window.showTextDocument(
      revisionUri(repoRoot, revision.ref, revision.path),
      { preview: true, viewColumn: vscode.ViewColumn.Beside }
    );
  } catch (error) {
    if (error instanceof vscode.CancellationError) {
      return;
    }
    const message = error instanceof Error ? error.message : String(error);
    if (message.trim().length > 0) {
      vscode.window.showErrorMessage(message);
    }
  }
}
