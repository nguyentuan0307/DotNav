# DotNav — EF Core Tools: Design Document

Trạng thái: Draft — chờ duyệt trước khi implement.
Phạm vi: extension `dotnav`, module mới `src/ef/`.

---

## 1. Mục tiêu

Mang trải nghiệm EF Core plugin của Rider vào VS Code, dựa hoàn toàn trên `dotnet ef` CLI:

- Tự detect project có EF Core, DbContext, cặp migrations project ↔ startup project.
- Quản lý migrations: add / remove / list / script / update / rollback / drop database.
- UI tree riêng, trạng thái applied/pending, thao tác qua context menu + Command Palette.
- Không yêu cầu user cấu hình tay khi solution theo convention chuẩn.

Không nằm trong scope v1: `dbcontext scaffold` (reverse engineering), `migrations bundle`, EF6.

---

## 2. Kiến trúc tổng quan

```
src/ef/
├── efJsonParser.ts     # Pure: parse --json output, classify lỗi, mask secret, validate tên
├── efQueue.ts          # Pure: SerialQueue + GenerationTracker
├── efProcess.ts        # Spawn dotnet + kill process tree, timeout
├── efDetection.ts      # Pure: phân loại project từ metadata csproj
├── efCli.ts            # Wrap `dotnet ef`: queue, guards R1/R2, no-build auto, progress
├── efToolManager.ts    # Check/cài dotnet-ef tool, check version compatibility
├── efMigrationStore.ts # Cache contexts/migrations + generation + fallback parse file
├── efTreeProvider.ts   # TreeDataProvider cho view "EF Core"
├── efCommands.ts       # Đăng ký commands, quickpick flows, confirm dialogs
├── efConfigStore.ts    # Persist cặp project, context mặc định (workspaceState)
├── efStatusBar.ts      # Status bar item khi có lệnh EF đang chạy
└── efMain.ts           # EfFeature: wiring, watcher, detection cache, context key
```

Nguyên tắc:

- **Mọi lệnh EF đi qua một hàng đợi tuần tự duy nhất** (chi tiết §7.1). Không bao giờ chạy song song hai lệnh `dotnet ef`.
- Tái sử dụng `processManager.ts` để spawn, `projectParser.ts` để đọc csproj, pattern `runConfigStore.ts` cho persistence.
- Output đầy đủ vào Output channel **"DotNav EF Core"**; notification chỉ hiện tóm tắt.

---

## 3. Detection

### 3.1 Phân loại project (đọc csproj, không cần build)

| Loại | Điều kiện |
|---|---|
| Migrations project | Reference `Microsoft.EntityFrameworkCore.Design` hoặc `Microsoft.EntityFrameworkCore.Tools`, hoặc đã có folder `Migrations/` chứa `*.Designer.cs` |
| Startup project candidate | `OutputType=Exe` / Web SDK, và reference (trực tiếp hoặc bắc cầu) tới migrations project |
| EF project (chung) | Reference bất kỳ package `Microsoft.EntityFrameworkCore*` |

Transitive reference resolve từ graph đã có trong `solutionParser.ts`.

### 3.2 DbContext discovery

- Nguồn chính: `dotnet ef dbcontext list --json --no-build` (fallback có build nếu fail).
- Chạy **lazy**: chỉ khi user mở view EF Core lần đầu hoặc bấm Refresh — không chạy lúc activate extension.
- Cache kết quả theo (project, configuration); invalidate khi csproj hoặc file `*.cs` chứa `DbContext` thay đổi (watcher, debounce 2s).
- Fallback tĩnh khi CLI fail: regex quét `class X : DbContext` trong project để vẫn render tree (đánh dấu "unverified").

### 3.3 Chọn cặp migrations ↔ startup project

1. Nếu chỉ có 1 candidate mỗi loại → auto chọn, không hỏi.
2. Nhiều candidate → quickpick lần đầu, lưu vào `workspaceState` (`efConfigStore`).
3. Override được qua settings `dotnav.ef.startupProject` / context menu "Set as Startup Project for EF".

### 3.4 Tool check (`efToolManager`)

- `dotnet ef --version` (ưu tiên local tool manifest `.config/dotnet-tools.json`, sau đó global).
- Chưa cài → notification 2 nút: **Install local tool** (`dotnet new tool-manifest` nếu chưa có + `dotnet tool install dotnet-ef`) / **Install global**.
- So version tool với version package `Microsoft.EntityFrameworkCore.Design` trong project: lệch major → warning kèm nút update tool.
- Kết quả cache trong session; invalidate khi user bấm install/update.

---

## 4. Danh sách tính năng

### Phase 1 — MVP (Command Palette, chưa có tree)

| # | Tính năng | Lệnh CLI | Ghi chú |
|---|---|---|---|
| F1 | Detect EF projects + tool check | — | Activation event: có csproj chứa `EntityFrameworkCore` |
| F2 | Add Migration | `migrations add <name>` | Input validate tên (identifier hợp lệ, chưa trùng); mở file migration sau khi tạo |
| F3 | Remove Last Migration | `migrations remove` | Cảnh báo nếu migration đã applied (thêm `--force` chỉ khi user xác nhận) |
| F4 | List Migrations | `migrations list --json` | Hiện quickpick read-only kèm trạng thái |

### Phase 2 — Tree view

| # | Tính năng | Ghi chú |
|---|---|---|
| F5 | View "EF Core" trong container `dotnavContainer` | TreeDataProvider, chi tiết §5 |
| F6 | Trạng thái applied / pending / unknown per migration | Nguồn: `migrations list --json`; DB không connect được → fallback parse folder `Migrations/`, badge "unknown" |
| F7 | Refresh (toàn bộ / per node) | Nút title bar + context menu |
| F8 | Reveal migration file trong editor | Click node migration |

### Phase 3 — Database operations

| # | Tính năng | Lệnh CLI | Guard |
|---|---|---|---|
| F9 | Update Database (latest) | `database update` | Confirm modal kèm tên DB nếu lấy được từ `dbcontext info` |
| F10 | Update / Rollback tới migration cụ thể | `database update <name>` | Context menu trên node migration: "Update Database to This Migration". Rollback (target cũ hơn) → confirm modal riêng, nêu rõ các migration sẽ bị revert |
| F11 | Generate SQL Script | `migrations script [from] [to] [--idempotent]` | Quickpick chọn range; output mở tab editor `.sql` (untitled) hoặc save file |
| F12 | Drop Database | `database drop --force` | Confirm modal **gõ lại tên database** mới cho chạy (kiểu GitHub delete repo) |
| F13 | DbContext Info | `dbcontext info --json` | Hiện provider, connection string (mask password), hover/tooltip node context |

### Phase 4 — Polish

| # | Tính năng | Ghi chú |
|---|---|---|
| F14 | Settings `dotnav.ef.*` | §8 |
| F15 | Multi-context: mọi lệnh tự thêm `--context` | Quickpick khi ambiguous, nhớ lựa chọn |
| F16 | Multi-root workspace | Mỗi root một nhánh tree, state per-root |
| F17 | Status bar spinner khi lệnh EF chạy | Click → focus Output channel |
| F18 | Optimize DbContext (`dbcontext optimize`) | Compiled models, optional |
| F19 | Cancel lệnh đang chạy | Nút trên notification progress; kill process tree |

---

## 5. UI Design

### 5.1 Tree view "EF Core"

View mới `dotnav.efCore` trong container `dotnavContainer` sẵn có (dưới view `dotnav` và `dotnav.runConfigurations`). `visibility: collapsed` mặc định; chỉ hiện khi detect được EF project (`when: dotnav.ef.hasProjects`).

```
EF CORE                                    ⟳  ⚙  ＋
└─ 📦 MyApp.Data          (startup: MyApp.Web)
   └─ 🗂 AppDbContext      SqlServer · MyAppDb
      ├─ ✓ 20260101120000_InitialCreate
      ├─ ✓ 20260215093000_AddUsers
      ├─ ● 20260722140000_AddOrders        pending
      └─ ● 20260723081500_AddOrderIndex    pending
   └─ 🗂 IdentityDbContext  Npgsql · MyAppAuth
      ├─ ✓ 20260110000000_Init
      └─ (up to date)
```

Node hierarchy + hình thức:

| Node | Icon (codicon) | Label | Description (mờ bên phải) | Tooltip |
|---|---|---|---|---|
| Project | `package` | Tên project | `startup: <startup project>` | Đường dẫn csproj, EF package versions |
| DbContext | `database` | Tên class | `<provider> · <database>` (từ `dbcontext info`, lazy) | Full type name, connection string (mask password), provider version |
| Migration applied | `check` (màu `charts.green`) | Tên migration | — | Timestamp parse từ id, đường dẫn file |
| Migration pending | `circle-filled` (màu `charts.yellow`) | Tên migration | `pending` | như trên |
| Migration unknown | `circle-outline` (màu mờ) | Tên migration | `unknown` | "Không kết nối được database — trạng thái chưa xác định" |
| Placeholder | `info` | `(no migrations)` / `(up to date)` / `(DB unreachable — showing local files)` | — | — |
| Loading | `loading~spin` | `Discovering DbContexts…` | — | — |
| Error | `warning` | `dotnet-ef not installed` | `click to install` | stderr tóm tắt |

Thứ tự migration: mới nhất **dưới cùng** (theo thời gian, giống thứ tự apply). Setting đảo ngược được.

### 5.2 Title bar actions (view EF Core)

| Icon | Command | Ghi chú |
|---|---|---|
| `add` | `dotnav.ef.addMigration` | Dùng context/project đang chọn, thiếu thì quickpick |
| `refresh` | `dotnav.ef.refresh` | Invalidate toàn bộ cache + re-run discovery |
| `gear` | `dotnav.ef.openSettings` | Mở Settings filter `dotnav.ef` |

### 5.3 Context menus

**Node Project:**
- Add Migration…
- Update Database
- Refresh
- Set Startup Project for EF… (quickpick candidates)
- Open csproj

**Node DbContext:**
- Add Migration…
- Update Database
- Generate SQL Script… (Full / Idempotent / Range…)
- DbContext Info
- Drop Database… *(group riêng cuối menu, tách separator)*
- Refresh

**Node Migration:**
- Open Migration File
- Update Database to This Migration *(pending hoặc applied cũ hơn = rollback — label đổi thành "Rollback Database to This Migration")*
- Generate Script from This Migration…
- Remove *(chỉ hiện trên migration cuối cùng — `when: viewItem == efMigrationLast*`)*
- Copy Migration Name

### 5.4 Command Palette

Mọi command prefix `EF Core: ` (category), hoạt động không cần mở tree:

```
EF Core: Add Migration
EF Core: Remove Last Migration
EF Core: Update Database
EF Core: Update Database to Migration…
EF Core: Generate SQL Script
EF Core: List Migrations
EF Core: Drop Database
EF Core: DbContext Info
EF Core: Install/Update dotnet-ef Tool
EF Core: Select Startup Project
EF Core: Refresh
```

Flow chung khi gọi từ palette: thiếu tham số nào → quickpick tham số đó theo thứ tự project → DbContext → (tham số riêng của lệnh). Mỗi bước đều nhớ lựa chọn trước làm default.

### 5.5 Flow "Add Migration" (chuẩn cho mọi flow input)

1. Xác định project + context (auto nếu chỉ có 1; ngược lại quickpick).
2. InputBox tên migration:
   - Placeholder: `e.g. AddOrderTable`
   - Validate realtime: identifier C# hợp lệ, chưa trùng tên migration hiện có, không rỗng.
3. Progress notification (cancellable): `Adding migration 'AddOrderTable'…` — dùng pattern `withProgress` + Task như `dotnetCli.ts` hiện tại.
4. Thành công:
   - Mở file `*_AddOrderTable.cs` trong editor.
   - Tree refresh node DbContext tương ứng (không refresh toàn bộ).
   - Notification: `Migration 'AddOrderTable' created` + nút **Update Database**.
5. Thất bại: notification lỗi, dòng lỗi cuối của stderr, nút **Show Output**.

### 5.6 Confirm dialogs (modal)

| Hành động | Nội dung |
|---|---|
| Update Database | `Apply 2 pending migration(s) to database 'MyAppDb' (SqlServer)?` — liệt kê tên nếu ≤5 |
| Rollback | `Rollback database 'MyAppDb' to 'AddUsers'? 2 migration(s) will be REVERTED: AddOrders, AddOrderIndex. Data in affected tables may be lost.` |
| Remove applied migration | `'AddOrders' is applied to the database. Remove anyway with --force? Consider rolling back first.` — nút: Rollback First / Force Remove / Cancel |
| Drop Database | InputBox: `Type the database name 'MyAppDb' to confirm dropping it. THIS CANNOT BE UNDONE.` — sai tên → không chạy |

Tên database không lấy được (DB offline) → dialog vẫn hiện, thay tên bằng tên DbContext, thêm dòng "database name unavailable".

### 5.7 Status bar (`efStatusBar`)

- Chỉ hiện khi có lệnh EF chạy: `$(sync~spin) EF: Adding migration…`
- Click → focus Output channel "DotNav EF Core".
- Có lệnh đang queue: `$(sync~spin) EF: Updating database… (+1 queued)`.

### 5.8 Output channel

- Tên: `DotNav EF Core`.
- Mỗi lệnh log: dòng header `── dotnet ef migrations add AddOrders --project … ──` + full stdout/stderr + exit code + duration.
- Setting `dotnav.ef.verbose` → thêm `--verbose` vào CLI.

---

## 6. Command layer (`efCli.ts`)

### 6.1 Thực thi

- Spawn `dotnet ef …` qua `ProcessManager` (track PID, kill được cả process tree khi cancel).
- `cwd` = thư mục migrations project. Luôn truyền tường minh: `--project`, `--startup-project`, `--context` (khi >1), `--configuration` (theo setting), `--no-color`, `--prefix-output` khi cần tách stream.
- `--json`: parse các dòng prefix `data:` (format chuẩn của dotnet-ef), bỏ qua dòng build noise. Parse fail → coi như lỗi, log raw output.

### 6.2 Build strategy

- Mặc định để `dotnet ef` tự build (an toàn nhất).
- Setting `dotnav.ef.noBuild: "auto" | "always" | "never"`:
  - `auto` (default): thêm `--no-build` nếu DotNav vừa build thành công project đó và chưa có file thay đổi kể từ đó (dựa vào state build sẵn có của DotNav); fail vì thiếu assembly → tự retry một lần không có `--no-build`.
  - `always` / `never`: ép theo user.

### 6.3 Kết quả chuẩn hóa

```ts
interface EfCommandResult<T = void> {
  readonly kind: 'success' | 'cliError' | 'buildError' | 'toolMissing' | 'cancelled';
  readonly exitCode?: number;
  readonly data?: T;          // parsed từ --json
  readonly errorSummary?: string; // dòng lỗi cuối, đã lọc stack trace
  readonly duration: number;
}
```

Phân loại lỗi từ stderr pattern: build fail (`Build failed`), tool missing, DB connect fail (`A network-related…`, `Login failed`, provider-specific), pending model changes, v.v. → message thân thiện + nút hành động phù hợp.

---

## 7. Concurrency, race conditions & cách xử lý

Đây là phần dễ sai nhất. Nguyên tắc gốc: **một mutex tuần tự cho mọi lệnh `dotnet ef` ghi-trạng-thái, cache bất biến theo generation, mọi async callback phải check generation trước khi commit kết quả vào state.**

### 7.1 R1 — Hai lệnh EF chạy đồng thời

**Kịch bản:** User bấm "Add Migration" rồi bấm tiếp "Update Database" khi lệnh đầu chưa xong. Hai `dotnet ef` cùng build một project → MSBuild file lock, hoặc migration được add giữa chừng khiến update apply thiếu.

**Xử lý:** `efCli` giữ một **promise queue tuần tự** (per workspace). Lệnh mới enqueue, status bar hiện `(+N queued)`. Lệnh read-only thuần cache (render tree) không vào queue; lệnh CLI read-only (`dbcontext info`) vẫn vào queue vì cũng trigger build. Queue có giới hạn: user gọi lệnh ghi khi đang có lệnh ghi chạy → hỏi "Queue or Cancel current?" thay vì âm thầm xếp hàng.

### 7.2 R2 — Lệnh EF chạy đồng thời với Build/Run của DotNav

**Kịch bản:** User bấm Build trên tree solution trong khi `dotnet ef` đang build cùng project → MSBuild node conflict, output DLL bị lock (nhất là khi app đang chạy/debug).

**Xử lý:**
- `efCli` hỏi `ProcessManager`: project (hoặc dependency) đang build/run/debug → chặn với message `Project is currently building/running. Stop it first?` + nút Stop & Continue.
- Ngược lại, khi lệnh EF đang chạy, các lệnh build của DotNav trên cùng project hiện cảnh báo tương tự (soft-block, user override được).
- App đang chạy giữ file lock DB (SQLite) → lỗi CLI được phân loại và gợi ý stop app.

### 7.3 R3 — Tree refresh vs. lệnh đang chạy (stale cache)

**Kịch bản:** `migrations list` (populate tree) đang chạy; user "Add Migration" xong trước khi list trả về → list cũ ghi đè lên state mới → tree thiếu migration vừa tạo.

**Xử lý:** `efMigrationStore` giữ `generation: number` per DbContext. Mọi lệnh **ghi** thành công → `generation++` + invalidate. Kết quả đọc về chỉ được commit nếu generation lúc bắt đầu == generation hiện tại; lệch → vứt, tự re-fetch. Kết hợp với queue tuần tự (§7.1), cửa sổ race chỉ còn ở các đọc-ngoài-queue và bị generation chặn nốt.

### 7.4 R4 — File watcher vs. `migrations add`

**Kịch bản:** `migrations add` tự sinh 3 file trong `Migrations/` → watcher (invalidate DbContext cache, §3.2) bắn ngay giữa lúc lệnh chưa xong → refresh đọc trạng thái nửa vời; đồng thời watcher chung của solution tree cũng bắn.

**Xử lý:** Khi có lệnh EF trong queue đang chạy, watcher events cho project đó **treo lại** (buffer), xả một lần sau khi lệnh kết thúc. Debounce 2s cho edit tay của user.

### 7.5 R5 — Cancel giữa chừng

**Kịch bản:** User cancel `database update` → SQL đang chạy nửa migration; hoặc cancel `migrations add` sau khi file đã ghi ra disk.

**Xử lý:**
- Kill cả process tree (dotnet ef spawn con).
- Sau cancel bất kỳ lệnh ghi nào → **ép full refresh** DbContext đó (không tin cache), tree hiện trạng thái thực tế.
- Cancel `database update`: notification cảnh báo `Update was cancelled mid-run. Database may be in a partial state — run 'migrations list' to verify.` (EF chạy mỗi migration trong transaction riêng trên đa số provider, nhưng không đảm bảo tuyệt đối — không hứa gì với user).
- Cancel `migrations add`: check disk, nếu file migration đã sinh → hỏi user giữ hay xóa (xóa cả 2–3 file: migration, Designer, snapshot revert qua `migrations remove`... — an toàn nhất là chạy `migrations remove` chuẩn thay vì tự xóa file).

### 7.6 R6 — User sửa/xóa file migration bằng tay

**Kịch bản:** User xóa file migration trên disk nhưng snapshot (`*ModelSnapshot.cs`) không sync → mọi lệnh EF sau đó lỗi khó hiểu.

**Xử lý:** Không tự can thiệp. Phát hiện mismatch (file trong `Migrations/` không khớp `migrations list`) → node warning trong tree: `Migrations folder out of sync with model snapshot` + link docs. Đây là guard, không phải fix tự động.

### 7.7 R7 — Nhiều VS Code window / process ngoài cùng ghi một DB

**Kịch bản:** Hai cửa sổ VS Code mở cùng repo, hoặc teammate/CI chạy migration cùng DB. Trạng thái applied trong tree sai.

**Xử lý:** Không lock được — chấp nhận. Giảm thiểu: trạng thái applied luôn fetch mới ngay trước khi hiện confirm dialog của lệnh ghi DB (không dùng cache cho quyết định nguy hiểm); confirm dialog hiện số liệu vừa fetch. `database update` fail vì trạng thái đổi → message rõ ràng + Refresh.

### 7.8 R8 — Activate/dispose race

**Kịch bản:** User đóng workspace / disable extension khi lệnh EF đang chạy → orphan process, hoặc callback đụng vào object đã dispose.

**Xử lý:** `deactivate()` gọi `ProcessManager.killAll()` cho process EF (đã có pattern). Mọi callback async check `token.isCancellationRequested` / flag disposed trước khi đụng UI. Không giữ orphan `dotnet` / MSBuild node (`-nodeReuse:false` khi tự build).

### 7.9 R9 — Solution reload / branch switch giữa chừng

**Kịch bản:** User đổi git branch → csproj/Migrations đổi hàng loạt trong khi tree đang load hoặc lệnh đang queue.

**Xử lý:** Solution reload event (đã có trong DotNav) → clear toàn bộ queue **pending** (lệnh đang chạy vẫn chạy nốt, kết quả bị generation vứt), reset generation, re-discovery. Lệnh pending bị hủy → notification ngắn.

### 7.10 R10 — Multi-root / nhiều solution

**Kịch bản:** Hai root cùng chứa project trùng tên; state per-project key bằng tên → lẫn.

**Xử lý:** Mọi key state/cache dùng **đường dẫn tuyệt đối normalize** (`pathUtils.samePath` sẵn có), không dùng tên. Queue vẫn một — tránh hai build MSBuild song song ăn RAM.

---

## 8. Settings (`dotnav.ef.*`)

| Key | Type | Default | Mô tả |
|---|---|---|---|
| `dotnav.ef.enable` | boolean | `true` | Bật/tắt toàn bộ tính năng EF |
| `dotnav.ef.startupProject` | string | `""` | Path csproj startup; rỗng = auto/đã nhớ |
| `dotnav.ef.configuration` | string | `"Debug"` | `--configuration` |
| `dotnav.ef.noBuild` | enum `auto/always/never` | `auto` | §6.2 |
| `dotnav.ef.verbose` | boolean | `false` | Thêm `--verbose`, log full |
| `dotnav.ef.checkPendingOnStartup` | boolean | `false` | Discovery ngay khi mở workspace (mặc định lazy) |
| `dotnav.ef.migrationsSortOrder` | enum `oldestFirst/newestFirst` | `oldestFirst` | Thứ tự tree |
| `dotnav.ef.environmentVariables` | object | `{}` | Env truyền vào process (vd `ASPNETCORE_ENVIRONMENT`) |
| `dotnav.ef.commandTimeout` | number | `300` | Giây; quá → hỏi kill |

---

## 9. Rủi ro triển khai (ngoài race)

| # | Rủi ro | Mức | Giảm thiểu |
|---|---|---|---|
| RK1 | `dotnet ef` chậm (build mỗi lần) → cảm giác extension lag | Cao | Lazy discovery, cache + generation, `--no-build` auto, mọi thứ async + progress UI, không bao giờ block activate |
| RK2 | Format `--json` output đổi giữa các version dotnet-ef | Trung | Parser khoan dung (bỏ qua field lạ), test fixture output của EF 6/7/8/9/10, parse fail → fallback raw + vẫn hoạt động ở mức degraded |
| RK3 | Version mismatch tool ↔ runtime project (`dotnet-ef` 10 vs project EF 8…) | Trung | `efToolManager` so version, warning + nút cài đúng version dạng local tool per-repo |
| RK4 | Connection string chứa secret bị lộ (log/tooltip) | Cao | Mask password/token trong mọi output hiển thị; Output channel chỉ ghi khi verbose và vẫn mask; không bao giờ ghi vào state/file |
| RK5 | Lệnh phá hủy (drop, rollback) chạy nhầm DB production | Cao | Confirm modal nêu tên DB + provider, drop phải gõ lại tên DB, không có "don't ask again" cho nhóm lệnh này |
| RK6 | Startup project detect sai → migration sinh vào project sai / connection string sai environment | Trung | Luôn hiện startup project trong description node + trong confirm dialog; đổi được 1 click |
| RK7 | Solution lớn: nhiều DbContext × nhiều project → discovery lâu | Trung | Discovery per-project song song ở mức parse file (không CLI), CLI vẫn tuần tự; hiện partial tree ngay khi có dữ liệu |
| RK8 | User không có `dotnet` trên PATH / SDK version cũ | Thấp | Tái dùng detect sẵn có của DotNav; degrade thành node hướng dẫn cài |
| RK9 | Provider đặc thù (SQLite file lock, Cosmos không hỗ trợ migrations…) | Trung | Cosmos: ẩn nhóm lệnh migrations, hiện note. SQLite lock: phân loại lỗi, gợi ý stop app |
| RK10 | Orphan MSBuild/VBCSCompiler ăn RAM (đã từng xảy ra trên máy dev) | Trung | Mọi build tự phát thêm `-p:UseSharedCompilation=false -nodeReuse:false`; kill process tree khi cancel/deactivate |
| RK11 | Windows path/quoting (space, unicode) trong args | Thấp | Luôn spawn array-args (không shell string); test path có space |
| RK12 | Migration name user nhập gây lỗi (trùng, ký tự lạ) | Thấp | Validate realtime tại InputBox (§5.5) |

---

## 10. Testing

- **Unit:** parser `--json` (fixtures nhiều version EF), phân loại lỗi stderr, generation logic của `efMigrationStore`, validate migration name, mask connection string.
- **Integration (test workspace):** solution mẫu trong `src/test/fixtures/` với 2 project (Data + Web), SQLite provider (không cần DB server) — chạy thật add/list/remove/update/rollback/script trên CI.
- **Race tests:** enqueue 2 lệnh liên tiếp, cancel giữa chừng, generation mismatch — assert state cuối đúng.
- **Manual matrix:** SqlServer + Npgsql + SQLite; EF 8/9/10; global vs local tool; multi-context; multi-root.

---

## 11. Thứ tự triển khai

| Bước | Nội dung | Kết quả bàn giao |
|---|---|---|
| 1 | `efDetection` + `efToolManager` + `efCli` (queue, parser) + F2/F3/F4 qua palette | MVP dùng được, có test parser + queue |
| 2 | `efMigrationStore` (generation) + `efTreeProvider` + F5–F8 | Tree đầy đủ trạng thái |
| 3 | F9–F13 + confirm dialogs + status bar | Database ops an toàn |
| 4 | F14–F19 + race hardening (R4, R5, R9) + test matrix | Release-ready |

Mỗi bước một PR riêng, releasable độc lập.
