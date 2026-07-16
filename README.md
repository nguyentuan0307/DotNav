# GitNav & DotNav for Visual Studio Code

[![CI](https://img.shields.io/github/actions/workflow/status/nguyentuan0307/DotNav/ci.yml?branch=master&style=flat-square&label=CI)](https://github.com/nguyentuan0307/DotNav/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](LICENSE)

This repository contains two focused Visual Studio Code extensions. **GitNav** is the primary, standalone extension: it brings visual Git history and guarded Git workflows into the editor. **DotNav** adds solution-first navigation and development tools for .NET projects.

## GitNav: visual Git workflows without leaving VS Code

[![Install GitNav](https://img.shields.io/badge/Marketplace-Install%20GitNav-007ACC?style=for-the-badge&logo=visualstudiocode&logoColor=white)](https://marketplace.visualstudio.com/items?itemName=tuna-ex.gitnav-workflows)

VS Code's built-in source control is useful for everyday changes, but understanding repository history and running multi-step Git operations often means switching between views and terminal commands. GitNav puts those workflows in one visual panel.

- Read branches, tags, commits, stashes, worktrees, and changed files in a visual Git graph.
- Compare files or selected lines against another branch.
- Inspect the commit history of a selected range of code.
- Run branch, stash, reset, cherry-pick, revert, and rebase workflows with contextual confirmations.
- Continue, skip, or abort conflicted operations from their current Git state.
- Block history-rewriting actions on protected branches.

[Read the GitNav guide](extensions/gitnav/README.md) · [Download a VSIX](https://github.com/nguyentuan0307/DotNav/releases) · [Report an issue](https://github.com/nguyentuan0307/DotNav/issues)

## DotNav: a solution-first .NET workspace

[![Install DotNav](https://img.shields.io/badge/Marketplace-Install%20DotNav-512BD4?style=flat-square&logo=visualstudiocode&logoColor=white)](https://marketplace.visualstudio.com/items?itemName=tuna-ex.dotnav)

DotNav provides solution navigation, project operations, builds, run configurations, debugging, and C# formatting for .NET development in VS Code. Installing DotNav also installs GitNav, giving .NET users the complete workspace experience.

[Read the DotNav guide](extensions/dotnav/README.md) · [Download a VSIX](https://github.com/nguyentuan0307/DotNav/releases)

## Choose an extension

| Extension | Use it when you need | Requirements |
| --- | --- | --- |
| **GitNav** | Visual Git history, comparisons, line history, and guarded Git operations | VS Code and Git |
| **DotNav** | .NET solution navigation, build, run, debug, project operations, and C# formatting | VS Code and a .NET SDK |

GitNav works independently in any Git repository and does not require .NET or C#. DotNav depends on GitNav and installs it automatically.

## Repository layout

```text
extensions/
├── gitnav/    # standalone Git extension
└── dotnav/    # .NET extension
docs/          # engineering and release documentation
```

Each extension owns its manifest, source, tests, README, changelog, and VSIX packaging configuration. The root npm workspace coordinates builds and tests.

## Development

```console
npm install
npm test
npm run package:all
```

Generated VSIX files are written to `dist/`. To work on one extension only:

```console
npm run test --workspace extensions/gitnav
npm run test --workspace dotnav
```

## Releases

GitNav and DotNav are versioned independently with Release Please. Tags use component prefixes such as `gitnav-v0.5.2` and `dotnav-v0.4.0`; each GitHub Release receives the matching VSIX automatically.

See [docs/releasing.md](docs/releasing.md) for the complete release and Marketplace upload flow.

## License

Both extensions are available under the [MIT License](LICENSE). Third-party attributions are listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
