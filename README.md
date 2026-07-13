# DotNav: .NET Solution Explorer

[![Visual Studio Marketplace](https://img.shields.io/visual-studio-marketplace/v/tuna-ex.rider-like-solution-navigator?style=flat-square&label=Marketplace)](https://marketplace.visualstudio.com/items?itemName=tuna-ex.rider-like-solution-navigator)
[![Installs](https://img.shields.io/visual-studio-marketplace/i/tuna-ex.rider-like-solution-navigator?style=flat-square)](https://marketplace.visualstudio.com/items?itemName=tuna-ex.rider-like-solution-navigator)
[![CI](https://img.shields.io/github/actions/workflow/status/nguyentuan0307/DotNav/ci.yml?branch=master&style=flat-square&label=CI)](https://github.com/nguyentuan0307/DotNav/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](LICENSE)

DotNav brings solution-first .NET development to Visual Studio Code. Navigate large solutions, manage run configurations, inspect Git history, and apply consistent C# formatting without leaving your editor.

## Highlights

### Solution navigation

- Discover `.sln`, `.slnx`, and standalone project files automatically.
- Browse logical solution folders, projects, dependencies, NuGet packages, and nested files in a dedicated activity bar view.
- Filter the solution tree, reveal the active editor file, and hide generated or noisy folders.
- Use project-aware icons for web, console, library, test, Docker, and other project types.

### Build, run, and debug

- Build, rebuild, clean, test, run, or debug a project directly from the solution tree.
- Use `launchSettings.json` profiles and VS Code's .NET debugger integration.
- Create single-project or compound run configurations without maintaining `.vscode/launch.json`.
- Track active processes with project-level stop actions and a global **Stop All** command.

### Git workflows

- Explore branches, tags, commits, changed files, and repository history in the Git Log panel.
- Compare files or selections with another branch and inspect line history from the editor.
- Perform guarded Git operations with conflict recovery and configurable protected-branch rules.

### C# productivity

- Add classes, interfaces, records, enums, files, and folders with namespace-aware templates.
- Rename, move, delete, and drag files directly in the solution tree.
- Format C# selections with Roslyn plus configurable wrapping, indentation, fluent-chain, and blank-line passes.

## Installation

Install **DotNav: .NET Solution Explorer** from the [Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=tuna-ex.rider-like-solution-navigator), or run:

```console
code --install-extension tuna-ex.rider-like-solution-navigator
```

VS Code checks Marketplace-installed extensions for updates automatically. A manual VSIX installation does not auto-update unless VS Code's VSIX auto-update option is enabled.

## Requirements

- Visual Studio Code 1.92 or newer
- A .NET SDK available on `PATH`
- The Microsoft C# extension (`ms-dotnettools.csharp`), installed automatically as a dependency
- Git available on `PATH` for Git Log and comparison features

## Getting started

1. Open a folder containing a `.sln`, `.slnx`, `.csproj`, `.fsproj`, `.vbproj`, or `.dcproj` file.
2. Select the **.NET** icon in the Activity Bar.
3. Choose a solution if the workspace contains more than one.
4. Use the tree and its context menus to navigate, build, run, debug, or manage project files.
5. Open **Git Log** from the Panel area when you need repository history and branch workflows.

## Configuration

Open **Settings** and search for `DotNav` to customize the extension. Common settings include:

| Setting | Purpose |
| --- | --- |
| `dotnetSolutionNavigator.hiddenFolders` | Folder names excluded from the solution tree |
| `dotnetSolutionNavigator.hiddenFiles` | File globs excluded from the solution tree |
| `dotnetSolutionNavigator.showDependencies` | Show project and NuGet dependencies |
| `dotnetSolutionNavigator.showProjectFiles` | Show project files inside project nodes |
| `dotnetSolutionNavigator.buildBeforeRun` | Build before run or debug |
| `dotnetSolutionNavigator.buildConfiguration` | Select `Debug` or `Release` builds |
| `dotnetSolutionNavigator.iconMode` | Choose automatic, themed, Rider-style, or minimal icons |
| `dotnetSolutionNavigator.enableFileNesting` | Group related files under their parent |
| `dotnetSolutionNavigator.alwaysSelectOpenedFile` | Reveal the active editor file automatically |
| `dotnetSolutionNavigator.gitLog.protectedBranches` | Block history-rewriting actions on matching branches |
| `dotnetSolutionNavigator.gitLog.autoFetch` | Fetch while the Git Log view is active |
| `dotnetSolutionNavigator.format.*` | Configure C# formatting passes |

## Development

```console
npm install
npm test
```

Press `F5` in VS Code to launch an Extension Development Host. Release and packaging details are documented in [docs/releasing.md](docs/releasing.md).

For the implementation overview and current engineering notes, see [docs/CURRENT_STATE.md](docs/CURRENT_STATE.md).

## Feedback and support

Found a bug or have a feature request? [Open an issue](https://github.com/nguyentuan0307/DotNav/issues) with reproduction steps, your operating system, VS Code version, and relevant output logs.

## License

DotNav is available under the [MIT License](LICENSE). Third-party attributions are listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
