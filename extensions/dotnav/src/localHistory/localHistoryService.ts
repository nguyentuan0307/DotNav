import * as fs from 'fs/promises';
import * as path from 'path';
import * as vscode from 'vscode';
import { automaticCaptureDelay, createLocalHistoryPolicy, shouldTrackFile } from './historyPolicy';
import { LocalHistoryStore } from './localHistoryStore';
import {
  LocalHistoryEventSource,
  LocalHistoryPolicy,
  LocalHistoryRevision,
  LocalHistoryRevisionPage
} from './localHistoryTypes';

export class LocalHistoryService implements vscode.Disposable {
  readonly ready: Promise<void>;
  private readonly store: LocalHistoryStore;
  private readonly disposables: vscode.Disposable[] = [];
  private readonly pendingCaptures = new Map<string, PendingCapture>();
  private readonly pendingDeletes = new Map<string, NodeJS.Timeout>();
  private readonly lastAutomaticCaptureAt = new Map<string, number>();
  private snapshotsSinceMaintenance = 0;
  private maintenanceRun: Promise<void> | undefined;
  private maintenanceTimer: NodeJS.Timeout | undefined;
  private disposed = false;

  constructor(private readonly context: vscode.ExtensionContext) {
    const storagePath = context.storageUri?.fsPath ?? path.join(context.globalStorageUri.fsPath, 'no-workspace');
    this.store = new LocalHistoryStore(path.join(storagePath, 'local-history'));
    const policy = this.policy();
    this.ready = this.store.initialize(
      policy.retentionDays,
      policy.maximumStorageBytes,
      policy.maximumRevisionsPerFile
    );
  }

  start(): void {
    const watcher = vscode.workspace.createFileSystemWatcher('**/*');
    this.disposables.push(
      watcher,
      vscode.workspace.onDidOpenTextDocument(document => void this.captureDocument(document, 'baseline')),
      vscode.workspace.onDidSaveTextDocument(document => {
        const content = Buffer.from(document.getText(), 'utf8');
        this.scheduleCapture(
          document.uri.fsPath,
          'save',
          () => this.captureContent(document.uri.fsPath, content, 'save')
        );
      }),
      vscode.workspace.onDidRenameFiles(event => {
        for (const file of event.files) {
          const pendingFlush = this.flushPendingCapture(file.oldUri.fsPath);
          void pendingFlush.then(async () => {
            await this.afterReady(() => this.store.recordRename(file.oldUri.fsPath, file.newUri.fsPath, 'external'));
            this.scheduleCapture(file.newUri.fsPath, 'external');
          });
        }
      }),
      watcher.onDidCreate(uri => this.scheduleCapture(uri.fsPath, 'external')),
      watcher.onDidChange(uri => this.scheduleCapture(uri.fsPath, 'external')),
      watcher.onDidDelete(uri => this.scheduleDelete(uri.fsPath)),
      vscode.workspace.onDidChangeConfiguration(event => {
        if (event.affectsConfiguration('dotnav.localHistory')
          && !event.affectsConfiguration('dotnav.localHistory.enabled')) {
          const policy = this.policy();
          void this.runMaintenance(policy);
        }
      })
    );

    for (const document of vscode.workspace.textDocuments) {
      void this.captureDocument(document, 'baseline');
    }
    this.maintenanceTimer = setInterval(() => {
      if (this.snapshotsSinceMaintenance > 0) {
        void this.runMaintenance();
      }
    }, 5 * 60 * 1000);
  }

  async captureDocument(document: vscode.TextDocument, source: LocalHistoryEventSource): Promise<void> {
    if (document.uri.scheme !== 'file') {
      return;
    }
    if (source === 'manual') {
      this.markManualCapture(document.uri.fsPath);
    }
    const content = Buffer.from(document.getText(), 'utf8');
    await this.captureContent(document.uri.fsPath, content, source);
  }

  async getRevisions(filePath: string): Promise<LocalHistoryRevision[]> {
    await this.ready;
    await this.store.waitForIdle();
    return this.store.getRevisions(filePath);
  }

  async getRevisionPage(
    filePath: string,
    cursor?: string,
    pageSize = 50
  ): Promise<LocalHistoryRevisionPage> {
    await this.ready;
    await this.store.waitForIdle();
    return this.store.getRevisionPage(filePath, cursor, pageSize);
  }

  async readRevision(revision: LocalHistoryRevision): Promise<string> {
    await this.ready;
    return (await this.store.readRevision(revision)).toString('utf8');
  }

  dispose(): void {
    this.disposed = true;
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
    for (const pending of this.pendingCaptures.values()) {
      clearTimeout(pending.timer);
    }
    for (const timer of this.pendingDeletes.values()) {
      clearTimeout(timer);
    }
    if (this.maintenanceTimer) {
      clearInterval(this.maintenanceTimer);
    }
  }

  private scheduleCapture(
    filePath: string,
    source: LocalHistoryEventSource,
    capture: () => Promise<void> = () => this.captureFile(filePath, source)
  ): void {
    const key = normalizePathKey(filePath);
    const existing = this.pendingCaptures.get(key);
    if (existing?.source === 'save' && source === 'external') {
      return;
    }
    this.cancelPending(filePath);
    const now = Date.now();
    const delay = automaticCaptureDelay(
      now,
      this.lastAutomaticCaptureAt.get(key) ?? 0,
      this.policy().snapshotCoalescingMs
    );
    if (delay === 0) {
      this.lastAutomaticCaptureAt.set(key, now);
      void capture();
      return;
    }
    const timer = setTimeout(() => {
      this.pendingCaptures.delete(key);
      this.lastAutomaticCaptureAt.set(key, Date.now());
      void capture();
    }, delay);
    this.pendingCaptures.set(key, new PendingCapture(timer, capture, source));
  }

  private scheduleDelete(filePath: string): void {
    const pendingFlush = this.flushPendingCapture(filePath);
    this.cancelPendingDelete(filePath);
    const key = normalizePathKey(filePath);
    this.pendingDeletes.set(key, setTimeout(async () => {
      this.pendingDeletes.delete(key);
      await pendingFlush;
      if (!shouldTrackFile(filePath, this.workspaceRoots(), this.policy())) {
        return;
      }
      void this.afterReady(() => this.store.recordDelete(filePath, 'external'));
    }, 600));
  }

  private cancelPending(filePath: string): void {
    const key = normalizePathKey(filePath);
    const capture = this.pendingCaptures.get(key);
    if (capture) {
      clearTimeout(capture.timer);
      this.pendingCaptures.delete(key);
    }
    this.cancelPendingDelete(filePath);
  }

  private cancelPendingDelete(filePath: string): void {
    const key = normalizePathKey(filePath);
    const deletion = this.pendingDeletes.get(key);
    if (deletion) {
      clearTimeout(deletion);
      this.pendingDeletes.delete(key);
    }
  }

  private async flushPendingCapture(filePath: string): Promise<void> {
    const key = normalizePathKey(filePath);
    const pending = this.pendingCaptures.get(key);
    if (!pending) {
      return;
    }
    clearTimeout(pending.timer);
    this.pendingCaptures.delete(key);
    this.lastAutomaticCaptureAt.set(key, Date.now());
    await pending.capture();
  }

  async captureFile(filePath: string, source: LocalHistoryEventSource): Promise<void> {
    if (source === 'manual') {
      this.markManualCapture(filePath);
    }
    const policy = this.policy();
    if (!shouldTrackFile(filePath, this.workspaceRoots(), policy)) {
      return;
    }
    try {
      const stat = await fs.stat(filePath);
      if (!stat.isFile() || stat.size > policy.maximumFileBytes) {
        return;
      }
      await this.captureContent(filePath, await fs.readFile(filePath), source);
    } catch (error) {
      if (!isNotFound(error)) {
        console.error(`DotNav Local History failed to read ${filePath}: ${String(error)}`);
      }
    }
  }

  private async captureContent(filePath: string, content: Buffer, source: LocalHistoryEventSource): Promise<void> {
    if (this.disposed) {
      return;
    }
    const policy = this.policy();
    if (!shouldTrackFile(filePath, this.workspaceRoots(), policy)
      || content.byteLength > policy.maximumFileBytes
      || content.subarray(0, 8192).includes(0)) {
      return;
    }
    const event = await this.afterReady(() => this.store.snapshot(filePath, content, source));
    if (event) {
      this.snapshotsSinceMaintenance += 1;
      if (this.snapshotsSinceMaintenance >= 25) {
        void this.runMaintenance();
      }
    }
  }

  private async afterReady<T>(operation: () => Promise<T>): Promise<T | undefined> {
    try {
      await this.ready;
      if (this.disposed) {
        return undefined;
      }
      return await operation();
    } catch (error) {
      console.error(`DotNav Local History failed: ${String(error)}`);
      return undefined;
    }
  }

  private workspaceRoots(): string[] {
    return vscode.workspace.workspaceFolders?.map(folder => folder.uri.fsPath) ?? [];
  }

  private policy(): LocalHistoryPolicy {
    const configuration = vscode.workspace.getConfiguration('dotnav.localHistory');
    return createLocalHistoryPolicy({
      enabled: configuration.get<boolean>('enabled', false),
      retentionDays: configuration.get<number>('retentionDays', 5),
      maximumStorageMb: configuration.get<number>('maximumStorageMb', 250),
      maximumFileSizeMb: configuration.get<number>('maximumFileSizeMb', 2),
      maximumRevisionsPerFile: configuration.get<number>('maximumRevisionsPerFile', 250),
      snapshotCoalescingSeconds: configuration.get<number>('snapshotCoalescingSeconds', 5),
      trackedExtensions: configuration.get<string[]>('trackedExtensions')
    });
  }

  private markManualCapture(filePath: string): void {
    this.cancelPending(filePath);
    this.lastAutomaticCaptureAt.set(normalizePathKey(filePath), Date.now());
  }

  private runMaintenance(policy = this.policy()): Promise<void> {
    if (this.maintenanceRun) {
      return this.maintenanceRun;
    }
    this.snapshotsSinceMaintenance = 0;
    const operation = this.afterReady(() => this.store.prune(
      policy.retentionDays,
      policy.maximumStorageBytes,
      policy.maximumRevisionsPerFile
    )).then(() => undefined);
    this.maintenanceRun = operation.finally(() => {
      this.maintenanceRun = undefined;
    });
    return this.maintenanceRun;
  }
}

function isNotFound(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT');
}

function normalizePathKey(filePath: string): string {
  const normalized = path.normalize(filePath);
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

class PendingCapture {
  constructor(
    readonly timer: NodeJS.Timeout,
    readonly capture: () => Promise<void>,
    readonly source: LocalHistoryEventSource
  ) {}
}
