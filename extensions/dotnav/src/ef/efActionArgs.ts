export interface RemoveMigrationOptions {
  readonly force: boolean;
  readonly offline: boolean;
}

export interface UpdateDatabaseOptions {
  readonly target: string;
  readonly add: boolean;
  readonly outputDirectory?: string;
  readonly namespaceName?: string;
}

export interface ScriptOptions {
  readonly from: string;
  readonly to: string;
  readonly idempotent: boolean;
  readonly outputPath: string;
}

export interface BundleOptions {
  readonly outputPath: string;
  readonly force: boolean;
  readonly selfContained: boolean;
  readonly targetRuntime: string;
}

export interface OptimizeOptions {
  readonly outputDirectory: string;
  readonly namespaceName: string;
  readonly suffix: string;
  readonly noScaffold: boolean;
  readonly precompileQueries: boolean;
  readonly nativeAot: boolean;
}

export function removeMigrationArgs(options: RemoveMigrationOptions): string[] {
  return [
    'migrations', 'remove',
    ...(options.force ? ['--force'] : []),
    ...(options.offline ? ['--offline'] : [])
  ];
}

export function updateDatabaseArgs(options: UpdateDatabaseOptions): string[] {
  return [
    'database', 'update',
    ...(options.target ? [options.target] : []),
    ...(options.add ? ['--add'] : []),
    ...(options.add && options.outputDirectory ? ['--output-dir', options.outputDirectory] : []),
    ...(options.add && options.namespaceName ? ['--namespace', options.namespaceName] : [])
  ];
}

export function scriptArgs(options: ScriptOptions): string[] {
  const range = options.from || options.to
    ? [options.from || '0', ...(options.to ? [options.to] : [])]
    : [];
  return [
    'migrations', 'script',
    ...range,
    ...(options.idempotent ? ['--idempotent'] : []),
    '--output', options.outputPath
  ];
}

export function bundleArgs(options: BundleOptions): string[] {
  return [
    'migrations', 'bundle',
    ...(options.outputPath ? ['--output', options.outputPath] : []),
    ...(options.force ? ['--force'] : []),
    ...(options.selfContained ? ['--self-contained'] : []),
    ...(options.targetRuntime ? ['--target-runtime', options.targetRuntime] : [])
  ];
}

export function optimizeArgs(options: OptimizeOptions): string[] {
  return [
    'dbcontext', 'optimize',
    ...(options.outputDirectory ? ['--output-dir', options.outputDirectory] : []),
    ...(options.namespaceName ? ['--namespace', options.namespaceName] : []),
    ...(options.suffix ? ['--suffix', options.suffix] : []),
    ...(options.noScaffold ? ['--no-scaffold'] : []),
    ...(options.precompileQueries ? ['--precompile-queries'] : []),
    ...(options.nativeAot ? ['--nativeaot'] : [])
  ];
}
