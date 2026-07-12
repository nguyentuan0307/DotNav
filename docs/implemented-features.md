# Implemented Features

This file records feature and fix notes for future agent/developer review.

## Solution Folder Tree

- The tree now reads `.sln` solution folders instead of grouping projects only by disk path.
- `ProjectModel.solutionFolder` stores logical solution folder paths such as `['src', 'Services', 'IAM']`.
- `.sln` parsing captures project GUIDs, solution folder GUIDs, and `GlobalSection(NestedProjects)`.
- Logical folder nodes use stable ids like `folder:src/Services/ServiceBus`, so duplicate labels keep independent expand state.
- Solution folder `resourcePath` is set only when a matching real directory exists.
- Workspace/project-only fallback still groups by disk path.

Key files:
- `src/solutionParser.ts`
- `src/treeProvider.ts`
- `src/models.ts`

## User-Managed Run Configurations

- `Run Configurations` no longer auto-lists every runnable project/profile.
- `runConfigStore.listConfigs()` now returns only user-added single configs plus saved compounds.
- Full single config catalog remains available through `listSingles(solution)`.
- Added `addedSingleConfigIds` in workspace state.
- Toolbar `+` opens:
  - `Add Configuration...` multi-select picker, with previously added configs pre-checked.
  - `New Compound...`.
- Empty run config tree shows `No run configurations - click + to add`.
- A config can be removed from its context menu.

Key files:
- `src/runConfigStore.ts`
- `src/extension.ts`
- `src/treeProvider.ts`
- `package.json`

## Active Solution Selection UX

- Automatic refresh no longer opens the solution picker.
- Active solution is remembered in workspace state under `activeSolutionPath`.
- If no saved solution exists, the extension prefers a root workspace `.sln`.
- Users can switch manually through `Select Active Solution`.

Key files:
- `src/solutionParser.ts`
- `src/treeProvider.ts`
- `src/extension.ts`
- `package.json`

## Select Opened File

- Added toolbar command `Select Opened File`.
- Added setting `dotnetSolutionNavigator.alwaysSelectOpenedFile`, default `false`.
- Manual reveal shows an information message when the active editor file is not in the tree.
- Auto-follow is silent when no tree node is found and only runs when the tree view is visible.
- `TreeView.reveal()` is supported by implementing `DotnetTreeProvider.getParent()`.
- `findNodeForFile(filePath)` resolves the active file to a `TreeNode`.
- File nesting is handled, e.g. `appsettings.Development.json` reveals as a child under `appsettings.json`.
- Reveal works through logical solution folders, including folders with duplicate labels.

Key files:
- `src/treeProvider.ts`
- `src/fileTree.ts`
- `src/extension.ts`
- `package.json`

## File Node Click Behavior

- Clicking a file node opens the file but uses `preserveFocus: true`.
- This keeps keyboard focus in the tree, so `Delete` and `F2` still apply to the selected tree node.
- After opening, the tree does a best-effort reveal with scroll padding by briefly revealing a nearby node below the file and then re-selecting the opened file.
- VSCode extension `TreeView.reveal()` does not expose a true center/scroll-position option, so this intentionally stays as a native TreeView workaround.
- Context menu `Open` uses the same command.

Key files:
- `src/extension.ts`

## Git History for Selection

- Added `Show History for Selection` for editor selections.
- The command runs `git log -L <start>,<end>:<file>` asynchronously and supports cancellation.
- Git is executed through `child_process.spawn` with argv arrays, not a shell.
- Repo root is resolved from the selected file, so files in different repos work independently.
- Dirty worktree line numbers are mapped back to HEAD using `git diff --no-color -U0`.
- Fully uncommitted selected ranges stop early with a user-facing message instead of calling `git log`.
- Results render in a single reusable webview panel titled `History for Selection`.
- The webview shows a commit list beside the patch hunks returned by `git log -L`; it does not open a whole-file diff.
- The commit list pane can be resized by dragging the splitter and collapsed/restored by double-clicking it.
- Commit pane width and collapsed state are stored in webview `localStorage`.
- Arrow keys move through commits in the webview and update the patch pane in place.
- Patch hunks include real old/new line numbers; added lines have no old number, deleted lines have no new number.
- Diff paths are parsed from each `git log -L` record so rename history can show the old file name.
- Webview rendering uses DOM `textContent` and JSON `<` escaping so commit messages/code are displayed as text.
- Added `dotnetSolutionNavigator.gitHistoryMaxCommits`, default `50`.
- Added unit tests for line mapping, `git log -L` parser behavior, and patch hunk line-number parsing.

Key files:
- `src/git/gitCli.ts`
- `src/git/lineMapping.ts`
- `src/git/lineHistory.ts`
- `src/git/lineHistoryPanel.ts`
- `src/extension.ts`
- `src/test/lineMapping.test.ts`
- `src/test/lineHistory.test.ts`
- `package.json`

## Stability Fixes

- Dependency child node ids are scoped by owner project to avoid duplicate VSCode tree ids:
  - `projectReference`
  - `packageReference`
- `DotnetTreeProvider.refresh()` caches an in-flight load promise so concurrent `getChildren()` calls do not parse the solution multiple times.
- Shared `normalizePath()` and `samePath()` were added in `pathUtils.ts`.
- Process tracking no longer lowercases paths on case-sensitive OSes.
- Debug session tracking matches sessions by extension marker/session name instead of FIFO-shifting any started debug session.
- `buildProject()` now also listens to `onDidEndTask` so it does not hang forever if `onDidEndTaskProcess` is not emitted.

Key files:
- `src/treeProvider.ts`
- `src/pathUtils.ts`
- `src/processManager.ts`
- `src/debugRunner.ts`

## Verification Notes

Manual/mock checks performed during implementation:

- `npm run compile`
- `git diff --check`
- Backend `ELDesk.sln` parses 119 projects.
- Dependency child ids: 504 checked, 0 duplicates.
- Concurrent `getChildren()` calls load the solution once.
- `BaseJob.cs` reveal chain works through `src -> Services -> CustomApp -> Jobs -> project`.
- `appsettings.Development.json` resolves under `appsettings.json`.
- Project-only workspace fallback can reveal a file under the project node.
- `npm test`
- `npx --yes @vscode/vsce package --allow-missing-repository`
- Smoke parsed real `git log -L 1,5:src/pathUtils.ts` output from this repo.
