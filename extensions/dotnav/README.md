# DotNav: .NET Solution Explorer

[![Install from Visual Studio Marketplace](https://img.shields.io/badge/Marketplace-Install-007ACC?style=flat-square&logo=visualstudiocode&logoColor=white)](https://marketplace.visualstudio.com/items?itemName=tuna-ex.dotnav)

[![Download VSIX from GitHub Releases](https://img.shields.io/badge/GitHub%20Releases-VSIX-181717?style=flat-square&logo=github)](https://github.com/nguyentuan0307/DotNav/releases)

DotNav brings solution-first .NET development to Visual Studio Code. Navigate large solutions, manage run configurations, build and debug projects, and apply consistent C# formatting without leaving your editor.

## Highlights

- Discover `.sln`, `.slnx`, and standalone project files automatically.
- Browse logical solution folders, projects, dependencies, NuGet packages, and nested files.
- Build, rebuild, clean, test, run, or debug directly from the solution tree.
- Use `launchSettings.json` profiles and VS Code's .NET debugger integration.
- Create single-project or compound run configurations without maintaining `.vscode/launch.json`.
- Add, rename, move, delete, and drag project files with namespace-aware C# templates.
- Reformat whole C# documents or multiple selections with Roslyn plus safe, configurable readability passes.
- Manage EF Core from a project-aware Center: add/remove/browse migrations, apply or roll back databases, generate SQL scripts and bundles, check model changes, and optimize DbContexts.
- Reveal the active editor file, filter the solution tree, and customize project icons.

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
