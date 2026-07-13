import * as path from 'path';
import * as vscode from 'vscode';
import { addCodeItem, addExistingItem, addFile, addFolder } from './addCommands';
import { buildConfig, pickProfile, runConfig, startTarget } from './debugRunner';
import { SolutionOperation, openTerminalAt, runDotnetForProject, runDotnetForProjects, runDotnetForSolution } from './dotnetCli';
import { projectsUnderFolder } from './folderBuild';
import { ExplorerInteractionController, isMovableNode } from './explorerInteraction';
import { copyFullPath, copyRelativePath, deleteItem, moveItem, renameItem, revealInFileExplorer } from './fileCommands';
import { formatSelection } from './format/formatSelection';
import { BranchCompareDocumentProvider, compareFileWithBranch, compareSelectionWithBranch } from './git/branchCompare';
import { findRepoRoot, runGit, toGitRelativePath } from './git/gitCli';
import { GitOperationCancelledError, LineHistoryQuery, getLineHistory, lineHistoryLabel } from './git/lineHistory';
import { LineHistoryPanel } from './git/lineHistoryPanel';
import { mapWorktreeRangeToHead } from './git/lineMapping';
import { GitLogViewProvider } from './git/gitLogViewProvider';
import { GitRepositoryService } from './git/gitRepositoryService';
import { GitRevisionProvider, gitRevisionScheme } from './git/gitRevisionProvider';
import { ProjectModel, RunConfig, SolutionModel, TreeNode } from './models';
import { isRunnableProject } from './projectCapabilities';
import { ProcessManager } from './processManager';
import { RunConfigTreeProvider } from './runConfigTreeProvider';
import * as runConfigStore from './runConfigStore';
import { createStatusBar, updateStatusBar } from './statusBar';
import { DotnetTreeProvider } from './treeProvider';

let activeProcessManager: ProcessManager | undefined;

export function activate(context: vscode.ExtensionContext): void {
  const provider = new DotnetTreeProvider(context);
  const branchCompareProvider = new BranchCompareDocumentProvider();
  const gitRepositoryService = new GitRepositoryService();
  const gitLogProvider = new GitLogViewProvider(gitRepositoryService, context.extensionUri);
  const processManager = new ProcessManager();
  provider.setRunStateProvider(
    project => processManager.getProjectPhase(project),
    configId => {
      const session = processManager.getLatestSessionForConfig(configId);
      return session ? {
        phase: session.phase,
        busy: Boolean(processManager.getActiveSessionForConfig(configId))
      } : undefined;
    }
  );
  activeProcessManager = processManager;
  const interaction = new ExplorerInteractionController(provider);
  const treeView = vscode.window.createTreeView('dotnetSolutionNavigator', {
    treeDataProvider: provider,
    dragAndDropController: interaction,
    showCollapseAll: true
  });
  const runConfigTreeView = vscode.window.createTreeView('dotnetSolutionNavigator.runConfigurations', {
    treeDataProvider: new RunConfigTreeProvider(provider),
    showCollapseAll: false
  });

  const statusItems = createStatusBar();
  const refreshStatusBar = () => {
    updateStatusBar(provider, context, processManager);
    const solution = provider.getSolution();
    const activeConfig = solution ? runConfigStore.getActive(solution, context) : undefined;
    vscode.commands.executeCommand(
      'setContext',
      'dotnetSolutionNavigator.activeConfigBusy',
      Boolean(activeConfig && processManager.getActiveSessionForConfig(activeConfig.id))
    );
  };
  const updateRunningContext = (hasRunningProcesses: boolean) => {
    vscode.commands.executeCommand('setContext', 'dotnetSolutionNavigator.hasRunningProcesses', hasRunningProcesses);
    provider.fireChanged();
  };

  context.subscriptions.push(
    treeView,
    runConfigTreeView,
    vscode.workspace.registerTextDocumentContentProvider('dotnet-navigator-compare', branchCompareProvider),
    vscode.workspace.registerTextDocumentContentProvider(gitRevisionScheme, new GitRevisionProvider(gitRepositoryService)),
    vscode.window.registerWebviewViewProvider(GitLogViewProvider.viewId, gitLogProvider, { webviewOptions: { retainContextWhenHidden: true } }),
    gitLogProvider,
    processManager,
    ...statusItems,
    provider.onDidChangeTreeData(refreshStatusBar),
    processManager.onDidChangeRunningState(updateRunningContext),
    vscode.commands.registerCommand('dotnetSolutionNavigator.refresh', () => provider.refresh()),
    vscode.commands.registerCommand('dotnetSolutionNavigator.selectSolution', () => provider.selectActiveSolution()),
    vscode.commands.registerCommand('dotnetSolutionNavigator.selectOpenedFile', () => selectOpenedFile(provider, treeView, true)),
    vscode.commands.registerCommand('dotnetSolutionNavigator.searchSolutionTree', openSolutionTreeFind),
    vscode.commands.registerCommand('dotnetSolutionNavigator.openItem', (node: TreeNode) => openItem(provider, treeView, node)),
    vscode.commands.registerCommand('dotnetSolutionNavigator.openProjectFile', openProjectFile),
    vscode.commands.registerCommand('dotnetSolutionNavigator.openSolutionFile', () => openSolutionFile(provider)),
    vscode.commands.registerCommand('dotnetSolutionNavigator.openSolutionTerminal', () => openSolutionTerminal(provider)),
    vscode.commands.registerCommand('dotnetSolutionNavigator.buildProject', (node: TreeNode) => runProjectCommand(processManager, node, 'build')),
    vscode.commands.registerCommand('dotnetSolutionNavigator.buildFolderProjects', (node: TreeNode) => buildFolderProjects(provider, processManager, node)),
    vscode.commands.registerCommand('dotnetSolutionNavigator.rebuildProject', (node: TreeNode) => runProjectCommand(processManager, node, 'rebuild')),
    vscode.commands.registerCommand('dotnetSolutionNavigator.buildSolution', () => runSolutionCommand(provider, processManager, 'build')),
    vscode.commands.registerCommand('dotnetSolutionNavigator.rebuildSolution', () => runSolutionCommand(provider, processManager, 'rebuild')),
    vscode.commands.registerCommand('dotnetSolutionNavigator.cleanSolution', () => runSolutionCommand(provider, processManager, 'clean')),
    vscode.commands.registerCommand('dotnetSolutionNavigator.openWorkspaceFolder', () => vscode.commands.executeCommand('workbench.action.files.openFolder')),
    vscode.commands.registerCommand('dotnetSolutionNavigator.runProject', (node: TreeNode) => runOrDebugProject(processManager, node, false)),
    vscode.commands.registerCommand('dotnetSolutionNavigator.debugProject', (node: TreeNode) => runOrDebugProject(processManager, node, true)),
    vscode.commands.registerCommand('dotnetSolutionNavigator.testProject', (node: TreeNode) => runProjectCommand(processManager, node, 'test')),
    vscode.commands.registerCommand('dotnetSolutionNavigator.cleanProject', (node: TreeNode) => runProjectCommand(processManager, node, 'clean')),
    vscode.commands.registerCommand('dotnetSolutionNavigator.stopProject', (node: TreeNode) => stopProject(processManager, node)),
    vscode.commands.registerCommand('dotnetSolutionNavigator.stopAll', () => processManager.stopAll()),
    vscode.commands.registerCommand('dotnetSolutionNavigator.stopActiveConfig', () => stopActiveConfig(context, provider, processManager)),
    vscode.commands.registerCommand('dotnetSolutionNavigator.showRunOutput', () => processManager.showOutput()),
    vscode.commands.registerCommand('dotnetSolutionNavigator.stopConfigNode', (node: TreeNode) => node.configId ? processManager.stopConfig(node.configId) : undefined),
    vscode.commands.registerCommand('dotnetSolutionNavigator.openTerminalHere', openTerminalHere),
    vscode.commands.registerCommand('dotnetSolutionNavigator.toggleProjectFiles', () => toggleProjectFiles(provider)),
    vscode.commands.registerCommand('dotnetSolutionNavigator.toggleFileNesting', () => toggleFileNesting(provider)),
    vscode.commands.registerCommand('dotnetSolutionNavigator.openSettings', () => openNavigatorSettings()),
    vscode.commands.registerCommand('dotnetSolutionNavigator.addClass', (node: TreeNode) => addCodeItem(provider, node, 'class')),
    vscode.commands.registerCommand('dotnetSolutionNavigator.addInterface', (node: TreeNode) => addCodeItem(provider, node, 'interface')),
    vscode.commands.registerCommand('dotnetSolutionNavigator.addRecord', (node: TreeNode) => addCodeItem(provider, node, 'record')),
    vscode.commands.registerCommand('dotnetSolutionNavigator.addEnum', (node: TreeNode) => addCodeItem(provider, node, 'enum')),
    vscode.commands.registerCommand('dotnetSolutionNavigator.addFile', (node: TreeNode) => addFile(provider, node)),
    vscode.commands.registerCommand('dotnetSolutionNavigator.addFolder', (node: TreeNode) => addFolder(provider, node)),
    vscode.commands.registerCommand('dotnetSolutionNavigator.addExistingItem', (node: TreeNode) => addExistingItem(provider, node)),
    vscode.commands.registerCommand('dotnetSolutionNavigator.renameItem', (node?: TreeNode) => runSelectedFileCommand(interaction, node, selected => renameItem(provider, selected))),
    vscode.commands.registerCommand('dotnetSolutionNavigator.moveItem', (node?: TreeNode) => runSelectedFileCommand(interaction, node, selected => moveItem(provider, selected))),
    vscode.commands.registerCommand('dotnetSolutionNavigator.deleteItem', (node?: TreeNode) => runSelectedFileCommand(interaction, node, selected => deleteItem(provider, selected))),
    vscode.commands.registerCommand('dotnetSolutionNavigator.copyPath', (node?: TreeNode) => runSelectedResourceCommand(interaction, node, copyFullPath)),
    vscode.commands.registerCommand('dotnetSolutionNavigator.copyRelativePath', (node?: TreeNode) => runSelectedResourceCommand(interaction, node, copyRelativePath)),
    vscode.commands.registerCommand('dotnetSolutionNavigator.revealInOs', (node?: TreeNode) => runSelectedResourceCommand(interaction, node, revealInFileExplorer)),
    vscode.commands.registerCommand('dotnetSolutionNavigator.addRunConfig', () => addRunConfig(context, provider)),
    vscode.commands.registerCommand('dotnetSolutionNavigator.renameRunConfig', (node: TreeNode) => renameRunConfig(context, provider, node)),
    vscode.commands.registerCommand('dotnetSolutionNavigator.removeRunConfig', (node: TreeNode) => removeRunConfig(context, provider, node)),
    vscode.commands.registerCommand('dotnetSolutionNavigator.selectRunConfig', () => selectRunConfig(context, provider)),
    vscode.commands.registerCommand('dotnetSolutionNavigator.newCompound', () => newCompound(context, provider)),
    vscode.commands.registerCommand('dotnetSolutionNavigator.deleteCompound', () => deleteCompound(context, provider)),
    vscode.commands.registerCommand('dotnetSolutionNavigator.setActiveConfig', (node: TreeNode) => setActiveConfig(context, provider, node)),
    vscode.commands.registerCommand('dotnetSolutionNavigator.runActiveConfig', () => withActiveConfig(context, provider, config => runConfig(provider.getSolution()!, config, { debug: false, processManager }))),
    vscode.commands.registerCommand('dotnetSolutionNavigator.debugActiveConfig', () => withActiveConfig(context, provider, config => runConfig(provider.getSolution()!, config, { debug: true, processManager }))),
    vscode.commands.registerCommand('dotnetSolutionNavigator.buildActiveConfig', () => withActiveConfig(context, provider, config => buildConfig(provider.getSolution()!, config, processManager))),
    vscode.commands.registerCommand('dotnetSolutionNavigator.runConfigNode', (node: TreeNode) => runConfigNode(context, provider, node, false, processManager)),
    vscode.commands.registerCommand('dotnetSolutionNavigator.debugConfigNode', (node: TreeNode) => runConfigNode(context, provider, node, true, processManager)),
    vscode.commands.registerCommand('dotnetSolutionNavigator.showHistoryForSelection', () => showHistoryForSelection(context)),
    vscode.commands.registerCommand('dotnetSolutionNavigator.compareFileWithBranch', () => compareFileWithBranch(branchCompareProvider)),
    vscode.commands.registerCommand('dotnetSolutionNavigator.compareSelectionWithBranch', () => compareSelectionWithBranch(branchCompareProvider)),
    vscode.commands.registerCommand('dotnetSolutionNavigator.formatSelection', () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showInformationMessage('Open a C# file before formatting a selection.');
        return;
      }
      return formatSelection(editor).catch(error => {
        const message = error instanceof Error ? error.message : String(error);
        vscode.window.showErrorMessage(message);
      });
    }),
    treeView.onDidChangeSelection(event => interaction.setSelection(event.selection)),
    vscode.workspace.onDidChangeConfiguration(event => {
      if (event.affectsConfiguration('dotnetSolutionNavigator')) {
        provider.refresh();
      }
      if (event.affectsConfiguration('dotnetSolutionNavigator.gitLog')) {
        gitLogProvider.configureAutoFetch();
      }
    }),
    vscode.window.onDidChangeActiveTextEditor(() => {
      const follow = vscode.workspace
        .getConfiguration('dotnetSolutionNavigator')
        .get<boolean>('alwaysSelectOpenedFile', false);
      if (follow && treeView.visible) {
        selectOpenedFile(provider, treeView, false).catch(error => console.error(error));
      }
    }),
    vscode.commands.registerCommand('dotnetSolutionNavigator.setStartupProject', async (node: TreeNode) => {
      const project = projectFromNode(node);
      if (!project) {
        return;
      }

      await provider.setStartupProject(project);
      vscode.window.showInformationMessage(`Startup project set to ${project.name}.`);
    })
  );

  provider.refresh();
  refreshStatusBar();
  updateRunningContext(processManager.hasRunningProcesses());
  registerWorkspaceFileWatcher(context, provider);
}

export async function deactivate(): Promise<void> {
  await activeProcessManager?.shutdown();
  activeProcessManager = undefined;
}

async function openItem(provider: DotnetTreeProvider, treeView: vscode.TreeView<TreeNode>, node: TreeNode): Promise<void> {
  if (!node.resourcePath) {
    return;
  }

  await vscode.window.showTextDocument(vscode.Uri.file(node.resourcePath), { preview: false, preserveFocus: true });
  await revealWithScrollPadding(provider, treeView, node);
}

async function openProjectFile(node: TreeNode): Promise<void> {
  const project = projectFromNode(node);
  if (!project) {
    return;
  }

  await vscode.window.showTextDocument(vscode.Uri.file(project.path), { preview: false });
}

async function selectOpenedFile(
  provider: DotnetTreeProvider,
  treeView: vscode.TreeView<TreeNode>,
  notifyNotFound: boolean
): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.uri.scheme !== 'file') {
    return;
  }

  const node = await provider.findNodeForFile(editor.document.uri.fsPath);
  if (!node) {
    if (notifyNotFound) {
      vscode.window.showInformationMessage('File is not in the solution tree.');
    }

    return;
  }

  await treeView.reveal(node, { select: true, focus: false, expand: true });
}

async function openSolutionFile(provider: DotnetTreeProvider): Promise<void> {
  const solutionPath = provider.getSolution()?.path;
  if (!solutionPath) {
    vscode.window.showInformationMessage('No .sln or .slnx file is active.');
    return;
  }

  await vscode.window.showTextDocument(vscode.Uri.file(solutionPath), { preview: false });
}

function openSolutionTerminal(provider: DotnetTreeProvider): void {
  const solution = provider.getSolution();
  if (!solution) {
    return;
  }

  openTerminalAt(solution.path ? path.dirname(solution.path) : solution.rootPath);
}

async function openSolutionTreeFind(): Promise<void> {
  await vscode.commands.executeCommand('dotnetSolutionNavigator.focus');
  await vscode.commands.executeCommand('list.find');
}

async function showHistoryForSelection(context: vscode.ExtensionContext): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.uri.scheme !== 'file') {
    vscode.window.showInformationMessage('Open a file and select a code range first.');
    return;
  }

  const selection = editor.selection;
  if (selection.isEmpty) {
    vscode.window.showInformationMessage('Select a code range first.');
    return;
  }

  let startLine = selection.start.line + 1;
  let endLine = selection.end.line + 1;
  if (selection.end.character === 0 && endLine > startLine) {
    endLine -= 1;
  }

  if (endLine < startLine) {
    [startLine, endLine] = [endLine, startLine];
  }

  const repoRoot = await findRepoRoot(editor.document.uri.fsPath);
  if (!repoRoot) {
    vscode.window.showInformationMessage('This file is not inside a Git repository.');
    return;
  }

  const relPath = toGitRelativePath(repoRoot, editor.document.uri.fsPath);
  const query = await resolveLineHistoryQuery(repoRoot, relPath, startLine, endLine);
  if (!query) {
    vscode.window.showInformationMessage('This selected range has not been committed yet.');
    return;
  }

  await runLineHistoryQuery(context, query);
}

async function resolveLineHistoryQuery(
  repoRoot: string,
  relPath: string,
  startLine: number,
  endLine: number
): Promise<LineHistoryQuery | undefined> {
  const dirty = await runGit(repoRoot, ['diff', '--quiet', '--', relPath]);
  if (dirty.exitCode === 0) {
    return { repoRoot, relPath, headStart: startLine, headEnd: endLine };
  }

  const diff = await runGit(repoRoot, ['diff', '--no-color', '-U0', '--', relPath]);
  if (diff.exitCode !== 0) {
    throw new Error(diff.stderr.trim() || 'git diff failed.');
  }

  const mapped = mapWorktreeRangeToHead(diff.stdout, startLine, endLine);
  return mapped ? { repoRoot, relPath, headStart: mapped.start, headEnd: mapped.end } : undefined;
}

async function runLineHistoryQuery(context: vscode.ExtensionContext, query: LineHistoryQuery): Promise<void> {
  const maxCommits = vscode.workspace
    .getConfiguration('dotnetSolutionNavigator')
    .get<number>('gitHistoryMaxCommits', 50);

  try {
    const entries = await vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      cancellable: true,
      title: 'Loading line history'
    }, (_progress, token) => getLineHistory(query, Math.max(1, maxCommits), token));

    if (entries.length === 0) {
      vscode.window.showInformationMessage('No commit touched this selected range.');
      return;
    }

    LineHistoryPanel.show(entries, lineHistoryLabel(query), context.extensionUri);
  } catch (error) {
    if (error instanceof GitOperationCancelledError) {
      return;
    }

    const message = error instanceof Error ? error.message : String(error);
    if (message.trim().length > 0) {
      vscode.window.showErrorMessage(message);
    }
  }
}

async function revealWithScrollPadding(
  provider: DotnetTreeProvider,
  treeView: vscode.TreeView<TreeNode>,
  node: TreeNode
): Promise<void> {
  const anchor = await findScrollPaddingAnchor(provider, node, 8);
  if (anchor) {
    await treeView.reveal(anchor, { select: false, focus: false, expand: false });
  }

  await treeView.reveal(node, { select: true, focus: true, expand: false });
}

async function findScrollPaddingAnchor(
  provider: DotnetTreeProvider,
  node: TreeNode,
  offset: number
): Promise<TreeNode | undefined> {
  const parent = await provider.getParent(node);
  if (!parent) {
    return undefined;
  }

  const siblings = flattenVisibleNodes(await provider.getChildren(parent));
  const index = siblings.findIndex(candidate => sameTreeResource(candidate, node));
  if (index < 0) {
    return undefined;
  }

  return siblings[Math.min(index + offset, siblings.length - 1)];
}

function flattenVisibleNodes(nodes: TreeNode[]): TreeNode[] {
  const result: TreeNode[] = [];
  for (const node of nodes) {
    result.push(node);
    if (node.children) {
      result.push(...flattenVisibleNodes(node.children));
    }
  }

  return result;
}

function sameTreeResource(a: TreeNode, b: TreeNode): boolean {
  if (a.resourcePath && b.resourcePath) {
    return path.resolve(a.resourcePath) === path.resolve(b.resourcePath);
  }

  return a.kind === b.kind && a.label === b.label && a.id === b.id && a.configId === b.configId;
}

async function runProjectCommand(processManager: ProcessManager, node: TreeNode, verb: 'build' | 'rebuild' | 'test' | 'clean'): Promise<void> {
  const project = projectFromNode(node);
  if (!project) {
    return;
  }

  await runDotnetForProject(project, verb, processManager);
}

async function buildFolderProjects(provider: DotnetTreeProvider, processManager: ProcessManager, node: TreeNode): Promise<void> {
  if (node.kind !== 'folder' || !node.resourcePath) return;
  if (!provider.getSolution()) await provider.refresh();
  const solution = provider.getSolution();
  if (!solution) {
    vscode.window.showInformationMessage('Open a .NET workspace before building folder projects.');
    return;
  }
  const projects = projectsUnderFolder(solution, node.resourcePath);
  if (!projects.length) {
    vscode.window.showInformationMessage(`No .csproj files were found under ${node.label}.`);
    return;
  }
  await runDotnetForProjects(projects, node.resourcePath, processManager);
}

async function runSolutionCommand(
  provider: DotnetTreeProvider,
  processManager: ProcessManager,
  operation: SolutionOperation
): Promise<void> {
  if (!provider.getSolution()) {
    await provider.refresh();
  }

  const solution = provider.getSolution();
  if (!solution) {
    vscode.window.showInformationMessage('Open a .NET workspace before running a solution operation.');
    return;
  }

  await runDotnetForSolution(solution, operation, processManager);
}

async function runOrDebugProject(processManager: ProcessManager, node: TreeNode, debug: boolean): Promise<void> {
  const project = projectFromNode(node);
  if (!project) {
    return;
  }

  if (!isRunnableProject(project)) {
    vscode.window.showInformationMessage(`${project.name} is not runnable. Use Build instead.`);
    return;
  }

  const profile = await pickProfile(project);
  if (profile === null) {
    return;
  }

  await startTarget(project, profile, { debug, processManager });
}

async function stopProject(processManager: ProcessManager, node: TreeNode): Promise<void> {
  const project = projectFromNode(node);
  if (!project) {
    return;
  }

  await processManager.stopProject(project);
}

function openTerminalHere(node: TreeNode): void {
  if (node.project) {
    openTerminalAt(node.project.directory);
    return;
  }

  if (node.resourcePath) {
    openTerminalAt(node.resourcePath);
  }
}

function projectFromNode(node: TreeNode): ProjectModel | undefined {
  if (node.kind === 'project') {
    return node.project;
  }

  return undefined;
}

async function toggleProjectFiles(provider: DotnetTreeProvider): Promise<void> {
  const configuration = vscode.workspace.getConfiguration('dotnetSolutionNavigator');
  const current = configuration.get<boolean>('showProjectFiles', true);

  await configuration.update('showProjectFiles', !current, vscode.ConfigurationTarget.Workspace);
  await provider.refresh();
  vscode.window.showInformationMessage(`Project files are now ${!current ? 'visible' : 'hidden'} in .NET Navigator.`);
}

async function toggleFileNesting(provider: DotnetTreeProvider): Promise<void> {
  const configuration = vscode.workspace.getConfiguration('dotnetSolutionNavigator');
  const current = configuration.get<boolean>('enableFileNesting', true);

  await configuration.update('enableFileNesting', !current, vscode.ConfigurationTarget.Workspace);
  await provider.refresh();
  vscode.window.showInformationMessage(`File nesting is now ${!current ? 'enabled' : 'disabled'} in .NET Navigator.`);
}

async function openNavigatorSettings(): Promise<void> {
  await vscode.commands.executeCommand('workbench.action.openSettings', '@ext:local-dev.rider-like-solution-navigator');
}

async function runSelectedFileCommand(
  interaction: ExplorerInteractionController,
  node: TreeNode | undefined,
  command: (selected: TreeNode) => Promise<void>
): Promise<void> {
  const selected = node ?? interaction.getSelection();
  if (!isMovableNode(selected)) {
    vscode.window.showInformationMessage('Select a file or folder in .NET Navigator first.');
    return;
  }

  await command(selected);
}

async function runSelectedResourceCommand(
  interaction: ExplorerInteractionController,
  node: TreeNode | undefined,
  command: (selected: TreeNode) => Promise<void>
): Promise<void> {
  const selected = node ?? interaction.getSelection();
  if (!selected?.resourcePath || !['file', 'folder', 'project'].includes(selected.kind)) {
    vscode.window.showInformationMessage('Select a file, folder, or project in .NET Navigator first.');
    return;
  }

  await command(selected);
}

function registerWorkspaceFileWatcher(context: vscode.ExtensionContext, provider: DotnetTreeProvider): void {
  const watcher = vscode.workspace.createFileSystemWatcher('**/*');
  let refreshTimer: NodeJS.Timeout | undefined;

  const scheduleRefresh = () => {
    if (refreshTimer) {
      clearTimeout(refreshTimer);
    }

    refreshTimer = setTimeout(() => {
      provider.refresh();
      refreshTimer = undefined;
    }, 250);
  };

  context.subscriptions.push(
    watcher,
    watcher.onDidCreate(scheduleRefresh),
    watcher.onDidDelete(scheduleRefresh),
    watcher.onDidChange(scheduleRefresh),
    { dispose: () => refreshTimer && clearTimeout(refreshTimer) }
  );
}

async function withActiveConfig(
  context: vscode.ExtensionContext,
  provider: DotnetTreeProvider,
  action: (config: RunConfig) => Promise<void>
): Promise<void> {
  const solution = provider.getSolution();
  if (!solution) {
    vscode.window.showInformationMessage('Open a .NET solution first.');
    return;
  }

  const active = runConfigStore.getActive(solution, context);
  if (!active) {
    vscode.window.showInformationMessage('No run configuration available.');
    return;
  }

  await action(active);
}

async function stopActiveConfig(
  context: vscode.ExtensionContext,
  provider: DotnetTreeProvider,
  processManager: ProcessManager
): Promise<void> {
  const solution = provider.getSolution();
  const active = solution ? runConfigStore.getActive(solution, context) : undefined;
  if (active) {
    await processManager.stopConfig(active.id);
  }
}

async function selectRunConfig(context: vscode.ExtensionContext, provider: DotnetTreeProvider): Promise<void> {
  const solution = provider.getSolution();
  if (!solution) {
    return;
  }

  const active = runConfigStore.getActive(solution, context);
  const items = runConfigStore.listConfigs(solution, context).map(config => ({
    label: `${config.id === active?.id ? '$(check) ' : ''}${config.label}`,
    description: config.kind,
    id: config.id
  }));

  if (items.length === 0) {
    vscode.window.showInformationMessage('No run configurations. Use + to add one.');
    return;
  }

  const picked = await vscode.window.showQuickPick(items, { title: 'Select Run Configuration' });

  if (!picked) {
    return;
  }

  await runConfigStore.setActive(context, picked.id);
  await provider.refresh();
}

async function addRunConfig(context: vscode.ExtensionContext, provider: DotnetTreeProvider): Promise<void> {
  const solution = provider.getSolution();
  if (!solution) {
    vscode.window.showInformationMessage('Open a .NET solution first.');
    return;
  }

  const addConfigurationId = 'addConfiguration';
  const newCompoundId = 'newCompound';
  const picked = await vscode.window.showQuickPick(
    [
      { label: '$(add) Add Configuration...', id: addConfigurationId },
      { label: '$(layers) New Compound...', id: newCompoundId }
    ],
    { title: 'Add Run Configuration' }
  );

  if (!picked) {
    return;
  }

  if (picked.id === newCompoundId) {
    await newCompound(context, provider);
    return;
  }

  await pickAddedSingleConfigs(context, provider);
}

async function pickAddedSingleConfigs(context: vscode.ExtensionContext, provider: DotnetTreeProvider): Promise<void> {
  const solution = provider.getSolution();
  if (!solution) {
    return;
  }

  const addedIds = new Set(runConfigStore.getAddedSingleIds(context));
  const items = runConfigStore.listSingles(solution).map(config => ({
    label: config.label,
    description: relativeProjectPath(solution, config.targets[0]?.projectPath),
    id: config.id,
    picked: addedIds.has(config.id)
  }));

  const picked = await vscode.window.showQuickPick(items, {
    title: 'Add Run Configurations',
    canPickMany: true,
    matchOnDescription: true
  });

  if (!picked) {
    return;
  }

  const validIds = new Set(items.map(item => item.id));
  await runConfigStore.setAddedSingleIds(context, picked.map(item => item.id).filter(id => validIds.has(id)));
  await provider.refresh();
}

async function removeRunConfig(context: vscode.ExtensionContext, provider: DotnetTreeProvider, node: TreeNode): Promise<void> {
  if (!node.configId) {
    return;
  }

  if (node.configId.startsWith('compound:')) {
    await runConfigStore.deleteCompound(context, node.configId);
  } else {
    await runConfigStore.removeAddedSingle(context, node.configId);
  }

  await provider.refresh();
}

async function renameRunConfig(context: vscode.ExtensionContext, provider: DotnetTreeProvider, node: TreeNode): Promise<void> {
  const solution = provider.getSolution();
  if (!solution || !node.configId) {
    return;
  }

  const config = runConfigStore.listConfigs(solution, context).find(candidate => candidate.id === node.configId);
  if (!config) {
    return;
  }

  const label = await vscode.window.showInputBox({
    title: 'Rename Run Configuration',
    prompt: 'Display name',
    value: config.label,
    validateInput: value => value.trim().length > 0 ? undefined : 'Name is required.'
  });

  if (label === undefined) {
    return;
  }

  await runConfigStore.renameConfig(context, config.id, label.trim());
  await provider.refresh();
}

async function newCompound(context: vscode.ExtensionContext, provider: DotnetTreeProvider): Promise<void> {
  const solution = provider.getSolution();
  if (!solution) {
    return;
  }

  const singles = runConfigStore.listSingles(solution);
  const picked = await vscode.window.showQuickPick(
    singles.map(config => ({ label: config.label, description: config.kind, config })),
    { title: 'New Compound Configuration', canPickMany: true }
  );

  if (!picked || picked.length === 0) {
    return;
  }

  const name = await vscode.window.showInputBox({
    title: 'New Compound Configuration',
    prompt: 'Compound name',
    validateInput: value => value.trim().length > 0 ? undefined : 'Name is required.'
  });

  if (!name) {
    return;
  }

  const config: RunConfig = {
    id: `compound:${name.trim()}`,
    label: name.trim(),
    kind: 'compound',
    targets: picked.flatMap(item => item.config.targets)
  };

  await runConfigStore.saveCompound(context, config);
  await runConfigStore.setActive(context, config.id);
  await provider.refresh();
}

async function deleteCompound(context: vscode.ExtensionContext, provider: DotnetTreeProvider): Promise<void> {
  const compounds = runConfigStore.getCompounds(context);
  if (compounds.length === 0) {
    vscode.window.showInformationMessage('No compound configurations to delete.');
    return;
  }

  const picked = await vscode.window.showQuickPick(
    compounds.map(config => ({ label: config.label, id: config.id })),
    { title: 'Delete Compound Configuration' }
  );

  if (!picked) {
    return;
  }

  await runConfigStore.deleteCompound(context, picked.id);
  await provider.refresh();
}

async function setActiveConfig(context: vscode.ExtensionContext, provider: DotnetTreeProvider, node: TreeNode): Promise<void> {
  if (!node.configId) {
    return;
  }

  await runConfigStore.setActive(context, node.configId);
  await provider.refresh();
}

async function runConfigNode(
  context: vscode.ExtensionContext,
  provider: DotnetTreeProvider,
  node: TreeNode,
  debug: boolean,
  processManager: ProcessManager
): Promise<void> {
  const solution = provider.getSolution();
  if (!solution || !node.configId) {
    return;
  }

  const config = runConfigStore.listConfigs(solution, context).find(candidate => candidate.id === node.configId);
  if (config) {
    await runConfig(solution, config, { debug, processManager });
  }
}

function relativeProjectPath(solution: SolutionModel, projectPath: string | undefined): string | undefined {
  if (!projectPath) {
    return undefined;
  }

  return path.relative(solution.rootPath, projectPath).replace(/\\/g, '/');
}
