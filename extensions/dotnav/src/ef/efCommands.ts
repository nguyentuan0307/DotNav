import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { ProjectModel, TreeNode } from '../models';
import { samePath } from '../pathUtils';
import { EfCommandResult, buildEfArgs, readEfSettings, reportEfFailure } from './efCli';
import { EfProjectDetection } from './efDetection';
import { EfDialogOption, EfDialogSpec, EfDialogValues, showEfDialog } from './efDialog';
import { maskConnectionString, parseDbContextInfo, parseMigrationsList, validateMigrationName } from './efJsonParser';
import { DiscoveredMigration, ProjectEfModel, loadEfModel, migrationsForContext } from './efModel';
import type { EfFeature } from './efMain';

interface EfTarget {
  readonly detection: EfProjectDetection;
  readonly project: ProjectModel;
  readonly startupProjectPath: string;
  readonly contextName?: string;
  readonly model: ProjectEfModel;
}

/** Field ids shared by every dialog. */
const FIELD = {
  project: 'project',
  startup: 'startup',
  context: 'context',
  name: 'name',
  target: 'target',
  from: 'from',
  to: 'to',
  idempotent: 'idempotent',
  noBuild: 'noBuild',
  configuration: 'configuration',
  extraArgs: 'extraArgs'
} as const;

export function registerEfCommands(context: vscode.ExtensionContext, feature: EfFeature): void {
  const register = (id: string, handler: (...args: never[]) => unknown) =>
    context.subscriptions.push(vscode.commands.registerCommand(id, handler as (...args: unknown[]) => unknown));

  register('dotnav.ef.refresh', () => feature.refreshAll());
  register('dotnav.ef.showOutput', () => feature.cli.showOutput());
  register('dotnav.ef.openSettings', () =>
    vscode.commands.executeCommand('workbench.action.openSettings', 'dotnav.ef'));
  register('dotnav.ef.installTool', () => installTool(feature));
  register('dotnav.ef.addMigration', (node?: TreeNode) => addMigration(feature, node));
  register('dotnav.ef.removeLastMigration', (node?: TreeNode) => removeLastMigration(feature, node));
  register('dotnav.ef.listMigrations', (node?: TreeNode) => listMigrations(feature, node));
  register('dotnav.ef.updateDatabase', (node?: TreeNode) => updateDatabase(feature, node));
  register('dotnav.ef.generateScript', (node?: TreeNode) => generateScript(feature, node));
  register('dotnav.ef.dropDatabase', (node?: TreeNode) => dropDatabase(feature, node));
  register('dotnav.ef.dbContextInfo', (node?: TreeNode) => showDbContextInfo(feature, node));
}

// ── Target resolution (no CLI: everything comes from the static model) ───────

async function pickDetection(feature: EfFeature, node?: TreeNode): Promise<EfProjectDetection | undefined> {
  const detections = await feature.getDetections();
  if (detections.length === 0) {
    const choice = await vscode.window.showInformationMessage(
      'No EF Core projects were detected in this solution.',
      'Show Output'
    );
    if (choice === 'Show Output') {
      feature.cli.showOutput();
    }

    return undefined;
  }

  const nodeProject = node?.kind === 'project' ? node.project : undefined;
  if (nodeProject) {
    const matched = detections.find(detection => samePath(detection.project.path, nodeProject.path));
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

async function resolveTarget(feature: EfFeature, node?: TreeNode): Promise<EfTarget | undefined> {
  const detection = await pickDetection(feature, node);
  if (!detection) {
    return undefined;
  }

  const startupProjectPath = await feature.resolveStartupProject(detection) ?? detection.project.path;
  const model = await loadEfModel(detection.project.directory);
  const remembered = feature.configStore.getLastContext(detection.project.path);
  const contextName = model.contexts.some(context => context.name === remembered)
    ? remembered
    : model.contexts[0]?.name;

  return { detection, project: detection.project, startupProjectPath, contextName, model };
}

/** Startup project choices: every candidate plus the migrations project itself. */
function startupOptions(detection: EfProjectDetection): EfDialogOption[] {
  const candidates = [...detection.startupCandidates];
  if (!candidates.some(candidate => samePath(candidate.path, detection.project.path))) {
    candidates.push(detection.project);
  }

  return candidates.map(candidate => ({
    value: candidate.path,
    label: candidate.name,
    description: candidate.relativePath
  }));
}

function projectOptions(detections: readonly EfProjectDetection[]): EfDialogOption[] {
  return detections.map(detection => ({
    value: detection.project.path,
    label: detection.project.name,
    description: detection.project.relativePath
  }));
}

function contextOptions(model: ProjectEfModel): EfDialogOption[] {
  return model.contexts.map(context => ({
    value: context.name,
    label: context.name,
    description: context.fullName
  }));
}

function migrationOptions(migrations: readonly DiscoveredMigration[]): EfDialogOption[] {
  return [...migrations].reverse().map(migration => ({
    value: migration.name,
    label: migration.name,
    description: migration.id
  }));
}

/** Fields every dialog carries below its command-specific inputs. */
function commonFields(
  target: EfTarget,
  detections: readonly EfProjectDetection[],
  settings = readEfSettings()
): EfDialogSpec['fields'] {
  return [
    {
      id: FIELD.project,
      label: 'Migrations project',
      type: 'select',
      value: target.project.path,
      options: projectOptions(detections)
    },
    {
      id: FIELD.startup,
      label: 'Startup project',
      type: 'select',
      value: target.startupProjectPath,
      options: startupOptions(target.detection)
    },
    {
      id: FIELD.context,
      label: 'DbContext',
      type: 'select',
      value: target.contextName ?? '',
      options: contextOptions(target.model),
      description: target.model.contexts.length === 0
        ? 'No DbContext class was found in this project by source scan.'
        : undefined
    },
    {
      id: FIELD.configuration,
      label: 'Configuration',
      type: 'text',
      value: settings.configuration
    },
    {
      id: FIELD.noBuild,
      label: 'Skip build (--no-build)',
      type: 'checkbox',
      value: settings.noBuild === 'always',
      description: 'Much faster, but requires the project to already be built.'
    },
    {
      id: FIELD.extraArgs,
      label: 'Additional arguments',
      type: 'text',
      value: '',
      placeholder: 'e.g. --namespace MyApp.Data.Migrations'
    }
  ];
}

interface RunRequest {
  readonly args: readonly string[];
  readonly title: string;
  readonly write: boolean;
  readonly json?: boolean;
}

/** Turns dialog values into the concrete CLI invocation. */
function toRunOptions(feature: EfFeature, values: EfDialogValues, request: RunRequest) {
  const projectPath = String(values[FIELD.project] ?? '');
  const project = feature.findProject(projectPath);
  const extra = String(values[FIELD.extraArgs] ?? '').trim();
  const contextName = String(values[FIELD.context] ?? '').trim();

  return {
    project,
    startupProjectPath: String(values[FIELD.startup] ?? projectPath),
    contextName: contextName.length > 0 ? contextName : undefined,
    configuration: String(values[FIELD.configuration] ?? 'Debug').trim() || 'Debug',
    forceNoBuild: values[FIELD.noBuild] === true,
    args: [...request.args, ...(extra ? extra.split(/\s+/) : [])],
    title: request.title,
    write: request.write,
    json: request.json
  };
}

function previewCommand(feature: EfFeature, values: EfDialogValues, request: RunRequest): string {
  const options = toRunOptions(feature, values, request);
  if (!options.project) {
    return 'Select a migrations project.';
  }

  const settings = { ...readEfSettings(), configuration: options.configuration };
  const args = buildEfArgs(
    {
      args: options.args,
      project: options.project,
      startupProjectPath: options.startupProjectPath,
      contextName: options.contextName,
      title: options.title,
      write: options.write,
      json: options.json
    },
    { settings, noBuild: options.forceNoBuild }
  );
  return `dotnet ${args.join(' ')}`;
}

async function runFromValues(
  feature: EfFeature,
  values: EfDialogValues,
  request: RunRequest
): Promise<EfCommandResult | undefined> {
  const options = toRunOptions(feature, values, request);
  if (!options.project) {
    vscode.window.showErrorMessage('The selected migrations project could not be resolved.');
    return undefined;
  }

  if (!await feature.toolManager.ensureTool(options.project.directory)) {
    return undefined;
  }

  void feature.toolManager.warnOnVersionMismatch(options.project, options.project.directory);
  if (options.contextName) {
    await feature.configStore.setLastContext(options.project.path, options.contextName);
  }

  await feature.configStore.setStartupProject(options.project.path, options.startupProjectPath);

  const result = await feature.cli.run({
    args: options.args,
    project: options.project,
    startupProjectPath: options.startupProjectPath,
    contextName: options.contextName,
    title: options.title,
    write: options.write,
    json: options.json,
    configurationOverride: options.configuration,
    forceNoBuild: options.forceNoBuild
  });

  if (options.write) {
    // A write attempt — success, failure, or cancellation — can change files
    // on disk, so the static model must be re-read.
    feature.invalidateModel(options.project.directory);
  }

  return result;
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

async function addMigration(feature: EfFeature, node?: TreeNode): Promise<void> {
  const target = await resolveTarget(feature, node);
  if (!target) {
    return;
  }

  const detections = await feature.getDetections();
  let existingNames = target.model.migrations.map(migration => migration.name);

  const request = (values: EfDialogValues): RunRequest => ({
    args: ['migrations', 'add', String(values[FIELD.name] ?? '').trim()],
    title: `Adding migration '${String(values[FIELD.name] ?? '').trim()}'`,
    write: true
  });

  const values = await showEfDialog(
    {
      title: 'Add Migration',
      submitLabel: 'Create',
      fields: [
        {
          id: FIELD.name,
          label: 'Migration name',
          type: 'text',
          value: '',
          placeholder: 'e.g. AddOrderTable',
          required: true
        },
        ...commonFields(target, detections)
      ]
    },
    {
      preview: current => previewCommand(feature, current, request(current)),
      onChange: async (current, handle) => {
        const model = await feature.modelForProjectPath(String(current[FIELD.project] ?? ''));
        existingNames = model ? model.migrations.map(migration => migration.name) : existingNames;
        const problem = validateMigrationName(String(current[FIELD.name] ?? ''), existingNames);
        handle.setStatus(problem ?? '');
      }
    }
  );

  if (!values) {
    return;
  }

  const name = String(values[FIELD.name] ?? '').trim();
  const problem = validateMigrationName(name, existingNames);
  if (problem) {
    vscode.window.showErrorMessage(problem);
    return;
  }

  const result = await runFromValues(feature, values, request(values));
  if (!result) {
    return;
  }

  if (result.kind === 'error') {
    await reportEfFailure(feature.cli, `Adding migration '${name}'`, result);
    return;
  }

  if (result.kind === 'cancelled') {
    vscode.window.showWarningMessage(
      `Adding '${name}' was cancelled. If migration files were already generated, remove them with "EF Core: Remove Last Migration".`
    );
    return;
  }

  const project = feature.findProject(String(values[FIELD.project] ?? ''));
  const model = project ? await loadEfModel(project.directory) : undefined;
  const created = model?.migrations.find(migration => migration.name === name);
  if (created) {
    await vscode.window.showTextDocument(vscode.Uri.file(created.filePath), { preview: false });
  }

  const action = await vscode.window.showInformationMessage(`Migration '${name}' created.`, 'Update Database');
  if (action === 'Update Database') {
    await updateDatabase(feature, node);
  }
}

async function removeLastMigration(feature: EfFeature, node?: TreeNode): Promise<void> {
  const target = await resolveTarget(feature, node);
  if (!target) {
    return;
  }

  const migrations = migrationsForContext(target.model, target.contextName);
  const last = migrations[migrations.length - 1];
  if (!last) {
    vscode.window.showInformationMessage('There are no migrations to remove.');
    return;
  }

  const detections = await feature.getDetections();
  const request = (values: EfDialogValues): RunRequest => ({
    args: ['migrations', 'remove', ...(values['force'] === true ? ['--force'] : [])],
    title: 'Removing the last migration',
    write: true
  });

  const values = await showEfDialog(
    {
      title: 'Remove Last Migration',
      submitLabel: 'Remove',
      danger: true,
      warning:
        `This removes '${last.name}', the most recent migration in this project.\n` +
        'If it has already been applied to a database, roll the database back first or the schema and code go out of sync.',
      fields: [
        {
          id: 'force',
          label: 'Force removal even if applied (--force)',
          type: 'checkbox',
          value: false
        },
        ...commonFields(target, detections)
      ]
    },
    { preview: current => previewCommand(feature, current, request(current)) }
  );

  if (!values) {
    return;
  }

  const result = await runFromValues(feature, values, request(values));
  if (result?.kind === 'error') {
    await reportEfFailure(feature.cli, 'Removing the last migration', result);
  } else if (result?.kind === 'success') {
    vscode.window.showInformationMessage(`Migration '${last.name}' removed.`);
  }
}

async function listMigrations(feature: EfFeature, node?: TreeNode): Promise<void> {
  const target = await resolveTarget(feature, node);
  if (!target) {
    return;
  }

  const migrations = migrationsForContext(target.model, target.contextName);
  if (migrations.length === 0) {
    vscode.window.showInformationMessage('No migrations were found in this project.');
    return;
  }

  const picked = await vscode.window.showQuickPick(
    [...migrations].reverse().map(migration => ({
      label: migration.name,
      description: migration.id,
      migration
    })),
    {
      title: `Migrations — ${target.contextName ?? target.project.name} (${migrations.length})`,
      matchOnDescription: true
    }
  );
  if (picked) {
    await vscode.window.showTextDocument(vscode.Uri.file(picked.migration.filePath), { preview: false });
  }
}

async function updateDatabase(feature: EfFeature, node?: TreeNode): Promise<void> {
  const target = await resolveTarget(feature, node);
  if (!target) {
    return;
  }

  const detections = await feature.getDetections();
  const migrations = migrationsForContext(target.model, target.contextName);

  const request = (values: EfDialogValues): RunRequest => {
    const migration = String(values[FIELD.target] ?? '').trim();
    return {
      args: ['database', 'update', ...(migration ? [migration] : [])],
      title: migration ? `Updating database to '${migration}'` : 'Updating database',
      write: true
    };
  };

  const values = await showEfDialog(
    {
      title: 'Update Database',
      submitLabel: 'Update',
      danger: true,
      warning: 'Applying or reverting migrations changes the target database. Reverting can drop data.',
      fields: [
        {
          id: FIELD.target,
          label: 'Target migration',
          type: 'combo',
          value: '',
          options: migrationOptions(migrations),
          placeholder: 'Leave empty for the latest migration',
          description: 'Enter 0 to revert every migration. Use "Check database" to see what is already applied.'
        },
        ...commonFields(target, detections)
      ],
      actions: [{ id: 'check', label: 'Check database' }]
    },
    {
      preview: current => previewCommand(feature, current, request(current)),
      onAction: async (action, current, handle) => {
        if (action !== 'check') {
          return;
        }

        handle.setBusy(true);
        handle.setStatus('Checking the database…');
        try {
          const status = await fetchAppliedState(feature, current);
          handle.setStatus(status.summary);
          if (status.options.length > 0) {
            handle.setOptions(FIELD.target, status.options);
          }
        } finally {
          handle.setBusy(false);
        }
      }
    }
  );

  if (!values) {
    return;
  }

  const result = await runFromValues(feature, values, request(values));
  if (!result) {
    return;
  }

  if (result.kind === 'error') {
    await reportEfFailure(feature.cli, 'Updating the database', result);
  } else if (result.kind === 'cancelled') {
    vscode.window.showWarningMessage(
      'The database update was cancelled mid-run. The database may be in a partial state — run "Check database" to verify.'
    );
  } else {
    vscode.window.showInformationMessage('Database updated.');
  }
}

/** The one place that talks to the database, and only on explicit request. */
async function fetchAppliedState(
  feature: EfFeature,
  values: EfDialogValues
): Promise<{ summary: string; options: EfDialogOption[] }> {
  const result = await runFromValues(feature, values, {
    args: ['migrations', 'list'],
    title: 'Checking applied migrations',
    write: false,
    json: true
  });

  if (!result) {
    return { summary: 'Could not start the check.', options: [] };
  }

  if (result.kind !== 'success') {
    return {
      summary: result.errorSummary
        ? `Could not read the database: ${maskConnectionString(result.errorSummary)}`
        : 'Could not read the database.',
      options: []
    };
  }

  const entries = parseMigrationsList(result.stdout) ?? [];
  if (entries.length === 0) {
    return { summary: 'The database reports no migrations.', options: [] };
  }

  const applied = entries.filter(entry => entry.applied === true);
  const pending = entries.filter(entry => entry.applied === false);
  const options = [...entries].reverse().map(entry => ({
    value: entry.name,
    label: entry.name,
    description: entry.applied === true ? 'applied' : entry.applied === false ? 'pending' : 'unknown'
  }));

  return {
    summary: `${applied.length} applied, ${pending.length} pending.` +
      (pending.length > 0 ? ` Next: ${pending[0].name}` : ' The database is up to date.'),
    options
  };
}

async function generateScript(feature: EfFeature, node?: TreeNode): Promise<void> {
  const target = await resolveTarget(feature, node);
  if (!target) {
    return;
  }

  const detections = await feature.getDetections();
  const migrations = migrationsForContext(target.model, target.contextName);
  const outputPath = path.join(os.tmpdir(), `dotnav-ef-script-${Date.now()}.sql`);

  const request = (values: EfDialogValues): RunRequest => {
    const from = String(values[FIELD.from] ?? '').trim();
    const to = String(values[FIELD.to] ?? '').trim();
    const range = from || to ? [from || '0', ...(to ? [to] : [])] : [];
    return {
      args: [
        'migrations', 'script',
        ...range,
        ...(values[FIELD.idempotent] === true ? ['--idempotent'] : []),
        '--output', outputPath
      ],
      title: 'Generating SQL script',
      write: false
    };
  };

  const values = await showEfDialog(
    {
      title: 'Generate SQL Script',
      submitLabel: 'Generate',
      fields: [
        {
          id: FIELD.from,
          label: 'From migration (exclusive)',
          type: 'combo',
          value: '',
          options: migrationOptions(migrations),
          placeholder: 'Leave empty to start from an empty database'
        },
        {
          id: FIELD.to,
          label: 'To migration (inclusive)',
          type: 'combo',
          value: '',
          options: migrationOptions(migrations),
          placeholder: 'Leave empty for the latest migration'
        },
        {
          id: FIELD.idempotent,
          label: 'Idempotent script (--idempotent)',
          type: 'checkbox',
          value: false,
          description: 'Safe to run against a database at any migration.'
        },
        ...commonFields(target, detections)
      ]
    },
    { preview: current => previewCommand(feature, current, request(current)) }
  );

  if (!values) {
    return;
  }

  const result = await runFromValues(feature, values, request(values));
  if (!result) {
    return;
  }

  if (result.kind === 'error') {
    await reportEfFailure(feature.cli, 'Generating the SQL script', result);
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

async function dropDatabase(feature: EfFeature, node?: TreeNode): Promise<void> {
  const target = await resolveTarget(feature, node);
  if (!target) {
    return;
  }

  const detections = await feature.getDetections();
  const expected = target.contextName ?? target.project.name;
  const request = (): RunRequest => ({
    args: ['database', 'drop', '--force'],
    title: 'Dropping the database',
    write: true
  });

  const values = await showEfDialog(
    {
      title: 'Drop Database',
      submitLabel: 'Drop Database',
      danger: true,
      warning:
        'This deletes the entire database for the selected DbContext. THIS CANNOT BE UNDONE.\n' +
        `Type ${expected} in the confirmation field to enable the button.`,
      fields: [
        {
          id: 'confirm',
          label: `Type "${expected}" to confirm`,
          type: 'text',
          value: '',
          required: true,
          placeholder: expected
        },
        ...commonFields(target, detections)
      ]
    },
    {
      preview: current => previewCommand(feature, current, request()),
      onChange: (current, handle) => {
        const typed = String(current['confirm'] ?? '').trim();
        const wanted = String(current[FIELD.context] ?? '').trim() || expected;
        handle.setStatus(typed === wanted ? '' : `Type "${wanted}" exactly to confirm.`);
      }
    }
  );

  if (!values) {
    return;
  }

  const wanted = String(values[FIELD.context] ?? '').trim() || expected;
  if (String(values['confirm'] ?? '').trim() !== wanted) {
    vscode.window.showWarningMessage('The confirmation text did not match. The database was not dropped.');
    return;
  }

  const result = await runFromValues(feature, values, request());
  if (result?.kind === 'error') {
    await reportEfFailure(feature.cli, 'Dropping the database', result);
  } else if (result?.kind === 'success') {
    vscode.window.showInformationMessage('Database dropped.');
  }
}

async function showDbContextInfo(feature: EfFeature, node?: TreeNode): Promise<void> {
  const target = await resolveTarget(feature, node);
  if (!target) {
    return;
  }

  const detections = await feature.getDetections();
  const request = (): RunRequest => ({
    args: ['dbcontext', 'info'],
    title: 'Reading DbContext info',
    write: false,
    json: true
  });

  const values = await showEfDialog(
    {
      title: 'DbContext Info',
      submitLabel: 'Read Info',
      warning: 'Reading DbContext info builds the project and resolves the configured connection.',
      fields: commonFields(target, detections)
    },
    { preview: current => previewCommand(feature, current, request()) }
  );

  if (!values) {
    return;
  }

  const result = await runFromValues(feature, values, request());
  if (!result) {
    return;
  }

  if (result.kind === 'error') {
    await reportEfFailure(feature.cli, 'Reading DbContext info', result);
    return;
  }

  if (result.kind !== 'success') {
    return;
  }

  const info = parseDbContextInfo(result.stdout);
  const lines = [
    values[FIELD.context] ? `DbContext: ${values[FIELD.context]}` : undefined,
    info?.providerName ? `Provider: ${info.providerName}` : undefined,
    info?.databaseName ? `Database: ${info.databaseName}` : undefined,
    info?.dataSource ? `Data source: ${maskConnectionString(info.dataSource)}` : undefined
  ].filter((line): line is string => Boolean(line));

  const choice = await vscode.window.showInformationMessage(
    lines.length > 0 ? lines.join('\n') : 'No DbContext info was returned.',
    { modal: true },
    'Show Output'
  );
  if (choice === 'Show Output') {
    feature.cli.showOutput();
  }
}
