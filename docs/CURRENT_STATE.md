# Current Project State

Last updated: 2026-07-12
Repository: `D:\VibingCode\CodexProject`

Read this file first when reopening the repository or starting a new Codex task. The complete historical feature log is in [implemented-features.md](implemented-features.md).

## Product

`Rider-like Solution Navigator` is a VS Code extension for .NET development. Its implemented areas are:

- Rider-style solution/project/file tree, logical solution folders, dependencies, file nesting, search, and reveal-active-file behavior.
- File/folder creation, rename, move, delete, copy-path, and reveal-in-OS actions.
- Project and user-managed run configurations, compound configurations, build/run/debug/test/clean, lifecycle tracking, status bar controls, cancellation, timeout, and process cleanup.
- Git history for the selected lines using `git log -L`, including dirty-worktree line mapping and an interactive diff webview.
- C# selection formatting that combines the installed C# extension's Roslyn formatter with repository-specific readability passes.

See [implemented-features.md](implemented-features.md) for behavior and key files for every product area.

## C# Formatter: Current Behavior

Command: `dotnetSolutionNavigator.formatSelection` (`Format Selection`).

- With a non-empty selection, only the selected full lines are replaced by default.
- With no selection, the whole document is formatted.
- `format.expandToEnclosingMember` can opt into expanding a selection to its containing C# member; default is `false`.
- Roslyn formatting runs first. Roslyn edits outside the requested range are rejected.
- Custom passes then normalize indentation, leading-comma lists, fluent chains, and blank lines.
- Indentation respects the editor's `insertSpaces` and `tabSize` settings.
- Formatting works without an `.editorconfig`; no warning is shown.
- A matching `.editorconfig` `max_line_length` overrides the extension's fallback wrap column. Layered sections and glob patterns including `**` are supported.
- Long single-line argument/parameter lists can be wrapped. Nested calls, generics, lambdas, strings, chars, raw/interpolated strings, suffix comments, LF/CRLF, and malformed input are guarded by lexer/scanner logic.
- Existing multiline argument/parameter lists are normalized to leading commas and aligned to a stable visual anchor.
- Strict fragments containing only leading-comma lines or only fluent continuation lines preserve the first selected line as their alignment anchor.
- Multiline fluent chains including `.`, `?.`, MongoDB builder calls, LINQ chains, and initializer content are aligned consistently.
- Repeated formatting is intended to be idempotent and preserve non-whitespace tokens.
- Lists containing comments or preprocessor directives are currently left unchanged when structural formatting cannot be proven safe.

Formatter pipeline entry points:

- `src/format/formatSelection.ts` — command orchestration and range replacement.
- `src/format/roslynFormat.ts` — scoped Roslyn formatting.
- `src/format/editorConfig.ts` — `.editorconfig` lookup and `max_line_length` resolution.
- `src/format/csharpLexer.ts` — code/string/comment classification.
- `src/format/passes/` — indentation, lists, fluent-chain, and blank-line passes.
- `src/test/formatCompatibility.test.ts` — broad compatibility/property matrix.
- `src/test/formatPasses.test.ts` — direct formatter regressions and reported examples.

## Formatter Settings

All names are prefixed with `dotnetSolutionNavigator.`:

| Setting | Default | Purpose |
| --- | ---: | --- |
| `format.normalizeIndentWhitespace` | `true` | Normalize leading indentation using the active editor indentation unit. |
| `format.enableLeadingComma` | `true` | Format multiline C# parameter and argument lists with leading commas. |
| `format.wrapColumn` | `120` | Fallback line width when `.editorconfig` does not provide `max_line_length`. |
| `format.leadingCommaWrapStyle` | `wrapIfLong` | `wrapIfLong`, `chopAlways`, or `keep` for single-line lists. |
| `format.enableFluentChainWrap` | `true` | Align multiline fluent/LINQ chains. |
| `format.fluentChainMinSegments` | `2` | Minimum continuation count before chain alignment. |
| `format.enableBlankLineRules` | `true` | Collapse repeated blank lines and remove blank lines just inside braces. |
| `format.expandToEnclosingMember` | `false` | Expand a selection to its enclosing member when explicitly enabled. |

## Verification Baseline

At this checkpoint:

- `npm test`: 132/132 tests passed.
- VSIX packaging succeeded.
- Packaged artifact: `D:\VibingCode\CodexProject\rider-like-solution-navigator-0.0.1.vsix`.
- Latest formatter checkpoint commit: `1dab400 fix: format strict selection fragments safely`.
- Worktree was clean immediately after that commit; check `git status --short` on reopening because this document may be a newer change.

Standard verification commands:

```powershell
npm test
git diff --check
npx --yes @vscode/vsce package --allow-missing-repository
```

## Known Gaps and Recommended Next Work

Priority order:

1. Add support for multiple selections/multi-cursor. The command currently uses only `editor.selection`, not all `editor.selections`. Normalize and merge overlapping full-line ranges, then submit non-overlapping replacements in original-document coordinates.
2. Expand safe formatting around comments between arguments. The current conservative skip avoids corrupting comment ownership.
3. Expand safe handling for `#if`, `#else`, and `#endif` inside lists. These are intentionally skipped today.
4. Consider a Roslyn AST helper for long-term structural accuracy if formatter rules grow beyond what the TypeScript lexer/scanner can safely prove.
5. Continue collecting real project snippets where the output is valid but visually awkward; add each as an idempotent regression test before changing a pass.

For any formatter change, preserve these invariants:

- Never modify text outside the requested range unless member expansion is explicitly enabled.
- Never change non-whitespace tokens as a side effect of visual alignment.
- Formatting twice must equal formatting once.
- Preserve line endings and the active tabs/spaces policy.
- Prefer safely leaving ambiguous syntax unchanged over guessing.

## Repository Notes

- `AGENTS.md` supplied to the task contains `@RTK.md`, but `RTK.md` was not present under `D:\VibingCode` at the last check. Recheck if it is added later.
- Do not discard unrelated user changes in a dirty worktree.
- Use `apply_patch` for hand-written file edits.
