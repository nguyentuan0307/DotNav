# Project Guidelines & Agent Directives (DotNav & GitNav Monorepo)

> **Mục đích**: Tài liệu này là **Kim chỉ nam (Single Source of Truth)** quy định toàn bộ quy trình làm việc, nguyên tắc tương tác AI, kiến trúc dự án và quy chuẩn kiểm thử/release. Bất kỳ Agent hay nhà phát triển nào khi làm việc trên repository này **BẮT BUỘC PHẢI TUÂN THỦ 100% KHÔNG NGOẠI LỆ**.

---

## 1. 🛑 Nguyên Tắc Tương Tác & Sửa Code (Strict Interaction Rules)

### 1.1. Bắt Buộc: Plan-First & Chờ Duyệt (No Unapproved Edits)
- **TUYỆT ĐỐI KHÔNG** tự ý sửa code (`replace_file_content`, `write_to_file`, `multi_replace_file_content`) hoặc chạy lệnh làm thay đổi mã nguồn khi **chưa được User phê duyệt Plan**.
- **Quy trình chuẩn**:
  1. Khi nhận yêu cầu: **CHỈ** dùng các tool đọc/nghiên cứu (`view_file`, `grep_search`, `find_by_name`, `list_dir`).
  2. Tạo/cập nhật `implementation_plan.md` trình bày rõ nguyên nhân, giải pháp, file cần sửa và kế hoạch kiểm thử.
  3. **DỪNG LẠI** và đợi User gửi tin nhắn xác nhận rõ ràng (ví dụ: *"chốt"*, *"đồng ý"*, *"proceed"*, *"tiến hành"*).
  4. Chỉ sau khi User đã duyệt mới bắt đầu gọi tool sửa code.

### 1.2. Kỹ Thuật Can Thiệp Code Tối Giản (Surgical Changes)
- **Surgical Edits**: Chỉ chạm đúng những dòng code/hàm cần sửa. Tuyệt đối **không format lại toàn bộ file** hoặc xáo trộn các đoạn code xung quanh.
- **Simplicity First**: Giải pháp tối giản nhất; không tạo abstraction/helper dư thừa cho code chỉ dùng 1 lần; không tự ý thêm tính năng hoặc config ngoài yêu cầu.
- **Preserve Comments**: Giữ nguyên vẹn các comment, docstring và cấu trúc code cũ không liên quan.

---

## 2. 🏗️ Kiến Trúc Monorepo & Phân Vùng Dự Án

Dự án là một **VS Code Extension Monorepo (npm workspaces)** gồm 3 extension chính:

| Phân vùng | Đường dẫn | Chức năng cốt lõi & Lưu ý |
|---|---|---|
| **DotNav** | `extensions/dotnav/` | • **EF Core Visualizer & ERD Diagram**: Quét DbContext, ModelSnapshot, C# Entity, vẽ quan hệ FK, Canvas World-space, Focus Mode, Quick Finder.<br>• **Solution & Architecture Explorer**: Quét .NET Solution, project dependency graph, package graph.<br>• **Build Host**: Host .NET 6/8 biên dịch (`build-host/`). |
| **GitNav** | `extensions/gitnav/` | • **Git History & Visualizer**: Commit graph, log viewer, branch/tag manager, stashes, conflict resolver.<br>• **Worktree Manager**: Quản lý nhiều worktree độc lập.<br>• **CLI Watchdog**: Cơ chế timeout 25s chống treo khi CPU 100%. |
| **GitNav Workflows** | `extensions/gitnav-workflows/` | • **CI/CD Workflow Runner**: Quản lý và thực thi các pipeline workflow trong workspace. |

> **⚠️ Lưu ý Webview Client Code**:
> Mã nguồn client Webview (như `efDiagramClient.ts`, `efDiagramStyles.ts`) thường được bọc trong template literal TypeScript (`return \`...\`;`). Khi can thiệp:
> - Phải **escape backticks** (`` \` ``) và **escape biến template** (`\${...}`).
> - Phải **escape regex literal** (ví dụ `/\\?$/` thay vì `/\?$/`).

---

## 3. 🔄 Quy Trình Phát Triển & Kiểm Thử Chuẩn (Standard Dev Flow)

Mọi tính năng hoặc bản sửa lỗi đều phải tuân thủ nghiêm ngặt 5 bước:

### Bước 1: Nghiên Cứu (Research)
- Dùng `grep_search` và `view_file` để kiểm tra chính xác những gì code **hiện tại ĐÃ CÓ** trước khi đề xuất hoặc triển khai, tránh đề xuất trùng lặp tính năng đã có sẵn.

### Bước 2: Lập Plan & Chờ Phê Duyệt
- Viết rõ các file cần can thiệp và phương án kiểm thử vào `implementation_plan.md`.
- Dừng lại chờ User phê duyệt.

### Bước 3: Triển Khai
- Thực hiện chỉnh sửa chính xác theo đúng scope đã duyệt.

### Bước 4: Xác Minh Toàn Diện (Verification Gates)
1. **Kiểm tra Compile TypeScript**:
   ```bash
   npm run compile
   ```
   *Yêu cầu*: Bắt buộc exit code 0, không có bất kỳ lỗi TypeScript nào.
2. **Kiểm tra Monorepo Test Suite**:
   ```bash
   npm test
   ```
   *Yêu cầu*: Toàn bộ unit tests (760+ tests) phải pass 100%.
3. **Kiểm tra Webview E2E (Nếu có thay đổi UI/Canvas)**:
   - Chạy script kiểm thử Chrome Headless E2E để xác minh DOM, sự kiện click, kéo thả và giao diện thật.

### Bước 5: Đóng Gói VSIX & Cài Đặt Local
- Đóng gói toàn bộ extension và cài đặt đè bản mới nhất vào VS Code để User có thể trải nghiệm ngay:
  ```bash
  npm run package:all && code --install-extension dist/dotnav.vsix --force
  ```

---

## 4. 🚀 Quy Chuẩn Release, Git & Conventional Commits

Dự án áp dụng cơ chế **Tự Động Hóa Release Hoàn Toàn** thông qua GitHub Actions và **Release Please**. Do đó:

### 4.1. ❌ Những Điều TUYỆT ĐỐI CẤM (Forbidden Actions)
1. **TUYỆT ĐỐI KHÔNG tạo Git Tag thủ công**: Mọi tag (`dotnav-v*`, `gitnav-v*`) đều do Release Please tự động tạo khi merge vào master.
2. **TUYỆT ĐỐI KHÔNG sửa số version thủ công**: Không sửa trường `"version"` trong `package.json` hoặc `.release-please-manifest.json`. Việc tăng version (Major/Minor/Patch) được tính toán tự động dựa trên Conventional Commits.

### 4.2. ✅ Quy Chuẩn Conventional Commits
Mọi commit message **bắt buộc** phải tuân theo cấu trúc:
```text
<type>(<scope>): <mô tả ngắn gọn bằng tiếng Anh>
```
- **Các type hợp lệ**:
  - `feat`: Thêm tính năng mới (sẽ trigger tăng **Minor** version `0.X.0`).
  - `fix`: Sửa lỗi (sẽ trigger tăng **Patch** version `0.0.X`).
  - `perf`: Cải thiện hiệu năng.
  - `refactor`: Tái cấu trúc mã nguồn không đổi behavior.
  - `test`: Thêm/sửa unit test, E2E test.
  - `docs`: Sửa tài liệu.
  - `chore`: Tác vụ bảo trì, build script, phụ thuộc.
- **Các scope hợp lệ**: `dotnav`, `gitnav`, `workflows`, `erd`, `diagram`.
- **Ví dụ chuẩn**:
  - `feat(erd): add snap to grid and orthogonal line routing`
  - `fix(gitnav): add execution timeout watchdog for CPU overload hangs`
  - `refactor(dotnav): optimize card geometry calculation`

### 4.3. Tiêu Chí Trước Khi Push (`origin master`)
Trước khi chạy `git push origin master`, bắt buộc phải:
1. Chạy `npm test` và kiểm tra pass 100%.
2. Chạy `npm run package:all` để đảm bảo build artifact sạch sẽ.

---

## 5. 💡 Checklist Hành Động Nhanh Cho Agent Khi Bắt Đầu Task Mới

- [ ] Đã đọc kỹ câu hỏi / issue của User chưa?
- [ ] Đã search/view code hiện tại để nắm đúng thực trạng chưa?
- [ ] Đã lên `implementation_plan.md` và **DỪNG LẠI CHỜ USER PHÊ DUYỆT** chưa?
- [ ] Khi code: Có sửa thừa thãi hoặc format lại code không liên quan không?
- [ ] Khi sửa webview template: Đã escape `\${...}` và `` \` `` đúng cách chưa?
- [ ] Đã chạy `npm run compile` và `npm test` chưa?
- [ ] Đã đóng gói VSIX và cài đặt vào VS Code cho User chưa?
- [ ] Commit message đã chuẩn Conventional Commit chưa?

