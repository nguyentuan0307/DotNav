# Releasing DotNav and GitNav

The two extensions are versioned independently by Release Please and packaged by GitHub Actions.

## Components

| Component | Marketplace ID | Tag format | Asset format |
| --- | --- | --- | --- |
| DotNav | `tuna-ex.dotnav` | `dotnav-v0.2.0` | `dotnav-0.2.0.vsix` |
| GitNav | `tuna-ex.gitnav` | `gitnav-v0.1.0` | `gitnav-0.1.0.vsix` |

## Normal release flow

1. Merge conventional commits into `master`.
2. CI tests both workspaces and validates both VSIX packages.
3. Release Please creates or updates a component Release PR only when files in that component changed.
4. Review and merge the relevant Release PR.
5. Release Please creates the component tag and GitHub Release.
6. The release workflow tests the complete monorepo, packages the tagged component, and attaches its VSIX.
7. Upload the VSIX to the matching Visual Studio Marketplace listing.

When releasing both extensions for the first time, merge and publish **GitNav before DotNav** because DotNav declares `tuna-ex.gitnav` as an extension dependency.

Use conventional commit prefixes to control semantic versioning:

- `fix:` creates a patch release.
- `feat:` creates a minor release.
- `feat!:` or a `BREAKING CHANGE:` footer creates a major release.

## Local verification

```console
npm install
npm test
npm run package:all
```

The generated files are `dist/dotnav.vsix` and `dist/gitnav.vsix`.

## Recovery

If packaging or asset upload fails after a GitHub Release exists, run **Build Release Asset** manually with the existing component tag.

Marketplace upload remains a manual publisher action and does not require an Azure DevOps organization, Azure subscription, or PAT.
