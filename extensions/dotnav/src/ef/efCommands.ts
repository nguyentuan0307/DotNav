import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { ProjectModel } from '../models';
import { samePath } from '../pathUtils';
import { EfCommandResult, reportEfFailure } from './efCli';
import { EfProjectDetection } from './efDetection';
import {
  maskConnectionString,
  parseDbContextInfo,
  validateMigrationName
} from './efJsonParser';
import { DbContextModel, MigrationModel } from './efMigrationStore';
import { EfNode } from './efTreeProvider';
import type { EfFeature } from './efMain';

interface EfTarget {
  readonly detection: EfProjectDetection;
  readonly project: ProjectModel;
  readonly startupProjectPath: string;
  readonly context?: DbContextModel;
  /** Set only when the project has more than one DbContext. */
  readonly contextName?: string;
}

export function registerEfCommands(context: vscode.ExtensionContext, feature: EfFeature): void {
  const register = (id: string, handler: (...args: never[]) => unknown) =>
    context.subscriptions.push(vscode.commands.registerCommand(id, handler as (...args: unknown[]) => unknown));

  register('dotnav.ef.refresh', () => feature.refreshAll());
  register('dotnav.ef.showOutput', () => feature.cli.showOutput());
  register('dotnav.ef.openSettings', () =>
    vscode.commands.executeCommand('workbench.action.openSettings', 'dotnav.ef'));
  register('dotnav.ef.installTool', () => installTool(feature));
  register('dotnav.ef.selectStartupProject', (node?: EfNode) => selectStartupProject(feature, node));
  register('dotnav.ef.addMigration', (node?: EfNode) => addMigration(feature, node));
  register('dotnav.ef.removeLastMigration', (node?: EfNode) => removeLastMigration(feature, node));
  register('dotnav.ef.listMigrations', (node?: EfNode) => listMigrations(feature, node));
  register('dotnav.ef.updateDatabase', (node?: EfNode) => updateDatabase(feature, node, undefined));
  register('dotnav.ef.updateDatabaseTo', (node?: EfNode) => updateDatabaseTo(feature, node));
  register('dotnav.ef.updateDatabaseToThis', (node: EfNode) =>
    node.migration ? updateDatabase(feature, node, node.migration) : undefined);
  // Same behavior; separate id so applied migrations show a "Rollback" label.
  register('dotnav.ef.rollbackDatabaseToThis', (node: EfNode) =>
    node.migration ? updateDatabase(feature, node, node.migration) : undefined);
  register('dotnav.ef.generateScript', (node?: EfNode) => generateScript(feature, node, undefined));
  register('dotnav.ef.generateScriptFromThis', (node: EfNode) =>
    node.migration ? generateScript(feature, node, node.migration) : undefined);
  register('dotnav.ef.dropDatabase', (node?: EfNode) => dropDatabase(feature, node));
  register('dotnav.ef.dbContextInfo', (node?: EfNode) => showDbContextInfo(feature, node));
  register('dotnav.ef.openMigrationFile', (node?: EfNode) => openMigrationFile(node));
  register('dotnav.ef.copyMigrationName', (node?: EfNode) =>
    node?.migration ? vscode.env.clipboard.writeText(node.migration.name) : undefined);
  register('dotnav.ef.openCsproj', (node?: EfNode) =>
    node?.project
      ? vscode.window.showTextDocument(vscode.Uri.file(node.project.path), { preview: false })
      : undefined);
}

// ── Target resolution ────────────────────────────────────────────────────────

async function pickDetection(feature: EfFeature, node?: EfNode): Promise<EfProjectDetection | undefined> {
  const detections = await feature.getDetections();
  if (detections.length === 0) {
    vscode.window.showInformationMessage('No EF Core projects were detected in this solution.');
    return undefined;
  }

  if (node?.project) {
    const matched = detections.find(detection => samePath(detection.project.path, node.project!.path));
    if (matched) {
      return matched;
    }
  }

  if (detections.length === 1) {
    return detections[0];
  }

  const picked = await vscode.window.showQuickPick(
    detections.map(detection => ({
      label: detection.project.name,
      description: detection.project.relativePath,
      detection
    })),
    { title: 'Select EF Core Project', matchOnDescription: true }
  );
  return picked?.detection;
}

async function resolveTarget(feature: EfFeature, node?: EfNode): Promise<EfTarget | undefined> {
  const detection = await pickDetection(feature, node);
  if (!detection) {
    return undefined;
  }

  const startupProjectPath = await feature.resolveStartupProject(detection) ?? detection.project.path;
  if (!await feature.toolManager.ensureTool(detection.project.directory)) {
    return undefined;
  }

  void feature.toolManager.warnOnVersionMismatch(detection.project, detection.project.directory);

  const resolution = { project: detection.project, startupProjectPath };
  const contexts = await feature.store.getContexts(resolution);

  let context: DbContextModel | undefined;
  if (node?.context) {
    context = node.context;
  } else if (contexts.length === 1) {
    context = contexts[0];
  } else if (contexts.length > 1) {
    const lastContext = feature.configStore.getLastContext(detection.project.path);
    const items = contexts.map(candidate => ({
      label: candidate.name,
      description: candidate.fullName,
      picked: candidate.name === lastContext,
      candidate
    }));
    const picked = await vscode.window.showQuickPick(
      items.sort((a, b) => Number(b.picked) - Number(a.picked)),
      { title: 'Select DbContext', matchOnDescription: true }
    );
    if (!picked) {
      return undefined;
    }

    context = picked.candidate;
    await feature.configStore.setLastContext(detection.project.path, context.name);
  }

  return {
    detection,
    project: detection.project,
    startupProjectPath,
    context,
    contextName: contexts.length > 1 ? context?.name : undefined
  };
}

async function afterWriteResult(feature: EfFeature, target: EfTarget, result: EfCommandResult): Promise<void> {
  // Any write attempt — success, failure, or cancellation — may have changed
  // migrations or the database. Never trust the cache afterwards (§7.5).
  feature.store.invalidateProject(target.project.path);
}

// ── Commands ─────────────────────────────────────────────────────────────────

async function installTool(feature: EfFeature): Promise<void> {
  const detections = await feature.getDetections();
  const cwd = detections[0]?.project.directory ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!cwd) {
    vscode.window.showInformationMessage('Open a workspace before installing dotnet-ef.');
    return;
  }

  const choice = await vscode.window.showQuickPick(
    [
      { label: 'Install Local Tool (recommended)', global: false },
      { label: 'Install Global Tool', global: true }
    ],
    { title: 'Install dotnet-ef' }
  );
  if (choice) {
    await feature.toolManager.install(cwd, choice.global);
  }
}

async function selectStartupProject(feature: EfFeature, node?: EfNode): Promise<void> {
  const detection = await pickDetection(feature, node);
  if (!detection) {
    return;
  }

  const candidates = detection.startupCandidates.length > 0
    ? detection.startupCandidates
    : [detection.project];
  const picked = await vscode.window.showQuickPick(
    candidates.map(candidate => ({
      label: candidate.name,
      description: candidate.relativePath,
      candidate
    })),
    { title: `EF Startup Project for ${detection.project.name}` }
  );
  if (!picked) {
    return;
  }

  await feature.configStore.setStartupProject(detection.project.path, picked.candidate.path);
  feature.store.invalidateProject(detection.project.path);
  feature.treeProvider.refresh();
  vscode.window.showInformationMessage(`EF startup project set to ${picked.candidate.name}.`);
}

async function addMigration(feature: EfFeature, node?: EfNode): Promise<void> {
  const target = await resolveTarget(feature, node);
  if (!target) {
    return;
  }

  const cached = feature.store.getCachedMigrations(target.project.path, target.contextName);
  const existingNames = (cached?.migrations ?? []).map(migration => migration.name);
  const name = await vscode.window.showInputBox({
    title: `Add Migration (${target.context?.name ?? target.project.name})`,
    prompt: 'Migration name',
    placeHolder: 'e.g. AddOrderTable',
    validateInput: value => validateMigrationName(value, existingNames)
  });
  if (!name) {
    return;
  }

  const trimmed = name.trim();
  const result = await feature.cli.run({
    args: ['migrations', 'add', trimmed],
    project: target.project,
    startupProjectPath: target.startupProjectPath,
    contextName: target.contextName,
    title: `Adding migration '${trimmed}'`,
    write: true
  });
  await afterWriteResult(feature, target, result);

  if (result.kind === 'error') {
    await reportEfFailure(feature.cli, `Adding migration '${trimmed}'`, result);
    return;
  }

  if (result.kind === 'cancelled') {
    await handleCancelledAdd(feature, target, trimmed);
    return;
  }

  const snapshot = await feature.store.getMigrations(target, target.contextName, { refresh: true });
  const created = snapshot.migrations.find(migration => migration.name === trimmed);
  if (created?.filePath) {
    await vscode.window.showTextDocument(vscode.Uri.file(created.filePath), { preview: false });
  }

  const action = await vscode.window.showInformationMessage(
    `Migration '${trimmed}' created.`,
    'Update Database'
  );
  if (action === 'Update Database') {
    await updateDatabase(feature, node, undefined);
  }
}

/** Cancel mid-add can leave generated files behind (§7.5). */
async function handleCancelledAdd(feature: EfFeature, target: EfTarget, name: string): Promise<void> {
  const snapshot = await feature.store.getMigrations(target, target.contextName, { refresh: true });
  const leftover = snapshot.migrations.find(migration => migration.name === name);
  if (!leftover) {
    return;
  }

  const choice = await vscode.window.showWarningMessage(
    `Adding '${name}' was cancelled but migration files were already generated. Remove them?`,
    'Remove Migration',
    'Keep Files'
  );
  if (choice === 'Remove Migration') {
    const result = await feature.cli.run({
      args: ['migrations', 'remove', '--force'],
      project: target.project,
      startupProjectPath: target.startupProjectPath,
      contextName: target.contextName,
      title: `Removing migration '${name}'`,
      write: true
    });
    await afterWriteResult(feature, target, result);
    if (result.kind === 'error') {
      await reportEfFailure(feature.cli, `Removing migration '${name}'`, result);
    }
  }
}

async function removeLastMigration(feature: EfFeature, node?: EfNode): Promise<void> {
  const target = await resolveTarget(feature, node);
  if (!target) {
    return;
  }

  // Fetch fresh state before a destructive decision (§7.7).
  const snapshot = await feature.store.getMigrations(target, target.contextName, { fresh: true });
  const last = [...snapshot.migrations].sort((a, b) => a.id.localeCompare(b.id)).pop();
  if (!last) {
    vscode.window.showInformationMessage('There are no migrations to remove.');
    return;
  }

  let force = false;
  if (last.status === 'applied') {
    const choice = await vscode.window.showWarningMessage(
      `'${last.name}' is applied to the database. Removing it without rolling back leaves the database ahead of the code.`,
      { modal: true },
      'Force Remove'
    );
    if (choice !== 'Force Remove') {
      return;
    }

    force = true;
  } else if (last.status === 'unknown') {
    const choice = await vscode.window.showWarningMessage(
      `The database could not be reached, so it is unknown whether '${last.name}' is applied. Remove anyway?`,
      { modal: true },
      'Remove'
    );
    if (choice !== 'Remove') {
      return;
    }
  }

  const result = await feature.cli.run({
    args: ['migrations', 'remove', ...(force ? ['--force'] : [])],
    project: target.project,
    startupProjectPath: target.startupProjectPath,
    contextName: target.contextName,
    title: `Removing migration '${last.name}'`,
    write: true
  });
  await afterWriteResult(feature, target, result);

  if (result.kind === 'error') {
    await reportEfFailure(feature.cli, `Removing migration '${last.name}'`, result);
  } else if (result.kind === 'success') {
    vscode.window.showInformationMessage(`Migration '${last.name}' removed.`);
  }
}

function statusIcon(migration: MigrationModel): string {
  switch (migration.status) {
    case 'applied': return '$(check)';
    case 'pending': return '$(circle-filled)';
    default: return '$(circle-outline)';
  }
}

async function listMigrations(feature: EfFeature, node?: EfNode): Promise<void> {
  const target = await resolveTarget(feature, node);
  if (!target) {
    return;
  }

  const snapshot = await feature.store.getMigrations(target, target.contextName, { refresh: true });
  if (snapshot.migrations.length === 0) {
    vscode.window.showInformationMessage('No migrations found.');
    return;
  }

  const items = [...snapshot.migrations]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map(migration => ({
      label: `${statusIcon(migration)} ${migration.name}`,
      description: migration.status,
      detail: migration.id,
      migration
    }));
  const picked = await vscode.window.showQuickPick(items, {
    title: `Migrations (${target.context?.name ?? target.project.name})${snapshot.source === 'folder' ? ' — DB unreachable' : ''}`,
    matchOnDetail: true
  });
  if (picked?.migration.filePath) {
    await vscode.window.showTextDocument(vscode.Uri.file(picked.migration.filePath), { preview: false });
  }
}

async function describeDatabase(feature: EfFeature, target: EfTarget): Promise<{ name?: string; provider?: string }> {
  const result = await feature.cli.run({
    args: ['dbcontext', 'info'],
    project: target.project,
    startupProjectPath: target.startupProjectPath,
    contextName: target.contextName,
    title: `Reading DbContext info (${target.context?.name ?? target.project.name})`,
    write: false,
    json: true
  });
  if (result.kind !== 'success') {
    return {};
  }

  const info = parseDbContextInfo(result.stdout);
  return {
    name: info?.databaseName,
    provider: info?.providerName?.split('.').pop()
  };
}

async function updateDatabase(feature: EfFeature, node: EfNode | undefined, targetMigration: MigrationModel | undefined): Promise<void> {
  const target = await resolveTarget(feature, node);
  if (!target) {
    return;
  }

  const snapshot = await feature.store.getMigrations(target, target.contextName, { fresh: true });
  const ordered = [...snapshot.migrations].sort((a, b) => a.id.localeCompare(b.id));
  const database = await describeDatabase(feature, target);
  const databaseLabel = database.name
    ? `database '${database.name}'${database.provider ? ` (${database.provider})` : ''}`
    : `the ${target.context?.name ?? target.project.name} database (name unavailable)`;

  let confirmMessage: string;
  let confirmDetail: string | undefined;
  let isRollback = false;
  if (targetMigration) {
    const targetIndex = ordered.findIndex(migration => migration.id === targetMigration.id);
    const reverted = ordered.slice(targetIndex + 1).filter(migration => migration.status === 'applied');
    const applied = ordered.slice(0, targetIndex + 1).filter(migration => migration.status !== 'applied');
    isRollback = reverted.length > 0 && applied.length === 0;
    if (isRollback) {
      confirmMessage = `Rollback ${databaseLabel} to '${targetMigration.name}'?`;
      confirmDetail =
        `${reverted.length} migration(s) will be REVERTED:\n${nameList(reverted)}\n\n` +
        'Data in affected tables may be lost.';
    } else {
      const parts = [];
      if (applied.length > 0) {
        parts.push(`${applied.length} migration(s) will be applied:\n${nameList(applied)}`);
      }
      if (reverted.length > 0) {
        parts.push(`${reverted.length} migration(s) will be reverted:\n${nameList(reverted)}`);
      }
      confirmMessage = `Update ${databaseLabel} to '${targetMigration.name}'?`;
      confirmDetail = parts.length > 0 ? parts.join('\n\n') : undefined;
    }
  } else {
    const pending = ordered.filter(migration => migration.status !== 'applied');
    if (snapshot.source === 'db' && pending.length === 0) {
      vscode.window.showInformationMessage('The database is already up to date.');
      return;
    }

    confirmMessage = `Apply ${pending.length > 0 ? pending.length : 'all'} pending migration(s) to ${databaseLabel}?`;
    confirmDetail = pending.length > 0 && pending.length <= 8 ? nameList(pending) : undefined;
  }

  const confirmLabel = isRollback ? 'Rollback' : 'Update Database';
  const choice = await vscode.window.showWarningMessage(
    confirmMessage,
    { modal: true, detail: confirmDetail },
    confirmLabel
  );
  if (choice !== confirmLabel) {
    return;
  }

  const title = targetMigration
    ? `${isRollback ? 'Rolling back' : 'Updating'} database to '${targetMigration.name}'`
    : 'Updating database';
  const result = await feature.cli.run({
    args: ['database', 'update', ...(targetMigration ? [targetMigration.name] : [])],
    project: target.project,
    startupProjectPath: target.startupProjectPath,
    contextName: target.contextName,
    title,
    write: true
  });
  await afterWriteResult(feature, target, result);

  if (result.kind === 'error') {
    await reportEfFailure(feature.cli, title, result);
  } else if (result.kind === 'cancelled') {
    vscode.window.showWarningMessage(
      'Database update was cancelled mid-run. The database may be in a partial state — check the migration list.'
    );
  } else {
    vscode.window.showInformationMessage(
      targetMigration ? `Database is now at '${targetMigration.name}'.` : 'Database updated.'
    );
  }
}

async function updateDatabaseTo(feature: EfFeature, node?: EfNode): Promise<void> {
  const target = await resolveTarget(feature, node);
  if (!target) {
    return;
  }

  const snapshot = await feature.store.getMigrations(target, target.contextName, { fresh: true });
  if (snapshot.migrations.length === 0) {
    vscode.window.showInformationMessage('No migrations found.');
    return;
  }

  const items = [...snapshot.migrations]
    .sort((a, b) => b.id.localeCompare(a.id))
    .map(migration => ({
      label: `${statusIcon(migration)} ${migration.name}`,
      description: migration.status,
      migration
    }));
  const zero = { label: '$(discard) 0 (revert all migrations)', description: '', migration: undefined };
  const picked = await vscode.window.showQuickPick([...items, zero], { title: 'Update Database to Migration' });
  if (!picked) {
    return;
  }

  if (!picked.migration) {
    await revertAllMigrations(feature, target);
    return;
  }

  await updateDatabase(feature, node, picked.migration);
}

async function revertAllMigrations(feature: EfFeature, target: EfTarget): Promise<void> {
  const database = await describeDatabase(feature, target);
  const label = database.name ? `database '${database.name}'` : 'the database';
  const choice = await vscode.window.showWarningMessage(
    `Revert ALL migrations on ${label}?`,
    { modal: true, detail: 'Every migrated table/object will be removed. Data will be lost.' },
    'Revert All'
  );
  if (choice !== 'Revert All') {
    return;
  }

  const result = await feature.cli.run({
    args: ['database', 'update', '0'],
    project: target.project,
    startupProjectPath: target.startupProjectPath,
    contextName: target.contextName,
    title: 'Reverting all migrations',
    write: true
  });
  await afterWriteResult(feature, target, result);
  if (result.kind === 'error') {
    await reportEfFailure(feature.cli, 'Reverting all migrations', result);
  }
}

async function generateScript(feature: EfFeature, node: EfNode | undefined, fromMigration: MigrationModel | undefined): Promise<void> {
  const target = await resolveTarget(feature, node);
  if (!target) {
    return;
  }

  const args = ['migrations', 'script'];
  if (fromMigration) {
    args.push(fromMigration.name);
  } else {
    const mode = await vscode.window.showQuickPick(
      [
        { label: 'Full Script', description: 'From empty database to latest', id: 'full' },
        { label: 'Idempotent Script', description: 'Safe to run on any database state', id: 'idempotent' },
        { label: 'Range…', description: 'Choose from/to migrations', id: 'range' }
      ],
      { title: 'Generate SQL Script' }
    );
    if (!mode) {
      return;
    }

    if (mode.id === 'idempotent') {
      args.push('--idempotent');
    } else if (mode.id === 'range') {
      const snapshot = await feature.store.getMigrations(target, target.contextName, { refresh: true });
      const ordered = [...snapshot.migrations].sort((a, b) => a.id.localeCompare(b.id));
      if (ordered.length === 0) {
        vscode.window.showInformationMessage('No migrations found.');
        return;
      }

      const fromItems = [
        { label: '0 (empty database)', migration: undefined as MigrationModel | undefined },
        ...ordered.map(migration => ({ label: migration.name, migration }))
      ];
      const from = await vscode.window.showQuickPick(fromItems, { title: 'Script FROM migration (exclusive)' });
      if (!from) {
        return;
      }

      const to = await vscode.window.showQuickPick(
        ordered.map(migration => ({ label: migration.name, migration })),
        { title: 'Script TO migration (inclusive)' }
      );
      if (!to) {
        return;
      }

      args.push(from.migration?.name ?? '0', to.migration.name);
    }
  }

  const outputPath = path.join(os.tmpdir(), `dotnav-ef-script-${Date.now()}.sql`);
  args.push('--output', outputPath);

  const result = await feature.cli.run({
    args,
    project: target.project,
    startupProjectPath: target.startupProjectPath,
    contextName: target.contextName,
    title: 'Generating SQL script',
    write: false
  });

  if (result.kind === 'error') {
    await reportEfFailure(feature.cli, 'Generating SQL script', result);
    return;
  }

  if (result.kind !== 'success') {
    return;
  }

  try {
    const sql = await fs.readFile(outputPath, 'utf8');
    const document = await vscode.workspace.openTextDocument({ language: 'sql', content: sql });
    await vscode.window.showTextDocument(document, { preview: false });
  } catch {
    vscode.window.showErrorMessage('The script was generated but could not be read back. See output for details.');
  } finally {
    void fs.unlink(outputPath).catch(() => undefined);
  }
}

async function dropDatabase(feature: EfFeature, node?: EfNode): Promise<void> {
  const target = await resolveTarget(feature, node);
  if (!target) {
    return;
  }

  const database = await describeDatabase(feature, target);
  const expected = database.name ?? target.context?.name ?? target.project.name;
  const typed = await vscode.window.showInputBox({
    title: 'Drop Database',
    prompt: database.name
      ? `Type the database name '${expected}' to confirm dropping it. THIS CANNOT BE UNDONE.`
      : `Database name unavailable. Type '${expected}' to confirm dropping the ${target.context?.name ?? target.project.name} database. THIS CANNOT BE UNDONE.`,
    placeHolder: expected,
    validateInput: value => value === expected ? undefined : `Type '${expected}' exactly to confirm.`
  });
  if (typed !== expected) {
    return;
  }

  const result = await feature.cli.run({
    args: ['database', 'drop', '--force'],
    project: target.project,
    startupProjectPath: target.startupProjectPath,
    contextName: target.contextName,
    title: `Dropping database '${expected}'`,
    write: true
  });
  await afterWriteResult(feature, target, result);

  if (result.kind === 'error') {
    await reportEfFailure(feature.cli, `Dropping database '${expected}'`, result);
  } else if (result.kind === 'success') {
    vscode.window.showInformationMessage(`Database '${expected}' dropped.`);
  }
}

async function showDbContextInfo(feature: EfFeature, node?: EfNode): Promise<void> {
  const target = await resolveTarget(feature, node);
  if (!target) {
    return;
  }

  const result = await feature.cli.run({
    args: ['dbcontext', 'info'],
    project: target.project,
    startupProjectPath: target.startupProjectPath,
    contextName: target.contextName,
    title: `Reading DbContext info (${target.context?.name ?? target.project.name})`,
    write: false,
    json: true
  });
  if (result.kind === 'error') {
    await reportEfFailure(feature.cli, 'Reading DbContext info', result);
    return;
  }

  if (result.kind !== 'success') {
    return;
  }

  const info = parseDbContextInfo(result.stdout);
  const lines = [
    target.context ? `DbContext: ${target.context.fullName}` : undefined,
    info?.providerName ? `Provider: ${info.providerName}` : undefined,
    info?.databaseName ? `Database: ${info.databaseName}` : undefined,
    info?.dataSource ? `Data source: ${maskConnectionString(info.dataSource)}` : undefined,
    info?.options ? `Options: ${maskConnectionString(info.options)}` : undefined
  ].filter((line): line is string => Boolean(line));

  const choice = await vscode.window.showInformationMessage(
    lines.length > 0 ? lines.join('\n') : 'No DbContext info available.',
    { modal: true },
    'Show Output'
  );
  if (choice === 'Show Output') {
    feature.cli.showOutput();
  }
}

async function openMigrationFile(node?: EfNode): Promise<void> {
  if (!node?.migration) {
    return;
  }

  if (!node.migration.filePath) {
    vscode.window.showInformationMessage('The migration file could not be located on disk.');
    return;
  }

  await vscode.window.showTextDocument(vscode.Uri.file(node.migration.filePath), { preview: false });
}

function nameList(migrations: readonly MigrationModel[]): string {
  const names = migrations.map(migration => `  • ${migration.name}`);
  return names.length > 8
    ? [...names.slice(0, 8), `  … and ${names.length - 8} more`].join('\n')
    : names.join('\n');
}
