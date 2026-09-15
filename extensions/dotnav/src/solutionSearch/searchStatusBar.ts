export interface IStatusBarItem {
  text: string;
  tooltip?: string | any;
  command?: string | any;
  name?: string;
  show(): void;
  hide(): void;
  dispose(): void;
}

export class SearchIndexStatusBar {
  private readonly item: IStatusBarItem;
  private lastReportedPercent = -1;
  private lastUpdateTime = 0;
  private hideTimer?: NodeJS.Timeout;

  constructor(customItem?: IStatusBarItem) {
    if (customItem) {
      this.item = customItem;
    } else {
      const vscode = require('vscode');
      const vsItem = vscode.window.createStatusBarItem(
        'dotnav.searchIndexStatus',
        vscode.StatusBarAlignment.Right,
        95
      );
      vsItem.name = 'DotNav Search Indexing';
      vsItem.command = 'dotnav.searchEverywhere';
      this.item = vsItem;
    }
  }

  public start(totalFiles: number): void {
    if (this.hideTimer) {
      clearTimeout(this.hideTimer);
      this.hideTimer = undefined;
    }
    this.lastReportedPercent = 0;
    this.lastUpdateTime = 0;
    this.item.text = `$(sync~spin) DotNav: Indexing 0%`;
    this.item.tooltip = `DotNav Solution Search: Scanning solution symbols (0 / ${totalFiles.toLocaleString()}). Click to open Search Everywhere.`;
    this.item.show();
  }

  public reportProgress(scannedFiles: number, totalFiles: number): void {
    if (totalFiles <= 0) return;
    const percent = Math.min(99, Math.round((scannedFiles / totalFiles) * 100));
    const now = Date.now();

    // Throttle UI updates to at least 200ms or 1% change
    if (percent !== this.lastReportedPercent && (now - this.lastUpdateTime > 200 || percent === 99)) {
      this.lastReportedPercent = percent;
      this.lastUpdateTime = now;
      this.item.text = `$(sync~spin) DotNav: Indexing ${percent}%`;
      this.item.tooltip = `DotNav Solution Search: Scanning solution symbols (${scannedFiles.toLocaleString()} / ${totalFiles.toLocaleString()}) • ${percent}%\nClick to open Search Everywhere.`;
    }
  }

  public complete(symbolCount: number, durationMs?: number): void {
    if (this.hideTimer) {
      clearTimeout(this.hideTimer);
    }
    this.item.text = `$(check) DotNav: Indexed ${symbolCount.toLocaleString()} symbols`;
    const dur = durationMs ? ` in ${(durationMs / 1000).toFixed(1)}s` : '';
    this.item.tooltip = `DotNav Solution Search: Indexing complete (${symbolCount.toLocaleString()} symbols & endpoints${dur}). Click to open Search Everywhere.`;
    this.hideTimer = setTimeout(() => {
      this.item.hide();
      this.hideTimer = undefined;
    }, 1800);
  }

  public hide(): void {
    if (this.hideTimer) {
      clearTimeout(this.hideTimer);
      this.hideTimer = undefined;
    }
    this.item.hide();
  }

  public dispose(): void {
    if (this.hideTimer) {
      clearTimeout(this.hideTimer);
      this.hideTimer = undefined;
    }
    this.item.dispose();
  }
}

let globalSearchStatusBar: SearchIndexStatusBar | undefined;

export function getSearchIndexStatusBar(): SearchIndexStatusBar {
  if (!globalSearchStatusBar) {
    globalSearchStatusBar = new SearchIndexStatusBar();
  }
  return globalSearchStatusBar;
}
