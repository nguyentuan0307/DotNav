# DotNav: .NET Solution Explorer

[![Visual Studio Marketplace](https://img.shields.io/visual-studio-marketplace/v/tuna-ex.dotnav?style=flat-square&label=Marketplace)](https://marketplace.visualstudio.com/items?itemName=tuna-ex.dotnav)
[![Installs](https://img.shields.io/visual-studio-marketplace/i/tuna-ex.dotnav?style=flat-square)](https://marketplace.visualstudio.com/items?itemName=tuna-ex.dotnav)

DotNav brings solution-first .NET development to Visual Studio Code. Navigate large solutions, manage run configurations, build and debug projects, and apply consistent C# formatting without leaving your editor.

## Highlights

- Discover `.sln`, `.slnx`, and standalone project files automatically.
- Browse logical solution folders, projects, dependencies, NuGet packages, and nested files.
- Build, rebuild, clean, test, run, or debug directly from the solution tree.
- Use `launchSettings.json` profiles and VS Code's .NET debugger integration.
- Create single-project or compound run configurations without maintaining `.vscode/launch.json`.
- Add, rename, move, delete, and drag project files with namespace-aware C# templates.
- Format C# selections with Roslyn plus configurable readability passes.
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

## Configuration

Open **Settings** and search for `DotNav`. Settings use the `dotnav.*` namespace for solution navigation, run behavior, file nesting, icons, and C# formatting.

## Feedback

[Open an issue](https://github.com/nguyentuan0307/DotNav/issues) with reproduction steps, your operating system, VS Code version, and relevant output logs.

## License

DotNav is available under the [MIT License](LICENSE).
