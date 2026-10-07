# EF Core Tools: operation lifecycle and button state

Status: complete; verified, reviewed, packaged and installed locally.
Classification: L2 (cross-layer callbacks, queue, process cancellation). Review: independent Codex Reviewer with inherited model and effort.

## Approved behavior

1. Release busy state when work finishes, independently of notification dismissal; terminate progress on all failures.
2. Recompute Update validity after connection/startup/context/configuration/mode changes. Invalidate checked state after every write attempt.
3. Distinguish successful, failed, cancelled, and unknown database checks. Failed/unknown checks show an error and allow Update when the form is valid.
4. Keep host UI state and replay it when the webview becomes ready. Scope callbacks to their action/revision and lock fields during work; Cancel, Output, and Help remain available.
5. Propagate optional AbortSignal through operation, tool preparation, CLI, queue, and process runner. Cancel only the corresponding request, wait for termination, and retain the form. Idle Cancel closes the Center.

## Implementation scope

- EF dialog host/client: operation ownership, state replay, callback isolation, bounded busy state and field locking.
- EF command callbacks/database check: explicit result states, consistent validation, scoped progress and non-blocking notifications.
- EF CLI/tool preparation/queue/process: per-request cancellation, no retry after cancellation, listener/timer cleanup.
- Regression tests and Chrome Headless E2E, with all EF/database operations mocked.

## Acceptance and authorized verification

- Cover eight reproduced regressions: deferred notification, connection-change lock, --add lock, failed check, unknown applied status, stale check response, ready during execution, and Cancel without cancellation.
- Cover cancellation before start, while queued, and while running; preserve unrelated queue entries.
- Run `npm run compile`, `npm test`, `node scripts/ef-tools-e2e.mjs`, and `git diff --check`.
- Freeze and independently review the complete L2 diff; address findings and mark review.
- Run `npm run package:all` and `code --install-extension dist/dotnav.vsix --force`.
- Track and clean only processes started by this task. No migration generation/application or real database write commands. No version/tag/commit changes.

## Baseline and report

Working tree was clean at intake. Source audit and in-memory reproduction completed before approval.
Compile, full test suite (858 passing; one existing Windows-only skip), Chrome Headless E2E, and diff check pass.
Independent L2 review completed in two rounds. Fixed two additional gaps: superseded project/startup validation and malformed migration-array members. No findings remain.
`npm run package:all` passed. `code --install-extension dist/dotnav.vsix --force` reported successful installation. All EF/database regression and E2E operations were mocked; no migration was generated or applied.
