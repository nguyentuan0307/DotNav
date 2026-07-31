import * as vscode from 'vscode';
import { GitFileRevision, listFileRevisions, resolveFileRevision } from './fileRevision';
import { GitOperationCancelledError } from './lineHistory';

interface GitFileRevisionQuickPickItem extends vscode.QuickPickItem {
  readonly revision?: GitFileRevision;
  readonly enterRevision?: boolean;
}

export async function pickFileRevision(
  repoRoot: string,
  relPath: string,
  title: string
): Promise<GitFileRevision | undefined> {
  const maxCommits = Math.max(
    1,
    vscode.workspace.getConfiguration('gitnav').get<number>('history.maxCommits', 50)
  );
  let revisions: GitFileRevision[];
  try {
    revisions = await vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title: 'Loading file revisions',
      cancellable: true
    }, (_progress, token) => listFileRevisions(repoRoot, relPath, maxCommits, token));
  } catch (error) {
    if (error instanceof GitOperationCancelledError) {
      throw new vscode.CancellationError();
    }
    throw error;
  }

  const items: GitFileRevisionQuickPickItem[] = [
    {
      label: '$(edit) Enter a commit, tag, or SHA...',
      description: 'Use a revision not shown below',
      alwaysShow: true,
      enterRevision: true
    },
    ...revisions.map(revision => ({
      label: revision.subject,
      description: revision.shortHash,
      detail: revision.timestamp > 0
        ? `${revision.authorName} · ${new Date(revision.timestamp * 1000).toLocaleString()}`
        : revision.path,
      revision
    }))
  ];

  const picked = await vscode.window.showQuickPick(items, {
    title,
    placeHolder: 'Select a revision of the current file',
    matchOnDescription: true,
    matchOnDetail: true
  });
  if (!picked) {
    return undefined;
  }
  if (picked.revision) {
    return picked.revision;
  }

  const value = await vscode.window.showInputBox({
    title,
    prompt: 'Commit, tag, or SHA',
    placeHolder: 'HEAD~1, v1.2.0, or a commit SHA',
    validateInput: input => input.trim().length > 0 ? undefined : 'Revision is required.'
  });
  return value === undefined
    ? undefined
    : resolveFileRevision(repoRoot, relPath, value.trim(), revisions);
}
