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
    if (!fs.existsSync(assetsPath)) return false;

    const assetsStat = fs.statSync(assetsPath);
    // If the project file itself was modified after assets were generated (e.g. git checkout), restore is required
    if (!stat.isDirectory() && assetsStat.mtimeMs < stat.mtimeMs) {
      return false;
    }

    // Check if shared build/package config files are newer than project.assets.json
    const sharedConfigs = findAncestorConfigFiles(directory);
    for (const configPath of sharedConfigs) {
      try {
        const configStat = fs.statSync(configPath);
        if (configStat.mtimeMs > assetsStat.mtimeMs) {
          return false;
        }
      } catch {
        // ignore unreadable config
      }
    }

    return true;
  } catch {
    return false;
  }
}

function findAncestorConfigFiles(startDir: string): string[] {
  const configs: string[] = [];
  const candidateNames = [
    'Directory.Build.props',
    'Directory.Build.targets',
    'Directory.Packages.props',
    'packages.lock.json',
    'nuget.config',
    'NuGet.Config',
    'global.json'
  ];
  let currentDir = path.resolve(startDir);
  const root = path.parse(currentDir).root;

  while (currentDir && currentDir !== root) {
    for (const name of candidateNames) {
      const fullPath = path.join(currentDir, name);
      if (fs.existsSync(fullPath)) {
        configs.push(fullPath);
      }
    }
    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) break;
    currentDir = parentDir;
  }
  return configs;
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
