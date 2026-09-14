# DotNav — ReSharper full-engine migration

## Scope

Migrate Build/Rebuild/Clean and project Run/Debug entry points in `extensions/dotnav` to
`jetbrains.resharper-code` whenever ReSharper is the active engine. Do not silently execute a
legacy `dotnet` build after a ReSharper failure.

## Verified findings

1. `runDotnetForSolution()` creates an unresolved `resharper-build` task without an execution.
   When task resolution/start rejects, the catch at `dotnetCli.ts:310-319` silently starts
   `createStandardSolutionTask()`, which exactly explains the observed `dotnet build` terminal.
2. ReSharper 2026.2.2 provides native `resharper.solution.build`, `.rebuild`, `.clean` commands,
   a `resharper-build` task provider, and a project debug provider with `type: "dotnet"`.
3. ReSharper's valid launch ID is always `TargetFramework=<tfm>;<profile>` when either component
   exists. DotNav currently emits invalid strings for TFM-only and profile-only cases.
4. ReSharper project build requests accept `projectFiles`; DotNav project paths originate from
   `path.resolve(...)`, so current project and multi-project inputs are absolute.
5. ReSharper's reload/build/run commands under `resharper.solutionExplorer.*` operate on the
   selection in ReSharper's own tree. A DotNav `TreeNode` is not a supported command argument.

## Assumptions requiring approval

- Keep `dotnav.resharper.useReSharperBuild` as an explicit escape hatch. When it is enabled and
  ReSharper fails, fail with diagnostics; do not auto-fallback to `dotnet`.
- Use ReSharper's project debug provider (`type: "dotnet"`), not executable `coreclr`, so target
  framework and launch profile resolution remain owned by ReSharper.
- Do not claim one-click project reload until JetBrains exposes a path-based command/API. Replace
  the current unreliable wrapper with a command that opens/focuses ReSharper Solution Explorer
  and explains the required selection, or remove it from DotNav menus.

## Files and surgical changes

1. `extensions/dotnav/src/resharperIntegration.ts` (new)
   - Activate `jetbrains.resharper-code` before use.
   - Verify native solution commands with `vscode.commands.getCommands()`.
   - Execute solution operations through `resharper.solution.build|rebuild|clean` and capture the
     resulting `resharper-build` task start for cancellation/result tracking.
   - Resolve project/multi-project tasks from `vscode.tasks.fetchTasks({ type: 'resharper-build' })`
     before injecting absolute `projectFiles`, avoiding execution of a task with no provider-owned
     `CustomExecution`.
   - Return actionable readiness errors instead of falling back silently.
   - Verify: unit tests prove activation, command absence, provider-not-ready, and task selection.

2. `extensions/dotnav/src/dotnetCli.ts`
   - Route solution Build/Rebuild/Clean through the native-command helper.
   - Route project and folder Build/Rebuild/Clean through the resolved ReSharper task helper.
   - Remove all automatic ReSharper-to-dotnet catch fallbacks; report original and final errors.
   - Normalize every project path with `path.resolve()` at the integration boundary.
   - Verify: each verb produces the expected ReSharper target; solution uses an empty project set;
     single/folder builds use exact absolute project sets; no `dotnet` task starts on ReSharper error.

3. `extensions/dotnav/src/debugRunner.ts`
   - Reuse the same resolved ReSharper build helper for single and compound pre-builds.
   - Emit launch IDs as `TargetFramework=${tfm ?? ''};${profile ?? ''}` and omit only when both
     values are absent.
   - Keep `type: 'dotnet'`, `projectPath`, `noDebug`, environment, args, and DotNav tracking IDs.
   - Prevent duplicated build ownership: DotNav compound pre-build and ReSharper's default
     `resharper.runAndDebug.dotnet.buildBeforeLaunch=true` cannot both remain authoritative.
   - Verify: four launch-ID combinations, Run/Debug `noDebug`, single pre-build, compound project
     de-duplication, failure cancellation, and no legacy task fallback.

4. `extensions/dotnav/src/engineDetector.ts`
   - Preserve Auto => ReSharper whenever the extension is installed.
   - Distinguish installed/active/ready state and activate ReSharper on first operation.
   - Add `dotnav.isReSharperActive` and `dotnav.useReSharperBuild` context keys while preserving
     existing keys; refresh them on extension and relevant configuration changes.
   - Warn in dual-stack mode that VS Code permits only one C# debugger provider and JetBrains
     requires Microsoft C# debugging extensions to be disabled before ReSharper debugging works.
   - Verify: install/uninstall, Auto/explicit preference, build-setting refresh, disposal, dual stack.

5. `extensions/dotnav/src/extension.ts`, `extensions/dotnav/package.json`, tests
   - Add Solution Folder Rebuild and Clean commands beside Build.
   - Keep generic DotNav Build/Run/Debug menu IDs; handlers choose the active engine centrally.
   - Gate ReSharper-only actions on active/ready context, not merely installation.
   - Remove or relabel the unreliable `reloadAllProjects` action; do not pass DotNav nodes to
     `resharper.solutionExplorer.reloadProject`.
   - Add focused tests in `src/test/resharperIntegration.test.ts`, extend engine/debug and manifest
     assertions without altering unrelated tests.
   - Verify: all expected context-menu nodes/verbs exist and every handler reaches the integration
     helper.

## Verification gates after approval

1. `npx tsc --noEmit -p extensions/dotnav/tsconfig.json`
2. Targeted ReSharper integration, engine detector, debug/run, and menu tests
3. `npm run compile` and `dotnet build-server shutdown`
4. `npm test` and process cleanup verification
5. `npm run package:all`, install `dist/dotnav.vsix --force`, then Extension Host smoke tests for
   Solution/Project/Solution Folder/Compound Build-Rebuild-Clean-Run-Debug with ReSharper 2026.2.2

No product-code implementation begins until this plan and the Run/Debug build-ownership choice are
approved.
