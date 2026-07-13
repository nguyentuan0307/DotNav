# GitNav: Git History & Workflows

[![Visual Studio Marketplace](https://img.shields.io/visual-studio-marketplace/v/tuna-ex.gitnav-workflows?style=flat-square&label=Marketplace)](https://marketplace.visualstudio.com/items?itemName=tuna-ex.gitnav-workflows)
[![Installs](https://img.shields.io/visual-studio-marketplace/i/tuna-ex.gitnav-workflows?style=flat-square)](https://marketplace.visualstudio.com/items?itemName=tuna-ex.gitnav-workflows)

GitNav adds visual repository history and guarded Git workflows to Visual Studio Code. It works independently in any Git repository and does not require .NET or C#.

## Highlights

- Explore branches, tags, commits, worktrees, stashes, and changed files in a visual Git Log panel.
- Render real graph lanes with paging, filters, repository status, and commit details.
- Compare files or editor selections with another branch.
- Inspect commit history for a selected range of lines.
- Preview diffs and navigate historical revisions without changing the working tree.
- Run guarded branch, commit, stash, worktree, reset, cherry-pick, revert, and rebase operations.
- Recover from conflicts with operation-aware continue, skip, and abort actions.
- Protect important branch patterns from history-rewriting commands.
- Fetch repositories automatically while the Git Log panel is active.

## Installation

```console
code --install-extension tuna-ex.gitnav-workflows
```

## Requirements

- Visual Studio Code 1.92 or newer
- Git available on `PATH`
- An open folder containing a Git repository

## Getting started

1. Open a Git repository in VS Code.
2. Open the bottom Panel and select **GitNav**.
3. Use the branch tree, history list, changed-file pane, and context menus to inspect or manage the repository.
4. Select code in an editor and open the **GitNav** context submenu for line history and comparisons.

## Configuration

Open **Settings** and search for `GitNav`. Available settings include automatic fetch, fetch interval, protected branches, and the maximum line-history commit count.

## Safety

GitNav blocks history-rewriting operations on configured protected branches and uses explicit confirmations for destructive actions. Always review the displayed branch, commit, and working-tree state before confirming a mutation.

## Feedback

[Open an issue](https://github.com/nguyentuan0307/DotNav/issues) with reproduction steps, your operating system, VS Code version, Git version, and relevant output logs.

## License

GitNav is available under the [MIT License](LICENSE). Third-party attributions are listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
