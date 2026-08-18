# Hướng dẫn sử dụng Git Worktree Manager trong GitNav

Tài liệu này hướng dẫn cách sử dụng tính năng **Git Worktree Manager** trên GitNav để quản lý đa nhánh làm việc đồng thời trong các thư mục độc lập mà không cần switch branch hay stash dở dang công việc.

---

## 1. Giới thiệu về Git Worktree

### Git Worktree là gì?
Thông thường trong Git, bạn chỉ có 1 working tree gắn liền với repository. Mỗi khi muốn chuyển sang nhánh khác (để fix bug khẩn cấp, review PR, hoặc test tính năng mới), bạn phải:
1. `git stash` hoặc commit dở code đang viết.
2. `git checkout <branch-khac>`.
3. Chạy `npm install` hoặc rebuild lại project.
4. Xong việc lại checkout về và `git stash pop`.

**Git Worktree** cho phép bạn checkout **nhiều branch khác nhau vào các thư mục riêng biệt** cùng lúc từ cùng 1 repository (`.git`). Tất cả các worktree đều chia sẻ chung lịch sử Git, remote, commit history, nhưng có working directory và index độc lập!

---

## 2. Các tính năng chính của Worktree Manager trong GitNav

| Tính năng | Mô tả |
| :--- | :--- |
| 📋 **Worktree Hub QuickPick** | Xem toàn bộ danh sách worktree đang có kèm trạng thái (`[Current]`, `[Locked]`, `[Prunable]`). |
| ➕ **Interactive Create Worktree** | Tạo worktree mới từ nhánh hiện có hoặc tạo nhánh mới chỉ với 2 bước đơn giản. |
| 📂 **Open in New / Current Window** | Mở thư mục worktree trong cửa sổ VS Code mới hoặc chuyển đổi ngay lập tức. |
| 🖥️ **Open Terminal in Worktree** | Bật terminal tích hợp tại đúng đường dẫn worktree chỉ với 1 click. |
| 🔒 **Lock / Unlock Worktree** | Khóa worktree kèm lý do ghi chú để tránh bị xóa nhầm hoặc tự động prune. |
| 🗑️ **Safe Remove Worktree** | Xóa thư mục worktree và giải phóng ref an toàn; tự động cảnh báo nếu có thay đổi chưa commit. |
| 🧹 **Prune Stale Worktrees** | Dọn dẹp siêu dữ liệu của các worktree đã bị xóa thủ công ngoài hệ thống file. |

---

## 3. Hướng dẫn sử dụng chi tiết

### 3.1. Mở Worktree Manager
- Mở Command Palette (`Ctrl+Shift+P` hoặc `Cmd+Shift+P` trên macOS).
- Gõ: `GitNav: Manage Worktrees...` (hoặc phím tắt).
- Một bảng QuickPick sẽ hiển thị danh sách các worktree hiện tại và các hành động nhanh.

### 3.2. Tạo Worktree mới (`GitNav: Create Worktree...`)
1. Chạy lệnh `GitNav: Create Worktree...` (hoặc chọn `$(plus) Create New Worktree...` trong Manager).
2. **Bước 1 - Chọn Branch:**
   - Chọn một nhánh Local/Remote có sẵn trong danh sách.
   - Hoặc chọn `$(plus) Create New Branch for Worktree...` để đặt tên cho nhánh mới.
   - *Lưu ý:* Nếu nhánh đã được checkout ở một worktree khác, GitNav sẽ tự động nhắc bạn tạo nhánh mới tương ứng.
3. **Bước 2 - Chọn Thư mục:**
   - GitNav tự động gợi ý đường dẫn thư mục cạnh repository (ví dụ: `../MyProject-hotfix-login`).
   - Bạn có thể nhấn `Enter` để đồng ý hoặc nhập đường dẫn tùy chỉnh.
4. **Bước 3 - Mở Worktree:**
   - Sau khi tạo thành công, popup thông báo sẽ cung cấp nút:
     - `Open in New Window`: Mở ngay trong cửa sổ VS Code mới.
     - `Open Terminal`: Bật terminal tại thư mục đó.

### 3.3. Thao tác trên một Worktree có sẵn
Trong bảng Manage Worktrees hoặc click chuột phải vào mục **Worktrees** trong thanh bên trái của GitNav Log panel:
- **Open in New Window:** Mở worktree ở cửa sổ mới.
- **Open in Current Window:** Chuyển cửa sổ hiện tại sang worktree đó.
- **Open in Terminal:** Mở tab terminal với `cwd` trỏ vào worktree.
- **Lock Worktree...:** Nhập lý do khóa (ví dụ: `Đang chạy benchmark dài hạn`). Khi bị khóa, lệnh remove hoặc prune sẽ không thể xóa thư mục này.
- **Unlock Worktree:** Mở khóa worktree.
- **Remove Worktree:** Xóa worktree. Nếu thư mục có file uncommitted, GitNav sẽ hiện popup xác nhận cảnh báo `Force Remove`.
- **Copy Path:** Sao chép đường dẫn tuyệt đối của worktree vào clipboard.

### 3.4. Dọn dẹp Worktree cũ (`GitNav: Prune Stale Worktrees`)
Nếu bạn đã lỡ xóa thư mục worktree bằng File Explorer / Finder của hệ điều hành, Git vẫn còn giữ metadata cũ.
- Chọn `GitNav: Prune Stale Worktrees` (hoặc bấm biểu tượng Prune).
- GitNav sẽ chạy `git worktree prune -v` và báo cáo số lượng entry rác đã được dọn sạch.

---

## 4. Các tình huống sử dụng thực tế (Best Practices)

1. **Hotfix khẩn cấp trong khi đang code tính năng lớn:**
   - Thay vì stash/unstash đống code dang dở:
   - Mở `GitNav: Create Worktree...` -> chọn nhánh `main` -> tạo worktree `../MyProject-hotfix`.
   - Mở cửa sổ mới, fix bug, commit, push PR.
   - Xong việc quay lại cửa sổ chính code tiếp không bị gián đoạn hay mất ngữ cảnh.
2. **So sánh hành vi giữa 2 phiên bản (Parallel Running):**
   - Chạy 2 worktree ở 2 port khác nhau (ví dụ: port 5000 và port 5001) để so sánh trực tiếp API hoặc UI trước và sau refactor.
