import * as path from 'path';
import * as fs from 'fs';
import * as vscode from 'vscode';
import { isInside, readDirectoryNodes, readDockerProjectNodes } from './fileTree';
import { ProjectModel, SolutionModel, TreeNode } from './models';
import { samePath } from './pathUtils';
import { isRunnableProject, isTestProject } from './projectCapabilities';
import * as runConfigStore from './runConfigStore';
import { RunPhase } from './runSessionState';
import { loadSolution, pickSolution } from './solutionParser';

const activeSolutionPathKey = 'activeSolutionPath';

interface ConfigRunSummary {
  readonly phase: RunPhase;
  readonly busy: boolean;
}

export class DotnetTreeProvider implements vscode.TreeDataProvider<TreeNode> {
  private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<TreeNode | undefined | null | void>();
  readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;

  private solution?: SolutionModel;
  private solutionTree?: TreeNode[];
  private loading?: Promise<void>;
  private startupProjectPath?: string;
  private projectStateProvider?: (project: ProjectModel) => RunPhase | undefined;
  private configStateProvider?: (configId: string) => ConfigRunSummary | undefined;

  constructor(private readonly context: vscode.ExtensionContext) {
    this.startupProjectPath = context.workspaceState.get<string>('startupProjectPath');
  }

  async refresh(): Promise<void> {
    if (!this.loading) {
      this.loading = this.loadWorkspaceSolution().finally(() => {
        this.loading = undefined;
      });
    }

    await this.loading;
  }

  private async loadWorkspaceSolution(): Promise<void> {
    this.solutionTree = undefined;
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      this.solution = undefined;
      this.onDidChangeTreeDataEmitter.fire();
      return;
    }

    this.solution = await loadSolution(workspaceFolder, this.context.workspaceState.get<string>(activeSolutionPathKey));
    if (this.solution.path) {
      await this.context.workspaceState.update(activeSolutionPathKey, this.solution.path);
    }

    this.onDidChangeTreeDataEmitter.fire();
  }

  getSolution(): SolutionModel | undefined {
    return this.solution;
  }

  setRunStateProvider(
    projectProvider: (project: ProjectModel) => RunPhase | undefined,
    configProvider: (configId: string) => ConfigRunSummary | undefined
  ): void {
    this.projectStateProvider = projectProvider;
    this.configStateProvider = configProvider;
  }

  fireChanged(): void {
    this.onDidChangeTreeDataEmitter.fire();
  }

  getTreeItem(node: TreeNode): vscode.TreeItem {
    const item = new vscode.TreeItem(node.label, node.collapsibleState ?? getDefaultCollapsibleState(node));
    item.id = this.nodeId(node);
    item.contextValue = this.contextValueFor(node);
    item.resourceUri = node.resourcePath && node.kind !== 'project'
      ? vscode.Uri.file(node.resourcePath)
      : undefined;
    item.tooltip = this.tooltipFor(node);
    item.description = this.descriptionFor(node);
    item.iconPath = this.iconFor(node);

    if (node.kind === 'file') {
      item.command = {
        command: 'dotnav.openItem',
        title: 'Open',
        arguments: [node]
      };
    }

    if (node.kind === 'runConfig') {
      item.command = {
        command: 'dotnav.setActiveConfig',
        title: 'Set as Active',
        arguments: [node]
      };
    }

    return item;
  }

  async getChildren(node?: TreeNode): Promise<TreeNode[]> {
    if (!this.solution) {
      await this.refresh();
    }

    if (!this.solution) {
      return [];
    }

    if (!this.solution.path && this.solution.projects.length === 0) {
      return [];
    }

    if (!node) {
      return [this.solutionNode(this.solution)];
    }

    if (node.kind === 'solution') {
      return this.getSolutionTree();
    }

    if (node.children) {
      return node.children;
    }

    if (node.kind === 'project' && node.project) {
      const nodes: TreeNode[] = [];
      if (node.project.kind === 'docker') {
        nodes.push(...await readDockerProjectNodes(node.project));
        return nodes;
      }

      if (vscode.workspace.getConfiguration('dotnav').get<boolean>('showDependencies', true)) {
        nodes.push(this.dependenciesNode(node.project));
      }

      nodes.push(...await readDirectoryNodes(node.project.directory, node.project.directory, node.project));
      return nodes;
    }

    if (node.kind === 'dependencies' && node.project) {
      const groups: TreeNode[] = [];

      if (node.project.projectReferences.length > 0) {
        groups.push({
          kind: 'projectReferences',
          label: 'Projects',
          project: node.project,
          collapsibleState: vscode.TreeItemCollapsibleState.Collapsed
        });
      }

      if (node.project.packageReferences.length > 0) {
        groups.push({
          kind: 'packageReferences',
          label: 'Packages',
          project: node.project,
          collapsibleState: vscode.TreeItemCollapsibleState.Collapsed
        });
      }

      return groups;
    }

    if (node.kind === 'projectReferences' && node.project) {
      return node.project.projectReferences.map(reference => ({
        kind: 'projectReference',
        label: reference.name,
        resourcePath: reference.path,
        project: node.project,
        collapsibleState: vscode.TreeItemCollapsibleState.None
      }));
    }

    if (node.kind === 'packageReferences' && node.project) {
      return node.project.packageReferences.map(reference => ({
        kind: 'packageReference',
        label: reference.version ? `${reference.name} ${reference.version}` : reference.name,
        project: node.project,
        collapsibleState: vscode.TreeItemCollapsibleState.None
      }));
    }

    if (node.kind === 'folder' && node.resourcePath && node.project) {
      return readDirectoryNodes(node.resourcePath, node.project.directory, node.project);
    }

    if (node.kind === 'folder' && node.resourcePath) {
      return readDirectoryNodes(node.resourcePath, node.resourcePath);
    }

    return [];
  }

  async setStartupProject(project: ProjectModel): Promise<void> {
    this.startupProjectPath = project.path;
    await this.context.workspaceState.update('startupProjectPath', project.path);
    this.onDidChangeTreeDataEmitter.fire();
  }

  async selectActiveSolution(): Promise<void> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      vscode.window.showInformationMessage('Open a workspace folder to select a .NET solution.');
      return;
    }

    const picked = await pickSolution(workspaceFolder, this.solution?.path);
    if (!picked) {
      return;
    }

    await this.context.workspaceState.update(activeSolutionPathKey, picked.fsPath);
    await this.refresh();
  }

  async findNodeForFile(filePath: string): Promise<TreeNode | undefined> {
    if (!this.solution) {
      await this.refresh();
    }

    if (!this.solution) {
      return undefined;
    }

    const project = this.findProjectContaining(filePath);
    if (!project) {
      return undefined;
    }

    return this.findProjectFileNode(project, filePath);
  }

  async getParent(node: TreeNode): Promise<TreeNode | undefined> {
    if (!this.solution) {
      await this.refresh();
    }

    if (!this.solution) {
      return undefined;
    }

    switch (node.kind) {
      case 'solution':
      case 'runConfigs':
      case 'message':
        return undefined;
      case 'runConfig':
        return undefined;
      case 'project':
        return node.project ? this.parentForProject(node.project) : undefined;
      case 'folder':
        if (node.id?.startsWith('folder:')) {
          return this.parentForSolutionFolder(node.id);
        }

        return this.parentForFileSystemNode(node);
      case 'file':
        return this.parentForFileSystemNode(node);
      default:
        return this.parentForAuxiliaryNode(node);
    }
  }

  private solutionNode(solution: SolutionModel): TreeNode {
    const solutionName = solution.path ? path.basename(solution.path, path.extname(solution.path)) : solution.name;

    return {
      kind: 'solution',
      label: solutionName,
      resourcePath: solution.path,
      collapsibleState: vscode.TreeItemCollapsibleState.Expanded
    };
  }

  private projectNode(project: ProjectModel): TreeNode {
    return {
      kind: 'project',
      label: project.name,
      resourcePath: project.path,
      project,
      collapsibleState: vscode.TreeItemCollapsibleState.Collapsed
    };
  }

  private dependenciesNode(project: ProjectModel): TreeNode {
    const dependencyCount = project.projectReferences.length + project.packageReferences.length;

    return {
      kind: 'dependencies',
      label: dependencyCount > 0 ? `Dependencies (${dependencyCount})` : 'Dependencies',
      project,
      collapsibleState: dependencyCount > 0
        ? vscode.TreeItemCollapsibleState.Collapsed
        : vscode.TreeItemCollapsibleState.None
    };
  }

  getRunConfigNodes(): TreeNode[] {
    if (!this.solution) {
      return [];
    }

    const configs = runConfigStore.listConfigs(this.solution, this.context);
    if (configs.length === 0) {
      return [{
        kind: 'message',
        label: 'No run configurations - click + to add',
        collapsibleState: vscode.TreeItemCollapsibleState.None
      }];
    }

    return configs.map(config => ({
      kind: 'runConfig',
      label: config.label,
      configId: config.id,
      collapsibleState: vscode.TreeItemCollapsibleState.None
    }));
  }

  private getSolutionTree(): TreeNode[] {
    if (!this.solutionTree && this.solution) {
      this.solutionTree = this.groupProjectNodes(this.solution);
    }

    return this.solutionTree ?? [];
  }

  private groupProjectNodes(solution: SolutionModel): TreeNode[] {
    const solutionTree: TreeNode[] = [];
    const fallbackProjects: ProjectModel[] = [];

    for (const project of solution.projects) {
      if (project.solutionFolder && project.solutionFolder.length > 0) {
        this.insertSolutionFolderProject(solutionTree, solution, project, project.solutionFolder);
      } else {
        fallbackProjects.push(project);
      }
    }

    return [
      ...sortTreeNodes(solutionTree),
      ...this.groupProjectsByDiskPath(solution, fallbackProjects)
    ];
  }

  private groupProjectsByDiskPath(solution: SolutionModel, projects: ProjectModel[]): TreeNode[] {
    const rootProjects: TreeNode[] = [];
    const groups = new Map<string, TreeNode[]>();
    const containerFolders = new Set(['src', 'source', 'sources', 'test', 'tests']);

    for (const project of projects) {
      const parts = project.relativePath.split('/').filter(Boolean);
      if (parts.length <= 1) {
        rootProjects.push(this.projectNode(project));
        continue;
      }

      const groupName = parts[0];
      if (!containerFolders.has(groupName.toLowerCase())) {
        rootProjects.push(this.projectNode(project));
        continue;
      }

      const existing = groups.get(groupName) ?? [];
      existing.push(this.projectNode(project));
      groups.set(groupName, existing);
    }

    const groupNodes = [...groups.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([label, children]) => ({
        kind: 'folder' as const,
        label,
        resourcePath: path.join(solution.rootPath, label),
        children: children.sort((a, b) => a.label.localeCompare(b.label)),
        collapsibleState: vscode.TreeItemCollapsibleState.Expanded
      }));

    return [...groupNodes, ...rootProjects.sort((a, b) => a.label.localeCompare(b.label))];
  }

  private insertSolutionFolderProject(
    nodes: TreeNode[],
    solution: SolutionModel,
    project: ProjectModel,
    folderPath: string[]
  ): void {
    let currentNodes = nodes;
    const logicalParts: string[] = [];

    for (const [index, folderName] of folderPath.entries()) {
      logicalParts.push(folderName);
      const folderId = `folder:${logicalParts.join('/')}`;
      let folderNode = currentNodes.find(node => node.kind === 'folder' && node.id === folderId);

      if (!folderNode) {
        folderNode = this.solutionFolderNode(solution, folderName, logicalParts, index);
        currentNodes.push(folderNode);
      }

      currentNodes = folderNode.children!;
    }

    currentNodes.push(this.projectNode(project));
  }

  private solutionFolderNode(
    solution: SolutionModel,
    label: string,
    logicalParts: string[],
    depth: number
  ): TreeNode {
    const resourcePath = existingDirectoryPath(path.join(solution.rootPath, ...logicalParts));

    return {
      kind: 'folder',
      label,
      id: `folder:${logicalParts.join('/')}`,
      resourcePath,
      children: [],
      collapsibleState: depth === 0
        ? vscode.TreeItemCollapsibleState.Expanded
        : vscode.TreeItemCollapsibleState.Collapsed
    };
  }

  private parentForProject(project: ProjectModel): TreeNode | undefined {
    if (project.solutionFolder && project.solutionFolder.length > 0) {
      return findNodeById(this.getSolutionTree(), `folder:${project.solutionFolder.join('/')}`);
    }

    const parentFolder = findNode(this.getSolutionTree(), node =>
      node.kind === 'folder'
      && Boolean(node.children?.some(child => child.kind === 'project' && samePath(child.project?.path, project.path)))
    );

    return parentFolder ?? (this.solution ? this.solutionNode(this.solution) : undefined);
  }

  private parentForSolutionFolder(folderId: string): TreeNode | undefined {
    if (!this.solution) {
      return undefined;
    }

    const logicalPath = folderId.slice('folder:'.length).split('/').filter(Boolean);
    logicalPath.pop();

    if (logicalPath.length === 0) {
      return this.solutionNode(this.solution);
    }

    return findNodeById(this.getSolutionTree(), `folder:${logicalPath.join('/')}`);
  }

  private async parentForFileSystemNode(node: TreeNode): Promise<TreeNode | undefined> {
    if (!node.resourcePath) {
      return undefined;
    }

    if (node.project) {
      const nestedParent = await this.findNestedFileParent(node);
      if (nestedParent) {
        return nestedParent;
      }

      const parentDirectory = path.dirname(node.resourcePath);
      if (samePath(parentDirectory, node.project.directory)) {
        return this.projectNode(node.project);
      }

      return this.fileSystemFolderNode(parentDirectory, node.project);
    }

    const parentDirectory = path.dirname(node.resourcePath);
    const parentInSolutionTree = findNode(this.getSolutionTree(), candidate =>
      candidate.kind === 'folder' && samePath(candidate.resourcePath, parentDirectory)
    );

    return parentInSolutionTree ?? (this.solution ? this.solutionNode(this.solution) : undefined);
  }

  private async findNestedFileParent(node: TreeNode): Promise<TreeNode | undefined> {
    if (!node.resourcePath || !node.project || node.kind !== 'file') {
      return undefined;
    }

    const siblingNodes = await readDirectoryNodes(path.dirname(node.resourcePath), node.project.directory, node.project);
    return siblingNodes.find(candidate =>
      candidate.kind === 'file'
      && candidate.children?.some(child => samePath(child.resourcePath, node.resourcePath))
    );
  }

  private parentForAuxiliaryNode(node: TreeNode): TreeNode | undefined {
    if (!node.project) {
      return undefined;
    }

    if (node.kind === 'dependencies') {
      return this.projectNode(node.project);
    }

    if (node.kind === 'projectReferences' || node.kind === 'packageReferences') {
      return this.dependenciesNode(node.project);
    }

    if (node.kind === 'projectReference') {
      return {
        kind: 'projectReferences',
        label: 'Projects',
        project: node.project,
        collapsibleState: vscode.TreeItemCollapsibleState.Collapsed
      };
    }

    if (node.kind === 'packageReference') {
      return {
        kind: 'packageReferences',
        label: 'Packages',
        project: node.project,
        collapsibleState: vscode.TreeItemCollapsibleState.Collapsed
      };
    }

    return undefined;
  }

  private findProjectContaining(filePath: string): ProjectModel | undefined {
    if (!this.solution) {
      return undefined;
    }

    return this.solution.projects
      .filter(project => isInside(project.directory, filePath))
      .sort((a, b) => b.directory.length - a.directory.length)[0];
  }

  private async findProjectFileNode(project: ProjectModel, filePath: string): Promise<TreeNode | undefined> {
    if (!samePath(filePath, project.directory) && !isInside(project.directory, filePath)) {
      return undefined;
    }

    const relativePath = path.relative(project.directory, filePath);
    if (!relativePath) {
      return this.projectNode(project);
    }

    const parts = relativePath.split(path.sep).filter(Boolean);
    let currentDirectory = project.directory;

    for (const [index, part] of parts.entries()) {
      const targetPath = path.join(currentDirectory, part);
      const nodes = await readDirectoryNodes(currentDirectory, project.directory, project);
      const directNode = nodes.find(node => samePath(node.resourcePath, targetPath));
      if (directNode) {
        if (index === parts.length - 1) {
          return directNode;
        }

        if (directNode.kind !== 'folder') {
          return undefined;
        }

        currentDirectory = targetPath;
        continue;
      }

      const nestedNode = findNode(nodes, node => samePath(node.resourcePath, targetPath));
      if (nestedNode) {
        return index === parts.length - 1 ? nestedNode : undefined;
      }

      return undefined;
    }

    return undefined;
  }

  private fileSystemFolderNode(directoryPath: string, project: ProjectModel): TreeNode {
    return {
      kind: 'folder',
      label: path.basename(directoryPath),
      resourcePath: directoryPath,
      project,
      collapsibleState: vscode.TreeItemCollapsibleState.Collapsed
    };
  }

  private contextValueFor(node: TreeNode): string {
    if (node.kind === 'project' && node.project) {
      const values = ['project'];
      if (node.project.path === this.startupProjectPath) {
        values.push('startup');
      }

      if (isRunnableProject(node.project)) {
        values.push('runnable');
      }

      if (isTestProject(node.project)) {
        values.push('test');
      }

      const phase = this.projectStateProvider?.(node.project);
      if (phase) {
        values.push('busy', phase);
      }

      return values.join(' ');
    }

    if (node.kind === 'folder' && node.id?.startsWith('folder:')) {
      return 'solutionFolder';
    }

    if (node.kind === 'runConfig') {
      const values = ['runConfig'];
      if (this.solution && node.configId === runConfigStore.getActive(this.solution, this.context)?.id) {
        values.push('active');
      }

      const config = this.solution
        ? runConfigStore.listConfigs(this.solution, this.context).find(candidate => candidate.id === node.configId)
        : undefined;
      if (config?.kind === 'compound') {
        values.push('compound');
      }

      const state = node.configId ? this.configStateProvider?.(node.configId) : undefined;
      if (state) {
        values.push(state.phase);
        if (state.busy) {
          values.push('busy');
        }
      }

      return values.join(' ');
    }

    return node.kind;
  }

  private descriptionFor(node: TreeNode): string | undefined {
    if (node.kind === 'solution' && this.solution) {
      const projectWord = this.solution.projects.length === 1 ? 'project' : 'projects';
      return `${this.solution.projects.length} ${projectWord}`;
    }

    if (node.kind === 'project' && node.project) {
      const startup = node.project.path === this.startupProjectPath ? 'startup' : undefined;
      const phase = this.projectStateProvider?.(node.project);
      return [frameworkSummary(node.project.targetFrameworks), startup, phase ? phaseLabel(phase) : undefined]
        .filter(Boolean)
        .join(' · ');
    }

    if (node.kind === 'runConfig') {
      const values: string[] = [];
      if (this.solution && node.configId === runConfigStore.getActive(this.solution, this.context)?.id) {
        values.push('active');
      }
      const state = node.configId ? this.configStateProvider?.(node.configId) : undefined;
      if (state) {
        values.push(phaseLabel(state.phase));
      }
      return values.length > 0 ? values.join('  ') : undefined;
    }

    return undefined;
  }

  private tooltipFor(node: TreeNode): string | undefined {
    if (node.kind === 'solution' && this.solution) {
      return [
        this.solution.path ? path.basename(this.solution.path) : this.solution.name,
        `${this.solution.projects.length} project${this.solution.projects.length === 1 ? '' : 's'}`,
        this.solution.path ?? this.solution.rootPath
      ].join('\n');
    }

    if (node.kind === 'project' && node.project) {
      const frameworks = node.project.targetFrameworks.length > 0
        ? node.project.targetFrameworks.join(', ')
        : 'No target framework detected';
      return [node.project.relativePath, `${projectKindLabel(node.project)} · ${frameworks}`].join('\n');
    }

    return node.resourcePath;
  }

  private iconFor(node: TreeNode): vscode.ThemeIcon | vscode.Uri | undefined {
    const iconMode = vscode.workspace
      .getConfiguration('dotnav')
      .get<string>('iconMode', 'auto');

    if (iconMode === 'theme' && (node.kind === 'folder' || node.kind === 'file')) {
      return undefined;
    }

    switch (node.kind) {
      case 'solution':
        return new vscode.ThemeIcon('repo');
      case 'runConfigs':
        return new vscode.ThemeIcon('rocket');
      case 'runConfig':
        return this.runConfigIcon(node, iconMode);
      case 'project':
        return node.project ? this.projectIconFor(node, iconMode) : undefined;
      case 'dependencies':
        return new vscode.ThemeIcon('references');
      case 'projectReferences':
      case 'projectReference':
        return new vscode.ThemeIcon('type-hierarchy');
      case 'packageReferences':
      case 'packageReference':
        return new vscode.ThemeIcon('package');
      case 'folder':
        return this.folderIconFor(node, iconMode);
      case 'file':
        return vscode.ThemeIcon.File;
      default:
        return undefined;
    }
  }

  private runConfigIcon(node: TreeNode, iconMode: string): vscode.ThemeIcon {
    const config = this.solution
      ? runConfigStore.listConfigs(this.solution, this.context).find(candidate => candidate.id === node.configId)
      : undefined;

    const phase = node.configId ? this.configStateProvider?.(node.configId)?.phase : undefined;
    if (phase === 'queued' || phase === 'building' || phase === 'starting' || phase === 'stopping') {
      return new vscode.ThemeIcon('sync~spin');
    }
    if (phase === 'running') {
      return new vscode.ThemeIcon('debug-alt');
    }
    if (phase === 'failed') {
      return new vscode.ThemeIcon('error');
    }
    if (phase === 'succeeded') {
      return new vscode.ThemeIcon('pass');
    }
    if (phase === 'stopped') {
      return new vscode.ThemeIcon('circle-slash');
    }
    if (this.solution && node.configId === runConfigStore.getActive(this.solution, this.context)?.id) {
      return new vscode.ThemeIcon('check');
    }

    if (iconMode === 'minimal') {
      return new vscode.ThemeIcon('circle-large-outline');
    }

    return new vscode.ThemeIcon(config?.kind === 'compound' ? 'layers' : 'play-circle');
  }

  private projectIconFor(node: TreeNode, iconMode: string): vscode.ThemeIcon | vscode.Uri {
    const project = node.project!;
    const phase = this.projectStateProvider?.(project);
    if (phase === 'queued' || phase === 'building' || phase === 'starting' || phase === 'stopping') {
      return new vscode.ThemeIcon('sync~spin');
    }
    if (phase === 'running') {
      return new vscode.ThemeIcon('debug-alt');
    }

    if (iconMode === 'theme' || iconMode === 'minimal') {
      return new vscode.ThemeIcon(projectThemeIcon(project));
    }

    const fileName = projectIconFileName(project);
    return vscode.Uri.file(this.context.asAbsolutePath(path.join('media', fileName)));
  }

  private folderIconFor(node: TreeNode, iconMode: string): vscode.ThemeIcon | vscode.Uri | undefined {
    if (iconMode === 'theme') {
      return undefined;
    }

    if (iconMode === 'minimal') {
      return new vscode.ThemeIcon('folder');
    }

    const fileName = folderIconFileName(node.label);
    if (iconMode === 'auto' && fileName === 'folder-default.svg') {
      return new vscode.ThemeIcon('folder');
    }

    return vscode.Uri.file(this.context.asAbsolutePath(path.join('media', fileName)));
  }

  private nodeId(node: TreeNode): string | undefined {
    if (node.id) {
      return node.id;
    }

    if (node.kind === 'runConfigs') {
      return 'runConfigs';
    }

    if (node.kind === 'runConfig') {
      return `runConfig:${node.configId ?? node.label}`;
    }

    if ((node.kind === 'projectReference' || node.kind === 'packageReference') && node.project) {
      return `${node.kind}:${node.project.path}:${node.resourcePath ?? node.label}`;
    }

    if (node.resourcePath) {
      return `${node.kind}:${node.resourcePath}`;
    }

    if (node.project) {
      return `${node.kind}:${node.project.path}:${node.label}`;
    }

    return `${node.kind}:${node.label}`;
  }
}

function phaseLabel(phase: RunPhase): string {
  switch (phase) {
    case 'queued': return 'queued…';
    case 'building': return 'building…';
    case 'starting': return 'starting…';
    case 'running': return 'running';
    case 'stopping': return 'stopping…';
    case 'succeeded': return 'completed';
    case 'failed': return 'failed';
    case 'stopped': return 'stopped';
  }
}

function sortTreeNodes(nodes: TreeNode[]): TreeNode[] {
  for (const node of nodes) {
    if (node.children) {
      sortTreeNodes(node.children);
    }
  }

  return nodes.sort(compareTreeNodes);
}

function findNode(nodes: TreeNode[], predicate: (node: TreeNode) => boolean): TreeNode | undefined {
  for (const node of nodes) {
    if (predicate(node)) {
      return node;
    }

    if (node.children) {
      const child = findNode(node.children, predicate);
      if (child) {
        return child;
      }
    }
  }

  return undefined;
}

function findNodeById(nodes: TreeNode[], id: string): TreeNode | undefined {
  return findNode(nodes, node => node.id === id);
}

function compareTreeNodes(a: TreeNode, b: TreeNode): number {
  if (a.kind === 'folder' && b.kind !== 'folder') {
    return -1;
  }

  if (a.kind !== 'folder' && b.kind === 'folder') {
    return 1;
  }

  return a.label.localeCompare(b.label);
}

function existingDirectoryPath(directoryPath: string): string | undefined {
  try {
    return fs.statSync(directoryPath).isDirectory() ? directoryPath : undefined;
  } catch {
    return undefined;
  }
}

function getDefaultCollapsibleState(node: TreeNode): vscode.TreeItemCollapsibleState {
  if (node.children && node.children.length > 0) {
    return vscode.TreeItemCollapsibleState.Collapsed;
  }

  return vscode.TreeItemCollapsibleState.None;
}

function projectKindLabel(project: ProjectModel): string {
  switch (project.kind) {
    case 'web':
      return 'Web';
    case 'test':
      return 'Test';
    case 'console':
      return 'Console';
    case 'library':
      return 'Library';
    case 'docker':
      return 'Docker';
    default:
      return 'Project';
  }
}

function frameworkSummary(frameworks: readonly string[]): string | undefined {
  if (frameworks.length === 0) {
    return undefined;
  }

  return frameworks.length === 1 ? frameworks[0] : `${frameworks[0]} +${frameworks.length - 1}`;
}

function projectIconFileName(project: ProjectModel): string {
  switch (project.kind) {
    case 'web':
      return 'project-web.svg';
    case 'test':
      return 'project-test.svg';
    case 'console':
      return 'project-console.svg';
    case 'library':
      return 'project-library.svg';
    case 'docker':
      return 'project-docker.svg';
    default:
      return 'project-unknown.svg';
  }
}

function projectThemeIcon(project: ProjectModel): string {
  switch (project.kind) {
    case 'web':
      return 'globe';
    case 'test':
      return 'beaker';
    case 'console':
      return 'terminal';
    case 'library':
      return 'library';
    case 'docker':
      return 'package';
    default:
      return 'symbol-class';
  }
}

function folderIconFileName(folderName: string): string {
  const normalized = folderName.toLowerCase();

  switch (normalized) {
    case 'properties':
      return 'folder-settings.svg';
    case 'controllers':
    case 'endpoints':
      return 'folder-controller.svg';
    case 'services':
    case 'service':
      return 'folder-service.svg';
    case 'repositories':
    case 'repository':
      return 'folder-database.svg';
    case 'entities':
    case 'entity':
    case 'models':
    case 'model':
      return 'folder-structure.svg';
    case 'viewmodels':
    case 'views':
      return 'folder-structure.svg';
    case 'middlewares':
    case 'middleware':
      return 'folder-structure.svg';
    case 'extensions':
      return 'folder-controller.svg';
    case 'configuration':
    case 'config':
      return 'folder-settings.svg';
    case 'attributes':
      return 'folder-controller.svg';
    case 'exceptions':
      return 'folder-warning.svg';
    case 'resources':
    case 'resource':
      return 'folder-default.svg';
    case 'htmltemplates':
    case 'templates':
      return 'folder-controller.svg';
    case 'https':
    case 'http':
      return 'folder-controller.svg';
    case 'tests':
    case 'test':
      return 'folder-test.svg';
    case 'src':
    case 'source':
    case 'sources':
      return 'folder-default.svg';
    default:
      return 'folder-default.svg';
  }
}
