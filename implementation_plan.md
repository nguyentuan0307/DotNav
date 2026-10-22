# GitNav: Git timeout policy & interactive rebase runtime (+ đề xuất tách client ERD)

Status: **CHỜ DUYỆT** — chưa sửa code.
Baseline: `6dbee57` trên `claude/eloquent-maxwell-t4yo4w` (trùng `origin/master`), working tree sạch.
Request: sửa issue ① (watchdog 25s cắt lệnh git dài) và ② (interactive rebase cần `node` trên PATH); đề xuất cải tiến ④ (client ERD trong template literal).

## Issue ① — Watchdog 25s áp cho mọi lệnh git

### Nguyên nhân
- `extensions/gitnav/src/git/gitCli.ts:15` — `DEFAULT_GIT_TIMEOUT_MS = 25_000`, là giá trị mặc định của tham số `timeoutMs` trong `runGit` (`gitCli.ts:25`).
- Không caller nào truyền timeout riêng. `GitRepositoryService.git` (`gitRepositoryService.ts:359`) gọi `runGit(root, args, token)`; mọi mutation trong `GitMutationRunner` (fetch/pull/push/merge/rebase/cherry-pick/revert/commit/switch/stash…), `runInteractiveRebase`, `worktreeManager` (`worktree add/remove/prune`) đều đi qua mặc định 25s.
- Hậu quả: push/fetch repo lớn hoặc mạng chậm, commit có pre-commit hook (lint/test), checkout repo lớn, nhập credential (Git Credential Manager trên Windows) > 25s → SIGTERM. Kill `merge`/`rebase`/`cherry-pick` giữa chừng để lại repo ở trạng thái đang thao tác dở.

### Giải pháp (tối giản, 1 chỗ)
Chọn timeout mặc định theo subcommand ngay trong `gitCli.ts`, không phải sửa các call site:
- Thêm `LONG_GIT_TIMEOUT_MS = 10 * 60_000` và hàm export `defaultGitTimeoutMs(args)`.
- Lệnh ghi/mạng → 10 phút: `fetch, pull, push, clone, merge, rebase, cherry-pick, revert, commit, switch, checkout, reset, restore, am, apply, gc`; `stash` (trừ `list`/`show`); `worktree` (trừ `list`).
- Mọi lệnh khác (log, status, diff, show, rev-parse, for-each-ref, blame, ls-files…) giữ nguyên 25s — chống treo khi CPU 100% như thiết kế ban đầu.
- `runGit(..., timeoutMs: number = defaultGitTimeoutMs(args))`. Caller truyền timeout tường minh vẫn được tôn trọng (test hiện có dùng 5000).
- **Vì sao 10 phút thay vì bỏ hẳn timeout**: `RepositoryMutationQueue` tuần tự hoá mutation theo repo, và một số bước chuẩn bị (fetch trong `update`/`checkoutUpdate`/`pushAfterUpdate`, background auto-fetch) chạy không có cancellation token. Bỏ hẳn timeout thì một lệnh treo (SSH passphrase, lock) sẽ khoá queue vĩnh viễn. 10 phút đủ cho thao tác thực tế mà vẫn tự giải phóng. Bước cuối của mutation vẫn huỷ được qua notification progress hiện có.
- Ngoài scope (ghi nhận, không làm): truyền cancellation token cho các bước chuẩn bị nói trên.

### File sửa
- `extensions/gitnav/src/git/gitCli.ts` (khoảng 15 dòng).
- Test: `extensions/gitnav/src/test/gitFeatures.test.ts` — thêm case cho `defaultGitTimeoutMs` (lệnh đọc = 25s; push/fetch/commit/rebase/merge = 10 phút; `stash list` / `worktree list` = 25s; `stash push` / `worktree add` = 10 phút).

## Issue ② — Interactive rebase phụ thuộc `node` trên PATH

### Nguyên nhân
`extensions/gitnav/src/git/gitInteractiveRebase.ts:23-24` đặt `GIT_SEQUENCE_EDITOR: node "<script>"` và `GIT_EDITOR: node "<script>"`. Extension host của VS Code chạy trên runtime Electron có sẵn, không bảo đảm có Node.js cài riêng → máy không có `node` (thường gặp với dev .NET trên Windows) bị lỗi ở Interactive Rebase, Edit Commit Message (commit cũ), reword/squash.

### Giải pháp
- Chạy script bằng chính runtime của extension host: `process.execPath` kèm `ELECTRON_RUN_AS_NODE=1`.
- Đặt biến **inline trong chuỗi lệnh editor** (`ELECTRON_RUN_AS_NODE=1 "<execPath>" "<script>"`; git chạy editor qua `sh`, kể cả Git for Windows) thay vì đưa vào env của tiến trình git — tránh rò `ELECTRON_RUN_AS_NODE` sang git hooks chạy trong lúc rebase.
- Chạy được trong Node thuần (test, Remote SSH/WSL): `process.execPath` là `node`, biến môi trường bị bỏ qua.
- Thêm helper nhỏ `nodeScriptCommand(scriptPath)` để test được (đặt trong `gitCli.ts`, vì `gitInteractiveRebase.ts` import `vscode` lúc runtime nên không import được trong unit test).

### File sửa
- `extensions/gitnav/src/git/gitInteractiveRebase.ts` (2 dòng env).
- `extensions/gitnav/src/git/gitCli.ts` (helper).
- Test: unit test cho định dạng lệnh (dùng `process.execPath`, không bắt đầu bằng `node `), và integration test chạy `git rebase -i` thật trên repo tạm, với `GIT_SEQUENCE_EDITOR` lấy từ helper (script đổi `pick` → `drop`) để xác nhận git thực thi được chuỗi lệnh (quoting) trên OS hiện tại.

## Kiểm thử ① + ②
1. `git diff --check`.
2. `npm run compile` → exit 0.
3. `npm test` → toàn bộ pass (trên cloud: .NET 8 + `DOTNET_ROLL_FORWARD=Major` cho 3 test Smart Build).
4. Kiểm chứng thủ công qua script tạm: repo có pre-commit hook `sleep 30` → `runGit(['commit',…])` thành công (trước sửa: timedOut). Rebase với PATH không chứa `node` → thành công.
5. Không đụng UI/webview → không cần E2E. Đóng gói `.vsix` chỉ khi bạn yêu cầu (không cài được vào VS Code local từ cloud).
6. Commit dự kiến: `fix(gitnav): scale git timeout by command and run rebase editors on the host runtime` (hoặc tách 2 commit). Push lên `claude/eloquent-maxwell-t4yo4w`; không tạo PR trừ khi bạn yêu cầu.

---

## Đề xuất ④ — Tách client ERD khỏi template literal (CHỈ ĐỀ XUẤT, chưa thuộc scope sửa)

### Hiện trạng
- `extensions/dotnav/src/ef/diagram/efDiagramClient.ts`: 4.331 dòng JS (76 hàm, state toàn cục) trong `return \`...\``; `efDiagramStyles.ts` có 2.106 dòng CSS cùng kiểu. `efDiagramHtml.ts` nhúng cả hai inline vào HTML.
- Không được typecheck/lint; phải escape `` \` ``, `\${}`, regex (AGENTS.md mục 2 phải cảnh báo riêng).
- Test (`src/test/efDiagramClient.test.ts`) cắt chuỗi bằng `indexOf('  function computeRelGeometry(')` rồi `new Function(...)` — vỡ khi đổi tên/thụt lề.
- Message protocol host↔webview không chia sẻ type (`parseEfDiagramMessage` ở host, `switch (msg.type)` ở client).

### Kiến trúc đích
```
src/ef/diagram/
  efDiagramProtocol.ts        ← type message dùng chung host + client
  webview/                    ← tsconfig riêng: lib DOM, không import vscode
    main.ts                   ← bootstrap, acquireVsCodeApi, message router
    state.ts                  ← state + undo/redo
    geometry.ts               ← computeRelGeometry, routing (pure → test trực tiếp)
    render/{cards,links,notes,sidebar,finder}.ts
    interactions/{drag,marquee,zoom,keyboard}.ts
    diagram.css
```
- esbuild (đã là devDependency) bundle `webview/main.ts` → `out/webview/efDiagram.js` (IIFE) và copy CSS; thêm bước này vào script `compile` và whitelist `!out/webview/**` trong `.vscodeignore`.
- `efDiagramHtml.ts` dùng `<script nonce src="${asWebviewUri}">` + `<link rel="stylesheet">`; CSP thêm `script-src ${cspSource}` (GitNav đã làm vậy trong `gitLogWebviewHtml.ts`). `localResourceRoots` đã cho phép `extensionPath`.

### Lộ trình (mỗi bước 1 PR, behavior không đổi)
| Bước | Nội dung | Rủi ro |
|---|---|---|
| P0 | Chụp baseline E2E Chrome headless (DOM, click, kéo thả, zoom, focus mode, notes, export Mermaid) trên fixture DbContext | Thấp |
| P1 | **Chuyển cơ học**: sinh `webview/main.js` bằng cách *chạy* `getEfDiagramClientScript()` và ghi output ra file (chuỗi đã unescape chính xác lúc runtime, không unescape tay); tương tự CSS. Nạp qua URI. Rename `.ts` + `// @ts-nocheck` | Thấp; so E2E với P0 |
| P2 | Tách pure module (`geometry`, layout, undo stack) có type; viết lại 5 test hiện có thành import trực tiếp | Thấp |
| P3 | `efDiagramProtocol.ts` dùng chung; bỏ `@ts-nocheck` từng file | Trung bình |
| P4 | Tách render/interactions; thay state toàn cục bằng object `DiagramState` | Trung bình |
| P5 | Áp dụng cùng mẫu cho `efDialogClientScript.ts`/`efDialogStyles.ts` (EF Core Center) và Local History; cập nhật AGENTS.md mục 2 | Thấp |

### Lợi ích
Typecheck + IDE support cho 6.400+ dòng client, hết lỗi escape, test geometry/routing trực tiếp, protocol an toàn kiểu, có thể thêm ESLint (issue ⑦) cho cả webview, HTML ban đầu nhỏ hơn (script cache theo URI).

### Chi phí
P0–P2 khoảng 1–2 phiên làm việc; P3–P5 làm dần. Cần E2E headless ở mỗi bước (môi trường cloud có Chromium/Playwright).

---

# GitNav: History follows the selected diff side

## Follow-up plan: History tab placement follows the invoked diff side

Status: implementation complete; compile and full tests passed, and native VS Code 1.126.0 checks passed 45/45 (44 placement/preservation checks plus one explicit native-window focus retry check). Final independent review: no issues. Automatic recovery after switching native windows during loading is unsupported; the command reports a focus retry instead of opening History in the wrong window.
Baseline: 764ee15d85e5d68cf62d7cb4a98578c07276b3d7, pushed to origin/master; working tree was clean.
Classification: L2, editor command/panel presentation contract; independent Codex Reviewer after implementation.
Request: calling History from the left diff side opens its tab to the left; calling it from the right side opens its tab to the right.

### Current behavior and intended layout

`LineHistoryPanel.show` creates and reveals its shared panel with `ViewColumn.Beside`, regardless of the invoked diff side. Revision routing is already correct; panel placement has no side context.

VS Code represents both original and modified resources as one `TabInputTextDiff` in one editor group. The proposed History tab sits in a separate editor group beside that diff; it is not a tab embedded inside an original/modified half.

- Left invocation: `[History] [Diff: original | modified]`.
- Right invocation: `[Diff: original | modified] [History]`.
- Reuse the existing single History tab, moving it to the requested side on subsequent calls. Keeping two simultaneous independent History panels is outside this proposed scope.

### Implementation scope

1. Capture the invoked URI, owning diff tab/group and original/modified side before awaiting the history query. Command Palette uses the focused editor; distinguish the side from the diff tab's URIs rather than URI scheme or branch name.
2. Pass a clearly named presentation context from all three History commands to the existing panel. Resolve placement against the source diff group, including when a History panel is already focused or the user changes focus during loading.
3. Select or create an adjacent History group on the requested horizontal side. Reuse the group's existing GitNav History tab where possible; move the shared panel when switching sides without replacing the diff or moving unrelated tabs. Avoid accumulating empty groups when repeatedly invoking History.
4. Ordinary editors keep their existing adjacent History behavior. History query refs, source labels, snapshot/line mapping and Git Log Timeline behavior stay as implemented.

Primary files: `extensions/gitnav/src/extension.ts`, `extensions/gitnav/src/git/lineHistoryPanel.ts`; add a focused placement/context module only if needed for clear shared ownership and regression coverage. Add regression tests under `extensions/gitnav/src/test` and update section 16 of `docs/gitnav-system-guide.md`.

### Acceptance and verification

- Left and right context-menu invocation puts File/Current Line/Selection History on the corresponding side of the source diff; Command Palette behaves identically for the focused side.
- Repeated calls and left/right switching reuse History without duplicate tabs, empty groups or closing the diff. Verify when the diff is not the first editor group and when unrelated tabs/groups already exist.
- Calling History while an existing panel is open or changing focus between editor groups during loading still anchors placement to the original diff source. If VS Code cannot activate a different native source window, report a focus retry without opening History elsewhere.
- Branch and old-commit histories retain correct revision, source label and line/selection offsets; ordinary files still work.
- Static call-chain inspection and `git diff --check` after implementation. Freeze the complete diff for an independent Reviewer and resolve confirmed findings before reporting completion.
- Build/test/package/native VS Code execution requires a fresh explicit user request in the implementation turn. When requested: `npm run compile`, `npm test`, `npm run package:all` if packaging is requested, and direct VS Code placement checks using an isolated extension development host. Do not replace newer installed extensions with older repository packages.
- No commit/push for this follow-up unless requested after implementation.

Approval: user replied “Chốt. Triển khai” on 2026-10-08, subsequently requested “build/test trên vs code”, and resumed that verification with “continue” on 2026-10-09. Compile, full tests and direct VS Code verification are authorized for this resumed task; no follow-up package/install/commit/push was requested.

### Implementation result

- All three commands capture the owning tab and original/modified side before loading history. `HistoryPanelLocation` carries the presentation context into the existing shared panel.
- `historyPanelPlacement.ts` resolves horizontal neighbors from nested layout geometry, creates a left/right group when needed, and tracks only groups created by GitNav. Floating editor windows use explicit adjacent creation because layout trees are local to a window while ViewColumns are global. Direct ordinal group-focus commands avoid stale active-group DTO state in floating windows; higher columns use Last/Previous commands.
- Source capture rules out ordinary-file groups positively identified by another visible same-URI editor with a known column. Captured source TextEditor instances guard focus before layout/splitting; native-window activation failure reports “Focus the source editor window and run History again.” A retry from the source diff opens History correctly.
- `LineHistoryPanel` serializes placement and cleanup, moves one shared panel, and handles asynchronous tab updates plus disposal followed by replacement. Only empty owned groups are closed.
- Added 15 regression cases. Independent static Reviewer found two warnings in round 1; both were confirmed, fixed and re-reviewed with no findings in round 2. Native verification exposed a floating-window focus timeout and a same-URI ordinary-tab owner mismatch; read-only Reviewer independently confirmed both. Targeted focus and owner exclusion fix these cases. Native-window activation cannot be guaranteed by group focus or vscode.diff, including with a real window manager; the final focus guard prevents misplaced History and offers a retry. Full review snapshots and raw command outputs are under `.agents/gitnav-history-placement/` (ignored artifacts).

| Acceptance check | Evidence/status |
|---|---|
| File/Current Line/Selection, URI and Command Palette side capture | Native context menus and actual Palette verified on both sides; 15 placement regressions pass |
| Left/right placement, one shared panel, middle diff group and unrelated tabs | Native repeated switching and middle-group checks pass; one History tab, source diff and unrelated tabs retained |
| Existing History focus, changed focus, closed source during loading | Native delayed real Git log checks pass for group changes; closed-source error opens no misplaced panel. Switching native windows is guarded with an explicit retry; automatic cross-window recovery remains unsupported |
| Nested/vertical layout and floating editor windows | Native vertical/nested layout, ninth source group and floating left/right context-menu checks pass |
| Ordinary Beside behavior and cleanup only of empty owned groups | Native ordinary-file Palette and closeEmptyGroups=false checks pass; user-created empty group retained |
| Revision, source labels, offsets and Git Log Timeline preserved | Native branch/old-commit ancestry, checkout pinning and snippet offsets pass; no Timeline/query/provider changes, preserved by static inspection and full tests |
| Whitespace and independent review | Tracked `git diff --check` exit 0; new-file checks have no whitespace diagnostics. Final independent complete six-file review: no issues |
| Compile and full tests | `npm run compile` exit 0; `npm test` exit 0: 883 total, 882 pass, 0 fail, 1 Windows-only skip |
| Native VS Code | Isolated extension development host 1.126.0, current repository extension 0.19.0: 45/45 pass; real menus, Palette, Git subprocesses and webviews. Includes one guarded native-window activation failure plus successful retry, not automatic cross-window recovery |
| Package and installation | Not requested/run for this follow-up; newer installed GitNav 0.22.1 and DotNav 0.32.6 retained |

Verification artifacts: `compile-window-guard.log`, `tests-window-guard.log`, `native-placement-complete.log`, `native-edge-complete.log`, `native-right-first-final.log`, `native-window-guard-final.log`, `native-vscode/native-final-combined.json`, and final left/right screenshots. Earlier failing attempts are retained: test URI cast and fixture label errors, harness startup/layout issues, floating focus timeout, duplicate-URI capture failure and native-window activation counterexample. Final gates above rerun the affected checks. Window-manager dependencies were extracted only into ignored test artifacts; no system package installation.

No commit or push performed for this follow-up.

---

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
