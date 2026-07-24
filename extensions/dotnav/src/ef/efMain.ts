import * as fs from 'fs/promises';
import * as path from 'path';
import * as vscode from 'vscode';
import { normalizePath, samePath } from '../pathUtils';
import { ProcessManager } from '../processManager';
import { parseProject } from '../projectParser';
import { DotnetTreeProvider } from '../treeProvider';
import { EfCli } from './efCli';
import { EfConfigStore } from './efConfigStore';
import { EfProjectDetection, detectEfProjects, migrationProjectCandidates } from './efDetection';
import { EfMigrationStore } from './efMigrationStore';
import { EfDetectionProvider, EfTreeProvider } from './efTreeProvider';
import { EfToolManager } from './efToolManager';
import { createEfStatusBar } from './efStatusBar';
import { registerEfCommands } from './efCommands';

const DETECTION_TTL_MS = 5000;

/** Owns every EF Core service and wires them into the extension (design §2). */
export class EfFeature implements EfDetectionProvider, vscode.Disposable {
  readonly cli: EfCli;
  readonly store: EfMigrationStore;
  readonly toolManager: EfToolManager;
  readonly configStore: EfConfigStore;
  readonly treeProvider: EfTreeProvider;
  private detectionsCache: { at: number; detections: readonly EfProjectDetection[] } | undefined;
  private readonly disposables: vscode.Disposable[] = [];
  private fileEventTimer: NodeJS.Timeout | undefined;
  private readonly pendingFileEvents = new Set<string>();

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly solutionProvider: DotnetTreeProvider,
    processManager: ProcessManager
  ) {
    this.cli = new EfCli(processManager);
    this.store = new EfMigrationStore(this.cli);
    this.toolManager = new EfToolManager(message => this.cli.appendOutput(message));
    this.configStore = new EfConfigStore(context.workspaceState);
    this.treeProvider = new EfTreeProvider(this, this.store, this.configStore);

    const updateStatusBar = createEfStatusBar(context);
    this.disposables.push(
      this.cli,
      this.cli.onDidChangeActivity(snapshot => {
        updateStatusBar(snapshot);
        if (!snapshot.running && snapshot.pending.length === 0) {
          // Queue drained — release buffered watcher invalidations (§7.4).
          this.store.flushBufferedEvents();
        }
      }),
      this.store.onDidChange(() => this.treeProvider.refresh())
    );

    this.registerWatcher();
    this.disposables.push(
      vscode.window.createTreeView('dotnav.efCore', { treeDataProvider: this.treeProvider, showCollapseAll: true })
    );
    registerEfCommands(context, this);

    // Detection is lazy by default; the context key controls view visibility.
    void this.updateContextKey();
    this.disposables.push(
      this.solutionProvider.onDidChangeTreeData(() => void this.updateContextKey())
    );

    if (vscode.workspace.getConfiguration('dotnav.ef').get<boolean>('checkPendingOnStartup', false)) {
      void this.getDetections();
    }
  }

  async getDetections(): Promise<readonly EfProjectDetection[]> {
    if (!vscode.workspace.getConfiguration('dotnav.ef').get<boolean>('enable', true)) {
      return [];
    }

    if (this.detectionsCache && Date.now() - this.detectionsCache.at < DETECTION_TTL_MS) {
      return this.detectionsCache.detections;
    }

    const solution = this.solutionProvider.getSolution();
    if (!solution) {
      return [];
    }

    // Parse csproj files directly (regex-level, cached by signature) instead of
    // forcing the solution tree to hydrate metadata for every project.
    const projects = await Promise.all(
      solution.projects.map(project =>
        project.metadataLoaded ? Promise.resolve(project) : parseProject(project.path, solution.rootPath).catch(() => project)
      )
    );

    const migrationFolderProjects = new Set<string>();
    await Promise.all(projects.map(async project => {
      if (await hasMigrationsFolder(project.directory)) {
        migrationFolderProjects.add(normalizePath(project.path));
      }
    }));

    const all = detectEfProjects({ ...solution, projects }, migrationFolderProjects);
    const detections = migrationProjectCandidates(all);
    this.detectionsCache = { at: Date.now(), detections };
    this.cli.appendOutput(
      `detection: ${detections.length} EF project(s)` +
      (detections.length > 0
        ? ` — ${detections.map(detection => detection.project.name).join(', ')}`
        : ` (scanned ${projects.length} project(s); no EntityFrameworkCore package references or Migrations folders found)`)
    );
    return detections;
  }

  invalidateDetections(): void {
    this.detectionsCache = undefined;
  }

  /**
   * Non-interactive startup project resolution used by tree rendering:
   * remembered choice first, then the sole/first candidate (design §3.3).
   */
  async resolveStartupProject(detection: EfProjectDetection): Promise<string | undefined> {
    const configured = vscode.workspace.getConfiguration('dotnav.ef').get<string>('startupProject', '');
    if (configured) {
      const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? detection.project.directory;
      return path.isAbsolute(configured) ? configured : path.resolve(root, configured);
    }

    const stored = this.configStore.getStartupProject(detection.project.path);
    if (stored && (
      detection.startupCandidates.some(candidate => samePath(candidate.path, stored)) ||
      samePath(detection.project.path, stored)
    )) {
      return stored;
    }

    return detection.startupCandidates[0]?.path ?? detection.project.path;
  }

  private async updateContextKey(): Promise<void> {
    const detections = await this.getDetections().catch(() => []);
    await vscode.commands.executeCommand('setContext', 'dotnav.ef.hasProjects', detections.length > 0);
  }

  private registerWatcher(): void {
    const watcher = vscode.workspace.createFileSystemWatcher('**/*.{cs,csproj,sln,slnx}');
    const handle = (uri: vscode.Uri) => this.onFileEvent(uri.fsPath);
    this.disposables.push(
      watcher,
      watcher.onDidCreate(handle),
      watcher.onDidChange(handle),
      watcher.onDidDelete(handle),
      { dispose: () => this.fileEventTimer && clearTimeout(this.fileEventTimer) }
    );
  }

  private onFileEvent(filePath: string): void {
    const normalized = normalizePath(filePath);
    if (/\/(bin|obj|node_modules|\.git|\.vs)\//i.test(normalized.replace(/\\/g, '/'))) {
      return;
    }

    if (/\.(csproj|sln|slnx)$/i.test(filePath)) {
      this.invalidateDetections();
      // Solution shape changed (branch switch, reload): drop queued commands
      // so they don't run against a stale model (§7.9).
      const cleared = this.cli.clearPending();
      if (cleared > 0) {
        vscode.window.showInformationMessage(
          `${cleared} queued EF command(s) were cancelled because the solution changed.`
        );
      }
      void this.updateContextKey();
    }

    this.pendingFileEvents.add(filePath);
    if (this.fileEventTimer) {
      clearTimeout(this.fileEventTimer);
    }

    // Debounce manual edits; EF-generated bursts are also coalesced here and
    // additionally buffered by the store while the queue is busy (§7.4).
    this.fileEventTimer = setTimeout(() => {
      this.fileEventTimer = undefined;
      void this.dispatchFileEvents();
    }, 2000);
  }

  private async dispatchFileEvents(): Promise<void> {
    const files = [...this.pendingFileEvents];
    this.pendingFileEvents.clear();
    const detections = await this.getDetections().catch(() => [] as readonly EfProjectDetection[]);
    if (detections.length === 0) {
      return;
    }

    const touched = new Set<string>();
    for (const filePath of files) {
      const normalizedFile = normalizePath(filePath);
      for (const detection of detections) {
        const directoryPrefix = normalizePath(detection.project.directory) + path.sep;
        if (normalizedFile.startsWith(directoryPrefix)) {
          touched.add(detection.project.path);
        }
      }
    }

    for (const projectPath of touched) {
      this.cli.freshness.markDirty(projectPath);
      this.store.handleFileEvent(projectPath);
    }
  }

  refreshAll(): void {
    this.invalidateDetections();
    this.toolManager.invalidate();
    this.store.invalidateAll();
    void this.updateContextKey();
    this.treeProvider.refresh();
  }

  dispose(): void {
    for (const disposable of this.disposables.splice(0)) {
      try {
        disposable.dispose();
      } catch {
        // Best-effort cleanup.
      }
    }
  }
}

/** True when the directory holds an EF `Migrations` folder with generated files. */
async function hasMigrationsFolder(projectDirectory: string): Promise<boolean> {
  const migrationsDir = path.join(projectDirectory, 'Migrations');
  try {
    const entries = await fs.readdir(migrationsDir);
    return entries.some(entry => /ModelSnapshot\.cs$/i.test(entry) || /^\d{14}_.+\.cs$/i.test(entry));
  } catch {
    return false;
  }
}

export function activateEfCore(
  context: vscode.ExtensionContext,
  solutionProvider: DotnetTreeProvider,
  processManager: ProcessManager
): EfFeature {
  const feature = new EfFeature(context, solutionProvider, processManager);
  context.subscriptions.push(feature);
  return feature;
}
