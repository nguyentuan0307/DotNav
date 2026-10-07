# EF Core Center: usable side guide and beginner-friendly content

Status: complete; verified, reviewed, packaged and installed locally.
Baseline: 0c686e6 (working tree clean). Classification: L2, UI rendering/client/content contract across multiple files. Independent Codex Reviewer inherits main model and effort.

## Approved behavior

1. Open a guide beside the form inside EF Core Center, without a backdrop or focus trap. Keep form fields, Check, Update and Cancel accessible. On narrow screens place the guide below the form; each surface remains scrollable.
2. Present a short purpose, numbered action-specific steps, expected result and relevant cautions. Collapse prerequisites and field explanations/examples; highlight and reveal the explanation for the focused field without stealing focus.
3. Review all eleven action guides (including the previously missing Create Empty Migration guide) in English and Vietnamese against actual DotNav commands and official EF documentation. Explain project/startup/context, defaults, Check vs Update, --add, rollback/0, Force/Offline, SQL ranges and compiled-model activation in plain language.
4. Preserve operation ownership, busy state, field values, command generation and cancellation. Guide controls remain usable during an operation; Enter in guide content never submits the form.

## Files

- `efDialogHtml.ts`, `efDialogStyles.ts`, `efDialogClientScript.ts`: integrated responsive aside, readable sections and safe focus/keyboard behavior.
- `efActionHelp.ts`, `efDialogI18n.ts`: bilingual steps and corrected explanations.
- `efCommands.ts`: clarify SQL From/To field labels as current/target states (text only, preserving generated commands).
- Existing guide/render tests and `scripts/ef-tools-e2e.mjs`: meaningful regressions for form interaction with guide open, focus, locale, narrow layouts and busy controls.

## Verification and completion

- Run `npm run compile`, `npm test`, `node scripts/ef-tools-e2e.mjs` at desktop and narrow viewport sizes, and `git diff --check`.
- Inspect actual Chrome screenshots for desktop/narrow layouts. All EF/database commands in tests remain mocked.
- Freeze complete L2 diff, independent review, fix verified findings, mark review.
- Run `npm run package:all`; install `dist/dotnav.vsix` locally with `code --install-extension dist/dotnav.vsix --force`.
- Track/clean only owned build/Chrome workers. No real EF operations, migrations, database updates, version/tag changes, commits or pushes.

## Sources

- https://learn.microsoft.com/en-us/ef/core/cli/dotnet
- https://learn.microsoft.com/en-us/ef/core/performance/advanced-performance-topics#compiled-models
- https://learn.microsoft.com/en-us/ef/core/managing-schemas/migrations/applying#with-from-and-to

## Verification report

- Compile and full suite pass: 858 tests passing, one existing Windows-only test skipped on Linux.
- Chrome E2E passes at 1440, 1000, 680 and 420px. Actual desktop/narrow screenshots inspected. All EF/database execution mocked.
- Independent L2 review completed in two rounds; three findings fixed (Update name example, SQL rollback/state guidance, F1 focused-field reveal). No findings remain.
- Final diff check passed; owned build/Chrome workers cleaned.
- `npm run package:all` passed. `code --install-extension dist/dotnav.vsix --force` succeeded; installed bundle matches the packaged bundle. No real EF/database operation was run.
