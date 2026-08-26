import * as fs from 'fs';
import * as path from 'path';

/**
 * Standard MSBuild CLI optimization flags compatible with all .NET SDK versions (.NET 6, 7, 8, 9, 10+ and .NET Core).
 * - `-maxcpucount`: Multi-core CPU utilization
 * - `-p:BuildInParallel=true`: Parallel MSBuild project DAG execution
 * - `-p:UseSharedCompilation=true`: Reuse in-memory Roslyn compiler daemon (VBCSCompiler)
 * - `-clp:NoSummary;Verbosity=minimal`: Reduces terminal buffer render bottleneck while preserving warning/error matchers
 */
export function buildOptimizationFlags(): string {
  return '-maxcpucount -p:BuildInParallel=true -p:UseSharedCompilation=true -clp:NoSummary;Verbosity=minimal';
}

export function buildOptimizationArgs(): string[] {
  return [
    '-maxcpucount',
    '-p:BuildInParallel=true',
    '-p:UseSharedCompilation=true',
    '-clp:NoSummary;Verbosity=minimal'
  ];
}

/**
 * Checks whether NuGet restore assets (project.assets.json) exist on disk for the given project.
 * Works across both project directories and .csproj/.fsproj/.vbproj file paths.
 */
export function hasProjectAssets(projectPathOrDir: string): boolean {
  if (!projectPathOrDir) return false;
  try {
    const stat = fs.statSync(projectPathOrDir);
    const directory = stat.isDirectory() ? projectPathOrDir : path.dirname(projectPathOrDir);
    const assetsPath = path.join(directory, 'obj', 'project.assets.json');
    return fs.existsSync(assetsPath);
  } catch {
    return false;
  }
}

/**
 * Determines if `--no-restore` can safely be appended to a build command.
 * Returns false for clean, rebuild, or if project assets haven't been generated yet.
 */
export function shouldUseNoRestore(projectPathOrDir: string, verb: string = 'build'): boolean {
  if (verb === 'clean' || verb === 'rebuild') {
    return false;
  }
  return hasProjectAssets(projectPathOrDir);
}
