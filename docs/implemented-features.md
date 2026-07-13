# Implemented Features

> This is a historical implementation log. Paths beginning with `src/` or referencing the root `package.json` describe the pre-monorepo layout. Current code lives under `extensions/dotnav` and `extensions/gitnav`.

This file records feature and fix notes for future agent/developer review.

For the latest checkpoint, formatter configuration, test baseline, known gaps, and next-step priorities, read [CURRENT_STATE.md](CURRENT_STATE.md) first.

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

## Search Solution Tree

- Added `Filter Solution Tree` as a toolbar and command palette action.
- The toolbar action focuses the Solution Tree and opens VS Code's native Tree Find Control inside the view.
- The control supports the editor's native highlight/filter and fuzzy-match modes without a modal input covering the editor.
- Closing the native control removes the box and restores the compact Explorer UI.
- Filtering is owned by VS Code's tree widget, so the extension does not mutate its solution model, child lists, file nesting, expansion state, drag/drop, or context menus.
- The same control remains available through VS Code's standard tree-find keyboard shortcut when the view has focus.

Key files:
- `src/extension.ts`
- `package.json`

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

## Run Configuration Lifecycle

- Every Run, Debug, or Build configuration creates a runtime session with a unique run id and target ids.
- Single and compound configurations expose `queued`, `building`, `starting`, `running`, `stopping`, and terminal phases.
- Duplicate starts of the same configuration are rejected in the command layer, independently of menu refresh timing.
- Task cleanup uses `onDidEndTask` as the completion signal and `onDidEndTaskProcess` to capture the exit code.
- Stop requests retain the `stopping` phase until VSCode confirms task/debug-session termination.
- Build waits have a configurable timeout through `dotnetSolutionNavigator.buildTimeoutSeconds`.
- Run/debug startup has a configurable timeout through `dotnetSolutionNavigator.startTimeoutSeconds`.
- Debug sessions are matched through run/target markers instead of display names.
- Debug sessions arriving after Start timeout or Stop are tombstoned, tracked, and stopped immediately.
- A task handle arriving after Stop is terminated immediately and remains busy until VSCode confirms completion.
- Unconfirmed task/debug termination remains busy, preventing a replacement run from overlapping a possibly-live process.
- After Stop timeout, an active tracked task PID is force-killed when `dotnetSolutionNavigator.forceKillTaskOnStopTimeout` is enabled. Windows uses `taskkill /T /F` for the owned process tree; debug sessions without an exposed PID remain blocked rather than guessing a process.
- Compound startup is sequential and stops previously started targets when a later target fails.
- Project and Run Configuration context menus are gated by runtime state.
- Run Configuration nodes and the status bar show active or most recent lifecycle status.
- Secondary Solution view actions are placed in the overflow menu; the primary toolbar contains Select Opened File, Search, Run, Debug, Stop All, and Refresh.
- A `.NET Navigator` output channel records lifecycle transitions with run ids.

Key files:
- `src/runSessionState.ts`
- `src/processManager.ts`
- `src/debugRunner.ts`
- `src/treeProvider.ts`
- `src/statusBar.ts`
- `src/test/runSessionState.test.ts`
- `src/test/processManager.test.ts`

## Solution Operations and Build Progress

- The solution node now exposes `Build Solution`, `Rebuild Solution`, and `Clean Solution` actions.
- Rebuild uses `dotnet build --no-incremental`; all operations respect `dotnetSolutionNavigator.buildConfiguration`.
- Solution commands require an actual `.sln` or `.slnx`; project-only workspaces continue using project actions.
- Solution tasks use argv-based `ProcessExecution`, participate in the existing lifecycle/output channel, respect the build timeout, and can be stopped through notification Cancel or `Stop All`.
- Direct project Build/Test/Clean actions now show cancellable progress notifications and use the same timeout/lifecycle tracking.
- Duplicate operations for the same project or solution are rejected before a new task is started.
- Run and Debug remain on status bar/output lifecycle UI rather than showing long-lived progress notifications.

Key files:

- `src/dotnetCli.ts`
- `src/processManager.ts`
- `src/extension.ts`
- `src/test/processManager.test.ts`
- `src/test/solutionFeatures.test.ts`

## Empty-State Welcome View

- The Solution view is empty when no workspace or .NET solution/project is available, allowing native `viewsWelcome` content to render.
- Welcome actions provide `Open Folder` and `Select Solution` recovery paths.
- Existing workspaces with a solution or standalone projects continue rendering the normal tree.

Key files:

- `src/treeProvider.ts`
- `src/extension.ts`
- `package.json`
- `src/test/solutionFeatures.test.ts`

## Solution Explorer UI Refresh

- `Run Configurations` is now a separate native view in the same .NET activity container instead of occupying the first node of the Solution tree.
- Both views share the same solution provider, workspace state, active configuration, and lifecycle events, so splitting the UI does not duplicate state.
- The Solution toolbar keeps only reveal-active-file, native tree filter, conditional Stop All, and Refresh as primary actions. Run/Debug/Add Configuration actions live on the Run Configurations view.
- Solution root labels show only the solution name; project count moved to the native description and the tooltip contains the file/path summary.
- Project descriptions omit the project kind already represented by the icon. They show a compact framework summary, startup marker, and active lifecycle phase.
- Multi-target projects render as the first framework plus a remaining count; full frameworks remain available in the tooltip.
- Project icons temporarily become a spinner or running icon during active lifecycle phases, then return to their type icon.
- Runnable project rows expose at most Run and Debug inline hover actions; active rows replace them with Stop.
- Project context actions are grouped in workflow order: Run, Build, Project, Navigation, Terminal, Add, and Copy.
- Added project `Rebuild` using `dotnet build --no-incremental`, plus solution-file and solution-terminal context actions.
- Status bar primary controls were reduced to configuration selector, Run, and Debug; an active operation replaces Run/Debug with Stop.
- Added `iconMode: auto` as the new default. It combines Rider project and special-folder icons with the active file/folder icon theme while preserving `rider`, `theme`, and `minimal` modes.

Key files:

- `src/runConfigTreeProvider.ts`
- `src/treeProvider.ts`
- `src/statusBar.ts`
- `src/extension.ts`
- `package.json`
- `src/test/solutionFeatures.test.ts`

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
