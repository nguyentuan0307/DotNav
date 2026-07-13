# Releasing

Releases are managed by Release Please and GitHub Actions.

## One-time repository setup

In **Settings > Actions > General > Workflow permissions**, select **Read and write permissions** and enable **Allow GitHub Actions to create and approve pull requests**.

## Normal release flow

1. Merge conventional commits into `master`.
2. CI runs the test suite and validates VSIX packaging.
3. Release Please creates or updates a Release PR containing the next version and changelog.
4. Review and merge the Release PR when the changes are ready to ship.
5. Release Please creates the version tag and GitHub Release.
6. The release workflow tests and packages that exact tag, then attaches the VSIX to the GitHub Release.
7. Download the VSIX asset from the GitHub Release and upload it on the Visual Studio Marketplace publisher management page.

Use these commit prefixes to control semantic versioning:

- `fix:` creates a patch release.
- `feat:` creates a minor release.
- `feat!:` or a `BREAKING CHANGE:` footer creates a major release.

## Recovery

If packaging or asset upload fails after the GitHub Release has already been created, open the **Build Release Asset** workflow, choose **Run workflow**, and enter the existing tag such as `v0.0.2`.

Marketplace upload remains a manual publisher action and does not require an Azure DevOps organization, Azure subscription, or PAT.
