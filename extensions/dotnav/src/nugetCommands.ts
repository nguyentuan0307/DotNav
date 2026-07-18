import * as path from 'path';
import * as vscode from 'vscode';
import { runDotnetPackageCommand } from './dotnetCli';
import { ProjectModel, TreeNode } from './models';
import {
  listVersions,
  NugetPackageSearchResult,
  OutdatedPackages,
  parseOutdated,
  searchPackages
} from './nugetService';
import { samePath } from './pathUtils';
import { DotnetTreeProvider } from './treeProvider';

interface PackageQuickPickItem extends vscode.QuickPickItem {
  readonly package: NugetPackageSearchResult;
}

export async function addPackage(provider: DotnetTreeProvider, node: TreeNode): Promise<void> {
  const project = await projectFromNode(provider, node);
  if (!project) {
    vscode.window.showInformationMessage('Select a project or its Dependencies node first.');
    return;
  }

  const selection = await pickPackage();
  if (!selection) {
    return;
  }

  const { packageResult, includePrerelease } = selection;
  const version = await pickVersion(packageResult.id, includePrerelease, packageResult.latestVersion);
  if (!version) {
    return;
  }

  const result = await runDotnetPackageCommand(
    project.directory,
    ['add', project.path, 'package', packageResult.id, '--version', version],
    `Add ${packageResult.id} ${version}`
  );
  if (result.exitCode === 0) {
    vscode.window.showInformationMessage(`Added ${packageResult.id} ${version} to ${project.name}.`);
    await provider.refresh();
  }
}

export async function updatePackage(provider: DotnetTreeProvider, node: TreeNode): Promise<void> {
  const project = await projectFromNode(provider, node);
  const packageId = node.packageId;
  if (!project || !packageId) {
    vscode.window.showInformationMessage('Select a NuGet package first.');
    return;
  }

  const versions = await listVersions(packageId, prereleaseEnabled(), showNugetError);
  if (versions.length === 0) {
    return;
  }

  const version = await pickVersionFromList(packageId, versions, versions[0], node.packageVersion);
  if (!version) {
    return;
  }

  const result = await runDotnetPackageCommand(
    project.directory,
    ['add', project.path, 'package', packageId, '--version', version],
    `Update ${packageId} to ${version}`
  );
  if (result.exitCode === 0) {
    vscode.window.showInformationMessage(`Updated ${packageId} to ${version} in ${project.name}.`);
    await provider.refresh();
  }
}

export async function removePackage(provider: DotnetTreeProvider, node: TreeNode): Promise<void> {
  const project = await projectFromNode(provider, node);
  const packageId = node.packageId;
  if (!project || !packageId) {
    vscode.window.showInformationMessage('Select a NuGet package first.');
    return;
  }

  const confirmation = await vscode.window.showWarningMessage(
    `Remove ${packageId} from ${project.name}?`,
    { modal: true },
    'Remove'
  );
  if (confirmation !== 'Remove') {
    return;
  }

  const result = await runDotnetPackageCommand(
    project.directory,
    ['remove', project.path, 'package', packageId],
    `Remove ${packageId}`
  );
  if (result.exitCode === 0) {
    vscode.window.showInformationMessage(`Removed ${packageId} from ${project.name}.`);
    await provider.refresh();
  }
}

export async function restorePackages(provider: DotnetTreeProvider, node: TreeNode): Promise<void> {
  const target = await targetFromNode(provider, node);
  if (!target) {
    vscode.window.showInformationMessage('Select a solution or project to restore.');
    return;
  }

  const result = await runDotnetPackageCommand(
    target.cwd,
    ['restore', target.path],
    `Restore ${target.label}`
  );
  if (result.exitCode === 0) {
    vscode.window.showInformationMessage(`Restore succeeded for ${target.label}.`);
    await provider.refresh();
  }
}

export async function checkOutdated(provider: DotnetTreeProvider, node: TreeNode): Promise<void> {
  const target = await targetFromNode(provider, node);
  if (!target) {
    vscode.window.showInformationMessage('Select a solution or project to check.');
    return;
  }

  const result = await runDotnetPackageCommand(
    target.cwd,
    ['list', target.path, 'package', '--outdated'],
    `Check outdated packages in ${target.label}`
  );
  if (result.exitCode !== 0) {
    return;
  }

  const parsed = parseOutdated(result.stdout, target.project?.path);
  const resolved = resolveOutdatedProjectPaths(provider, parsed, target);
  provider.setOutdatedPackages(resolved);
  const count = [...resolved.values()].reduce((total, packages) => total + packages.size, 0);
  vscode.window.showInformationMessage(
    count === 0
      ? `All packages are up to date in ${target.label}.`
      : `Found ${count} outdated package${count === 1 ? '' : 's'} in ${target.label}.`
  );
}

async function pickPackage(): Promise<
  { packageResult: NugetPackageSearchResult; includePrerelease: boolean } | undefined
> {
  const picker = vscode.window.createQuickPick<PackageQuickPickItem>();
  const prereleaseButton: vscode.QuickInputButton = {
    iconPath: new vscode.ThemeIcon('beaker'),
    tooltip: 'Toggle prerelease versions'
  };
  let includePrerelease = prereleaseEnabled();
  let searchSequence = 0;
  let debounce: NodeJS.Timeout | undefined;

  picker.placeholder = 'Type to search nuget.org';
  picker.matchOnDescription = true;
  picker.matchOnDetail = true;
  picker.buttons = [prereleaseButton];
  updatePrereleaseTitle();

  const runSearch = async (query: string) => {
    const sequence = ++searchSequence;
    picker.busy = true;
    const packages = await searchPackages(query, includePrerelease, showNugetError);
    if (sequence === searchSequence) {
      picker.items = packages.map(packageResult => ({
        label: packageResult.id,
        description: packageResult.latestVersion,
        detail: [
          packageResult.description,
          packageResult.totalDownloads > 0
            ? `${packageResult.totalDownloads.toLocaleString()} downloads`
            : undefined
        ].filter(Boolean).join(' · '),
        package: packageResult
      }));
      picker.busy = false;
    }
  };

  picker.onDidChangeValue(value => {
    if (debounce) {
      clearTimeout(debounce);
    }
    if (!value.trim()) {
      picker.items = [];
      picker.busy = false;
      return;
    }
    debounce = setTimeout(() => void runSearch(value), 300);
  });
  picker.onDidTriggerButton(() => {
    includePrerelease = !includePrerelease;
    updatePrereleaseTitle();
    if (picker.value.trim()) {
      void runSearch(picker.value);
    }
  });

  const selected = await new Promise<NugetPackageSearchResult | undefined>(resolve => {
    picker.onDidAccept(() => {
      resolve(picker.selectedItems[0]?.package);
      picker.hide();
    });
    picker.onDidHide(() => resolve(undefined));
    picker.show();
  });
  if (debounce) {
    clearTimeout(debounce);
  }
  picker.dispose();
  return selected ? { packageResult: selected, includePrerelease } : undefined;

  function updatePrereleaseTitle(): void {
    picker.title = `Add NuGet Package · Prerelease ${includePrerelease ? 'on' : 'off'}`;
  }
}

async function pickVersion(
  packageId: string,
  includePrerelease: boolean,
  latestVersion?: string
): Promise<string | undefined> {
  const versions = await listVersions(packageId, includePrerelease, showNugetError);
  return versions.length > 0
    ? pickVersionFromList(packageId, versions, latestVersion ?? versions[0])
    : undefined;
}

async function pickVersionFromList(
  packageId: string,
  versions: string[],
  latestVersion: string,
  currentVersion?: string
): Promise<string | undefined> {
  const picked = await vscode.window.showQuickPick(
    versions.map(version => ({
      label: version,
      description: version === latestVersion ? 'latest' : version === currentVersion ? 'current' : undefined
    })),
    {
      title: `Select a version for ${packageId}`,
      placeHolder: currentVersion ? `Current version: ${currentVersion}` : undefined
    }
  );
  return picked?.label;
}

async function projectFromNode(provider: DotnetTreeProvider, node: TreeNode): Promise<ProjectModel | undefined> {
  return node.project ? provider.ensureProjectMetadata(node.project) : undefined;
}

async function targetFromNode(
  provider: DotnetTreeProvider,
  node: TreeNode
): Promise<{ path: string; cwd: string; label: string; project?: ProjectModel } | undefined> {
  if (node.project) {
    const project = await provider.ensureProjectMetadata(node.project);
    return { path: project.path, cwd: project.directory, label: project.name, project };
  }

  if (node.kind === 'solution') {
    const solution = provider.getSolution();
    if (solution?.path) {
      return {
        path: solution.path,
        cwd: path.dirname(solution.path),
        label: path.basename(solution.path)
      };
    }
  }
  return undefined;
}

function resolveOutdatedProjectPaths(
  provider: DotnetTreeProvider,
  parsed: OutdatedPackages,
  target: { path: string; cwd: string; project?: ProjectModel }
): OutdatedPackages {
  const projects = provider.getSolution()?.projects ?? [];
  const resolved: OutdatedPackages = new Map();

  for (const [reportedPath, packages] of parsed) {
    const absoluteReportedPath = path.isAbsolute(reportedPath)
      ? reportedPath
      : path.resolve(target.cwd, reportedPath);
    const project = projects.find(candidate =>
      samePath(candidate.path, absoluteReportedPath)
      || path.basename(candidate.path).toLowerCase() === path.basename(reportedPath).toLowerCase()
      || candidate.name.toLowerCase() === reportedPath.toLowerCase()
    ) ?? target.project;
    if (project) {
      resolved.set(project.path, packages);
    }
  }
  return resolved;
}

function prereleaseEnabled(): boolean {
  return vscode.workspace.getConfiguration('dotnav.nuget').get<boolean>('includePrerelease', false);
}

function showNugetError(message: string): void {
  vscode.window.showErrorMessage(message);
}
