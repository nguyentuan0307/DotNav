import * as fs from 'fs/promises';
import * as path from 'path';
import * as vscode from 'vscode';
import { ProjectModel } from '../models';
import { normalizePath, samePath } from '../pathUtils';
import { ProcessManager } from '../processManager';
import { parseProject } from '../projectParser';
import { DotnetTreeProvider } from '../treeProvider';
import { EfCli } from './efCli';
import { EfConfigStore } from './efConfigStore';
import { EfProjectDetection, detectEfProjects, migrationProjectCandidates } from './efDetection';
import { ProjectEfModel, invalidateEfModel, loadEfModel } from './efModel';
import { EfToolManager } from './efToolManager';
import { createEfStatusBar } from './efStatusBar';
import { registerEfCommands } from './efCommands';

const DETECTION_TTL_MS = 5000;

/**
 * Owns every EF Core service. Detection and the dialogs' data all come from
 * parsing files, so opening any EF dialog never waits on `dotnet ef`.
 */
export class EfFeature implements vscode.Disposable {
  readonly cli: EfCli;
  readonly toolManager: EfToolManager;
  readonly configStore: EfConfigStore;
  private detectionsCache: { at: number; detections: readonly EfProjectDetection[] } | undefined;
  private lastScannedProjectCount = 0;
  private lastSolutionSignature = '';
  private readonly disposables: vscode.Disposable[] = [];
  private fileEventTimer: NodeJS.Timeout | undefined;
  private readonly pendingFileEvents = new Set<string>();

  constructor(
    context: vscode.ExtensionContext,
    private readonly solutionProvider: DotnetTreeProvider,
    processManager: ProcessManager
  ) {
    this.cli = new EfCli(processManager);
    this.toolManager = new EfToolManager(message => this.cli.appendOutput(message));
    this.configStore = new EfConfigStore(context.workspaceState);

    const updateStatusBar = createEfStatusBar(context);
    this.disposables.push(
      this.cli,
      this.cli.onDidChangeActivity(snapshot => updateStatusBar(snapshot))
    );

    this.registerWatcher();
    registerEfCommands(context, this);

    this.disposables.push(
      this.solutionProvider.onDidChangeTreeData(() => this.onSolutionChanged())
    );

    if (vscode.workspace.getConfiguration('dotnav.ef').get<boolean>('checkPendingOnStartup', false)) {
      void this.getDetections();
    }
  }

  async getDetections(): Promise<readonly EfProjectDetection[]> {
    if (!vscode.workspace.getConfiguration('dotnav.ef').get<boolean>('enable', true)) {
      return [];
    }

    // Only non-empty results are cached: an empty result usually means the
    // solution had not finished loading, and caching it would hide EF projects
    // until something else happened to invalidate it.
    if (this.detectionsCache && Date.now() - this.detectionsCache.at < DETECTION_TTL_MS) {
      return this.detectionsCache.detections;
    }

    const solution = this.solutionProvider.getSolution();
    if (!solution || solution.projects.length === 0) {
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

    const detections = migrationProjectCandidates(
      detectEfProjects({ ...solution, projects }, migrationFolderProjects)
    );
    if (detections.length > 0) {
      this.detectionsCache = { at: Date.now(), detections };
    }

    this.lastScannedProjectCount = projects.length;
    this.cli.appendOutput(
      `detection: ${detections.length} EF project(s) out of ${projects.length} scanned` +
      (detections.length > 0
        ? ` — ${detections.map(detection => detection.project.name).join(', ')}`
        : ' (no EntityFrameworkCore package references or Migrations folders found)')
    );
    return detections;
  }

  /** Project count from the last completed scan, for diagnostics. */
  get scannedProjectCount(): number {
    return this.lastScannedProjectCount;
  }

  /** Resolves a detected project by path, for dialog dropdown selections. */
  findProject(projectPath: string): ProjectModel | undefined {
    if (!projectPath) {
      return undefined;
    }

    const detections = this.detectionsCache?.detections ?? [];
    const detected = detections.find(detection => samePath(detection.project.path, projectPath));
    if (detected) {
      return detected.project;
    }

    return this.solutionProvider.getSolution()?.projects
      .find(project => samePath(project.path, projectPath));
  }

  async modelForProjectPath(projectPath: string): Promise<ProjectEfModel | undefined> {
    const project = this.findProject(projectPath);
    return project ? loadEfModel(project.directory) : undefined;
  }

  invalidateModel(projectDirectory?: string): void {
    invalidateEfModel(projectDirectory);
  }

  private onSolutionChanged(): void {
    const solution = this.solutionProvider.getSolution();
    const signature = solution ? `${solution.path ?? solution.rootPath}:${solution.projects.length}` : '';
    if (signature === this.lastSolutionSignature) {
      return;
    }

    // The solution tree fires on every run-state change; only re-detect when
    // the set of projects actually changed.
    this.lastSolutionSignature = signature;
    this.invalidateDetections();
  }

  invalidateDetections(): void {
    this.detectionsCache = undefined;
  }

  /**
   * Startup project resolution: explicit setting, then the remembered choice,
   * then the sole/first candidate (design §3.3).
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
    const normalized = normalizePath(filePath).replace(/\\/g, '/');
    if (/\/(bin|obj|node_modules|\.git|\.vs)\//i.test(normalized)) {
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
    }

    this.pendingFileEvents.add(filePath);
    if (this.fileEventTimer) {
      clearTimeout(this.fileEventTimer);
    }

    // Debounce manual edits; EF-generated bursts are coalesced here too.
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
          touched.add(detection.project.directory);
          this.cli.freshness.markDirty(detection.project.path);
        }
      }
    }

    for (const directory of touched) {
      invalidateEfModel(directory);
    }
  }

  refreshAll(): void {
    this.invalidateDetections();
    this.toolManager.invalidate();
    invalidateEfModel();
    void this.getDetections().then(detections => {
      vscode.window.showInformationMessage(
        `EF Core: ${detections.length} project(s) detected out of ${this.scannedProjectCount} scanned.`
      );
    });
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
): EfFeature | undefined {
  try {
    const feature = new EfFeature(context, solutionProvider, processManager);
    context.subscriptions.push(feature);
    return feature;
  } catch (error) {
    // Never let an EF wiring failure fail silently.
    const message = error instanceof Error ? error.message : String(error);
    console.error('DotNav: EF Core tools failed to activate', error);
    vscode.window.showErrorMessage(`DotNav: the EF Core tools failed to start: ${message}`);
    return undefined;
  }
}
