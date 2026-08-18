import * as path from 'path';
import { GitWorktreeInfo } from './gitPanelModels';

export function resolveCurrentWorktree(
  worktrees: readonly GitWorktreeInfo[],
  currentPath: string,
  mainRoot: string
): { current: GitWorktreeInfo | undefined; isMain: boolean } {
  if (!worktrees || worktrees.length === 0) {
    return { current: undefined, isMain: false };
  }

  const normCurrent = path.normalize(currentPath).toLowerCase();
  const normMain = path.normalize(mainRoot).toLowerCase();

  const found =
    worktrees.find(w => path.normalize(w.path).toLowerCase() === normCurrent) ||
    worktrees.find(w => w.current) ||
    worktrees[0];

  const isMain =
    path.normalize(found.path).toLowerCase() === normMain ||
    path.normalize(worktrees[0].path).toLowerCase() === path.normalize(found.path).toLowerCase();

  return { current: found, isMain };
}

export function formatWorktreeStatusBarText(
  worktrees: readonly GitWorktreeInfo[],
  currentPath: string,
  mainRoot: string
): string {
  if (!worktrees || worktrees.length === 0) {
    return '';
  }

  const { current, isMain } = resolveCurrentWorktree(worktrees, currentPath, mainRoot);
  if (!current) {
    return '';
  }

  if (worktrees.length > 1 && !isMain) {
    const branchName = current.branch || (current.head ? `detached @ ${current.head.slice(0, 7)}` : path.basename(current.path));
    const lockBadge = current.locked ? ' 🔒' : '';
    return `$(repo-forked) Worktree: ${branchName}${lockBadge}`;
  }

  if (worktrees.length > 1) {
    return `$(repo) ${worktrees.length} Worktrees`;
  }

  return `$(repo) Worktrees`;
}

export function buildWorktreeTooltipMarkdown(
  worktrees: readonly GitWorktreeInfo[],
  currentPath: string,
  mainRoot: string
): string {
  if (!worktrees || worktrees.length === 0) {
    return '';
  }

  const { current, isMain } = resolveCurrentWorktree(worktrees, currentPath, mainRoot);
  if (!current) {
    return '';
  }

  const currentBranch = current.branch || `detached (${current.head.slice(0, 7)})`;
  const lines: string[] = [];

  lines.push(`### $(repo) Git Worktrees (${worktrees.length} active)\n`);
  lines.push(`**Current Workspace:** \`${currentBranch}\` ${isMain ? '*(Main Repo)*' : '*(Linked Worktree)*'}\n`);
  lines.push(`*Path:* \`${current.path}\`\n`);

  const otherWorktrees = worktrees.filter(w => path.normalize(w.path).toLowerCase() !== path.normalize(current.path).toLowerCase());
  if (otherWorktrees.length > 0) {
    lines.push(`---\n\n**Other Worktrees:**\n`);
    for (const wt of otherWorktrees) {
      const b = wt.branch || `detached (${wt.head.slice(0, 7)})`;
      const lockNote = wt.locked ? `🔒 *(Locked: ${wt.locked})*` : '';
      const prunableNote = wt.prunable ? `⚠️ *(Prunable)*` : '';
      lines.push(`• \`${b}\` → \`${wt.path}\` ${lockNote} ${prunableNote}`.trim());
    }
    lines.push('');
  }

  lines.push(`---\n\n[$(gear) Manage Worktrees](command:gitnav.manageWorktrees) • Click to switch, create, or prune`);

  return lines.join('\n');
}
