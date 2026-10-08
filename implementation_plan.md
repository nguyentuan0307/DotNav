# GitNav: History follows the selected diff side

Status: implementation reviewed; full build/test, mocked Chrome E2E and packaging passed. Native VS Code 1.126.0 verification passed 39/39 checks; local installations retained because their versions are newer.
Baseline: fc4e6dd34aed9ec53c79b68e8250ac6792f79c99; working tree was clean.
Classification: L2, editor commands/document providers/Git query contract across multiple code files.
Approval: user explicitly requested implementation of the proposed plan on 2026-10-08.

## Approved behavior

1. Keep right-click > GitNav > History. File, current-line and selection history use the clicked side's repository/path/revision; Command Palette uses the focused editor.
2. Support Git Log diff, file/selection branch compare, and old commit compare. History walks from the displayed revision backward, including common ancestors.
3. Pin revision sides to SHA when opening compare. Preserve original paths through rename and offsets for snippet documents. Working Tree snippets retain their original editor snapshot mapping, including staged/unsaved changes.
4. Reuse the existing History panel with a branch/commit source label. Reject empty sides and unavailable compare context without falling back to the checked-out branch.
5. Ordinary file history and Git Log file-list Timeline retain their behavior. Other editor actions remain file-only.

## Implementation

- New editorHistoryContext module: named source class, resource-to-editor selection, revision URI decoding, SHA capture and temporary no-index diff for Working Tree snapshots (cleanup in finally).
- Extension commands and queries: consume context-menu URI, accept explicit history ref and source label, retain ordinary file mapping.
- Compare providers and Git Log diff opening: attach snapshot context or stable revision URI, preserve side-specific rename paths.
- Manifest menu: expose History on GitNav virtual documents while leaving unsupported actions file-only.
- Regression coverage: context-menu side/selection, context errors, offsets, two real divergent branches, remote refs, older revisions, rename history, frozen snapshots, staged/unsaved changes and CRLF.
- Update the GitNav system guide for durable behavior.

## Acceptance and verification

- Static inspection of the complete source/call chain and git diff --check are permitted.
- Initial implementation turn did not authorize build/test. The user subsequently requested full build/test; compile, full tests, existing mocked E2E and packaging have now passed.
- Runtime Git query/context regression checks are verified by the full test suite. Native VS Code editor context-menu, Command Palette and Git Log diff checks passed in an isolated extension development host (39/39).
- Completed checks: npm run compile; npm test; existing mocked Chrome E2E; package:all; direct native VS Code left/right diff context menus and Command Palette. The native UI harness and evidence are stored under ignored .agents/gitnav-diff-history/native-vscode/.
- Freeze complete diff; independent Codex Reviewer inherits main model/effort, read-only, no nested agents, no build/test. Resolve confirmed findings and re-review before review-mark.sh reviewed.
- No version changes, tags, commits, pushes or EF/database operations.

## Verification report

- Source/call-chain inspection: completed, including both new files and all affected producers/consumers.
- git diff --check: exit 0, no output.
- Independent Codex Reviewer (inherited main model/effort): two rounds; one EOF/snippet-bound warning confirmed and fixed. Final review: no findings.
- Added regressions for empty/shorter branch snippets, final editor-only row, mixed content plus EOF and real empty source lines; preserved valid source bounds before slicing/mapping.
- Acceptance: branch/commit isolation, rename, offsets, snapshots and source labels are covered by passing regression tests. Menu contributions and URI routing are covered by tests/static review and actual native right-click interaction in VS Code.
- Initial implementation turn: compile/tests/E2E/package/install were not run (chưa build). Full build/test results from the authorized follow-up are recorded below.
- No owned build/debug/browser workers were started; no cleanup needed. No version/tag/commit/push/EF/database changes.

## Full build/test authorization (prior follow-up)

User explicitly requested full build/test on 2026-10-08. Run npm run compile, npm test, the existing mocked Chrome E2E script at its supported desktop/narrow sizes, npm run package:all, per project workflow after all checks pass. Local installation was deferred after discovering that both installed extensions are newer than the repository versions. The subsequent user request authorized direct VS Code verification; an isolated native harness was used. Track and clean only owned build/Chrome workers; preserve the existing JetBrains MSBuild/debug/LSP workers. Tests and E2E must not execute EF against a real database.

## Authorized full validation results

- .NET Build Host via safe-build.sh: exit 0, 0 warnings/errors; owned build group cleaned.
- npm run compile: exit 0 (all workspaces).
- npm test: exit 0; 868 tests, 867 passed, 0 failed, 1 Windows-only skip on Linux.
- New GitNav history regression tests passed, including source isolation, frozen revisions, rename, snippets, staged/unsaved changes, CRLF and EOF bounds.
- Chrome EF Tools E2E: exit 0 at 1440x1000, 1000x1000, 680x1000 and 420x1000; all EF/database interactions mocked.
- npm run package:all: exit 0; both VSIX ZIP integrity and exact manifest/bundle bytes verified.
- git diff --check: exit 0.
- Owned test/package groups left: 0; Chrome E2E workers left: 0; new MSBuild/VBCSCompiler workers: 0. Existing JetBrains MSBuild worker preserved.
- Native VS Code 1.126.0 verification: 39/39 passed. Actual context-menu/Command Palette routes, Git Log opening, old commits, rename, empty/missing context, frozen revision/snippets, staged/unsaved and CRLF mapping verified.
- Local installation was not performed: generated GitNav 0.19.0 / DotNav 0.20.2 are older than installed GitNav 0.22.1 / DotNav 0.32.6. Kept existing installations. No source version changes.

## Direct VS Code verification authorization and results

User requested “test thẳng trên vs code giúp tôi” on 2026-10-08. The built GitNav bundle was loaded in the actual VS Code 1.126.0 extension host with separate user-data and extension directories and a disposable two-branch Git fixture. Its entrypoint bytes match dist/gitnav.vsix.

- 39/39 native checks passed; both editor context menus and the Command Palette were exercised. The Git Log branch/commit changed-file UI opened real diff documents.
- Verified rendered History header and commit list, and clicked a history entry to verify its displayed patch.
- No production source fixes were needed. Existing installed GitNav 0.22.1 and DotNav 0.32.6 were preserved.
- Extension host exit 0; owned VS Code/Xephyr processes remaining: 0. Fixture clean on main; user JetBrains MSBuild preserved.
- Evidence and detailed results: .agents/gitnav-diff-history/native-verification.md and native-vscode/native-results.json; screenshot: native-vscode/vscode-history-verified.png.
