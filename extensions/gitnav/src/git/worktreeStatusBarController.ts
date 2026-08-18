import * as vscode from 'vscode';
import { GitRepositoryService } from './gitRepositoryService';
import { findRepoRoot } from './gitCli';
import { buildWorktreeTooltipMarkdown, formatWorktreeStatusBarText } from './worktreeStatusBar';

export class WorktreeStatusBarController implements vscode.Disposable {
  private readonly statusBarItem: vscode.StatusBarItem;
  private readonly disposables: vscode.Disposable[] = [];
  private currentRepoRoot: string | undefined;
  private isUpdating = false;

  constructor(private readonly repositoryService: GitRepositoryService) {
    this.statusBarItem = vscode.window.createStatusBarItem(
      'gitnav.worktreeStatus',
      vscode.StatusBarAlignment.Left,
      100
    );
    this.statusBarItem.name = 'GitNav Worktree Status';
    this.statusBarItem.command = 'gitnav.manageWorktrees';

    this.disposables.push(
      this.statusBarItem,
      vscode.window.onDidChangeActiveTextEditor(() => this.refresh()),
      vscode.workspace.onDidChangeWorkspaceFolders(() => this.refresh()),
      vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration('gitnav.showStatusBarWorktree')) {
          this.refresh();
        }
      })
    );

    void this.refresh();
  }

  public isEnabled(): boolean {
    return vscode.workspace
      .getConfiguration('gitnav')
      .get<boolean>('showStatusBarWorktree', true);
  }

  public async refresh(repoRoot?: string): Promise<void> {
    if (!this.isEnabled()) {
      this.statusBarItem.hide();
      return;
    }

    if (this.isUpdating) return;
    this.isUpdating = true;

    try {
      let root = repoRoot || this.currentRepoRoot;
      if (!root) {
        const editor = vscode.window.activeTextEditor;
        if (editor && editor.document.uri.scheme === 'file') {
          root = (await findRepoRoot(editor.document.uri.fsPath)) || undefined;
        }
        if (!root) {
          const repos = await this.repositoryService.discoverRepositories();
          if (repos.length > 0) {
            root = repos[0];
          }
        }
      }

      if (!root) {
        this.currentRepoRoot = undefined;
        this.statusBarItem.hide();
        return;
      }

      this.currentRepoRoot = root;
      const snapshot = await this.repositoryService.snapshot(root);
      const worktrees = snapshot.worktrees || [];

      if (worktrees.length === 0) {
        this.statusBarItem.hide();
        return;
      }

      const workspaceFolders = vscode.workspace.workspaceFolders;
      const currentWorkspacePath = workspaceFolders && workspaceFolders.length > 0
        ? workspaceFolders[0].uri.fsPath
        : root;

      const text = formatWorktreeStatusBarText(worktrees, currentWorkspacePath, root);
      if (!text) {
        this.statusBarItem.hide();
        return;
      }

      const tooltipContent = buildWorktreeTooltipMarkdown(worktrees, currentWorkspacePath, root);
      const md = new vscode.MarkdownString(tooltipContent);
      md.isTrusted = true;
      md.supportThemeIcons = true;

      this.statusBarItem.text = text;
      this.statusBarItem.tooltip = md;
      this.statusBarItem.show();
    } catch {
      this.statusBarItem.hide();
    } finally {
      this.isUpdating = false;
    }
  }

  public dispose(): void {
    for (const d of this.disposables) {
      d.dispose();
    }
  }
}
