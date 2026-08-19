# Agent Directives & Development Guidelines

## Release & Versioning Rules

- **DO NOT create Git tags manually**: All release tags (`dotnav-v*`, `gitnav-v*`) are strictly managed and generated automatically by GitHub Actions and Release Please workflows on GitHub.
- **DO NOT manually edit version numbers**: Do not manually modify package versions in `package.json` or `.release-please-manifest.json`. Version increments are calculated automatically from conventional commit history.
- **Use Conventional Commits**: All commit messages must follow conventional commit specifications (`feat:`, `fix:`, `refactor:`, `perf:`, `chore:`, `docs:`, `test:`).
- **Verify before pushing**: Always run `npm test` (monorepo test suite) and verify package builds with `npm run package:all` before pushing commits to `origin/master`.
