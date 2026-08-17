import * as vscode from 'vscode';
import { BoundedCache } from './boundedCache';
import { findRepoRoot, runGit, toGitRelativePath } from './gitCli';
import {
  buildBlameMarkdownContent,
  fetchLineBlame,
  formatBlameText,
  formatTimeAgo,
  GitBlameEntry,
  resolveBlameAutoDefault
} from './inlineBlame';

export function isExternalBlameExtensionInstalled(): boolean {
  return (
    vscode.extensions.getExtension('waderyan.gitblame') !== undefined ||
    vscode.extensions.getExtension('eamodio.gitlens') !== undefined
  );
}

export function formatBlameHover(entry: GitBlameEntry, repoRoot: string): vscode.MarkdownString {
  const md = new vscode.MarkdownString(buildBlameMarkdownContent(entry, repoRoot), true);
  md.isTrusted = true;
  md.supportHtml = true;
  return md;
}

export class InlineBlameController implements vscode.Disposable {
  private readonly decorationType: vscode.TextEditorDecorationType;
  private readonly statusBarItem: vscode.StatusBarItem;
  private readonly blameCache = new BoundedCache<GitBlameEntry>(300);
  private readonly disposables: vscode.Disposable[] = [];

  private currentTokenSource: vscode.CancellationTokenSource | undefined;
  private debounceTimer: NodeJS.Timeout | undefined;
  private currentBlameEntry: { entry: GitBlameEntry; repoRoot: string; relPath: string } | undefined;
  private currentUserCache = new Map<string, string>();

  constructor(private readonly revealCommitHandler?: (repoRoot: string, hash: string) => Promise<void>) {
    this.decorationType = vscode.window.createTextEditorDecorationType({
      after: {
        margin: '0 0 0 3em',
        color: new vscode.ThemeColor('gitDecoration.ignoredResourceForeground'),
        fontStyle: 'italic'
      },
      rangeBehavior: vscode.DecorationRangeBehavior.ClosedOpen
    });

    this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 95);
    this.statusBarItem.name = 'GitNav Line Blame';
    this.statusBarItem.command = 'gitnav.showBlameDetails';

    this.disposables.push(
      this.decorationType,
      this.statusBarItem,
      vscode.window.onDidChangeActiveTextEditor(() => this.onActiveEditorChanged()),
      vscode.window.onDidChangeTextEditorSelection(e => this.onSelectionChanged(e)),
      vscode.workspace.onDidChangeTextDocument(e => this.onDocumentChanged(e)),
      vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration('gitnav.inlineBlame')) {
          this.refresh();
        }
      })
    );

    if (vscode.window.activeTextEditor) {
      this.triggerBlameUpdate(vscode.window.activeTextEditor);
    }
  }

  public isEnabled(): boolean {
    const inspect = vscode.workspace.getConfiguration('gitnav').inspect<boolean>('inlineBlame.enabled');
    const explicit = inspect?.globalValue ?? inspect?.workspaceValue ?? inspect?.workspaceFolderValue;
    return resolveBlameAutoDefault(explicit, isExternalBlameExtensionInstalled());
  }

  public isStatusBarEnabled(): boolean {
    const inspect = vscode.workspace.getConfiguration('gitnav').inspect<boolean>('inlineBlame.showOnStatusBar');
    const explicit = inspect?.globalValue ?? inspect?.workspaceValue ?? inspect?.workspaceFolderValue;
    return resolveBlameAutoDefault(explicit, isExternalBlameExtensionInstalled());
  }

  public async toggle(): Promise<boolean> {
    const next = !this.isEnabled();
    await vscode.workspace.getConfiguration('gitnav').update('inlineBlame.enabled', next, vscode.ConfigurationTarget.Global);
    if (!next) {
      this.clearDecorations();
      this.statusBarItem.hide();
    } else if (vscode.window.activeTextEditor) {
      this.triggerBlameUpdate(vscode.window.activeTextEditor);
    }
    return next;
  }

  public async showBlameDetails(): Promise<void> {
    if (!this.currentBlameEntry) {
      vscode.window.showInformationMessage('No commit details available for the current line.');
      return;
    }

    const { entry, repoRoot } = this.currentBlameEntry;
    if (entry.isUncommitted) {
      vscode.window.showInformationMessage('The current line has not been committed yet.');
      return;
    }

    const items: (vscode.QuickPickItem & { action: string })[] = [
      {
        label: `$(search) Reveal in Git Log`,
        description: entry.shortHash,
        detail: entry.summary,
        action: 'reveal'
      },
      {
        label: `$(clippy) Copy Commit SHA`,
        description: entry.hash,
        action: 'copySha'
      },
      {
        label: `$(clippy) Copy Formatted Message`,
        description: `${entry.shortHash} - ${entry.summary}`,
        action: 'copyMessage'
      },
      {
        label: `$(history) Show Line History`,
        description: `Run git log -L for this line`,
        action: 'lineHistory'
      }
    ];

    const pick = await vscode.window.showQuickPick(items, {
      placeHolder: `Commit ${entry.shortHash} by ${entry.author} (${formatTimeAgo(entry.authorTimeSeconds)})`
    });

    if (!pick) return;

    switch (pick.action) {
      case 'reveal':
        if (this.revealCommitHandler) {
          await this.revealCommitHandler(repoRoot, entry.hash);
        } else {
          await vscode.commands.executeCommand('gitnav.revealCommitFromBlame', repoRoot, entry.hash);
        }
        break;
      case 'copySha':
        await vscode.env.clipboard.writeText(entry.hash);
        vscode.window.showInformationMessage(`Copied commit SHA: ${entry.shortHash}`);
        break;
      case 'copyMessage':
        await vscode.env.clipboard.writeText(`${entry.shortHash} - ${entry.summary}`);
        vscode.window.showInformationMessage(`Copied commit info to clipboard.`);
        break;
      case 'lineHistory':
        await vscode.commands.executeCommand('gitnav.showHistoryForCurrentLine');
        break;
    }
  }

  public getCurrentBlame(): { entry: GitBlameEntry; repoRoot: string; relPath: string } | undefined {
    return this.currentBlameEntry;
  }

  private onActiveEditorChanged(): void {
    this.clearDecorations();
    const editor = vscode.window.activeTextEditor;
    if (editor) {
      this.triggerBlameUpdate(editor);
    } else {
      this.statusBarItem.hide();
    }
  }

  private onSelectionChanged(e: vscode.TextEditorSelectionChangeEvent): void {
    if (e.textEditor === vscode.window.activeTextEditor) {
      this.triggerBlameUpdate(e.textEditor);
    }
  }

  private onDocumentChanged(e: vscode.TextDocumentChangeEvent): void {
    const fsPath = e.document.uri.fsPath;
    this.blameCache.deletePrefix(fsPath);
    if (vscode.window.activeTextEditor && vscode.window.activeTextEditor.document === e.document) {
      this.triggerBlameUpdate(vscode.window.activeTextEditor);
    }
  }

  public refresh(): void {
    if (!this.isEnabled()) {
      this.clearDecorations();
      this.statusBarItem.hide();
    } else if (vscode.window.activeTextEditor) {
      this.triggerBlameUpdate(vscode.window.activeTextEditor);
    }
  }

  private triggerBlameUpdate(editor: vscode.TextEditor): void {
    this.cancelInFlight();
    this.clearDecorations();

    if (!this.isEnabled() && !this.isStatusBarEnabled()) {
      this.statusBarItem.hide();
      return;
    }

    if (!editor || editor.document.uri.scheme !== 'file') {
      this.statusBarItem.hide();
      return;
    }

    const line = editor.selection.active.line;
    if (line < 0 || line >= editor.document.lineCount) {
      this.statusBarItem.hide();
      return;
    }

    const delay = Math.max(0, vscode.workspace.getConfiguration('gitnav').get<number>('inlineBlame.delay', 150));
    this.debounceTimer = setTimeout(() => {
      this.fetchAndApplyBlame(editor, line);
    }, delay);
  }

  private async fetchAndApplyBlame(editor: vscode.TextEditor, lineIndex: number): Promise<void> {
    const tokenSource = new vscode.CancellationTokenSource();
    this.currentTokenSource = tokenSource;

    try {
      const documentPath = editor.document.uri.fsPath;
      const repoRoot = await findRepoRoot(documentPath, tokenSource.token);
      if (!repoRoot || tokenSource.token.isCancellationRequested) {
        this.statusBarItem.hide();
        return;
      }

      const relPath = toGitRelativePath(repoRoot, documentPath);
      const lineNumber = lineIndex + 1; // 1-indexed for git blame

      const entry = await fetchLineBlame(repoRoot, relPath, lineNumber, this.blameCache, tokenSource.token);
      if (!entry || tokenSource.token.isCancellationRequested) {
        this.statusBarItem.hide();
        return;
      }

      let currentUser = this.currentUserCache.get(repoRoot);
      if (currentUser === undefined) {
        const configUser = await runGit(repoRoot, ['config', 'user.name'], tokenSource.token);
        if (configUser.exitCode === 0 && configUser.stdout.trim()) {
          currentUser = configUser.stdout.trim();
          this.currentUserCache.set(repoRoot, currentUser);
        }
      }

      this.currentBlameEntry = { entry, repoRoot, relPath };

      if (vscode.window.activeTextEditor === editor && editor.selection.active.line === lineIndex) {
        this.applyBlameToEditor(editor, lineIndex, entry, repoRoot, currentUser);
      }
    } catch {
      // Ignored for smooth inline rendering
    } finally {
      if (this.currentTokenSource === tokenSource) {
        this.currentTokenSource = undefined;
      }
    }
  }

  private applyBlameToEditor(
    editor: vscode.TextEditor,
    lineIndex: number,
    entry: GitBlameEntry,
    repoRoot: string,
    currentUser?: string
  ): void {
    const template = vscode.workspace.getConfiguration('gitnav').get<string>('inlineBlame.format', '${author}, ${timeAgo} • ${summary}');
    const text = formatBlameText(entry, template, currentUser);

    if (this.isEnabled()) {
      const lineLength = editor.document.lineAt(lineIndex).text.length;
      const range = new vscode.Range(lineIndex, lineLength, lineIndex, lineLength);
      const hoverMessage = formatBlameHover(entry, repoRoot);

      const decoration: vscode.DecorationOptions = {
        range,
        renderOptions: {
          after: {
            contentText: ` ${text}`
          }
        },
        hoverMessage
      };

      editor.setDecorations(this.decorationType, [decoration]);
    }

    if (this.isStatusBarEnabled()) {
      if (entry.isUncommitted) {
        this.statusBarItem.text = `$(git-commit) Not committed yet`;
        this.statusBarItem.tooltip = 'Current line has uncommitted changes';
      } else {
        const timeAgo = formatTimeAgo(entry.authorTimeSeconds);
        const authorDisplay = currentUser && entry.author.toLowerCase() === currentUser.toLowerCase() ? 'You' : entry.author;
        this.statusBarItem.text = `$(git-commit) ${authorDisplay}, ${timeAgo} • ${entry.summary}`;
        this.statusBarItem.tooltip = `Commit: ${entry.shortHash} by ${entry.author} (${entry.authorDate.toLocaleString()})\n${entry.summary}\n\nClick to view actions.`;
      }
      this.statusBarItem.show();
    } else {
      this.statusBarItem.hide();
    }
  }

  private clearDecorations(): void {
    this.currentBlameEntry = undefined;
    for (const editor of vscode.window.visibleTextEditors) {
      editor.setDecorations(this.decorationType, []);
    }
  }

  private cancelInFlight(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = undefined;
    }
    if (this.currentTokenSource) {
      this.currentTokenSource.cancel();
      this.currentTokenSource.dispose();
      this.currentTokenSource = undefined;
    }
  }

  public dispose(): void {
    this.cancelInFlight();
    this.clearDecorations();
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
    this.disposables.length = 0;
  }
}
