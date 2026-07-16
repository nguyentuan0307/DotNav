# GitNav: Visual Git History & Workflows

[![Install from Visual Studio Marketplace](https://img.shields.io/badge/Marketplace-Install-007ACC?style=for-the-badge&logo=visualstudiocode&logoColor=white)](https://marketplace.visualstudio.com/items?itemName=tuna-ex.gitnav-workflows)
[![Marketplace Version](https://img.shields.io/visual-studio-marketplace/v/tuna-ex.gitnav-workflows?style=flat-square)](https://marketplace.visualstudio.com/items?itemName=tuna-ex.gitnav-workflows)
[![Marketplace Installs](https://img.shields.io/visual-studio-marketplace/i/tuna-ex.gitnav-workflows?style=flat-square)](https://marketplace.visualstudio.com/items?itemName=tuna-ex.gitnav-workflows)
[![Download VSIX](https://img.shields.io/badge/GitHub%20Releases-VSIX-181717?style=flat-square&logo=github)](https://github.com/nguyentuan0307/DotNav/releases)

GitNav brings clear visual Git history and safer Git workflows directly into Visual Studio Code. Explore how your repository changed, compare code across branches, and run complex Git operations without piecing together multiple views and terminal commands.

GitNav is standalone: it works in any Git repository and does not require .NET or C#.
Install GitNav directly when you only need Git history, comparisons, and guarded branch workflows without the full DotNav .NET workspace experience.

## Why GitNav?

VS Code's built-in source control handles everyday changes well, but understanding a repository's history or completing a multi-step Git operation often requires switching between the editor, separate views, and the terminal. GitNav provides one visual workspace for both exploration and action.

- **Understand history quickly:** follow graph lanes across branches, tags, and commits, then inspect the files changed by any commit.
- **Compare code in context:** compare a file or selected lines with another branch without changing the working tree.
- **Use advanced Git workflows with guardrails:** run rebase, cherry-pick, revert, reset, stash, and worktree operations with contextual confirmations and protected-branch rules.

## What you can do

### Explore repository history

- Browse local and remote branches, tags, commits, worktrees, and stashes.
- Read a visual commit graph with paging, filters, repository status, and commit details.
- Inspect changed files and preview historical revisions without checking them out.
- Keep the view current with optional automatic fetch while the panel is active.

### Compare and investigate code

- Compare the current file with another branch.
- Compare only the lines selected in the editor.
- Show the commit history for a selected range of code.
- Navigate historical revisions without modifying the working tree.

### Run guarded Git operations

- Create, rename, delete, check out, merge, publish, and synchronize branches.
- Create or apply stashes and manage worktrees.
- Cherry-pick, revert, reset, and interactively rebase commits.
- Continue, skip, or abort operations after conflicts.
- Prevent history-rewriting commands on configured protected branches.

## Install

Install from the [Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=tuna-ex.gitnav-workflows), or run:

```console
code --install-extension tuna-ex.gitnav-workflows
```

You can also download a packaged VSIX from [GitHub Releases](https://github.com/nguyentuan0307/DotNav/releases).

## Quick start

1. Open a folder containing a Git repository in VS Code.
2. Open the bottom Panel and select **GitNav**.
3. Select a branch or commit to inspect its history and changed files.
4. Open an item's context menu to see the Git actions available for its current state.
5. Select lines in an editor and open the **GitNav** submenu to view line history or compare the selection with another branch.

## Requirements

- Visual Studio Code 1.92 or newer.
- Git available on `PATH`.
- An open folder containing a Git repository.

## Safety

GitNav adds guardrails around operations that can rewrite history or discard work:

- Protected branch patterns block history-rewriting actions.
- Destructive operations require explicit confirmation.
- Conflict recovery actions follow the active Git operation.
- Historical revisions and comparisons do not change the working tree.

Always review the displayed repository, branch, commit, and working-tree state before confirming a mutation.

## Configuration

Open **Settings** and search for `GitNav`.

| Setting | Purpose | Default |
| --- | --- | --- |
| `gitnav.autoFetch` | Fetch while the Git Log view is active | `true` |
| `gitnav.autoFetchMinutes` | Set the automatic fetch interval | `20` |
| `gitnav.protectedBranches` | Define branch patterns protected from history rewrites | `main`, `master`, `develop`, `release/*` |
| `gitnav.history.maxCommits` | Limit commits returned by selection history | `50` |

## Feedback

[Open an issue](https://github.com/nguyentuan0307/DotNav/issues) and include reproduction steps, your operating system, VS Code version, Git version, and relevant output logs.

## License

GitNav is available under the [MIT License](LICENSE). Third-party attributions are listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
