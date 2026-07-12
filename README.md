# Rider-like Solution Navigator

A small VS Code extension MVP that adds a Rider-inspired `.NET` activity bar view.

> Continuing development? Start with `docs/CURRENT_STATE.md` for the current implementation, formatter behavior, verification baseline, known gaps, and recommended next work. The full feature history is in `docs/implemented-features.md`.

## Features

- Finds `.sln`, `.slnx`, and standalone `.csproj` files.
- Renders projects in a dedicated solution tree.
- Hides noisy folders such as `bin`, `obj`, `.vs`, `.vscode`, `node_modules`, `TestResults`.
- Shows root-level projects directly and only groups common containers such as `src` and `tests`.
- Includes Docker Compose `.dcproj` projects from solution files.
- Shows project references and NuGet packages.
- Adds project context actions for build, run, test, clean, set startup project, and open terminal.
- Runs and debugs projects through VS Code's .NET debugger API, including `launchSettings.json` profile selection.
- Shows run/debug actions only for runnable projects such as Web, Console, or projects with launch profiles.
- Configures and runs multiple startup projects without writing `.vscode/launch.json`.
- Tracks launched debug sessions and managed dotnet tasks so project-level `Stop` and toolbar `Stop All` can shut them down.
- Adds a Rider-style status bar run selector with Build, Run, Debug, and Stop All controls.
- Stops tracked sessions and tasks when the extension is deactivated.
- Provides configurable icon modes and Rider-style folder mappings for common .NET folders.
- Nests related files such as `appsettings.Development.json`, generated C# files, Razor code-behind, and XAML code-behind under their parent files.
- Adds a Rider-style `Add` submenu on projects and folders for new classes, interfaces, records, enums, files, folders, and existing items.
- Adds Rider-style file and folder actions for rename, move, and delete.
- Supports Explorer-style `F2` rename, `Delete`, drag-and-drop moves, and automatic tree refresh for file changes.
- Generates C# namespaces from `RootNamespace` and the target folder path.
- Uses the active VS Code file icon theme for project files, source files, and folders.
- Uses dedicated project icons for Web, Library, Test, Console, Docker, and unknown project types.
- Lets folder clicks expand/collapse the tree instead of opening the OS file explorer.
- Lets project clicks expand/collapse the tree; use the context menu to open the project file.
- Adds a view-title toggle for showing or hiding project files such as `.csproj`.

## Try It

1. Run `npm install`.
2. Run `npm run compile`.
3. Open this folder in VS Code.
4. Press `F5` to launch the Extension Development Host.
5. Open a .NET solution folder in the Extension Development Host.

## Settings

- `dotnetSolutionNavigator.hiddenFolders`
- `dotnetSolutionNavigator.hiddenFiles`
- `dotnetSolutionNavigator.showDependencies`
- `dotnetSolutionNavigator.showProjectFiles`
- `dotnetSolutionNavigator.buildBeforeRun`
- `dotnetSolutionNavigator.buildConfiguration`
- `dotnetSolutionNavigator.iconMode`
- `dotnetSolutionNavigator.enableFileNesting`
- `dotnetSolutionNavigator.fileNestingRules`
