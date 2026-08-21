import * as path from 'path';
import * as vscode from 'vscode';
import { addCodeItem, addExistingItem, addFile, addFolder, addNewItemInteractive } from './addCommands';
import { buildConfig, configuredBuildBeforeRunMode, pickProfile, runConfig, startTarget } from './debugRunner';
import { SolutionOperation, openTerminalAt, runDotnetForProject, runDotnetForProjects, runDotnetForSolution } from './dotnetCli';
import { projectsUnderFolder, projectsUnderSolutionFolder } from './folderBuild';
import { ExplorerInteractionController, isMovableNode } from './explorerInteraction';
import { copyFullPath, copyRelativePath, deleteItems, moveItems, renameItem, revealInFileExplorer } from './fileCommands';
import { formatDocument, formatSelection } from './format/formatSelection';
import { ProjectModel, RunConfig, SolutionModel, TreeNode } from './models';
import { isRunnableProject } from './projectCapabilities';
import { ProcessManager } from './processManager';
import { RunConfigTreeProvider } from './runConfigTreeProvider';
import * as runConfigStore from './runConfigStore';
import { createStatusBar, updateStatusBar } from './statusBar';
import { DotnetTreeProvider } from './treeProvider';
import { activateEfCore } from './ef/efMain';
import { addPackage, checkOutdated, removePackage, restorePackages, updatePackage } from './nugetCommands';
import { addProjectReference, removeProjectReference } from './projectReferenceCommands';
import {
  WorkspaceChange,
  WorkspaceFileEventKind,
  classifyWorkspaceChange
} from './workspaceChangeClassifier';
import { activateLocalHistory } from './localHistory/localHistoryMain';
import { showFeatureAnnouncements } from './featureAnnouncements';
import { createAttachConfiguration, listDotnetProcesses } from './processDiscovery';
import {
  openActiveSymbolActions,
  rescanUniversalSearchIndex,
  resolveProjectForFile,
  searchEverywhereInteractive,
  UniversalSymbolIndex,
  warmUpUniversalSearchIndex
} from './solutionSearch';

let activeProcessManager: ProcessManager | undefined;

export function activate(context: vscode.ExtensionContext): void {
  const provider = new DotnetTreeProvider(context);
  const processManager = new ProcessManager();
  const symbolIndex = new UniversalSymbolIndex();
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
  const treeView = vscode.window.createTreeView('dotnav', {
    treeDataProvider: provider,
    dragAndDropController: interaction,
    showCollapseAll: true,
    canSelectMany: true
  });
  const runConfigTreeView = vscode.window.createTreeView('dotnav.runConfigurations', {
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
      'dotnav.activeConfigBusy',
      Boolean(activeConfig && processManager.getActiveSessionForConfig(activeConfig.id))
    );
  };
  const updateRunningContext = (hasRunningProcesses: boolean) => {
    vscode.commands.executeCommand('setContext', 'dotnav.hasRunningProcesses', hasRunningProcesses);
    provider.fireChanged();
  };

  context.subscriptions.push(
    treeView,
    runConfigTreeView,
    processManager,
    ...statusItems,
    provider.onDidChangeTreeData(refreshStatusBar),
    processManager.onDidChangeRunningState(updateRunningContext),
    vscode.commands.registerCommand('dotnav.refresh', () => provider.refresh()),
    vscode.commands.registerCommand('dotnav.addPackage', (node: TreeNode) => addPackage(provider, node)),
    vscode.commands.registerCommand('dotnav.updatePackage', (node: TreeNode) => updatePackage(provider, node)),
    vscode.commands.registerCommand('dotnav.removePackage', (node: TreeNode) => removePackage(provider, node)),
    vscode.commands.registerCommand('dotnav.restorePackages', (node: TreeNode) => restorePackages(provider, node)),
    vscode.commands.registerCommand('dotnav.checkOutdated', (node?: TreeNode) =>
      checkOutdated(provider, node ?? { kind: 'solution', label: 'Solution' })),
    vscode.commands.registerCommand('dotnav.addProjectReference', (node: TreeNode) =>
      addProjectReference(provider, node)),
    vscode.commands.registerCommand('dotnav.removeProjectReference', (node: TreeNode) =>
      removeProjectReference(provider, node)),
    vscode.commands.registerCommand('dotnav.selectSolution', () => provider.selectActiveSolution()),
    vscode.commands.registerCommand('dotnav.selectOpenedFile', () => selectOpenedFile(provider, treeView, true)),
    vscode.commands.registerCommand('dotnav.searchSolutionTree', () => filterSolutionTree(provider)),
    vscode.commands.registerCommand('dotnav.clearSolutionTreeFilter', () => clearSolutionTreeFilter(provider)),
    vscode.commands.registerCommand('dotnav.searchEverywhere', () => searchEverywhereInteractive(provider, symbolIndex, '', context)),
    vscode.commands.registerCommand('dotnav.searchApiEndpoints', () => searchEverywhereInteractive(provider, symbolIndex, '/', context)),
    vscode.commands.registerCommand('dotnav.rescanSolutionSymbols', () => rescanUniversalSearchIndex(provider, symbolIndex, context, true)),
    vscode.commands.registerCommand('dotnav.openEndpointActions', openActiveSymbolActions),
    vscode.commands.registerCommand('dotnav.openSymbolActions', openActiveSymbolActions),
    vscode.commands.registerCommand('dotnav.openItem', (node: TreeNode) => openItem(provider, treeView, node)),
    vscode.commands.registerCommand('dotnav.openProjectFile', openProjectFile),
    vscode.commands.registerCommand('dotnav.openSolutionFile', () => openSolutionFile(provider)),
    vscode.commands.registerCommand('dotnav.openSolutionTerminal', () => openSolutionTerminal(provider)),
    vscode.commands.registerCommand('dotnav.buildProject', (node: TreeNode) => runProjectCommand(processManager, node, 'build')),
    vscode.commands.registerCommand('dotnav.buildFolderProjects', (node: TreeNode) => buildFolderProjects(provider, processManager, node)),
    vscode.commands.registerCommand('dotnav.rebuildProject', (node: TreeNode) => runProjectCommand(processManager, node, 'rebuild')),
    vscode.commands.registerCommand('dotnav.buildSolution', () => runSolutionCommand(provider, processManager, 'build')),
    vscode.commands.registerCommand('dotnav.rebuildSolution', () => runSolutionCommand(provider, processManager, 'rebuild')),
    vscode.commands.registerCommand('dotnav.cleanSolution', () => runSolutionCommand(provider, processManager, 'clean')),
    vscode.commands.registerCommand('dotnav.openWorkspaceFolder', () => vscode.commands.executeCommand('workbench.action.files.openFolder')),
    vscode.commands.registerCommand('dotnav.runProject', (node: TreeNode) => runOrDebugProject(provider, processManager, node, false)),
    vscode.commands.registerCommand('dotnav.debugProject', (node: TreeNode) => runOrDebugProject(provider, processManager, node, true)),
    vscode.commands.registerCommand('dotnav.testProject', (node: TreeNode) => testProject(provider, processManager, node)),
    vscode.commands.registerCommand('dotnav.cleanProject', (node: TreeNode) => runProjectCommand(processManager, node, 'clean')),
    vscode.commands.registerCommand('dotnav.stopProject', (node: TreeNode) => stopProject(processManager, node)),
    vscode.commands.registerCommand('dotnav.stopAll', () => processManager.stopAll()),
    vscode.commands.registerCommand('dotnav.stopActiveConfig', () => stopActiveConfig(context, provider, processManager)),
    vscode.commands.registerCommand('dotnav.showRunOutput', () => processManager.showOutput()),
    vscode.commands.registerCommand('dotnav.stopConfigNode', (node: TreeNode) => node.configId ? processManager.stopConfig(node.configId) : undefined),
    vscode.commands.registerCommand('dotnav.openTerminalHere', openTerminalHere),
    vscode.commands.registerCommand('dotnav.toggleProjectFiles', () => toggleProjectFiles(provider)),
    vscode.commands.registerCommand('dotnav.toggleFileNesting', () => toggleFileNesting(provider)),
    vscode.commands.registerCommand('dotnav.openSettings', () => openNavigatorSettings()),
    vscode.commands.registerCommand('dotnav.addClass', (node: TreeNode) => addCodeItem(provider, node, 'class')),
    vscode.commands.registerCommand('dotnav.addInterface', (node: TreeNode) => addCodeItem(provider, node, 'interface')),
    vscode.commands.registerCommand('dotnav.addRecord', (node: TreeNode) => addCodeItem(provider, node, 'record')),
    vscode.commands.registerCommand('dotnav.addRecordStruct', (node: TreeNode) => addCodeItem(provider, node, 'recordStruct')),
    vscode.commands.registerCommand('dotnav.addStruct', (node: TreeNode) => addCodeItem(provider, node, 'struct')),
    vscode.commands.registerCommand('dotnav.addEnum', (node: TreeNode) => addCodeItem(provider, node, 'enum')),
    vscode.commands.registerCommand('dotnav.addController', (node: TreeNode) => addCodeItem(provider, node, 'controller')),
    vscode.commands.registerCommand('dotnav.addException', (node: TreeNode) => addCodeItem(provider, node, 'exception')),
    vscode.commands.registerCommand('dotnav.addNewItem', (node?: TreeNode) => addNewItemInteractive(provider, node)),
    vscode.commands.registerCommand('dotnav.addFile', (node: TreeNode) => addFile(provider, node)),
    vscode.commands.registerCommand('dotnav.addFolder', (node: TreeNode) => addFolder(provider, node)),
    vscode.commands.registerCommand('dotnav.addExistingItem', (node: TreeNode) => addExistingItem(provider, node)),
    vscode.commands.registerCommand('dotnav.renameItem', (node?: TreeNode, allSelected?: TreeNode[]) => runSelectedFileCommand(interaction, node, allSelected, async selected => {
      if (selected.length > 1) {
        vscode.window.showInformationMessage('Select a single file or folder to rename.');
        return;
      }
      await renameItem(provider, selected[0]);
    })),
    vscode.commands.registerCommand('dotnav.moveItem', (node?: TreeNode, allSelected?: TreeNode[]) => runSelectedFileCommand(interaction, node, allSelected, selected => moveItems(provider, selected))),
    vscode.commands.registerCommand('dotnav.deleteItem', (node?: TreeNode, allSelected?: TreeNode[]) => runSelectedFileCommand(interaction, node, allSelected, selected => deleteItems(provider, selected))),
    vscode.commands.registerCommand('dotnav.copyPath', (node?: TreeNode, allSelected?: TreeNode[]) => runSelectedResourceCommand(interaction, node, allSelected, copyFullPath)),
    vscode.commands.registerCommand('dotnav.copyRelativePath', (node?: TreeNode, allSelected?: TreeNode[]) => runSelectedResourceCommand(interaction, node, allSelected, copyRelativePath)),
    vscode.commands.registerCommand('dotnav.revealInOs', (node?: TreeNode, allSelected?: TreeNode[]) => runSelectedResourceCommand(interaction, node, allSelected, revealInFileExplorer)),
    vscode.commands.registerCommand('dotnav.addRunConfig', () => addRunConfig(context, provider)),
    vscode.commands.registerCommand('dotnav.editRunConfigProjects', (node: TreeNode) => editRunConfigProjects(context, provider, node)),
    vscode.commands.registerCommand('dotnav.renameRunConfig', (node: TreeNode) => renameRunConfig(context, provider, node)),
    vscode.commands.registerCommand('dotnav.removeRunConfig', (node: TreeNode) => removeRunConfig(context, provider, node)),
    vscode.commands.registerCommand('dotnav.selectRunConfig', () => selectRunConfig(context, provider)),
    vscode.commands.registerCommand('dotnav.attachProcess', () => attachProcessCommand(provider)),
    vscode.commands.registerCommand('dotnav.newCompound', () => newCompound(context, provider)),
    vscode.commands.registerCommand('dotnav.deleteCompound', () => deleteCompound(context, provider)),
    vscode.commands.registerCommand('dotnav.setActiveConfig', (node: TreeNode) => setActiveConfig(context, provider, node)),
    vscode.commands.registerCommand('dotnav.runActiveConfig', () => withActiveConfig(context, provider, config => runConfiguredConfig(provider.getSolution()!, config, false, processManager))),
    vscode.commands.registerCommand('dotnav.debugActiveConfig', () => withActiveConfig(context, provider, config => runConfiguredConfig(provider.getSolution()!, config, true, processManager))),
    vscode.commands.registerCommand('dotnav.buildActiveConfig', () => withActiveConfig(context, provider, config => buildConfig(provider.getSolution()!, config, processManager))),
    vscode.commands.registerCommand('dotnav.runConfigNode', (node: TreeNode) => runConfigNode(context, provider, node, false, processManager)),
    vscode.commands.registerCommand('dotnav.debugConfigNode', (node: TreeNode) => runConfigNode(context, provider, node, true, processManager)),
    vscode.commands.registerCommand('dotnav.formatSelection', () => {
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
    vscode.commands.registerCommand('dotnav.formatDocument', () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showInformationMessage('Open a C# file before formatting the document.');
        return;
      }
      return formatDocument(editor).catch(error => {
        const message = error instanceof Error ? error.message : String(error);
        vscode.window.showErrorMessage(message);
      });
    }),
    treeView.onDidChangeSelection(event => interaction.setSelection(event.selection)),
    vscode.workspace.onDidChangeConfiguration(event => {
      if (event.affectsConfiguration('dotnav')) {
        provider.refresh();
      }
    }),
    vscode.window.onDidChangeActiveTextEditor(() => {
      const follow = vscode.workspace
        .getConfiguration('dotnav')
        .get<boolean>('alwaysSelectOpenedFile', false);
      if (follow && treeView.visible) {
        selectOpenedFile(provider, treeView, false).catch(error => console.error(error));
      }
    }),
    vscode.commands.registerCommand('dotnav.setStartupProject', async (node: TreeNode) => {
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
  registerWorkspaceFileWatcher(context, provider, symbolIndex);
  activateLocalHistory(context);
  activateEfCore(context, provider, processManager);
  void showFeatureAnnouncements(context);
  setTimeout(() => {
    void warmUpUniversalSearchIndex(provider, symbolIndex, context);
  }, 1200);
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
  await treeView.reveal(node, { select: true, focus: false, expand: false });
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

  let node = await provider.findNodeForFile(editor.document.uri.fsPath);
  if (!node && provider.getTreeFilter()) {
    provider.clearTreeFilter();
    node = await provider.findNodeForFile(editor.document.uri.fsPath);
  }

  if (!node) {
    if (notifyNotFound) {
      vscode.window.showInformationMessage('File is not in the solution tree.');
    }

    return;
  }

  await revealWithScrollPadding(provider, treeView, node);
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

async function filterSolutionTree(provider: DotnetTreeProvider): Promise<void> {
  const current = provider.getTreeFilter() || '';
  const result = await vscode.window.showInputBox({
    title: 'Filter Solution Tree',
    prompt: 'Filter projects, folders, and files across the solution (plain text)',
    value: current,
    valueSelection: [0, current.length],
    placeHolder: 'e.g. Services, CustomApp, RecordAppearance, Domain...',
    validateInput: () => null
  });

  if (result === undefined) {
    return;
  }

  provider.setTreeFilter(result);
}

function clearSolutionTreeFilter(provider: DotnetTreeProvider): void {
  provider.clearTreeFilter();
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

async function testProject(
  provider: DotnetTreeProvider,
  processManager: ProcessManager,
  node: TreeNode
): Promise<void> {
  const project = projectFromNode(node);
  if (!project) return;
  const mode = configuredBuildBeforeRunMode();
  await runDotnetForProject(project, 'test', processManager, { noBuild: mode === 'none' });
}

async function buildFolderProjects(provider: DotnetTreeProvider, processManager: ProcessManager, node: TreeNode): Promise<void> {
  if (node.kind !== 'folder') {
    vscode.window.showInformationMessage('Select a folder in Solution Navigator before building folder projects.');
    return;
  }
  if (!provider.getSolution()) await provider.refresh();
  const solution = provider.getSolution();
  if (!solution) {
    vscode.window.showInformationMessage('Open a .NET workspace before building folder projects.');
    return;
  }
  const logicalPath = node.id?.startsWith('folder:')
    ? node.id.slice('folder:'.length).split('/').filter(Boolean)
    : undefined;
  if (!logicalPath && !node.resourcePath) {
    vscode.window.showInformationMessage(`Unable to resolve folder ${node.label}. Refresh Solution Navigator and try again.`);
    return;
  }
  const projects = logicalPath
    ? projectsUnderSolutionFolder(solution, logicalPath)
    : projectsUnderFolder(solution, node.resourcePath!);
  if (!projects.length) {
    vscode.window.showInformationMessage(`No projects were found under ${node.label}.`);
    return;
  }
  const loadedProjects = await provider.ensureProjectMetadataForProjects(projects);
  await runDotnetForProjects(loadedProjects, node.resourcePath ?? solution.rootPath, processManager, node.label);
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

async function runOrDebugProject(
  provider: DotnetTreeProvider,
  processManager: ProcessManager,
  node: TreeNode,
  debug: boolean
): Promise<void> {
  const projectNode = projectFromNode(node);
  if (!projectNode) {
    return;
  }

  const project = await provider.ensureProjectMetadata(projectNode);
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
  const configuration = vscode.workspace.getConfiguration('dotnav');
  const current = configuration.get<boolean>('showProjectFiles', true);

  await configuration.update('showProjectFiles', !current, vscode.ConfigurationTarget.Workspace);
  await provider.refresh();
  vscode.window.showInformationMessage(`Project files are now ${!current ? 'visible' : 'hidden'} in .NET Navigator.`);
}

async function toggleFileNesting(provider: DotnetTreeProvider): Promise<void> {
  const configuration = vscode.workspace.getConfiguration('dotnav');
  const current = configuration.get<boolean>('enableFileNesting', true);

  await configuration.update('enableFileNesting', !current, vscode.ConfigurationTarget.Workspace);
  await provider.refresh();
  vscode.window.showInformationMessage(`File nesting is now ${!current ? 'enabled' : 'disabled'} in .NET Navigator.`);
}

async function openNavigatorSettings(): Promise<void> {
  await vscode.commands.executeCommand('workbench.action.openSettings', '@ext:tuna-ex.dotnav');
}

function resolveSelectedNodes(
  interaction: ExplorerInteractionController,
  node: TreeNode | undefined,
  allSelected: TreeNode[] | undefined
): TreeNode[] {
  if (allSelected && allSelected.length > 0) {
    return allSelected;
  }

  if (node) {
    return [node];
  }

  return interaction.getSelection().slice();
}

async function runSelectedFileCommand(
  interaction: ExplorerInteractionController,
  node: TreeNode | undefined,
  allSelected: TreeNode[] | undefined,
  command: (selected: TreeNode[]) => Promise<void>
): Promise<void> {
  const selected = resolveSelectedNodes(interaction, node, allSelected).filter(isMovableNode);
  if (selected.length === 0) {
    vscode.window.showInformationMessage('Select a file or folder in .NET Navigator first.');
    return;
  }

  await command(selected);
}

async function runSelectedResourceCommand(
  interaction: ExplorerInteractionController,
  node: TreeNode | undefined,
  allSelected: TreeNode[] | undefined,
  command: (selected: TreeNode[]) => Promise<void>
): Promise<void> {
  const selected = resolveSelectedNodes(interaction, node, allSelected)
    .filter(candidate => candidate.resourcePath && ['file', 'folder', 'project'].includes(candidate.kind));
  if (selected.length === 0) {
    vscode.window.showInformationMessage('Select a file, folder, or project in .NET Navigator first.');
    return;
  }

  await command(selected);
}

function registerWorkspaceFileWatcher(
  context: vscode.ExtensionContext,
  provider: DotnetTreeProvider,
  symbolIndex: UniversalSymbolIndex
): void {
  const watcher = vscode.workspace.createFileSystemWatcher('**/*');
  let refreshTimer: NodeJS.Timeout | undefined;
  const pending = new Map<string, WorkspaceChange>();
  const pendingCsFiles = new Map<string, WorkspaceFileEventKind>();

  const isRelevantSymbolFile = (fsPath: string) => {
    return (
      (fsPath.endsWith('.cs') && !fsPath.includes('/bin/') && !fsPath.includes('/obj/')) ||
      path.basename(fsPath).startsWith('appsettings') ||
      fsPath.endsWith('.csproj')
    );
  };

  const flush = async () => {
    const changes = [...pending.values()];
    const csChanges = [...pendingCsFiles.entries()];
    pending.clear();
    pendingCsFiles.clear();
    refreshTimer = undefined;

    if (changes.some(item => item.kind === 'solution')) {
      symbolIndex.clear();
      await provider.refresh();
      void warmUpUniversalSearchIndex(provider, symbolIndex, context, true);
      return;
    }

    // Process file changes for UniversalSymbolIndex
    if (csChanges.length > 25) {
      symbolIndex.clear();
      void warmUpUniversalSearchIndex(provider, symbolIndex, context, true);
    } else if (csChanges.length > 0) {
      const solution = provider.getSolution();
      const projects = solution?.projects;

      await Promise.all(
        csChanges.map(async ([fsPath, eventKind]) => {
          if (eventKind === 'delete') {
            symbolIndex.invalidateFile(fsPath);
          } else {
            const projectName = resolveProjectForFile(fsPath, projects);
            const relPath = vscode.workspace.asRelativePath(fsPath);
            await symbolIndex.scanFile(fsPath, projectName, relPath);
          }
        })
      );
    }

    for (const item of changes.filter(candidate => candidate.kind === 'projectMetadata')) {
      if (!provider.invalidateProjectMetadata(item.filePath)) {
        await provider.refresh();
        return;
      }
    }
    const directories = new Set(changes
      .filter(candidate => candidate.kind === 'directory')
      .map(candidate => candidate.directoryPath)
      .filter((value): value is string => Boolean(value)));
    for (const directory of directories) {
      provider.invalidateDirectory(directory);
    }
  };

  const scheduleRefresh = (uri: vscode.Uri, eventKind: WorkspaceFileEventKind) => {
    if (isRelevantSymbolFile(uri.fsPath)) {
      pendingCsFiles.set(uri.fsPath, eventKind);
    }

    const change = classifyWorkspaceChange(uri.fsPath, eventKind);
    if (change.kind === 'ignored') {
      if (isRelevantSymbolFile(uri.fsPath)) {
        if (refreshTimer) {
          clearTimeout(refreshTimer);
        }
        refreshTimer = setTimeout(() => {
          void flush().catch(error => console.error(`DotNav workspace refresh failed: ${error}`));
        }, 250);
      }
      return;
    }

    pending.set(uri.fsPath, change);
    if (refreshTimer) {
      clearTimeout(refreshTimer);
    }

    refreshTimer = setTimeout(() => {
      void flush().catch(error => console.error(`DotNav workspace refresh failed: ${error}`));
    }, 250);
  };

  // Git branch checkout / switch watcher
  const gitWatcher = vscode.workspace.createFileSystemWatcher('**/.git/{HEAD,refs/heads/**,index}');
  let gitDebounceTimer: NodeJS.Timeout | undefined;
  const onGitStateChanged = () => {
    if (gitDebounceTimer) {
      clearTimeout(gitDebounceTimer);
    }
    gitDebounceTimer = setTimeout(() => {
      gitDebounceTimer = undefined;
      void warmUpUniversalSearchIndex(provider, symbolIndex, context, true).catch(err =>
        console.warn(`[DotNav] Auto re-scan on git event failed: ${err}`)
      );
    }, 350);
  };

  context.subscriptions.push(
    gitWatcher,
    gitWatcher.onDidChange(onGitStateChanged),
    gitWatcher.onDidCreate(onGitStateChanged),
    gitWatcher.onDidDelete(onGitStateChanged),
    { dispose: () => gitDebounceTimer && clearTimeout(gitDebounceTimer) }
  );

  try {
    const gitExt = vscode.extensions.getExtension('vscode.git')?.exports;
    const gitApi = gitExt?.getAPI?.(1);
    if (gitApi) {
      if (typeof gitApi.onDidChangeState === 'function') {
        context.subscriptions.push(gitApi.onDidChangeState(() => onGitStateChanged()));
      }
      if (gitApi.repositories) {
        for (const repo of gitApi.repositories) {
          if (repo.state && typeof repo.state.onDidChange === 'function') {
            context.subscriptions.push(repo.state.onDidChange(() => onGitStateChanged()));
          }
        }
      }
      if (typeof gitApi.onDidOpenRepository === 'function') {
        context.subscriptions.push(
          gitApi.onDidOpenRepository((repo: any) => {
            if (repo?.state && typeof repo.state.onDidChange === 'function') {
              context.subscriptions.push(repo.state.onDidChange(() => onGitStateChanged()));
            }
          })
        );
      }
    }
  } catch {
    // Ignore if git extension is unavailable
  }

  context.subscriptions.push(
    watcher,
    watcher.onDidCreate(uri => scheduleRefresh(uri, 'create')),
    watcher.onDidDelete(uri => scheduleRefresh(uri, 'delete')),
    watcher.onDidChange(uri => scheduleRefresh(uri, 'change')),
    vscode.workspace.onDidSaveTextDocument(doc => {
      if (doc.uri.scheme === 'file' && isRelevantSymbolFile(doc.uri.fsPath)) {
        const solution = provider.getSolution();
        const projects = solution?.projects;
        const projectName = resolveProjectForFile(doc.uri.fsPath, projects);
        const relPath = vscode.workspace.asRelativePath(doc.uri.fsPath);
        symbolIndex.scanFileContent(doc.uri.fsPath, doc.getText(), projectName, relPath);
      }
    }),
    vscode.workspace.onDidRenameFiles(event => {
      const solution = provider.getSolution();
      const projects = solution?.projects;
      for (const file of event.files) {
        if (isRelevantSymbolFile(file.oldUri.fsPath)) {
          symbolIndex.invalidateFile(file.oldUri.fsPath);
        }
        if (isRelevantSymbolFile(file.newUri.fsPath)) {
          const projectName = resolveProjectForFile(file.newUri.fsPath, projects);
          const relPath = vscode.workspace.asRelativePath(file.newUri.fsPath);
          void symbolIndex.scanFile(file.newUri.fsPath, projectName, relPath);
        }
      }
    }),
    { dispose: () => refreshTimer && clearTimeout(refreshTimer) }
  );
}

async function withActiveConfig(
  context: vscode.ExtensionContext,
  provider: DotnetTreeProvider,
  action: (config: RunConfig) => Promise<void>
): Promise<void> {
  await provider.ensureAllProjectMetadata();
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
  await provider.ensureAllProjectMetadata();
  const solution = provider.getSolution();
  if (!solution) {
    return;
  }

  const active = runConfigStore.getActive(solution, context);
  const savedConfigs = runConfigStore.listConfigs(solution, context);
  const allSingles = runConfigStore.listSingles(solution);

  interface ConfigPickItem extends vscode.QuickPickItem {
    id?: string;
    action?: 'add' | 'compound' | 'attach';
  }

  const items: ConfigPickItem[] = [];

  if (savedConfigs.length > 0) {
    for (const config of savedConfigs) {
      items.push({
        label: `${config.id === active?.id ? '$(check) ' : ''}${config.label}`,
        description: config.kind === 'compound' ? 'Compound Configuration' : 'Run Configuration',
        id: config.id
      });
    }
    items.push({ label: 'Available Projects & Profiles', kind: vscode.QuickPickItemKind.Separator });
  }

  const savedIds = new Set(savedConfigs.map(c => c.id));
  for (const single of allSingles) {
    if (!savedIds.has(single.id)) {
      items.push({
        label: `${single.id === active?.id ? '$(check) ' : ''}${single.label}`,
        description: 'Single Project',
        id: single.id
      });
    }
  }

  items.push({ label: 'Actions', kind: vscode.QuickPickItemKind.Separator });
  items.push({
    label: '$(debug-disconnect) Attach Debugger to .NET Process...',
    description: 'Attach to a running process in this workspace',
    action: 'attach'
  });
  items.push({
    label: '$(add) Add Compound Configuration...',
    description: 'Run multiple projects together',
    action: 'compound'
  });

  const picked = await vscode.window.showQuickPick(items, {
    title: 'Select Active Run Configuration or Profile',
    placeHolder: `Current: ${active?.label ?? 'None'}`
  });

  if (!picked) {
    return;
  }

  if (picked.action === 'attach') {
    await attachProcessCommand(provider);
    return;
  }
  if (picked.action === 'compound') {
    await newCompound(context, provider);
    return;
  }

  if (picked.id) {
    await runConfigStore.setActive(context, picked.id);
    await provider.refresh();
  }
}

async function attachProcessCommand(provider: DotnetTreeProvider): Promise<void> {
  const solution = provider.getSolution();
  const processes = await listDotnetProcesses(solution);

  if (processes.length === 0) {
    vscode.window.showInformationMessage('No running .NET processes found.');
    return;
  }

  interface ProcessPickItem extends vscode.QuickPickItem {
    pid: number;
    procLabel: string;
  }

  const items: ProcessPickItem[] = processes.map(p => ({
    label: p.label,
    description: p.description,
    detail: p.detail,
    pid: p.pid,
    procLabel: p.matchingProject?.name ?? p.label
  }));

  const picked = await vscode.window.showQuickPick(items, {
    title: 'Attach Debugger to .NET Process',
    placeHolder: 'Select a running .NET process to debug'
  });

  if (!picked) {
    return;
  }

  const config = createAttachConfiguration(picked.pid, picked.procLabel);
  const attached = await vscode.debug.startDebugging(vscode.workspace.workspaceFolders?.[0], config);
  if (!attached) {
    vscode.window.showErrorMessage(`Could not attach debugger to process ${picked.pid}.`);
  }
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
  await provider.ensureAllProjectMetadata();
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

async function editRunConfigProjects(
  context: vscode.ExtensionContext,
  provider: DotnetTreeProvider,
  node: TreeNode
): Promise<void> {
  await provider.ensureAllProjectMetadata();
  const solution = provider.getSolution();
  if (!solution || !node.configId) {
    return;
  }

  const config = runConfigStore.listConfigs(solution, context)
    .find(candidate => candidate.id === node.configId);
  if (!config || config.kind !== 'compound') {
    return;
  }

  const singles = runConfigStore.listSingles(solution);
  const items = singles.map(single => ({
    label: single.label,
    description: relativeProjectPath(solution, single.targets[0]?.projectPath),
    config: single,
    picked: config.targets.some(target =>
      target.projectPath === single.targets[0]?.projectPath &&
      target.profileName === single.targets[0]?.profileName)
  }));

  const picked = await vscode.window.showQuickPick(items, {
    title: 'Edit Selected Projects',
    canPickMany: true,
    matchOnDescription: true
  });

  if (!picked) {
    return;
  }

  if (picked.length === 0) {
    vscode.window.showWarningMessage('Select at least one project for this run configuration.');
    return;
  }

  await runConfigStore.saveCompound(context, {
    ...config,
    targets: picked.flatMap(item => item.config.targets)
  });
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
  await provider.ensureAllProjectMetadata();
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
  await provider.ensureAllProjectMetadata();
  const solution = provider.getSolution();
  if (!solution || !node.configId) {
    return;
  }

  const config = runConfigStore.listConfigs(solution, context).find(candidate => candidate.id === node.configId);
  if (config) {
    await runConfiguredConfig(solution, config, debug, processManager);
  }
}

async function runConfiguredConfig(
  solution: SolutionModel,
  config: RunConfig,
  debug: boolean,
  processManager: ProcessManager
): Promise<void> {
  const buildMode = configuredBuildBeforeRunMode();
  await runConfig(solution, config, {
    debug,
    processManager,
    buildMode
  });
}

function relativeProjectPath(solution: SolutionModel, projectPath: string | undefined): string | undefined {
  if (!projectPath) {
    return undefined;
  }

  return path.relative(solution.rootPath, projectPath).replace(/\\/g, '/');
}
