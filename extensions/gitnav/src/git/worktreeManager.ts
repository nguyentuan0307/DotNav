import * as path from 'path';
import * as vscode from 'vscode';
import { runGit } from './gitCli';
import { GitWorktreeInfo } from './gitPanelModels';
import { GitRepositoryService } from './gitRepositoryService';

export async function showWorktreeManager(service: GitRepositoryService, root: string): Promise<void> {
  const snapshot = await service.snapshot(root);
  const worktrees = snapshot.worktrees || [];

  interface WorktreeQuickPickItem extends vscode.QuickPickItem {
    readonly action?: 'create' | 'prune' | 'select';
    readonly worktree?: GitWorktreeInfo;
  }

  const items: WorktreeQuickPickItem[] = [
    {
      label: '$(plus) Create New Worktree...',
      description: 'Checkout a branch into a separate folder',
      action: 'create'
    },
    {
      label: '$(trash) Prune Stale Worktrees',
      description: 'Clean up worktree metadata for deleted directories',
      action: 'prune'
    }
  ];

  if (worktrees.length > 0) {
    items.push({
      label: 'Active Worktrees',
      kind: vscode.QuickPickItemKind.Separator
    });

    for (const wt of worktrees) {
      const branchDisplay = wt.branch || `detached @ ${wt.head.slice(0, 7)}`;
      const statusParts: string[] = [];
      if (wt.current) statusParts.push('Current');
      if (wt.locked) statusParts.push(`Locked: ${wt.locked}`);
      if (wt.prunable) statusParts.push('Prunable');

      const desc = `${path.basename(wt.path)}${statusParts.length ? ` • [${statusParts.join(', ')}]` : ''}`;

      items.push({
        label: `${wt.current ? '$(check) ' : '$(folder) '}${branchDisplay}`,
        description: desc,
        detail: wt.path,
        action: 'select',
        worktree: wt,
        buttons: [
          {
            iconPath: new vscode.ThemeIcon('folder-active'),
            tooltip: 'Open in New Window'
          },
          {
            iconPath: new vscode.ThemeIcon('terminal'),
            tooltip: 'Open in Terminal'
          }
        ]
      });
    }
  }

  const quickPick = vscode.window.createQuickPick<WorktreeQuickPickItem>();
  quickPick.title = `Git Worktrees — ${path.basename(root)}`;
  quickPick.placeholder = 'Select a worktree to manage, or create a new one';
  quickPick.items = items;
  quickPick.matchOnDescription = true;
  quickPick.matchOnDetail = true;

  quickPick.onDidTriggerItemButton(async event => {
    quickPick.hide();
    const wt = event.item.worktree;
    if (!wt) return;

    if (event.button.tooltip === 'Open in New Window') {
      await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(wt.path), true);
    } else if (event.button.tooltip === 'Open in Terminal') {
      vscode.window.createTerminal({ name: `Worktree: ${path.basename(wt.path)}`, cwd: wt.path }).show();
    }
  });

  quickPick.onDidAccept(async () => {
    const selected = quickPick.selectedItems[0];
    quickPick.hide();
    if (!selected) return;

    if (selected.action === 'create') {
      await createWorktreeInteractive(service, root);
    } else if (selected.action === 'prune') {
      await pruneWorktreesInteractive(service, root);
    } else if (selected.action === 'select' && selected.worktree) {
      await showWorktreeActions(service, root, selected.worktree);
    }
  });

  quickPick.show();
}

export async function showWorktreeActions(
  service: GitRepositoryService,
  root: string,
  worktree: GitWorktreeInfo
): Promise<void> {
  const branchName = worktree.branch || worktree.head.slice(0, 7);

  interface ActionItem extends vscode.QuickPickItem {
    readonly id: string;
  }

  const items: ActionItem[] = [
    {
      id: 'openNewWindow',
      label: '$(folder-active) Open in New Window',
      description: 'Open this worktree in a separate VS Code window'
    },
    {
      id: 'openCurrentWindow',
      label: '$(window) Open in Current Window',
      description: 'Switch this VS Code window to this worktree directory'
    },
    {
      id: 'openTerminal',
      label: '$(terminal) Open in Terminal',
      description: 'Launch an integrated terminal inside this worktree folder'
    },
    {
      id: 'copyPath',
      label: '$(clippy) Copy Folder Path',
      description: worktree.path
    }
  ];

  if (worktree.locked) {
    items.push({
      id: 'unlock',
      label: '$(unlock) Unlock Worktree',
      description: 'Remove lock so the worktree can be pruned or removed'
    });
  } else {
    items.push({
      id: 'lock',
      label: '$(lock) Lock Worktree...',
      description: 'Prevent worktree from being automatically pruned or deleted'
    });
  }

  if (!worktree.current) {
    items.push({
      id: 'remove',
      label: '$(trash) Remove Worktree',
      description: 'Delete this worktree directory and deregister from Git'
    });
  }

  const pick = await vscode.window.showQuickPick(items, {
    title: `Worktree: ${branchName} (${path.basename(worktree.path)})`,
    placeHolder: 'Choose an action for this worktree'
  });

  if (!pick) return;

  switch (pick.id) {
    case 'openNewWindow':
      await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(worktree.path), true);
      break;
    case 'openCurrentWindow':
      await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(worktree.path), false);
      break;
    case 'openTerminal':
      vscode.window.createTerminal({ name: `Worktree: ${path.basename(worktree.path)}`, cwd: worktree.path }).show();
      break;
    case 'copyPath':
      await vscode.env.clipboard.writeText(worktree.path);
      vscode.window.showInformationMessage(`Copied worktree path: ${worktree.path}`);
      break;
    case 'lock': {
      const reason = await vscode.window.showInputBox({
        title: `Lock Worktree (${path.basename(worktree.path)})`,
        prompt: 'Optional reason for locking this worktree',
        placeHolder: 'e.g., long-running experiment'
      });
      if (reason === undefined) return;
      const args = ['worktree', 'lock'];
      if (reason.trim()) args.push('--reason', reason.trim());
      args.push(worktree.path);
      const res = await runGit(root, args);
      if (res.exitCode === 0) {
        service.invalidateRepositoryState(root, ['worktrees']);
        vscode.window.showInformationMessage(`Locked worktree: ${path.basename(worktree.path)}`);
      } else {
        vscode.window.showErrorMessage(`Failed to lock worktree: ${res.stderr}`);
      }
      break;
    }
    case 'unlock': {
      const res = await runGit(root, ['worktree', 'unlock', worktree.path]);
      if (res.exitCode === 0) {
        service.invalidateRepositoryState(root, ['worktrees']);
        vscode.window.showInformationMessage(`Unlocked worktree: ${path.basename(worktree.path)}`);
      } else {
        vscode.window.showErrorMessage(`Failed to unlock worktree: ${res.stderr}`);
      }
      break;
    }
    case 'remove': {
      const changed = await service.worktreeChangedCount(worktree.path);
      let force = false;
      if (changed > 0) {
        const confirm = await vscode.window.showWarningMessage(
          `Worktree has ${changed} uncommitted change(s). Force remove?`,
          { modal: true },
          'Force Remove'
        );
        if (confirm !== 'Force Remove') return;
        force = true;
      } else {
        const confirm = await vscode.window.showWarningMessage(
          `Remove worktree at ${worktree.path}?`,
          { modal: true },
          'Remove'
        );
        if (confirm !== 'Remove') return;
      }

      const args = ['worktree', 'remove'];
      if (force) args.push('--force');
      args.push(worktree.path);
      const res = await runGit(root, args);
      if (res.exitCode === 0) {
        service.invalidateRepositoryState(root, ['worktrees']);
        vscode.window.showInformationMessage(`Removed worktree at ${worktree.path}`);
      } else {
        vscode.window.showErrorMessage(`Failed to remove worktree: ${res.stderr}`);
      }
      break;
    }
  }
}

export async function createWorktreeInteractive(service: GitRepositoryService, root: string): Promise<void> {
  const snapshot = await service.snapshot(root);

  interface BranchPickItem extends vscode.QuickPickItem {
    readonly isNewBranch?: boolean;
    readonly refName?: string;
  }

  const branchItems: BranchPickItem[] = [
    {
      label: '$(plus) Create New Branch for Worktree...',
      description: 'Create and checkout a new branch in the new worktree',
      isNewBranch: true
    },
    {
      label: 'Branches',
      kind: vscode.QuickPickItemKind.Separator
    }
  ];

  for (const ref of snapshot.refs) {
    if (ref.kind === 'local' || ref.kind === 'remote') {
      const inUse = snapshot.worktrees.some(wt => wt.branch === ref.name);
      branchItems.push({
        label: `${ref.kind === 'local' ? '$(git-branch) ' : '$(cloud) '}${ref.name}`,
        description: inUse ? '[Already in use by a worktree]' : undefined,
        refName: ref.name
      });
    }
  }

  const selectedRef = await vscode.window.showQuickPick(branchItems, {
    title: 'Create Git Worktree — Step 1: Select Target Branch',
    placeHolder: 'Choose an existing branch or create a new one'
  });

  if (!selectedRef) return;

  let branchToCheckout: string;
  let newBranchName: string | undefined;

  if (selectedRef.isNewBranch) {
    const input = await vscode.window.showInputBox({
      title: 'Create Git Worktree — New Branch Name',
      prompt: 'Enter name for the new branch',
      validateInput: value => {
        if (!value || !value.trim()) return 'Branch name cannot be empty';
        if (/\s/.test(value)) return 'Branch name cannot contain spaces';
        return undefined;
      }
    });
    if (!input) return;
    newBranchName = input.trim();
    branchToCheckout = 'HEAD';
  } else {
    branchToCheckout = selectedRef.refName!;
    const inUse = snapshot.worktrees.some(wt => wt.branch === branchToCheckout);
    if (inUse) {
      const input = await vscode.window.showInputBox({
        title: `Branch '${branchToCheckout}' is already checked out`,
        prompt: 'Enter a new branch name to create for this worktree based on ' + branchToCheckout,
        validateInput: value => {
          if (!value || !value.trim()) return 'Branch name cannot be empty';
          if (/\s/.test(value)) return 'Branch name cannot contain spaces';
          return undefined;
        }
      });
      if (!input) return;
      newBranchName = input.trim();
    }
  }

  const defaultFolder = path.join(
    path.dirname(root),
    `${path.basename(root)}-${(newBranchName || branchToCheckout).replace(/[^a-zA-Z0-9._-]/g, '-')}`
  );

  const folderInput = await vscode.window.showInputBox({
    title: 'Create Git Worktree — Step 2: Target Directory',
    prompt: 'Enter path for the new worktree folder (or press Enter to use default)',
    value: defaultFolder,
    valueSelection: [defaultFolder.length, defaultFolder.length]
  });

  if (!folderInput) return;
  const targetPath = folderInput.trim();

  const args = ['worktree', 'add'];
  if (newBranchName) {
    args.push('-b', newBranchName);
  }
  args.push(targetPath, branchToCheckout);

  const result = await runGit(root, args);
  if (result.exitCode !== 0) {
    vscode.window.showErrorMessage(`Failed to create worktree: ${result.stderr}`);
    return;
  }

  service.invalidateRepositoryState(root, ['worktrees', 'refs']);

  const action = await vscode.window.showInformationMessage(
    `Created worktree for '${newBranchName || branchToCheckout}' at ${targetPath}`,
    'Open in New Window',
    'Open Terminal',
    'Dismiss'
  );

  if (action === 'Open in New Window') {
    await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(targetPath), true);
  } else if (action === 'Open Terminal') {
    vscode.window.createTerminal({ name: `Worktree: ${path.basename(targetPath)}`, cwd: targetPath }).show();
  }
}

export async function pruneWorktreesInteractive(service: GitRepositoryService, root: string): Promise<void> {
  const result = await runGit(root, ['worktree', 'prune', '-v']);
  if (result.exitCode === 0) {
    service.invalidateRepositoryState(root, ['worktrees']);
    const output = result.stdout.trim();
    vscode.window.showInformationMessage(
      output ? `Pruned worktrees:\n${output}` : 'Worktree pruning complete. No stale entries found.'
    );
  } else {
    vscode.window.showErrorMessage(`Failed to prune worktrees: ${result.stderr}`);
  }
}
