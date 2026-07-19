import type { ProjectModel, SolutionModel, TreeNode } from './models';
import { samePath } from './pathUtils';
import type { DotnetTreeProvider } from './treeProvider';

export function candidateReferenceProjects(
  solution: SolutionModel,
  current: ProjectModel
): ProjectModel[] {
  return solution.projects.filter(candidate =>
    !samePath(candidate.path, current.path)
    && !current.projectReferences.some(reference => samePath(reference.path, candidate.path))
    && !candidate.projectReferences.some(reference => samePath(reference.path, current.path))
  );
}

export async function addProjectReference(
  provider: DotnetTreeProvider,
  node: TreeNode
): Promise<void> {
  const vscode = await import('vscode');
  if (!node.project) {
    vscode.window.showInformationMessage('Select a project or its Dependencies node first.');
    return;
  }

  const solution = provider.getSolution();
  if (!solution) {
    vscode.window.showInformationMessage('Open a solution before adding a project reference.');
    return;
  }

  const current = await provider.ensureProjectMetadata(node.project);
  const projects = await provider.ensureProjectMetadataForProjects(solution.projects);
  const candidates = candidateReferenceProjects({ ...solution, projects }, current);
  if (candidates.length === 0) {
    vscode.window.showInformationMessage('No other projects available to reference.');
    return;
  }

  const selected = await vscode.window.showQuickPick(
    candidates.map(project => ({
      label: project.name,
      description: project.relativePath,
      project
    })),
    {
      canPickMany: true,
      title: `Add Project Reference to ${current.name}`,
      placeHolder: 'Select one or more projects'
    }
  );
  if (!selected || selected.length === 0) {
    return;
  }

  const { runDotnetPackageCommand } = await import('./dotnetCli');
  const succeeded: ProjectModel[] = [];
  const failed: ProjectModel[] = [];
  for (const item of selected) {
    const result = await runDotnetPackageCommand(
      current.directory,
      ['add', current.path, 'reference', item.project.path],
      `Add reference ${item.project.name}`
    );
    (result.exitCode === 0 ? succeeded : failed).push(item.project);
  }

  if (succeeded.length > 0) {
    await provider.refresh();
  }
  if (failed.length === 0) {
    vscode.window.showInformationMessage(
      `Added ${succeeded.length} project reference${succeeded.length === 1 ? '' : 's'} to ${current.name}.`
    );
  } else {
    vscode.window.showWarningMessage(
      `Added ${succeeded.length} project reference${succeeded.length === 1 ? '' : 's'}; `
      + `failed ${failed.length}: ${failed.map(project => project.name).join(', ')}.`
    );
  }
}

export async function removeProjectReference(
  provider: DotnetTreeProvider,
  node: TreeNode
): Promise<void> {
  const vscode = await import('vscode');
  const project = node.project;
  const referencedPath = node.resourcePath;
  if (!project || !referencedPath) {
    vscode.window.showInformationMessage('Select a project reference first.');
    return;
  }

  const confirmation = await vscode.window.showWarningMessage(
    `Remove reference to ${node.label} from ${project.name}?`,
    { modal: true },
    'Remove'
  );
  if (confirmation !== 'Remove') {
    return;
  }

  const { runDotnetPackageCommand } = await import('./dotnetCli');
  const result = await runDotnetPackageCommand(
    project.directory,
    ['remove', project.path, 'reference', referencedPath],
    `Remove reference ${node.label}`
  );
  if (result.exitCode === 0) {
    vscode.window.showInformationMessage(`Removed reference to ${node.label} from ${project.name}.`);
    await provider.refresh();
  }
}
