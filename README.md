# DotNav Workspace

[![CI](https://img.shields.io/github/actions/workflow/status/nguyentuan0307/DotNav/ci.yml?branch=master&style=flat-square&label=CI)](https://github.com/nguyentuan0307/DotNav/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](LICENSE)

DotNav Workspace is the monorepo for two focused Visual Studio Code extensions:

| Extension | Marketplace ID | Purpose |
| --- | --- | --- |
| **DotNav: .NET Solution Explorer** | `tuna-ex.dotnav` | Solution navigation, builds, run configurations, debugging, project operations, and C# formatting |
| **GitNav: Git History & Workflows** | `tuna-ex.gitnav` | Git Log, branch and commit workflows, comparisons, line history, and guarded mutations |

Installing DotNav automatically installs GitNav, so .NET users receive the complete experience. GitNav can also be installed independently in any Git repository without requiring .NET or C#.

## Repository layout

```text
extensions/
├── dotnav/    # .NET extension
└── gitnav/    # standalone Git extension
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
npm run test --workspace dotnav
npm run test --workspace gitnav
```

## Releases

DotNav and GitNav are versioned independently with Release Please. Tags use component prefixes such as `dotnav-v0.2.0` and `gitnav-v0.1.0`; each GitHub Release receives the matching VSIX automatically.

See [docs/releasing.md](docs/releasing.md) for the complete release and Marketplace upload flow.

## License

Both extensions are available under the [MIT License](LICENSE). Third-party attributions are listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
