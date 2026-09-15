# DotNav Hotfix Phase 2.1 — Solution-Relevant Search Whitelist

**Trạng thái:** Đã triển khai, full test pass, đóng gói và cài local ngày 2026-09-15.

## Mục tiêu

- Search Everywhere chỉ index các loại file có giá trị với solution .NET.
- Không discover/read `.sql`, Markdown, YAML, Proto hoặc JSON cấu hình không liên quan.
- Giữ nguyên stale-while-idle Phase 2 và không thêm setting mới.

## Thực trạng đã xác minh

1. Startup scan hiện nhận `cs`, mọi `json`, `csproj`, `resx`, `sql`, `yaml/yml` và `proto`.
2. File watcher dùng cùng tập extension trên. Parser Markdown vẫn tồn tại nhưng `.md` không nằm trong startup glob/watcher, nên Markdown hiện không được tự động index.
3. Workspace Backend có 702 JSON, trong đó 241 file là `appsettings*.json`; 461 JSON còn lại đang được discover và parse dù phần lớn không phải mục tiêu Search.
4. Workspace có 2 SQL và 10 YAML; file SQL lớn từng là parse hotspot dù parser đã được tối ưu ở Phase 2.
5. Folder glob không tương đương MSBuild project membership: một số `.csproj` có `<Compile Remove=...>`. Việc đánh giá chính xác item graph của MSBuild là scope lớn hơn và có nguy cơ tái tạo tranh chấp CPU với Roslyn/C# Dev Kit.

## Rule đề xuất — whitelist thực dụng

- Index: `.cs`, `.csproj`, `.resx`, `appsettings*.json`.
- Không index: `.sql`, `.md`, `.yaml`, `.yml`, `.proto`, mọi JSON không có basename bắt đầu bằng `appsettings`.
- Tiếp tục loại `.Designer.cs`, `.g.cs`, `.generated.cs`, `*ModelSnapshot.cs`, `bin/`, `obj/` và các thư mục tooling hiện có.
- Đây là whitelist theo giá trị tìm kiếm, không phải MSBuild item evaluation. Cách này loại nhiễu mà không gọi MSBuild hoặc thêm full scan nặng.

## File và thay đổi sau khi được duyệt

1. `extensions/dotnav/src/solutionSearch/searchScanner.ts`
   - Mở rộng file-policy hiện có thành một nguồn kiểm tra duy nhất cho loại file được hỗ trợ.
   - Chặn cả `scanFile()` và `scanFileContent()` để đường gọi trực tiếp không thể đưa file ngoài whitelist vào index.
   - Giữ parser cũ để tránh refactor lan; chúng chỉ không còn được gọi từ Search Everywhere.
   - Verify: SQL/Markdown/YAML/Proto/generic JSON trả 0 symbol; C#/project/resx/appsettings vẫn parse.

2. `extensions/dotnav/src/solutionSearch/searchCommands.ts`, `extensions/dotnav/src/extension.ts`
   - Startup chỉ glob `cs/csproj/resx` và `appsettings*.json`; không glob tất cả JSON hay các loại bị loại.
   - Watcher dùng cùng file-policy thay vì regex extension riêng.
   - Verify: startup và save event không stat/read/queue file ngoài whitelist.

3. `extensions/dotnav/src/solutionSearch/streamingCache.ts`, `searchCommands.ts`, `searchDiskStore.ts`
   - Tăng internal cache schema lên v8 để cache v7 chứa SQL/YAML/generic JSON không thể làm symbol cũ xuất hiện lại.
   - Rebuild đúng một lần; chỉ xóa v7 sau khi v8 ghi thành công. Không sửa extension version hoặc tag.
   - Verify: v7 bị bỏ qua, v8 hot/cold round-trip và không chứa file ngoài whitelist.

4. `extensions/dotnav/src/test/solutionSearchScanner.test.ts`, `solutionSearch.test.ts`, `streamingSearchCache.test.ts`
   - Thêm regression tests cho whitelist, startup/watcher boundary và cache invalidation.
   - Chạy `npm run compile`, `npm test`, `npm run package:all`, cài VSIX và shutdown build server.

## Rủi ro được khoanh vùng

- Search sẽ không còn trả kết quả từ `ocelot*.json`, launch settings, SQL scripts, YAML và Proto.
- `.resx` được giữ vì loại `.Designer.cs` nhưng vẫn cần tìm localization keys.
- Nếu yêu cầu là “chỉ đúng các MSBuild items thực sự thuộc project”, cần một phase riêng để đọc/evaluate `Compile Include/Remove`; không gộp vào hotfix này vì blast radius và CPU cost lớn hơn đáng kể.

## Kết quả xác minh

- Full suite: 822 tests, 821 pass, 1 platform-specific skip, 0 fail.
- Backend smoke: 12.311 file được đọc/index; chỉ gồm 11.895 C#, 114 csproj, 241 appsettings JSON và 61 resx.
- 545 file mục tiêu bị loại: 461 generic JSON, 72 Markdown, 10 YAML và 2 SQL; `ModelSnapshot.cs` có 0 lần đọc.
- Cache v7 không được load; hot/cold cache v8 round-trip, chunking, atomic write và cleanup cache cũ đều pass.
- `npm run compile`, `npm test`, `npm run package:all` và cài `dist/dotnav.vsix --force` đều thành công.
- VS Code runtime trên workspace Backend tạo cache v8 với 12.311 file và 103.378 cold symbols; không có SQL, Markdown, YAML, Proto, generic JSON hoặc ModelSnapshot.
- Live-cache queries: `UpdateVisibilitySettingAsync` 74 ms, `FormService` 52 ms; watcher create/delete cập nhật sau quiet/save window và Extension Host đo được 0% CPU khi idle, không có sự kiện `UNRESPONSIVE` mới.

---

# DotNav Hotfix Phase 2 — Stale-While-Idle Search Index

**Trạng thái:** Đã triển khai, full test pass, đóng gói và cài local ngày 2026-09-15.

## Mục tiêu

- Giữ Search Everywhere phản hồi trong lúc workspace lớn đang được sửa liên tục.
- Phục vụ index cũ và chỉ cập nhật sau 5 giây yên, tối đa stale 30 giây.
- Bỏ qua generated source và `*ModelSnapshot.cs`, nhưng giữ migration chính searchable.
- Chuyển hot/cold cache sang streaming NDJSON gzip schema v7 để không parse/stringify object 38–54 MB trên Extension Host.

## File và thay đổi đã duyệt

1. `extensions/dotnav/src/solutionSearch/searchScanner.ts`, `extensions/dotnav/src/endpoints/endpointScanner.ts`
   - Bỏ qua `.Designer.cs`, `.g.cs`, `.generated.cs`, `obj/`, `bin/` và `*ModelSnapshot.cs`.
   - Giữ migration chính; log một lần khi một file parse quá 250 ms.
   - Verify: generated/ModelSnapshot không được đọc, migration chính vẫn có symbol.

2. `extensions/dotnav/src/extension.ts`, `extensions/dotnav/src/solutionSearch/searchCommands.ts`
   - Watcher chỉ queue trạng thái file cuối; flush sau quiet window 5 giây, hard limit 30 giây.
   - Search tiếp tục dùng index cũ; manual Re-scan chạy ngay.
   - Git status/stage không refresh Search; branch/mass change stale-while-revalidate và chỉ có một pending generation.
   - Verify: save burst parse một lần; branch burst tạo một refresh; thay đổi trong active scan không mất.

3. `extensions/dotnav/src/solutionSearch/searchDiskStore.ts`, `extensions/dotnav/src/solutionSearch/searchModel.ts`, `extensions/dotnav/src/solutionSearch/searchCommands.ts`
   - Dùng `dotnav_search_cache_v7_<branch>.ndjson.gz` và `cold_symbols_v7.ndjson.gz`.
   - Header riêng, record tối đa 100 symbols/file, CPU slice 8 ms, atomic temp rename.
   - Không load cache v6; chỉ xóa v6 sau khi v7 được ghi thành công.
   - Save sau 15 giây idle, hard limit 60 giây.
   - Verify: round-trip hot/cold, empty marker, chunking, corrupt/truncated cache và atomic write.

4. `extensions/dotnav/src/solutionSearch/searchCommands.ts`
   - Startup hydration chờ 5 giây; mở Search sớm bắt đầu hydration cooperative.
   - Query debounce 100 ms và chỉ render kết quả mới nhất.
   - Status bar: queued, updating, ready.
   - Verify: Search dùng snapshot cũ trong quiet window và input burst chỉ render query cuối.

## Verification gates

1. Focused Search/Endpoint tests và Backend smoke test.
2. `npm run compile`, `npm test`, `git diff --check`.
3. `npm run package:all`, cài `dist/dotnav.vsix --force`.
4. `dotnet build-server shutdown`; không kill Roslyn/C# Dev Kit/debug session của user.

Không sửa version và không tạo tag thủ công. Worker Thread nằm ngoài Phase 2 trừ khi profile sau hotfix vẫn có một file block Extension Host trên 1 giây.

## Kết quả xác minh

- Full suite: 819 tests, 818 pass, 1 platform-specific skip, 0 fail.
- Backend: 12.784 file parsed trong 11,7 giây; 0 `ModelSnapshot.cs`; không file nào giữ CPU quá 250 ms.
- Cache v7 trên dữ liệu Backend: hot load 2,12 giây tổng với event-loop lag tối đa 41,3 ms; cold load 665 ms với lag tối đa 7 ms.
- `npm run compile`, `npm run package:all` và cài `dist/dotnav.vsix --force` đều thành công.

---

# DotNav — Search Everywhere v0.32 performance hotfix

**Trạng thái:** Đã triển khai, full test pass, đóng gói và cài local ngày 2026-09-15.

## Mục tiêu

Khôi phục độ phản hồi gần v0.31.1 bằng cách rollback có chọn lọc các thay đổi indexing mới gây
CPU/RAM tăng cao. Không revert các commit UI/progress của DotNav, không sửa version và không tạo tag.

## Nguyên nhân đã xác minh

1. VS Code CPU profile ghi nhận `tuna-ex.dotnav` chiếm 98–99% extension-host trong nhiều khoảng
   gần 5 giây. Hot path là `scanFileContent`, `extractIndexTokens`, `addTerm`,
   `addSymbolToBuckets` và `saveToDisk`.
2. Commit `0125b3f` (v0.32.0) thêm cache toàn bộ nội dung source vào cả `UniversalSymbolIndex`
   và `EndpointIndex`, rồi quét lại các file đã xử lý khi gặp controller `partial`. Workspace đang
   dùng có khoảng 11.950 file source hiệu lực và 74 partial-controller files, nên chi phí bị nhân
   lên trên extension host.
3. Commit `5800d1f` (v0.32.0) tăng schema cache lên v6 và nhúng toàn bộ cold-symbol map vào từng
   branch snapshot. Workspace hiện có cold cache 56,5 MB khi giải nén và 20 branch snapshots;
   việc serialize/gzip dữ liệu lớn xuất hiện trực tiếp trong CPU profile.
4. Các commit v0.32.0 còn lại chủ yếu thay đổi progress/status UI. Chúng không nằm trên hot path
   và không cần revert. Logic tokenization nóng đã tồn tại từ v0.29.1; regression là số lần gọi và
   lượng dữ liệu giữ/serialize tăng lên, không phải một tokenizer hoàn toàn mới.

## File và thay đổi phẫu thuật

1. `extensions/dotnav/src/solutionSearch/searchScanner.ts`
   - Xóa `fileContentMap`, `_isRescanningPartials` và vòng lặp gọi đệ quy
     `scanFileContent()` trên các file đã index.
   - Giữ parser hiện tại cho từng file, explicit-interface/partial-method symbols và hot/cold split.
   - Không nhúng `coldSymbolsByFile` vào snapshot mới; vẫn đọc snapshot v6 cũ để tương thích.
   - Verify: mỗi file chỉ được parse một lần trong một full scan; index không giữ toàn bộ source text.

2. `extensions/dotnav/src/endpoints/endpointScanner.ts`
   - Xóa content cache và cơ chế reparse các partial files đã scan.
   - Giữ route parsing/synthesis trong phạm vi file hiện tại.
   - Verify: scan file B không âm thầm parse lại file A; invalidate/clear vẫn xóa endpoint cache.

3. `extensions/dotnav/src/solutionSearch/searchDiskStore.ts`,
   `extensions/dotnav/src/solutionSearch/searchCommands.ts`,
   `extensions/dotnav/src/solutionSearch/searchModel.ts`
   - Dùng `cold_symbols.gz` làm nguồn lưu cold symbols duy nhất thay vì sao chép vào mọi branch
     snapshot.
   - Đánh dấu cả file có 0 cold symbols là đã scan để `isMissingCold` không buộc parse lại ở mỗi lần
     khởi động.
   - Giữ khả năng load cache v6 hiện tại; không hạ schema để tránh tạo thêm một lần full reindex.
   - Verify: cache cũ vẫn load; file không có cold symbols không bị scan lại; snapshot mới không chứa
     bản sao cold-symbol map.

4. `extensions/dotnav/src/extension.ts`
   - Chỉ force full Search Everywhere warmup khi branch thực sự thay đổi. Git status/index events
     thông thường vẫn refresh tree nhưng không kích hoạt full workspace traversal.
   - File watcher hiện có tiếp tục cập nhật riêng file được sửa.
   - Verify: save/stage file không force warmup; branch checkout có force warmup đúng một lần.

5. `extensions/dotnav/src/test/solutionSearch*.test.ts` và endpoint tests hiện có
   - Thay các test phụ thuộc cross-file recursive rescan bằng regression tests đo số lần parse.
   - Thêm test cache compatibility/empty-cold marker và Git-event deduplication.
   - Verify: test chứng minh chi phí scan tăng tuyến tính theo số file, không nhân theo số controller
     `partial`.

## Đánh đổi được chấp nhận cho hotfix

- Route prefix nằm ở một file `partial controller` khác có thể tạm quay về hành vi v0.31.1 và phụ
  thuộc file chứa route được parse trực tiếp. Đây là giảm chức năng có chủ đích để loại bỏ freeze;
  giải pháp dài hạn nên xây registry metadata nhẹ rồi reconcile symbol, không giữ/reparse source text.
- Lần chạy đầu sau hotfix có thể vẫn cần đồng bộ cache hiện hữu. Các lần sau không được lặp lại full
  scan chỉ vì file có 0 cold symbols hoặc Git status thay đổi.

## Verification gates sau khi duyệt

1. `git diff --check` và review diff để bảo đảm chỉ có rollback/performance guard đã duyệt.
2. Chạy targeted Search Everywhere + endpoint tests.
3. Chạy `npm run compile` và `npm test`.
4. Chạy `npm run package:all`, cài `dist/dotnav.vsix --force`, rồi smoke test trên workspace Backend.
5. Sau build/test: `dotnet build-server shutdown` và xác minh không còn process agent-owned
   `MSBuild.dll`/`VBCSCompiler`; không đụng debug session của user.

Plan đã được duyệt bằng `chốt hotfix` trước khi product code được sửa.

---

# Kế hoạch trước đó — ReSharper full-engine migration (không thuộc hotfix hiện tại)

## Scope

Migrate Build/Rebuild/Clean and project Run/Debug entry points in `extensions/dotnav` to
`jetbrains.resharper-code` whenever ReSharper is the active engine. Do not silently execute a
legacy `dotnet` build after a ReSharper failure.

## Verified findings

1. `runDotnetForSolution()` creates an unresolved `resharper-build` task without an execution.
   When task resolution/start rejects, the catch at `dotnetCli.ts:310-319` silently starts
   `createStandardSolutionTask()`, which exactly explains the observed `dotnet build` terminal.
2. ReSharper 2026.2.2 provides native `resharper.solution.build`, `.rebuild`, `.clean` commands,
   a `resharper-build` task provider, and a project debug provider with `type: "dotnet"`.
3. ReSharper's valid launch ID is always `TargetFramework=<tfm>;<profile>` when either component
   exists. DotNav currently emits invalid strings for TFM-only and profile-only cases.
4. ReSharper project build requests accept `projectFiles`; DotNav project paths originate from
   `path.resolve(...)`, so current project and multi-project inputs are absolute.
5. ReSharper's reload/build/run commands under `resharper.solutionExplorer.*` operate on the
   selection in ReSharper's own tree. A DotNav `TreeNode` is not a supported command argument.

## Assumptions requiring approval

- Keep `dotnav.resharper.useReSharperBuild` as an explicit escape hatch. When it is enabled and
  ReSharper fails, fail with diagnostics; do not auto-fallback to `dotnet`.
- Use ReSharper's project debug provider (`type: "dotnet"`), not executable `coreclr`, so target
  framework and launch profile resolution remain owned by ReSharper.
- Do not claim one-click project reload until JetBrains exposes a path-based command/API. Replace
  the current unreliable wrapper with a command that opens/focuses ReSharper Solution Explorer
  and explains the required selection, or remove it from DotNav menus.

## Files and surgical changes

1. `extensions/dotnav/src/resharperIntegration.ts` (new)
   - Activate `jetbrains.resharper-code` before use.
   - Verify native solution commands with `vscode.commands.getCommands()`.
   - Execute solution operations through `resharper.solution.build|rebuild|clean` and capture the
     resulting `resharper-build` task start for cancellation/result tracking.
   - Resolve project/multi-project tasks from `vscode.tasks.fetchTasks({ type: 'resharper-build' })`
     before injecting absolute `projectFiles`, avoiding execution of a task with no provider-owned
     `CustomExecution`.
   - Return actionable readiness errors instead of falling back silently.
   - Verify: unit tests prove activation, command absence, provider-not-ready, and task selection.

2. `extensions/dotnav/src/dotnetCli.ts`
   - Route solution Build/Rebuild/Clean through the native-command helper.
   - Route project and folder Build/Rebuild/Clean through the resolved ReSharper task helper.
   - Remove all automatic ReSharper-to-dotnet catch fallbacks; report original and final errors.
   - Normalize every project path with `path.resolve()` at the integration boundary.
   - Verify: each verb produces the expected ReSharper target; solution uses an empty project set;
     single/folder builds use exact absolute project sets; no `dotnet` task starts on ReSharper error.

3. `extensions/dotnav/src/debugRunner.ts`
   - Reuse the same resolved ReSharper build helper for single and compound pre-builds.
   - Emit launch IDs as `TargetFramework=${tfm ?? ''};${profile ?? ''}` and omit only when both
     values are absent.
   - Keep `type: 'dotnet'`, `projectPath`, `noDebug`, environment, args, and DotNav tracking IDs.
   - Prevent duplicated build ownership: DotNav compound pre-build and ReSharper's default
     `resharper.runAndDebug.dotnet.buildBeforeLaunch=true` cannot both remain authoritative.
   - Verify: four launch-ID combinations, Run/Debug `noDebug`, single pre-build, compound project
     de-duplication, failure cancellation, and no legacy task fallback.

4. `extensions/dotnav/src/engineDetector.ts`
   - Preserve Auto => ReSharper whenever the extension is installed.
   - Distinguish installed/active/ready state and activate ReSharper on first operation.
   - Add `dotnav.isReSharperActive` and `dotnav.useReSharperBuild` context keys while preserving
     existing keys; refresh them on extension and relevant configuration changes.
   - Warn in dual-stack mode that VS Code permits only one C# debugger provider and JetBrains
     requires Microsoft C# debugging extensions to be disabled before ReSharper debugging works.
   - Verify: install/uninstall, Auto/explicit preference, build-setting refresh, disposal, dual stack.

5. `extensions/dotnav/src/extension.ts`, `extensions/dotnav/package.json`, tests
   - Add Solution Folder Rebuild and Clean commands beside Build.
   - Keep generic DotNav Build/Run/Debug menu IDs; handlers choose the active engine centrally.
   - Gate ReSharper-only actions on active/ready context, not merely installation.
   - Remove or relabel the unreliable `reloadAllProjects` action; do not pass DotNav nodes to
     `resharper.solutionExplorer.reloadProject`.
   - Add focused tests in `src/test/resharperIntegration.test.ts`, extend engine/debug and manifest
     assertions without altering unrelated tests.
   - Verify: all expected context-menu nodes/verbs exist and every handler reaches the integration
     helper.

## Verification gates after approval

1. `npx tsc --noEmit -p extensions/dotnav/tsconfig.json`
2. Targeted ReSharper integration, engine detector, debug/run, and menu tests
3. `npm run compile` and `dotnet build-server shutdown`
4. `npm test` and process cleanup verification
5. `npm run package:all`, install `dist/dotnav.vsix --force`, then Extension Host smoke tests for
   Solution/Project/Solution Folder/Compound Build-Rebuild-Clean-Run-Debug with ReSharper 2026.2.2

No product-code implementation begins until this plan and the Run/Debug build-ownership choice are
approved.
