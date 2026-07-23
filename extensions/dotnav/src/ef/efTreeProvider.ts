import * as path from 'path';
import * as vscode from 'vscode';
import { ProjectModel } from '../models';
import { normalizePath } from '../pathUtils';
import { EfConfigStore } from './efConfigStore';
import { EfProjectDetection } from './efDetection';
import { migrationTimestampFromId } from './efJsonParser';
import { DbContextModel, EfMigrationStore, MigrationModel } from './efMigrationStore';

export type EfNodeKind = 'project' | 'context' | 'migration' | 'message';

export interface EfNode {
  readonly kind: EfNodeKind;
  readonly label: string;
  readonly description?: string;
  readonly tooltip?: string;
  readonly project?: ProjectModel;
  readonly startupProjectPath?: string;
  readonly context?: DbContextModel;
  readonly migration?: MigrationModel;
  readonly isLastMigration?: boolean;
  readonly contextValue?: string;
  readonly icon?: vscode.ThemeIcon;
  readonly command?: vscode.Command;
}

export interface EfDetectionProvider {
  getDetections(): Promise<readonly EfProjectDetection[]>;
  resolveStartupProject(detection: EfProjectDetection): Promise<string | undefined>;
}

export class EfTreeProvider implements vscode.TreeDataProvider<EfNode> {
  private readonly changeEmitter = new vscode.EventEmitter<EfNode | undefined>();
  readonly onDidChangeTreeData = this.changeEmitter.event;

  constructor(
    private readonly detectionProvider: EfDetectionProvider,
    private readonly store: EfMigrationStore,
    private readonly configStore: EfConfigStore
  ) {}

  refresh(): void {
    this.changeEmitter.fire(undefined);
  }

  getTreeItem(node: EfNode): vscode.TreeItem {
    const collapsible = node.kind === 'project' || node.kind === 'context'
      ? vscode.TreeItemCollapsibleState.Collapsed
      : vscode.TreeItemCollapsibleState.None;
    const item = new vscode.TreeItem(node.label, collapsible);
    item.description = node.description;
    item.tooltip = node.tooltip;
    item.contextValue = node.contextValue;
    item.iconPath = node.icon;
    item.command = node.command;
    if (node.kind === 'project' && node.project) {
      item.id = `ef-project:${normalizePath(node.project.path)}`;
    } else if (node.kind === 'context' && node.context) {
      item.id = `ef-context:${normalizePath(node.context.projectPath)}:${node.context.name}`;
    } else if (node.kind === 'migration' && node.migration && node.context) {
      item.id = `ef-migration:${normalizePath(node.context.projectPath)}:${node.context.name}:${node.migration.id}`;
    }

    return item;
  }

  async getChildren(node?: EfNode): Promise<EfNode[]> {
    try {
      if (!node) {
        return await this.getProjectNodes();
      }

      if (node.kind === 'project' && node.project && node.startupProjectPath) {
        return await this.getContextNodes(node.project, node.startupProjectPath);
      }

      if (node.kind === 'context' && node.project && node.startupProjectPath && node.context) {
        return await this.getMigrationNodes(node.project, node.startupProjectPath, node.context);
      }

      return [];
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return [messageNode(`Error: ${message}`, 'warning')];
    }
  }

  private async getProjectNodes(): Promise<EfNode[]> {
    const detections = await this.detectionProvider.getDetections();
    if (detections.length === 0) {
      return [messageNode('No EF Core projects detected in this solution.', 'info')];
    }

    const nodes: EfNode[] = [];
    for (const detection of detections) {
      const startupProjectPath = await this.detectionProvider.resolveStartupProject(detection);
      const startupName = startupProjectPath
        ? path.basename(startupProjectPath, path.extname(startupProjectPath))
        : undefined;
      nodes.push({
        kind: 'project',
        label: detection.project.name,
        description: startupName && startupName !== detection.project.name ? `startup: ${startupName}` : undefined,
        tooltip: [
          detection.project.path,
          ...detection.project.packageReferences
            .filter(pkg => /^Microsoft\.EntityFrameworkCore/i.test(pkg.name))
            .map(pkg => `${pkg.name} ${pkg.version ?? ''}`.trim())
        ].join('\n'),
        project: detection.project,
        startupProjectPath: startupProjectPath ?? detection.project.path,
        contextValue: 'efProject',
        icon: new vscode.ThemeIcon('package')
      });
    }

    return nodes;
  }

  private async getContextNodes(project: ProjectModel, startupProjectPath: string): Promise<EfNode[]> {
    const contexts = await this.store.getContexts({ project, startupProjectPath });
    if (contexts.length === 0) {
      return [messageNode('No DbContext found. Check the EF startup project.', 'info')];
    }

    return contexts.map(context => ({
      kind: 'context' as const,
      label: context.name,
      description: context.unverified ? 'unverified' : undefined,
      tooltip: context.unverified
        ? `${context.fullName}\nDiscovered by static scan — the EF CLI could not run. Applied state unavailable.`
        : context.fullName,
      project,
      startupProjectPath,
      context,
      contextValue: 'efContext',
      icon: new vscode.ThemeIcon('database')
    }));
  }

  private async getMigrationNodes(
    project: ProjectModel,
    startupProjectPath: string,
    context: DbContextModel
  ): Promise<EfNode[]> {
    const contexts = this.store.getCachedContexts(project) ?? [];
    const contextName = contexts.length > 1 ? context.name : undefined;
    const snapshot = await this.store.getMigrations({ project, startupProjectPath }, contextName);
    if (snapshot.migrations.length === 0) {
      return [messageNode('(no migrations)', 'info')];
    }

    const sortOrder = vscode.workspace.getConfiguration('dotnav.ef')
      .get<'oldestFirst' | 'newestFirst'>('migrationsSortOrder', 'oldestFirst');
    const migrations = [...snapshot.migrations].sort((a, b) =>
      sortOrder === 'oldestFirst' ? a.id.localeCompare(b.id) : b.id.localeCompare(a.id));
    const lastId = snapshot.migrations.reduce((max, migration) =>
      migration.id.localeCompare(max) > 0 ? migration.id : max, snapshot.migrations[0].id);

    const nodes: EfNode[] = migrations.map(migration => {
      const isLast = migration.id === lastId;
      const timestamp = migrationTimestampFromId(migration.id);
      return {
        kind: 'migration' as const,
        label: migration.name,
        description: migration.status === 'pending' ? 'pending' : migration.status === 'unknown' ? 'unknown' : undefined,
        tooltip: [
          migration.id,
          timestamp ? `Created ${timestamp.toISOString().replace('T', ' ').slice(0, 19)} UTC` : undefined,
          migration.filePath,
          migration.status === 'unknown' ? 'Could not reach the database — applied state is unknown.' : undefined
        ].filter(Boolean).join('\n'),
        project,
        startupProjectPath,
        context,
        migration,
        isLastMigration: isLast,
        contextValue: migrationContextValue(migration, isLast),
        icon: migrationIcon(migration),
        command: migration.filePath
          ? {
            command: 'dotnav.ef.openMigrationFile',
            title: 'Open Migration File',
            arguments: [{ kind: 'migration', label: migration.name, migration } satisfies Partial<EfNode>]
          }
          : undefined
      } satisfies EfNode;
    });

    if (snapshot.source === 'folder') {
      nodes.push({
        kind: 'message',
        label: '(DB unreachable — showing local files)',
        contextValue: 'efMessage',
        icon: new vscode.ThemeIcon('plug', new vscode.ThemeColor('descriptionForeground'))
      } as EfNode);
    }

    return nodes;
  }
}

function migrationContextValue(migration: MigrationModel, isLast: boolean): string {
  const base = migration.status === 'applied'
    ? 'efMigrationApplied'
    : migration.status === 'pending' ? 'efMigrationPending' : 'efMigrationUnknown';
  return isLast ? `${base}Last` : base;
}

function migrationIcon(migration: MigrationModel): vscode.ThemeIcon {
  switch (migration.status) {
    case 'applied':
      return new vscode.ThemeIcon('check', new vscode.ThemeColor('charts.green'));
    case 'pending':
      return new vscode.ThemeIcon('circle-filled', new vscode.ThemeColor('charts.yellow'));
    default:
      return new vscode.ThemeIcon('circle-outline', new vscode.ThemeColor('descriptionForeground'));
  }
}

function messageNode(label: string, icon: 'info' | 'warning'): EfNode {
  return {
    kind: 'message',
    label,
    contextValue: 'efMessage',
    icon: new vscode.ThemeIcon(icon)
  };
}
