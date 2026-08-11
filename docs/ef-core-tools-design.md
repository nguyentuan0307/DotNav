# DotNav — EF Core Tools

Trạng thái: Implemented
Phạm vi: `extensions/dotnav/src/ef`

## 1. Mục tiêu

DotNav cung cấp một EF Core workbench trong VS Code dựa trên `dotnet ef`:

- Phát hiện migrations project, startup project và DbContext mà không build.
- Add/remove/browse migration.
- Apply hoặc rollback database có phân loại mức độ nguy hiểm.
- Sinh SQL script, migration bundle và compiled model.
- Kiểm tra pending model changes và đọc DbContext info.
- Không tự động kết nối hoặc thay đổi database.

`dbcontext scaffold` không nằm trong phạm vi này vì reverse engineering cần một
workflow riêng cho schema/table selection, credential và overwrite.

## 2. Entry points

### Project context menu

Submenu **Entity Framework Core** chỉ xuất hiện trên project đã được phát hiện
có EF Core. Menu có đúng chín action:

1. Add Migration...
2. Remove Last Migration
3. Browse Migrations
4. Update Database
5. Generate SQL Script...
6. DbContext Info
7. Check Pending Model Changes
8. Open EF Core Center
9. Drop Database...

Refresh, Output, Settings và tool management nằm trên toolbar của Center và
Command Palette; chúng không chiếm chỗ trong project menu.

### Command Palette

Mọi command có category `EF Core`. Advanced actions Migration Bundle và
Optimize DbContext chỉ có trong Center/Command Palette.

## 3. EF Core Center

Center là một webview editor tab duy nhất. Mở action khác sẽ reveal và thay nội
dung tab hiện tại, không tạo thêm tab.

```text
┌ EF Core Center ─ Project ─ DbContext ─ EF version ─ Toolbar ┐
│ Migrations    │ Action form                                 │
│ Database      │                                             │
│ Scripts       │ Command preview                             │
│ Advanced      │ Status                         Run · Cancel  │
│ Danger zone   │                                             │
└───────────────┴─────────────────────────────────────────────┘
```

Center có responsive breakpoint ở 760px. Khi editor hẹp, navigation trở thành
một hàng cuộn ngang. Mọi màu lấy từ VS Code theme tokens; forced-colors có
border rõ cho input, dropdown, warning và button.

### Toolbar

- **Refresh**: rescan csproj, source DbContext và migration files; không kết nối DB.
- **Output**: focus Output channel `DotNav EF Core`.
- **Tool**: xem resolved version và install/update local hoặc global `dotnet-ef`.
- **Settings**: mở Settings với query `dotnav.ef`.

### Button rules

- Tối đa một primary action, một Cancel và một secondary/inline action.
- Cancel không bị disable trong loading state.
- Host validation có quyền disable primary action.
- Database rollback/revert và destructive operations dùng danger style.
- Update Database sau khi Check Database đổi label theo kết quả:
  `Apply N Migrations`, `Database Is Up to Date`,
  `Roll Back N Migrations`, hoặc `Revert All Migrations`.

## 4. Discovery và dependent fields

UI không chạy CLI trên đường mở form:

1. Đọc metadata csproj để tìm EF package và reference graph.
2. Scan source để tìm class kế thừa DbContext.
3. Đọc migration file và `[DbContext(typeof(...))]` để group theo context.
4. Cache theo file signature; watcher invalidate sau debounce.

Khi migrations project thay đổi, `EfTargetCascade` cập nhật theo thứ tự:

```text
project
  → startup candidates
  → DbContexts
  → selected/remembered context
  → migrations for that context
  → validation and preview
```

Mỗi cascade có revision. Kết quả async cũ không được ghi đè lựa chọn mới.

## 5. Actions

| Action | CLI | Primary button | Guard |
|---|---|---|---|
| Add Migration | `migrations add` | Create Migration | Tên là C# identifier và chưa trùng |
| Remove Last | `migrations remove` | Remove | Hiện migration sẽ xóa; Force/Offline loại trừ nhau |
| Browse | source model | Open | Quick Pick searchable, Copy Name item button |
| Update DB | `database update` | Dynamic | Check DB phân loại apply/no-op/rollback |
| SQL Script | `migrations script` | Generate | From/To, idempotent, temp output mở SQL editor |
| Pending Model | `migrations has-pending-model-changes` | Check Model | EF Core 8+ |
| DbContext Info | `dbcontext info --json` | Read Info | Không nhận connection override không hợp lệ |
| Drop DB | `database drop --force` | Drop Database | Identify DB rồi gõ đúng database name |
| Bundle | `migrations bundle` | Create Bundle | Output, force, self-contained, runtime |
| Optimize | `dbcontext optimize` | Generate Optimized Model | Output dir, namespace, suffix |

## 6. Connection handling

Update, Drop và các CLI hỗ trợ `--connection` có password field:

- Rỗng: dùng startup project configuration.
- Chấp nhận `Name=ConnectionStrings:X`.
- Chấp nhận connection string đầy đủ.
- Không persist vào workspace/global/webview state.
- `retainContextWhenHidden` bị tắt; DOM bị hủy khi webview ẩn.
- Form values được giữ trong memory của extension host khi Center còn mở để
  khôi phục DOM và cho phép chạy nhiều action liên tiếp; đóng Center sẽ xóa
  toàn bộ session này, bao gồm connection string.
- Preview, Output và error đi qua masking.
- Password field có Show/Hide tạm thời.

`dotnet ef` vẫn nhận connection bằng process argument. DotNav không mô tả cơ
chế này là secret storage an toàn tuyệt đối; process owner có thể quan sát
argument trong thời gian process chạy.

Drop Database không enable dựa trên DbContext name. User phải bấm
**Identify database**:

- Full connection có `Database`/`Initial Catalog`: lấy identity trực tiếp.
- Không có explicit connection: gọi `dbcontext info`.
- Không xác định được database name: Drop tiếp tục bị khóa.

## 7. EF version capability

Capability dùng major thấp hơn giữa project Design package và resolved
`dotnet-ef`, tránh global tool mới làm lộ option runtime cũ không hiểu.

| Capability | Minimum |
|---|---:|
| Migration Bundle | EF Core 6 |
| Optimize DbContext | EF Core 6 |
| Pending Model Changes | EF Core 8 |
| Remove `--offline` | EF Core 11 |
| Remove `--connection` | EF Core 11 |
| Drop `--connection` | EF Core 11 |
| Database Update `--add` | EF Core 11 |
| Optimize precompiled queries / NativeAOT | EF Core 9 |

EF Core 6–11 được nhận diện; option chỉ render khi capability hiện tại hỗ trợ.
Version mismatch hiện warning và remediation cài local tool cùng major.

## 8. Command execution

- Mọi `dotnet ef` command đi qua một `SerialQueue`.
- Không chạy song song hai EF commands.
- Write command đang chạy thì write command tiếp theo phải được xác nhận queue.
- Guard với DotNav build/run cùng project.
- `--no-build` auto retry bằng full build khi assembly stale.
- Notification progress có Cancel; process tree bị kill.
- Write attempt luôn invalidate source model dù success, fail hay cancel.
- Status bar chỉ hiện trong thời gian running/queued.
- Output luôn ghi command, stdout/stderr đã mask, exit code và duration.

Additional arguments dùng parser shell-like nội bộ, không chạy shell. Quoted
value được giữ nguyên. Các option DotNav quản lý như `--project`,
`--startup-project`, `--context`, `--connection`, `--output` bị từ chối trong
raw additional arguments.

## 9. Accessibility

- Navigation có accessible label và active action.
- Searchable combo dùng combobox/listbox/option roles.
- `aria-controls`, `aria-expanded`, `aria-activedescendant`,
  `aria-selected` được cập nhật theo keyboard selection.
- Status dùng `aria-live="polite"`.
- Escape đóng popup trước, sau đó đóng Center.
- Arrow keys và Enter chọn combo item; Enter không submit khi list đang mở.
- Autofocus bỏ qua combo và collapsed Advanced content.
- Host validation và required validation cùng kiểm soát submit.

## 10. Settings

- `dotnav.ef.enable`
- `dotnav.ef.startupProject`
- `dotnav.ef.configuration`
- `dotnav.ef.noBuild`
- `dotnav.ef.verbose`
- `dotnav.ef.discoverOnStartup`
- `dotnav.ef.migrationsSortOrder`
- `dotnav.ef.environmentVariables`
- `dotnav.ef.commandTimeout`

`dotnav.ef.checkPendingOnStartup` đã deprecated và chỉ còn làm compatibility
alias cho `discoverOnStartup`.

## 11. Safety boundary

DotNav không chạy `database update`, `database drop`, migration apply hoặc bất
kỳ database write nào nếu user chưa bấm primary action tương ứng. Refresh,
discovery và mở Center không kết nối database. Check Database và Identify
Database là explicit reads.

Không có “do not ask again” cho Drop Database, rollback all hoặc remove
applied migration.

## 12. Test matrix

- Pure: parser JSON, error classification, masking, connection identity,
  argument quoting, capability matrix, database update planning.
- Source model: multi-context, large generated files, cache invalidation.
- UI HTML: CSP escaping, Center navigation, toolbar, responsive CSS,
  accessibility wiring, busy/Cancel, host validation, password reveal.
- Contributions: nine context actions, correct grouping, declared commands,
  maintenance excluded from project submenu.
- Queue/process: ordering, cancellation, stale generation, no-build retry.

Full extension test command:

```console
npm test --workspace extensions/dotnav
```
