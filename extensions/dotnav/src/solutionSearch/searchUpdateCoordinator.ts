import { WorkspaceFileEventKind } from '../workspaceChangeClassifier';

export const SEARCH_UPDATE_QUIET_MS = 5000;
export const SEARCH_UPDATE_MAX_MS = 30000;

export type SearchUpdateState = 'queued' | 'updating' | 'ready';

export class SearchUpdateCoordinator {
  private readonly pendingFiles = new Map<string, WorkspaceFileEventKind>();
  private quietTimer?: NodeJS.Timeout;
  private maxTimer?: NodeJS.Timeout;
  private activeFlush?: Promise<void>;
  private pendingFullRefresh = false;
  private flushAfterActive = false;

  constructor(
    private readonly flushFiles: (files: ReadonlyMap<string, WorkspaceFileEventKind>) => Promise<void>,
    private readonly refreshFullIndex: () => Promise<void>,
    private readonly updateState: (state: SearchUpdateState) => void
  ) {}

  public queueFile(filePath: string, eventKind: WorkspaceFileEventKind): void {
    if (!this.pendingFullRefresh) {
      this.pendingFiles.set(filePath, eventKind);
    }
    this.schedule();
  }

  public queueFullRefresh(): void {
    this.pendingFullRefresh = true;
    this.pendingFiles.clear();
    this.schedule();
  }

  public async flushNow(): Promise<void> {
    this.clearTimers();
    if (this.activeFlush) {
      this.flushAfterActive = true;
      await this.activeFlush;
      if (this.hasPendingWork()) {
        await this.flushNow();
      }
      return;
    }
    await this.flushPending();
  }

  public dispose(): void {
    this.clearTimers();
    this.pendingFiles.clear();
    this.pendingFullRefresh = false;
  }

  private schedule(): void {
    if (!this.maxTimer) {
      this.maxTimer = setTimeout(() => this.runScheduledFlush(), SEARCH_UPDATE_MAX_MS);
      this.maxTimer.unref?.();
    }
    if (this.quietTimer) {
      clearTimeout(this.quietTimer);
    }
    this.quietTimer = setTimeout(() => this.runScheduledFlush(), SEARCH_UPDATE_QUIET_MS);
    this.quietTimer.unref?.();
    this.updateState('queued');
  }

  private async flushPending(): Promise<void> {
    if (!this.hasPendingWork()) return;
    if (this.activeFlush) {
      this.flushAfterActive = true;
      return;
    }

    this.clearTimers();
    const fullRefresh = this.pendingFullRefresh;
    const files = new Map(this.pendingFiles);
    this.pendingFullRefresh = false;
    this.pendingFiles.clear();
    this.updateState('updating');

    this.activeFlush = fullRefresh
      ? this.refreshFullIndex()
      : this.flushFiles(files);

    try {
      await this.activeFlush;
    } finally {
      this.activeFlush = undefined;
      if (this.hasPendingWork()) {
        if (this.flushAfterActive) {
          this.flushAfterActive = false;
          await this.flushPending();
        }
      } else {
        this.flushAfterActive = false;
        this.updateState('ready');
      }
    }
  }

  private hasPendingWork(): boolean {
    return this.pendingFullRefresh || this.pendingFiles.size > 0;
  }

  private runScheduledFlush(): void {
    void this.flushPending().catch(error =>
      console.warn(`[DotNav] Delayed search index update failed: ${error}`)
    );
  }

  private clearTimers(): void {
    if (this.quietTimer) {
      clearTimeout(this.quietTimer);
      this.quietTimer = undefined;
    }
    if (this.maxTimer) {
      clearTimeout(this.maxTimer);
      this.maxTimer = undefined;
    }
  }
}
