import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { ProjectModel, TreeNode } from '../models';
import { samePath } from '../pathUtils';
import { EfCommandResult, buildEfArgs, readEfSettings, reportEfFailure } from './efCli';
import {
  bundleArgs,
  optimizeArgs,
  removeMigrationArgs,
  scriptArgs,
  updateDatabaseArgs
} from './efActionArgs';
import { parseAdditionalArguments } from './efArguments';
import { capabilitiesForVersions, EfCapabilities } from './efCapabilities';
import { EfProjectDetection } from './efDetection';
import { planDatabaseUpdate } from './efDatabasePlan';
import {
  EfDialogOption,
  EfDialogSpec,
  EfDialogValues,
  EfProgressStepState,
  setEfCenterBusy,
  setEfCenterProgress,
  showEfDialog
} from './efDialog';
import {
  databaseNameFromConnectionString,
  maskConnectionString,
  parseDbContextInfo,
  parseMigrationsList,
  validateMigrationName
} from './efJsonParser';
import { DiscoveredMigration, ProjectEfModel, loadEfModel, migrationsForContext } from './efModel';
import type { EfFeature } from './efMain';

interface EfTarget {
  readonly detection: EfProjectDetection;
  readonly project: ProjectModel;
  readonly startupProjectPath: string;
  readonly contextName?: string;
  readonly model: ProjectEfModel;
  readonly capabilities: EfCapabilities;
}

type EfCommandSource = TreeNode | string;

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
  connection: 'connection',
  extraArgs: 'extraArgs',
  output: 'output',
  outputDir: 'outputDir',
  namespace: 'namespace',
  suffix: 'suffix',
  runtime: 'runtime',
  selfContained: 'selfContained'
} as const;

export function registerEfCommands(context: vscode.ExtensionContext, feature: EfFeature): void {
  const register = (id: string, handler: (...args: never[]) => unknown) =>
    context.subscriptions.push(vscode.commands.registerCommand(id, handler as (...args: unknown[]) => unknown));

  register('dotnav.ef.refresh', () => feature.refreshAll());
  register('dotnav.ef.showOutput', () => feature.cli.showOutput());
  register('dotnav.ef.openSettings', () =>
    vscode.commands.executeCommand('workbench.action.openSettings', 'dotnav.ef'));
  register('dotnav.ef.installTool', (node?: EfCommandSource) => installTool(feature, node));
  register('dotnav.ef.openCenter', (node?: EfCommandSource) => addMigration(feature, node));
  register('dotnav.ef.addMigration', (node?: EfCommandSource) => addMigration(feature, node));
  register('dotnav.ef.removeLastMigration', (node?: EfCommandSource) => removeLastMigration(feature, node));
  register('dotnav.ef.listMigrations', (node?: EfCommandSource) => listMigrations(feature, node));
  register('dotnav.ef.updateDatabase', (node?: EfCommandSource) => updateDatabase(feature, node));
  register('dotnav.ef.generateScript', (node?: EfCommandSource) => generateScript(feature, node));
  register('dotnav.ef.dropDatabase', (node?: EfCommandSource) => dropDatabase(feature, node));
  register('dotnav.ef.dbContextInfo', (node?: EfCommandSource) => showDbContextInfo(feature, node));
  register('dotnav.ef.pendingModelChanges', (node?: EfCommandSource) => checkPendingModelChanges(feature, node));
  register('dotnav.ef.migrationsBundle', (node?: EfCommandSource) => createMigrationBundle(feature, node));
  register('dotnav.ef.optimizeDbContext', (node?: EfCommandSource) => optimizeDbContext(feature, node));
}

// ── Target resolution (no CLI: everything comes from the static model) ───────

async function pickDetection(feature: EfFeature, node?: EfCommandSource): Promise<EfProjectDetection | undefined> {
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

  const nodeProject = typeof node !== 'string' && node?.kind === 'project' ? node.project : undefined;
  const requestedPath = typeof node === 'string' ? node : nodeProject?.path;
  if (requestedPath) {
    const matched = detections.find(detection => samePath(detection.project.path, requestedPath));
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

async function resolveTarget(feature: EfFeature, node?: EfCommandSource): Promise<EfTarget | undefined> {
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

  const toolStatus = feature.toolManager.peekStatus(detection.project.directory);
  const designVersion = detection.project.packageReferences
    .find(pkg => /^Microsoft\.EntityFrameworkCore\.(Design|Tools)$/i.test(pkg.name))?.version;
  const capabilities = capabilitiesForVersions(designVersion, toolStatus?.version);

  return { detection, project: detection.project, startupProjectPath, contextName, model, capabilities };
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
    description: path.dirname(candidate.relativePath)
  }));
}

function projectOptions(detections: readonly EfProjectDetection[]): EfDialogOption[] {
  return detections.map(detection => ({
    value: detection.project.path,
    label: detection.project.name,
    description: path.dirname(detection.project.relativePath)
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
    description: formatMigrationDate(migration.id)
  }));
}

function centerIdentity(target: EfTarget, actionId: string) {
  return {
    actionId,
    projectLabel: target.project.name,
    contextLabel: target.contextName ?? 'No DbContext detected',
    toolLabel: `EF Core ${target.capabilities.major}`
  };
}

function databaseTargetKey(values: EfDialogValues): string {
  return [
    values[FIELD.project],
    values[FIELD.startup],
    values[FIELD.context],
    values[FIELD.connection]
  ].map(value => String(value ?? '')).join('\u0000');
}

/** `20260715035930_X` -> `2026-07-15`, so the dim column stays scannable. */
function formatMigrationDate(id: string): string {
  const match = /^(\d{4})(\d{2})(\d{2})/.exec(id);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : id;
}

interface CommonFieldOptions {
  /** Commands that reach the database also accept an explicit connection. */
  readonly connection?: boolean;
}

/** Fields every dialog carries below its command-specific inputs. */
function commonFields(
  target: EfTarget,
  detections: readonly EfProjectDetection[],
  options: CommonFieldOptions = {},
  settings = readEfSettings()
): EfDialogSpec['fields'] {
  return [
    {
      id: FIELD.project,
      label: 'Migrations project',
      type: 'combo',
      strict: true,
      value: target.project.path,
      options: projectOptions(detections)
    },
    {
      id: FIELD.startup,
      label: 'Startup project',
      type: 'combo',
      strict: true,
      value: target.startupProjectPath,
      options: startupOptions(target.detection)
    },
    {
      id: FIELD.context,
      label: 'DbContext',
      type: 'combo',
      strict: true,
      value: target.contextName ?? '',
      options: contextOptions(target.model),
      description: target.model.contexts.length === 0
        ? 'No DbContext class was found in this project by source scan.'
        : undefined
    },
    ...(options.connection
      ? [{
        id: FIELD.connection,
        label: 'Connection string',
        type: 'password' as const,
        value: '',
        placeholder: 'Leave empty to use the startup project configuration',
        description: 'Overrides the connection resolved from appsettings. ' +
          'Accepts Name=ConnectionStrings:Something too.'
      }]
      : []),
    {
      id: FIELD.configuration,
      label: 'Configuration',
      type: 'text',
      value: settings.configuration,
      advanced: true
    },
    {
      id: FIELD.noBuild,
      label: 'Skip build (--no-build)',
      type: 'checkbox',
      value: settings.noBuild === 'always',
      description: 'Much faster, but requires the project to already be built.',
      advanced: true
    },
    {
      id: FIELD.extraArgs,
      label: 'Additional arguments',
      type: 'text',
      value: '',
      placeholder: 'e.g. --namespace MyApp.Data.Migrations',
      advanced: true
    }
  ];
}

class EfTargetCascade {
  private revision = 0;
  private projectPath: string;
  private contextName: string;

  constructor(
    private readonly feature: EfFeature,
    private readonly detections: readonly EfProjectDetection[],
    initial: EfTarget,
    private readonly migrationFields: readonly string[] = []
  ) {
    this.projectPath = initial.project.path;
    this.contextName = initial.contextName ?? '';
  }

  async update(values: EfDialogValues, handle: import('./efDialog').EfDialogHandle): Promise<void> {
    const projectPath = String(values[FIELD.project] ?? '');
    const contextName = String(values[FIELD.context] ?? '');
    if (projectPath === this.projectPath && contextName === this.contextName) {
      return;
    }

    const revision = ++this.revision;
    const detection = this.detections.find(candidate => samePath(candidate.project.path, projectPath));
    if (!detection) {
      handle.setValid(false);
      handle.setStatus('The selected migrations project is no longer available.', true);
      return;
    }

    const projectChanged = projectPath !== this.projectPath;
    this.projectPath = projectPath;
    const model = await this.feature.modelForProjectPath(projectPath);
    if (!model || revision !== this.revision) {
      return;
    }

    let selectedContext = contextName;
    if (projectChanged || !model.contexts.some(context => context.name === selectedContext)) {
      const remembered = this.feature.configStore.getLastContext(projectPath);
      selectedContext = model.contexts.some(context => context.name === remembered)
        ? remembered!
        : model.contexts[0]?.name ?? '';
    }
    this.contextName = selectedContext;

    if (projectChanged) {
      const startup = await this.feature.resolveStartupProject(detection) ?? projectPath;
      if (revision !== this.revision) {
        return;
      }
      handle.setOptions(FIELD.startup, startupOptions(detection), startup);
      handle.setOptions(FIELD.context, contextOptions(model), selectedContext);
    }

    const migrations = migrationsForContext(model, selectedContext || undefined);
    for (const field of this.migrationFields) {
      handle.setOptions(field, migrationOptions(migrations), '');
    }
    handle.setValid(model.contexts.length > 0);
    handle.setStatus(
      model.contexts.length > 0 ? '' : 'No DbContext class was found in the selected project.',
      model.contexts.length === 0
    );
  }
}

interface RunRequest {
  readonly args: readonly string[];
  readonly title: string;
  readonly write: boolean;
  readonly json?: boolean;
  readonly acceptsConnection?: boolean;
}

/** Turns dialog values into the concrete CLI invocation. */
function toRunOptions(feature: EfFeature, values: EfDialogValues, request: RunRequest) {
  const projectPath = String(values[FIELD.project] ?? '');
  const project = feature.findProject(projectPath);
  const extra = String(values[FIELD.extraArgs] ?? '').trim();
  const parsedExtra = parseAdditionalArguments(extra);
  const contextName = String(values[FIELD.context] ?? '').trim();
  const connection = String(values[FIELD.connection] ?? '').trim();

  return {
    project,
    startupProjectPath: String(values[FIELD.startup] ?? projectPath),
    contextName: contextName.length > 0 ? contextName : undefined,
    configuration: String(values[FIELD.configuration] ?? 'Debug').trim() || 'Debug',
    forceNoBuild: values[FIELD.noBuild] === true,
    args: [
      ...request.args,
      ...(request.acceptsConnection && connection ? ['--connection', connection] : []),
      ...parsedExtra.args
    ],
    argumentError: parsedExtra.error,
    title: request.title,
    write: request.write,
    json: request.json
  };
}

/**
 * Command line shown in the dialog. Absolute solution paths are shortened to
 * workspace-relative and any connection string is masked, so the preview stays
 * readable and safe to screenshot.
 */
export function formatPreview(args: readonly string[], workspaceRoot?: string): string {
  const quote = (argument: string) => {
    const short = workspaceRoot && argument.startsWith(workspaceRoot + path.sep)
      ? argument.slice(workspaceRoot.length + 1)
      : argument;
    return /\s/.test(short) ? `"${short}"` : short;
  };

  // Positional arguments stay on the first line; each option starts a new one
  // with its value, so nothing has to wrap mid-path.
  const head: string[] = ['dotnet'];
  const lines: string[] = [];
  let index = 0;
  for (; index < args.length; index += 1) {
    if (args[index].startsWith('--')) {
      break;
    }

    head.push(quote(args[index]));
  }

  for (; index < args.length; index += 1) {
    const argument = args[index];
    const next = args[index + 1];
    if (argument.startsWith('--') && next !== undefined && !next.startsWith('--')) {
      lines.push(`  ${argument} ${quote(next)}`);
      index += 1;
    } else {
      lines.push(`  ${argument}`);
    }
  }

  return maskConnectionString([head.join(' '), ...lines].join('\n'));
}

function previewCommand(feature: EfFeature, values: EfDialogValues, request: RunRequest): string {
  const options = toRunOptions(feature, values, request);
  if (!options.project) {
    return 'Select a migrations project.';
  }
  if (options.argumentError) {
    return options.argumentError;
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
  const workspaceRoot = options.project
    ? vscode.workspace.getWorkspaceFolder(vscode.Uri.file(options.project.path))?.uri.fsPath
    : undefined;
  return formatPreview(args, workspaceRoot);
}

async function runFromValues(
  feature: EfFeature,
  values: EfDialogValues,
  request: RunRequest,
  /** The startup project the dialog opened with, so only real edits persist. */
  defaultStartupProjectPath?: string
): Promise<EfCommandResult | undefined> {
  const options = toRunOptions(feature, values, request);
  const stageLabels = [
    'Validate configuration',
    'Prepare dotnet-ef',
    request.acceptsConnection
      ? 'Build, connect, and execute'
      : 'Build and execute EF Core command',
    options.write ? 'Refresh changed files' : 'Process command result'
  ];
  const reportProgress = (
    activeIndex: number,
    state: 'running' | 'success' | 'error' | 'cancelled',
    detail?: string
  ) => {
    setEfCenterProgress({
      title: request.title,
      state,
      steps: stageLabels.map((label, index) => {
        let stepState: EfProgressStepState = index < activeIndex ? 'complete' : 'pending';
        if (index === activeIndex && state === 'running') {
          stepState = 'active';
        } else if (index === activeIndex && state === 'error') {
          stepState = 'error';
        } else if (state === 'success') {
          stepState = 'complete';
        }
        return { label, state: stepState, detail: index === activeIndex ? detail : undefined };
      })
    });
  };

  reportProgress(0, 'running');
  if (!options.project) {
    vscode.window.showErrorMessage('The selected migrations project could not be resolved.');
    setEfCenterBusy(false, 'The selected migrations project could not be resolved.', true);
    reportProgress(0, 'error', 'The migrations project could not be resolved.');
    return undefined;
  }
  if (options.argumentError) {
    vscode.window.showErrorMessage(options.argumentError);
    setEfCenterBusy(false, options.argumentError, true);
    reportProgress(0, 'error', options.argumentError);
    return undefined;
  }

  reportProgress(1, 'running');
  if (!await feature.toolManager.ensureTool(options.project.directory)) {
    setEfCenterBusy(false, 'dotnet-ef is required to run this command.', true);
    reportProgress(1, 'error', 'dotnet-ef is required to run this command.');
    return undefined;
  }

  void feature.toolManager.warnOnVersionMismatch(options.project, options.project.directory);
  if (options.contextName) {
    await feature.configStore.setLastContext(options.project.path, options.contextName);
  }

  // Persist only an explicit override; otherwise a one-off run would pin a
  // default the user never chose.
  if (defaultStartupProjectPath && !samePath(options.startupProjectPath, defaultStartupProjectPath)) {
    await feature.configStore.setStartupProject(options.project.path, options.startupProjectPath);
  }

  reportProgress(
    2,
    'running',
    request.acceptsConnection
      ? 'EF Core is loading the project and connecting to the selected database.'
      : 'EF Core is loading the selected project.'
  );
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

  if (result.kind === 'success') {
    reportProgress(3, 'running');
  }
  if (options.write) {
    // A write attempt — success, failure, or cancellation — can change files
    // on disk, so the static model must be re-read.
    feature.invalidateModel(options.project.directory);
  }

  setEfCenterBusy(
    false,
    result.kind === 'success'
      ? `Completed in ${(result.durationMs / 1000).toFixed(1)}s.`
      : result.errorSummary ?? (result.kind === 'cancelled' ? 'Command cancelled.' : 'Command failed.'),
    result.kind === 'error'
  );
  reportProgress(
    result.kind === 'success' ? 4 : 2,
    result.kind === 'success' ? 'success' : result.kind === 'cancelled' ? 'cancelled' : 'error',
    result.kind === 'success'
      ? `Completed in ${(result.durationMs / 1000).toFixed(1)}s.`
      : result.errorSummary
  );
  return result;
}

// ── Commands ─────────────────────────────────────────────────────────────────

async function installTool(feature: EfFeature, source?: EfCommandSource): Promise<void> {
  const detections = await feature.getDetections();
  const requestedPath = typeof source === 'string'
    ? source
    : source?.kind === 'project'
      ? source.project?.path
      : undefined;
  const requested = requestedPath
    ? detections.find(detection => samePath(detection.project.path, requestedPath))
    : undefined;
  const cwd = requested?.project.directory ??
    detections[0]?.project.directory ??
    vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!cwd) {
    vscode.window.showInformationMessage('Open a workspace before installing dotnet-ef.');
    return;
  }

  const status = await feature.toolManager.getStatus(cwd);
  const choice = await vscode.window.showQuickPick(
    [
      {
        label: status.installed ? '$(tools) Install or Update Local Tool' : '$(tools) Install Local Tool',
        description: 'Recommended — pinned by the repository tool manifest',
        global: false
      },
      {
        label: status.installed ? '$(globe) Update Global Tool' : '$(globe) Install Global Tool',
        description: 'Available to every workspace for the current user',
        global: true
      }
    ],
    {
      title: status.installed
        ? `Manage dotnet-ef — current resolved version ${status.version}`
        : 'Manage dotnet-ef — no resolved tool'
    }
  );
  if (choice) {
    await feature.toolManager.install(cwd, choice.global);
  }
}

async function addMigration(feature: EfFeature, node?: EfCommandSource): Promise<void> {
  const target = await resolveTarget(feature, node);
  if (!target) {
    return;
  }

  const detections = await feature.getDetections();
  let existingNames = target.model.migrations.map(migration => migration.name);
  let lastScannedProject = target.project.path;
  const cascade = new EfTargetCascade(feature, detections, target);

  const request = (values: EfDialogValues): RunRequest => ({
    args: ['migrations', 'add', String(values[FIELD.name] ?? '').trim()],
    title: `Adding migration '${String(values[FIELD.name] ?? '').trim()}'`,
    write: true
  });

  const values = await showEfDialog(
    {
      ...centerIdentity(target, 'dotnav.ef.addMigration'),
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
        await cascade.update(current, handle);
        // Rescan only when the project changes: loadEfModel stats every source
        // file, which is far too heavy to run on each keystroke.
        const projectPath = String(current[FIELD.project] ?? '');
        if (projectPath !== lastScannedProject) {
          lastScannedProject = projectPath;
          const model = await feature.modelForProjectPath(projectPath);
          if (model) {
            existingNames = model.migrations.map(migration => migration.name);
          }
        }

        const problem = validateMigrationName(String(current[FIELD.name] ?? ''), existingNames);
        handle.setStatus(problem ?? '', Boolean(problem));
        handle.setValid(!problem);
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

  const result = await runFromValues(feature, values, request(values), target.startupProjectPath);
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

async function removeLastMigration(feature: EfFeature, node?: EfCommandSource): Promise<void> {
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
  const cascade = new EfTargetCascade(feature, detections, target);
  const request = (values: EfDialogValues): RunRequest => ({
    args: removeMigrationArgs({
      force: values['force'] === true,
      offline: values['offline'] === true
    }),
    title: 'Removing the last migration',
    write: true,
    acceptsConnection: target.capabilities.removeConnection
  });

  const values = await showEfDialog(
    {
      ...centerIdentity(target, 'dotnav.ef.removeLastMigration'),
      title: 'Remove Last Migration',
      submitLabel: 'Remove',
      danger: true,
      warning:
        'This removes the most recent migration in the selected project.\n' +
        'If it has already been applied to a database, roll the database back first or the schema and code go out of sync.',
      fields: [
        {
          id: 'force',
          label: 'Force removal even if applied (--force)',
          type: 'checkbox',
          value: false
        },
        ...(target.capabilities.removeOffline
          ? [{
            id: 'offline',
            label: 'Remove without connecting to the database (--offline)',
            type: 'checkbox' as const,
            value: false,
            description: 'EF Core 11+. Cannot be combined with Force.'
          }]
          : []),
        ...commonFields(target, detections, { connection: target.capabilities.removeConnection })
      ]
    },
    {
      preview: current => previewCommand(feature, current, request(current)),
      // The warning names a migration, so it has to follow the project and
      // context the user actually has selected.
      onChange: async (current, handle) => {
        await cascade.update(current, handle);
        const doomed = await resolveLastMigration(feature, current);
        const mutuallyExclusive = current['force'] === true && current['offline'] === true;
        handle.setStatus(
          mutuallyExclusive
            ? 'Force and Offline cannot be enabled together.'
            : doomed
            ? `Will remove '${doomed.name}' (${formatMigrationDate(doomed.id)}).`
            : 'No migrations were found for this project and DbContext.',
          !doomed || mutuallyExclusive
        );
        handle.setValid(Boolean(doomed) && !mutuallyExclusive);
      }
    }
  );

  if (!values) {
    return;
  }

  const doomed = await resolveLastMigration(feature, values) ?? last;
  const result = await runFromValues(feature, values, request(values), target.startupProjectPath);
  if (result?.kind === 'error') {
    await reportEfFailure(feature.cli, 'Removing the last migration', result);
  } else if (result?.kind === 'success') {
    vscode.window.showInformationMessage(`Migration '${doomed.name}' removed.`);
  }
}

/** The migration `migrations remove` would delete for the current selection. */
async function resolveLastMigration(
  feature: EfFeature,
  values: EfDialogValues
): Promise<DiscoveredMigration | undefined> {
  const model = await feature.modelForProjectPath(String(values[FIELD.project] ?? ''));
  if (!model) {
    return undefined;
  }

  const contextName = String(values[FIELD.context] ?? '').trim() || undefined;
  const migrations = migrationsForContext(model, contextName);
  return migrations[migrations.length - 1];
}

async function listMigrations(feature: EfFeature, node?: EfCommandSource): Promise<void> {
  const target = await resolveTarget(feature, node);
  if (!target) {
    return;
  }

  const detections = await feature.getDetections();
  const cascade = new EfTargetCascade(feature, detections, target);
  const values = await showEfDialog(
    {
      ...centerIdentity(target, 'dotnav.ef.listMigrations'),
      title: 'Browse Migrations',
      submitLabel: 'Open Migration Browser',
      hideCommandPreview: true,
      fields: commonFields(target, detections).filter(field =>
        field.id === FIELD.project || field.id === FIELD.context)
    },
    {
      preview: () => '',
      onChange: (current, handle) => cascade.update(current, handle)
    }
  );
  if (!values) {
    return;
  }

  const projectPath = String(values[FIELD.project] ?? '');
  const contextName = String(values[FIELD.context] ?? '').trim() || undefined;
  const project = feature.findProject(projectPath);
  const model = project ? await feature.modelForProjectPath(projectPath) : undefined;
  const migrations = model ? migrationsForContext(model, contextName) : [];
  if (migrations.length === 0) {
    vscode.window.showInformationMessage('No migrations were found in this project.');
    return;
  }

  interface MigrationPickItem extends vscode.QuickPickItem {
    readonly migration: DiscoveredMigration;
  }
  const picker = vscode.window.createQuickPick<MigrationPickItem>();
  picker.title = `Browse Migrations — ${contextName ?? project?.name ?? target.project.name}`;
  picker.placeholder = 'Select a migration to open it; use the button to copy its name';
  picker.matchOnDescription = true;
  picker.matchOnDetail = true;
  const sortOrder = vscode.workspace.getConfiguration('dotnav.ef')
    .get<'oldestFirst' | 'newestFirst'>('migrationsSortOrder', 'oldestFirst');
  const orderedMigrations = sortOrder === 'newestFirst' ? [...migrations].reverse() : [...migrations];
  picker.items = orderedMigrations.map(migration => ({
    label: `$(file-code) ${migration.name}`,
    description: formatMigrationDate(migration.id),
    detail: vscode.workspace.asRelativePath(migration.filePath),
    buttons: [{ iconPath: new vscode.ThemeIcon('copy'), tooltip: 'Copy migration name' }],
    migration
  }));
  picker.onDidAccept(() => {
    const selected = picker.selectedItems[0];
    if (selected) {
      void vscode.window.showTextDocument(vscode.Uri.file(selected.migration.filePath), { preview: false });
    }
    picker.hide();
  });
  picker.onDidTriggerItemButton(event => {
    void vscode.env.clipboard.writeText(event.item.migration.name);
    picker.title = `Copied ${event.item.migration.name}`;
  });
  picker.onDidHide(() => picker.dispose());
  picker.show();
}

async function updateDatabase(feature: EfFeature, node?: EfCommandSource): Promise<void> {
  const target = await resolveTarget(feature, node);
  if (!target) {
    return;
  }

  const detections = await feature.getDetections();
  const migrations = migrationsForContext(target.model, target.contextName);
  const cascade = new EfTargetCascade(feature, detections, target, [FIELD.target]);
  let checkedState: EfDatabaseState | undefined;
  let checkedTargetKey: string | undefined;
  let updateExistingProject = target.project.path;
  let updateExistingNames = migrations.map(migration => migration.name);

  const request = (values: EfDialogValues): RunRequest => {
    const migration = String(values[FIELD.target] ?? '').trim();
    return {
      args: updateDatabaseArgs({
        target: migration,
        add: values['add'] === true,
        outputDirectory: String(values[FIELD.outputDir] ?? '').trim(),
        namespaceName: String(values[FIELD.namespace] ?? '').trim()
      }),
      title: migration ? `Updating database to '${migration}'` : 'Updating database',
      write: true,
      acceptsConnection: true
    };
  };

  const values = await showEfDialog(
    {
      ...centerIdentity(target, 'dotnav.ef.updateDatabase'),
      title: 'Update Database',
      submitLabel: 'Update',
      warning: 'Applying or reverting migrations changes the target database. Reverting can drop data.',
      fields: [
        {
          id: FIELD.target,
          label: 'Target migration',
          type: 'combo',
          value: '',
          options: migrationOptions(migrations),
          placeholder: 'Leave empty for the latest migration',
          description: 'Enter 0 to revert every migration.',
          action: { id: 'check', label: 'Check database' }
        },
        ...(target.capabilities.updateAdd
          ? [{
            id: 'add',
            label: 'Create and apply a migration for pending model changes (--add)',
            type: 'checkbox' as const,
            value: false,
            description: 'EF Core 11+. Target migration becomes the new migration name.'
          }, {
            id: FIELD.outputDir,
            label: 'New migration output directory',
            type: 'text' as const,
            value: '',
            placeholder: 'e.g. Migrations/Products',
            advanced: true
          }, {
            id: FIELD.namespace,
            label: 'New migration namespace',
            type: 'text' as const,
            value: '',
            placeholder: 'e.g. App.Migrations',
            advanced: true
          }]
          : []),
        ...commonFields(target, detections, { connection: true })
      ]
    },
    {
      preview: current => previewCommand(feature, current, request(current)),
      onChange: async (current, handle) => {
        await cascade.update(current, handle);
        if (checkedTargetKey !== databaseTargetKey(current)) {
          checkedState = undefined;
          checkedTargetKey = undefined;
          handle.setSubmit('Update');
        }
        if (current['add'] === true) {
          const migrationName = String(current[FIELD.target] ?? '').trim();
          const projectPath = String(current[FIELD.project] ?? '');
          if (projectPath !== updateExistingProject) {
            updateExistingProject = projectPath;
            const selectedModel = await feature.modelForProjectPath(projectPath);
            updateExistingNames = selectedModel?.migrations.map(migration => migration.name) ?? [];
          }
          const problem = validateMigrationName(
            migrationName,
            updateExistingNames
          );
          handle.setSubmit('Create and Apply Migration');
          handle.setStatus(problem ?? 'EF Core will create this migration and apply it in one operation.', Boolean(problem));
          handle.setValid(!problem);
          return;
        }
        if (checkedState) {
          updateDatabaseSubmit(current, checkedState, handle);
        }
      },
      onAction: async (action, current, handle) => {
        if (action !== 'check') {
          return;
        }

        handle.setBusy(true);
        handle.setStatus('Checking the database…');
        try {
          const status = await fetchAppliedState(feature, current);
          checkedState = status;
          checkedTargetKey = databaseTargetKey(current);
          handle.setStatus(status.summary);
          if (status.options.length > 0) {
            handle.setOptions(FIELD.target, status.options);
          }
          updateDatabaseSubmit(current, status, handle);
        } finally {
          handle.setBusy(false);
        }
      }
    }
  );

  if (!values) {
    return;
  }

  const result = await runFromValues(feature, values, request(values), target.startupProjectPath);
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

interface EfDatabaseState {
  readonly summary: string;
  readonly options: EfDialogOption[];
  readonly orderedNames: readonly string[];
  readonly appliedNames: ReadonlySet<string>;
}

function updateDatabaseSubmit(
  values: EfDialogValues,
  state: EfDatabaseState,
  handle: import('./efDialog').EfDialogHandle
): void {
  const target = String(values[FIELD.target] ?? '').trim();
  const plan = planDatabaseUpdate(state.orderedNames, state.appliedNames, target);
  handle.setSubmit(plan.label, plan.danger);
  handle.setValid(plan.valid);
}

/** The one place that talks to the database, and only on explicit request. */
async function fetchAppliedState(
  feature: EfFeature,
  values: EfDialogValues
): Promise<EfDatabaseState> {
  const result = await runFromValues(feature, values, {
    args: ['migrations', 'list'],
    title: 'Checking applied migrations',
    write: false,
    json: true,
    acceptsConnection: true
  });

  if (!result) {
    return { summary: 'Could not start the check.', options: [], orderedNames: [], appliedNames: new Set() };
  }

  if (result.kind !== 'success') {
    return {
      summary: result.errorSummary
        ? `Could not read the database: ${maskConnectionString(result.errorSummary)}`
        : 'Could not read the database.',
      options: [],
      orderedNames: [],
      appliedNames: new Set()
    };
  }

  const entries = parseMigrationsList(result.stdout) ?? [];
  if (entries.length === 0) {
    return {
      summary: 'The database reports no migrations.',
      options: [],
      orderedNames: [],
      appliedNames: new Set()
    };
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
    options,
    orderedNames: entries.map(entry => entry.name),
    appliedNames: new Set(applied.map(entry => entry.name))
  };
}

async function generateScript(feature: EfFeature, node?: EfCommandSource): Promise<void> {
  const target = await resolveTarget(feature, node);
  if (!target) {
    return;
  }

  const detections = await feature.getDetections();
  const migrations = migrationsForContext(target.model, target.contextName);
  const cascade = new EfTargetCascade(feature, detections, target, [FIELD.from, FIELD.to]);
  const temporaryOutputPath = path.join(os.tmpdir(), `dotnav-ef-script-${Date.now()}.sql`);

  const request = (values: EfDialogValues): RunRequest => {
    const from = String(values[FIELD.from] ?? '').trim();
    const to = String(values[FIELD.to] ?? '').trim();
    const outputPath = String(values[FIELD.output] ?? '').trim() || temporaryOutputPath;
    return {
      args: scriptArgs({
        from,
        to,
        idempotent: values[FIELD.idempotent] === true,
        outputPath
      }),
      title: 'Generating SQL script',
      write: false
    };
  };

  const values = await showEfDialog(
    {
      ...centerIdentity(target, 'dotnav.ef.generateScript'),
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
        {
          id: FIELD.output,
          label: 'Output file',
          type: 'text',
          value: '',
          placeholder: 'Leave empty to open an unsaved SQL editor',
          action: { id: 'chooseOutput', label: 'Choose...' }
        },
        ...commonFields(target, detections)
      ]
    },
    {
      preview: current => previewCommand(feature, current, request(current)),
      onChange: (current, handle) => cascade.update(current, handle),
      onAction: async (action, _current, handle) => {
        if (action !== 'chooseOutput') {
          return;
        }
        const selected = await vscode.window.showSaveDialog({
          title: 'Save EF Core SQL Script',
          filters: { 'SQL script': ['sql'] },
          defaultUri: vscode.Uri.file(path.join(target.project.directory, 'migration.sql'))
        });
        if (selected) {
          handle.setValue(FIELD.output, selected.fsPath);
        }
      }
    }
  );

  if (!values) {
    return;
  }

  const result = await runFromValues(feature, values, request(values), target.startupProjectPath);
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
    const selectedOutput = String(values[FIELD.output] ?? '').trim();
    const outputPath = selectedOutput || temporaryOutputPath;
    if (selectedOutput) {
      await vscode.window.showTextDocument(vscode.Uri.file(outputPath), { preview: false });
    } else {
      const sql = await fs.readFile(outputPath, 'utf8');
      const document = await vscode.workspace.openTextDocument({ language: 'sql', content: sql });
      await vscode.window.showTextDocument(document, { preview: false });
    }
  } catch {
    vscode.window.showErrorMessage('The script was generated but could not be read back. See output for details.');
  } finally {
    if (!String(values[FIELD.output] ?? '').trim()) {
      void fs.unlink(temporaryOutputPath).catch(() => undefined);
    }
  }
}

async function dropDatabase(feature: EfFeature, node?: EfCommandSource): Promise<void> {
  const target = await resolveTarget(feature, node);
  if (!target) {
    return;
  }

  const detections = await feature.getDetections();
  const cascade = new EfTargetCascade(feature, detections, target);
  let expected = target.contextName ?? target.project.name;
  let databaseIdentified = false;
  let identifiedTargetKey: string | undefined;
  const request = (): RunRequest => ({
    args: ['database', 'drop', '--force'],
    title: 'Dropping the database',
    write: true,
    acceptsConnection: target.capabilities.dropConnection
  });

  const values = await showEfDialog(
    {
      ...centerIdentity(target, 'dotnav.ef.dropDatabase'),
      title: 'Drop Database',
      submitLabel: 'Drop Database',
      danger: true,
      warning:
        'This deletes the entire database for the selected DbContext. THIS CANNOT BE UNDONE.\n' +
        'Identify the target database first, then type its name exactly to enable the button.',
      fields: [
        {
          id: 'confirm',
          label: 'Database name confirmation',
          type: 'text',
          value: '',
          required: true,
          placeholder: 'Identify the database first',
          action: { id: 'identify', label: 'Identify database' }
        },
        ...commonFields(target, detections, { connection: target.capabilities.dropConnection })
      ]
    },
    {
      preview: current => previewCommand(feature, current, request()),
      onChange: async (current, handle) => {
        await cascade.update(current, handle);
        if (identifiedTargetKey !== databaseTargetKey(current)) {
          databaseIdentified = false;
          identifiedTargetKey = undefined;
        }
        const typed = String(current['confirm'] ?? '').trim();
        const wanted = expected;
        handle.setStatus(
          !databaseIdentified
            ? 'Identify the target database before dropping it.'
            : typed === wanted
              ? `Confirmed target database: ${wanted}`
              : `Type "${wanted}" exactly to confirm.`,
          !databaseIdentified || typed !== wanted
        );
        handle.setValid(databaseIdentified && typed === wanted);
      },
      onAction: async (action, current, handle) => {
        if (action !== 'identify') {
          return;
        }
        handle.setBusy(true);
        handle.setStatus('Identifying the target database…');
        try {
          const explicitConnection = String(current[FIELD.connection] ?? '').trim();
          const explicitDatabase = databaseNameFromConnectionString(explicitConnection);
          if (explicitConnection && explicitDatabase) {
            expected = explicitDatabase;
            databaseIdentified = true;
            identifiedTargetKey = databaseTargetKey(current);
            handle.setValid(String(current['confirm'] ?? '').trim() === expected);
            handle.setStatus(`Target from the explicit connection: ${expected}. Type "${expected}" exactly to confirm.`);
            return;
          }
          if (explicitConnection) {
            databaseIdentified = false;
            handle.setValid(false);
            handle.setStatus(
              'The explicit connection does not expose a Database or Initial Catalog name. ' +
              'Use a connection with a named database to enable deletion.',
              true
            );
            return;
          }
          const result = await runFromValues(feature, current, {
            args: ['dbcontext', 'info'],
            title: 'Identifying the target database',
            write: false,
            json: true
          });
          const info = result?.kind === 'success' ? parseDbContextInfo(result.stdout) : undefined;
          if (!info?.databaseName) {
            databaseIdentified = false;
            handle.setValid(false);
            handle.setStatus('The database name could not be determined. The database was not enabled for deletion.', true);
            return;
          }
          expected = info.databaseName;
          databaseIdentified = true;
          identifiedTargetKey = databaseTargetKey(current);
          handle.setValid(String(current['confirm'] ?? '').trim() === expected);
          handle.setStatus(
            `Target: ${expected}` +
            (info.dataSource ? ` on ${maskConnectionString(info.dataSource)}.` : '.') +
            ` Type "${expected}" exactly to confirm.`
          );
        } finally {
          handle.setBusy(false);
        }
      }
    }
  );

  if (!values) {
    return;
  }

  const wanted = expected;
  if (!databaseIdentified || String(values['confirm'] ?? '').trim() !== wanted) {
    vscode.window.showWarningMessage('The confirmation text did not match. The database was not dropped.');
    return;
  }

  const result = await runFromValues(feature, values, request(), target.startupProjectPath);
  if (result?.kind === 'error') {
    await reportEfFailure(feature.cli, 'Dropping the database', result);
  } else if (result?.kind === 'success') {
    vscode.window.showInformationMessage('Database dropped.');
  }
}

async function showDbContextInfo(feature: EfFeature, node?: EfCommandSource): Promise<void> {
  const target = await resolveTarget(feature, node);
  if (!target) {
    return;
  }

  const detections = await feature.getDetections();
  const cascade = new EfTargetCascade(feature, detections, target);
  const request = (): RunRequest => ({
    args: ['dbcontext', 'info'],
    title: 'Reading DbContext info',
    write: false,
    json: true
  });

  const values = await showEfDialog(
    {
      ...centerIdentity(target, 'dotnav.ef.dbContextInfo'),
      title: 'DbContext Info',
      submitLabel: 'Read Info',
      warning: 'Reading DbContext info builds the project and resolves the configured connection.',
      fields: commonFields(target, detections)
    },
    {
      preview: current => previewCommand(feature, current, request()),
      onChange: (current, handle) => cascade.update(current, handle)
    }
  );

  if (!values) {
    return;
  }

  const result = await runFromValues(feature, values, request(), target.startupProjectPath);
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

async function checkPendingModelChanges(feature: EfFeature, node?: EfCommandSource): Promise<void> {
  const target = await resolveTarget(feature, node);
  if (!target) {
    return;
  }
  if (!target.capabilities.hasPendingModelChanges) {
    vscode.window.showInformationMessage(
      'Checking pending model changes requires EF Core 8 or newer.'
    );
    return;
  }

  const detections = await feature.getDetections();
  const cascade = new EfTargetCascade(feature, detections, target);
  const request = (): RunRequest => ({
    args: ['migrations', 'has-pending-model-changes'],
    title: 'Checking the EF Core model',
    write: false
  });
  const values = await showEfDialog(
    {
      ...centerIdentity(target, 'dotnav.ef.pendingModelChanges'),
      title: 'Check Pending Model Changes',
      submitLabel: 'Check Model',
      warning: 'This builds the selected projects but does not connect to or modify a database.',
      fields: commonFields(target, detections)
    },
    {
      preview: current => previewCommand(feature, current, request()),
      onChange: (current, handle) => cascade.update(current, handle)
    }
  );
  if (!values) {
    return;
  }

  const result = await runFromValues(feature, values, request(), target.startupProjectPath);
  if (!result) {
    return;
  }
  if (result.kind === 'success') {
    vscode.window.showInformationMessage('No pending EF Core model changes were detected.');
  } else if (result.errorKind === 'pendingModelChanges') {
    vscode.window.showWarningMessage('The current model has changes that are not covered by a migration.');
  } else if (result.kind === 'error') {
    await reportEfFailure(feature.cli, 'Checking pending model changes', result);
  }
}

async function createMigrationBundle(feature: EfFeature, node?: EfCommandSource): Promise<void> {
  const target = await resolveTarget(feature, node);
  if (!target) {
    return;
  }
  if (!target.capabilities.migrationsBundle) {
    vscode.window.showInformationMessage('Migration bundles are not supported by this EF Core version.');
    return;
  }

  const detections = await feature.getDetections();
  const cascade = new EfTargetCascade(feature, detections, target);
  const defaultOutput = path.join(target.project.directory, process.platform === 'win32' ? 'efbundle.exe' : 'efbundle');
  const request = (values: EfDialogValues): RunRequest => {
    const output = String(values[FIELD.output] ?? '').trim();
    const runtime = String(values[FIELD.runtime] ?? '').trim();
    return {
      args: bundleArgs({
        outputPath: output,
        force: values['force'] === true,
        selfContained: values[FIELD.selfContained] === true,
        targetRuntime: runtime
      }),
      title: 'Creating migration bundle',
      write: false
    };
  };
  const values = await showEfDialog(
    {
      ...centerIdentity(target, 'dotnav.ef.migrationsBundle'),
      title: 'Create Migration Bundle',
      submitLabel: 'Create Bundle',
      fields: [
        {
          id: FIELD.output, label: 'Output file', type: 'text',
          value: defaultOutput, required: true
        },
        {
          id: 'force', label: 'Overwrite an existing bundle (--force)',
          type: 'checkbox', value: false
        },
        {
          id: FIELD.selfContained, label: 'Include the .NET runtime (--self-contained)',
          type: 'checkbox', value: false, advanced: true
        },
        {
          id: FIELD.runtime, label: 'Target runtime', type: 'text', value: '',
          placeholder: 'e.g. linux-x64 or win-x64', advanced: true
        },
        ...commonFields(target, detections)
      ]
    },
    {
      preview: current => previewCommand(feature, current, request(current)),
      onChange: (current, handle) => cascade.update(current, handle)
    }
  );
  if (!values) {
    return;
  }

  const result = await runFromValues(feature, values, request(values), target.startupProjectPath);
  if (result?.kind === 'success') {
    const output = String(values[FIELD.output] ?? defaultOutput);
    vscode.window.showInformationMessage(`Migration bundle created: ${output}`);
  } else if (result?.kind === 'error') {
    await reportEfFailure(feature.cli, 'Creating the migration bundle', result);
  }
}

async function optimizeDbContext(feature: EfFeature, node?: EfCommandSource): Promise<void> {
  const target = await resolveTarget(feature, node);
  if (!target) {
    return;
  }
  if (!target.capabilities.dbContextOptimize) {
    vscode.window.showInformationMessage('DbContext optimization is not supported by this EF Core version.');
    return;
  }

  const detections = await feature.getDetections();
  const cascade = new EfTargetCascade(feature, detections, target);
  const request = (values: EfDialogValues): RunRequest => {
    const outputDir = String(values[FIELD.outputDir] ?? '').trim();
    const namespaceName = String(values[FIELD.namespace] ?? '').trim();
    const suffix = String(values[FIELD.suffix] ?? '').trim();
    return {
      args: optimizeArgs({
        outputDirectory: outputDir,
        namespaceName,
        suffix,
        noScaffold: values['noScaffold'] === true,
        precompileQueries: values['precompileQueries'] === true,
        nativeAot: values['nativeAot'] === true
      }),
      title: 'Optimizing DbContext',
      write: true
    };
  };
  const values = await showEfDialog(
    {
      ...centerIdentity(target, 'dotnav.ef.optimizeDbContext'),
      title: 'Optimize DbContext',
      submitLabel: 'Generate Optimized Model',
      warning: 'This generates compiled model source files in the migrations project.',
      fields: [
        {
          id: FIELD.outputDir, label: 'Output directory', type: 'text',
          value: 'CompiledModels', required: true
        },
        {
          id: FIELD.namespace, label: 'Namespace', type: 'text', value: '',
          placeholder: 'Leave empty to let EF Core choose'
        },
        {
          id: FIELD.suffix, label: 'Generated file suffix', type: 'text', value: '',
          advanced: true
        },
        {
          id: 'noScaffold',
          label: 'Use an existing compiled model (--no-scaffold)',
          type: 'checkbox',
          value: false,
          advanced: true
        },
        ...(target.capabilities.optimizeNativeAot
          ? [{
            id: 'precompileQueries',
            label: 'Generate precompiled queries (--precompile-queries)',
            type: 'checkbox' as const,
            value: false,
            advanced: true
          }, {
            id: 'nativeAot',
            label: 'Generate NativeAOT support (--nativeaot)',
            type: 'checkbox' as const,
            value: false,
            advanced: true
          }]
          : []),
        ...commonFields(target, detections)
      ]
    },
    {
      preview: current => previewCommand(feature, current, request(current)),
      onChange: (current, handle) => cascade.update(current, handle)
    }
  );
  if (!values) {
    return;
  }

  const result = await runFromValues(feature, values, request(values), target.startupProjectPath);
  if (result?.kind === 'success') {
    vscode.window.showInformationMessage('Optimized DbContext model generated.');
  } else if (result?.kind === 'error') {
    await reportEfFailure(feature.cli, 'Optimizing DbContext', result);
  }
}
