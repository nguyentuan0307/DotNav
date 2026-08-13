# DotNav: .NET Solution Explorer

[![Install from Visual Studio Marketplace](https://img.shields.io/badge/Marketplace-Install-007ACC?style=flat-square&logo=visualstudiocode&logoColor=white)](https://marketplace.visualstudio.com/items?itemName=tuna-ex.dotnav)

[![Download VSIX from GitHub Releases](https://img.shields.io/badge/GitHub%20Releases-VSIX-181717?style=flat-square&logo=github)](https://github.com/nguyentuan0307/DotNav/releases)

DotNav brings solution-first .NET development to Visual Studio Code. Navigate large solutions, manage run configurations, build and debug projects, and apply consistent C# formatting without leaving your editor.

## Highlights

- Discover `.sln`, `.slnx`, and standalone project files automatically.
- Browse logical solution folders, projects, dependencies, NuGet packages, and nested files.
- Use separate **Build** and **Smart Build** actions for projects, solution folders, and solutions.
- Build, rebuild, clean, test, run, or debug directly from the solution tree.
- Use `launchSettings.json` profiles and VS Code's .NET debugger integration.
- Create single-project or compound run configurations without maintaining `.vscode/launch.json`.
- Add, rename, move, delete, and drag project files with namespace-aware C# templates.
- Reformat whole C# documents or multiple selections with Roslyn plus safe, configurable readability passes.
- Manage EF Core from a project-aware Center: add/remove/browse migrations, apply or roll back databases, generate SQL scripts and bundles, check model changes, and optimize DbContexts.
- Reveal the active editor file, filter the solution tree, and customize project icons.
- Keep local snapshots of supported text files and compare any saved revision from **Local changes > Show Local History**.

DotNav depends on [GitNav](https://marketplace.visualstudio.com/items?itemName=tuna-ex.gitnav-workflows), which is installed automatically and supplies the integrated Git Log, comparison, and history workflows.

## Installation

```console
code --install-extension tuna-ex.dotnav
```

## Requirements

- Visual Studio Code 1.92 or newer
- A .NET SDK available on `PATH`
- Microsoft C# (`ms-dotnettools.csharp`), installed automatically
- GitNav (`tuna-ex.gitnav-workflows`), installed automatically

## Getting started

1. Open a folder containing a .NET solution or project.
2. Select the **.NET** icon in the Activity Bar.
3. Choose a solution if the workspace contains more than one.
4. Use the solution tree and context menus to navigate, build, run, debug, or manage files.

### EF Core

Right-click a detected EF Core project and open **Entity Framework Core**.
Actions reuse one **EF Core Center** editor tab with the selected project,
startup project, DbContext, command preview, validation, and version-gated
options. Every action provides an on-demand **Guide** drawer that explains when
to use it, prerequisites, each field, the expected result, and relevant safety
notes without occupying the main workflow. Open it from the action header or
press `F1`. Switch between English and Vietnamese from the Center header; the
preference is remembered and can also be set with `dotnav.ef.language`.
Executed EF Core actions show their real lifecycle—validation, tool preparation,
execution, and result refresh—in the Center without inventing percentage
completion that `dotnet ef` does not report.

Database state is never read automatically. Use **Check database** when you
need applied/pending status. Destructive database actions remain disabled
until their target is identified and explicitly confirmed.

## Configuration

Open **Settings** and search for `DotNav`. Settings use the `dotnav.*` namespace for solution navigation, run behavior, file nesting, icons, and C# formatting.

### Build and Smart Build

**Build** keeps the normal `dotnet build`/MSBuild behavior and is always available as the safety path. **Smart Build** evaluates the real MSBuild project graph in a separate process, fingerprints evaluated inputs and outputs, and invokes MSBuild only for projects that cannot be proven current. It first builds directly changed projects, then compares their reference assemblies: unchanged public APIs only propagate implementation outputs, while changed or unprovable APIs rebuild the reverse-dependent closure. Dependency waves run in order while independent projects run in parallel. Restore is skipped only when assets and restore inputs are proven unchanged.

Smart Build is deliberately conservative. Non-SDK projects, pre/post-build events, opt-outs (`<DotNavSmartBuild>false</DotNavSmartBuild>`), and custom `.targets` fall back to a full MSBuild invocation. Planning errors automatically continue with standard Build. `Clean` and `Rebuild` invalidate Smart Build state; failed or cancelled builds never commit it.

Use **DotNav: Explain Smart Build Plan** to inspect per-project reasons in the **DotNav Smart Build** output channel, and **DotNav: Invalidate Smart Build Cache** to force a cold plan. For staged rollout, set `dotnav.smartBuild.mode` to `shadow`: DotNav logs the plan but executes standard Build. `dotnav.smartBuild.maxParallelBuilds` caps Smart Build's MSBuild workers.

Run, Debug, and Test use `dotnav.buildBeforeRunMode` to choose the safety policy before execution:

- `standard` (default) performs the normal MSBuild build.
- `smart` waits for a successful Smart Build and then starts with `--no-build` semantics. A failed, cancelled, or concurrently modified Smart Build prevents the target from starting.
- `none` skips the build and uses existing outputs. Missing or stale outputs remain the user's responsibility.

**Explain Smart Build Plan** shows evaluation and planning timings, cache state, restore status, decisions, and per-project reasons in a searchable picker. Every executed Smart Build logs evaluation, planning, copy, MSBuild, state-capture, and total timings. Set `dotnav.smartBuild.generateBinaryLog` to create an MSBuild `.binlog`; files are written to extension workspace storage by default, or to `dotnav.smartBuild.binaryLogDirectory` when configured. Binary logs are opt-in because they can be large and may contain machine paths and build properties.

Smart Build solution configuration mapping is exact for `.sln`. Until `.slnx` configuration evaluation is supported by the bundled MSBuild API, Smart Build automatically uses standard Build for `.slnx` solutions. Project and folder Smart Build remain available.

### Local History

Right-click a file in the editor or DotNav Solution tree, then choose
**Local changes > Show Local History for File**. In the editor, select code and
choose **Show Local History for Selection** to keep only revisions and diff hunks
that affect the selected lines. Unsaved editor content is captured on demand. A
two-pane history view lists matching revisions on the left and shows the selected
revision's changes from its previous revision on the right. Snapshots are compressed,
deduplicated, stored in VS Code's workspace storage on the current machine, and never
added to the repository.

Automatic snapshots of the same file are coalesced into five-second windows.
Local History is off by default and can be enabled or disabled at any time with
`dotnav.localHistory.enabled`. DotNav also introduces the feature with an opt-in
prompt after upgrading. When enabled, storage defaults to 250 MB per workspace
and 250 visible revisions per file; both limits are configurable under
`dotnav.localHistory.*`. Disabling it stops its file watcher and all new snapshots.

## C# reformatting

Run **DotNav: Reformat Code** (`Ctrl+Alt+L`) to format every selected full-line range.
With no selection, DotNav reformats the whole document. Multiple selections are
normalized, merged, and applied atomically. **DotNav: Reformat Document** always
formats the whole file.

DotNav runs the installed C# extension's Roslyn formatter first, then applies its
leading-comma, fluent-chain, indentation, and blank-line readability rules.
Before Roslyn runs, DotNav detects formatting intent from the original document.
Consistent local layouts are preserved per construct, so a nested fluent chain
that deliberately uses two continuation indents is not flattened to the
one-indent style of an outer chain. Repeated nearby constructs provide a
deterministic fallback for new or inconsistent code. Fluent calls are grouped
by C# delimiter depth, so multiline predicates, lambdas, and object initializers
keep their own indentation while the surrounding `.Where`, `.OrderBy`, and
`.Select` calls remain aligned.

Structural validation cancels a custom rewrite if delimiters, literals, comments,
directives, or non-whitespace code tokens would change. A matching
`.editorconfig` `max_line_length` controls wrapping; `max_line_length = off`
disables new wrapping.

Smart detection is enabled by default. Projects that need a strict rule can use
DotNav's own `.editorconfig` properties:

```ini
[*.cs]
dotnav_csharp_continuation_indent_multiplier = 2
dotnav_csharp_preserve_existing_layout = true
dotnav_csharp_wrap_arguments = chop_if_long
dotnav_csharp_wrap_before_comma = true
```

The matching VS Code settings are
`dotnav.format.styleDetection`, `dotnav.format.preserveExistingLayout`, and
`dotnav.format.continuationIndentMultiplier`. A multiplier of `0` keeps
automatic detection active.

## Feedback

[Open an issue](https://github.com/nguyentuan0307/DotNav/issues) with reproduction steps, your operating system, VS Code version, and relevant output logs.

## License

DotNav is available under the [MIT License](LICENSE).
