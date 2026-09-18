import * as path from 'path';
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
      let root = repoRoot;
      const editor = vscode.window.activeTextEditor;
      let activeFilePath: string | undefined;

      if (!root && editor && editor.document.uri.scheme === 'file') {
        activeFilePath = editor.document.uri.fsPath;
        root = (await findRepoRoot(activeFilePath)) || undefined;
      }
      if (!root) {
        root = this.currentRepoRoot;
      }
      if (!root) {
        const repos = await this.repositoryService.discoverRepositories();
        if (repos.length > 0) {
          root = repos[0];
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

      let currentWorkspacePath = root;
      if (activeFilePath) {
        const normActive = path.normalize(activeFilePath).toLowerCase();
        const matchedWt = worktrees.find(w => {
          const normWt = path.normalize(w.path).toLowerCase();
          return normActive === normWt || normActive.startsWith(normWt + path.sep);
        });
        if (matchedWt) {
          currentWorkspacePath = matchedWt.path;
        }
      } else {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (workspaceFolders && workspaceFolders.length > 0) {
          const matchedFolder = workspaceFolders.find(f => {
            const normF = path.normalize(f.uri.fsPath).toLowerCase();
            return worktrees.some(w => path.normalize(w.path).toLowerCase() === normF);
          });
          if (matchedFolder) {
            currentWorkspacePath = matchedFolder.uri.fsPath;
          }
        }
      }

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
