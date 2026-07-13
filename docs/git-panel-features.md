# Git Panel — Feature Spec (JetBrains-like)

Đặc tả **tính năng**. Không bàn implementation.

Tham chiếu: IntelliJ IDEA Git tool window (Alt+9), Branches popup, Update Project, Commit tool window.
Reference UX: extension `zhycde.git-brains` ("Jet Git") — chỉ để so layout, không lấy code.

---

## 1. Tổng thể

Panel tên **Git Log**, nằm ở bottom panel (cạnh Terminal / Problems). Ba pane, chia bởi splitter kéo được, tỉ lệ lưu lại giữa các session.

```
┌─────────────┬──────────────────────────────────────┬────────────────────┐
│ BRANCHES    │ [filter bar]                         │ CHANGED FILES      │
│             ├──────────────────────────────────────┤                    │
│ tree branch │ graph │ subject+refs │ author │ date  │ file tree          │
│             │ (virtual scroll)                     ├────────────────────┤
│             │                                      │ COMMIT DETAIL      │
└─────────────┴──────────────────────────────────────┴────────────────────┘
```

Trạng thái toàn panel: repo hiện tại, branch đang HEAD, ahead/behind so upstream, số file đang thay đổi.

---

## 2. Pane trái — Branches

### 2.1 Cấu trúc cây

- **Current Branch** — branch HEAD đang đứng, luôn ở đỉnh, có badge ahead/behind (`↑2 ↓5`).
- **Favorites** — branch đã đánh dấu sao, gom lên trên.
- **Local** — branch local. Tên chứa `/` được gom thành folder lồng nhau (`feature/0307-x` → folder `feature` > item `0307-x`).
- **Remote** — gom theo remote (`origin`, …), rồi gom folder theo `/` như local.
- **Tags** — danh sách tag, gom folder theo `/`.
- **Stashes** — danh sách stash (`stash@{0}` + message + thời điểm).

Mỗi branch item hiển thị: tên, badge ahead/behind so upstream (nếu có), dấu sao nếu favorite, icon phân biệt local / remote / tag.

### 2.2 Hành vi

- Ô search lọc branch theo tên (fuzzy), tự bung folder khớp.
- Click branch → commit list highlight/scroll tới HEAD của branch đó, KHÔNG checkout.
- Double click branch → checkout (có confirm nếu working tree dirty).
- Trạng thái bung/gấp của folder lưu giữa các session.

### 2.3 Context menu — branch **local**

| Action | Hành vi |
|---|---|
| Checkout | Chuyển sang branch. Working tree dirty → hỏi Stash / Force / Cancel. |
| Checkout and Update | Checkout xong pull theo strategy mặc định (merge/rebase). |
| New Branch from Selected… | Nhập tên → tạo branch từ branch này. Checkbox *Checkout branch* (mặc định bật). |
| Rename… | Đổi tên branch local. |
| Delete | Xoá branch. Chưa merge → cảnh báo, cho phép force delete. Branch đang checkout → chặn. |
| Mark as Favorite / Unmark | Toggle sao. |
| Compare with Current | Mở tab so 2 branch: commit chỉ có ở bên này / bên kia + tổng file khác. |
| Show Diff with Working Tree | Danh sách file khác giữa branch và working tree; click file → diff. |
| Merge into Current | `merge <branch>` vào HEAD. Có option *No fast-forward*, *Squash*. Conflict → sang mục 7. |
| Rebase Current onto Selected | Rebase HEAD lên branch này. |
| Checkout and Rebase onto Current | Checkout branch này rồi rebase lên HEAD cũ. |
| Push | Push branch (không cần checkout). |
| Pull into Current using Merge/Rebase | Kéo branch này vào HEAD, không checkout. |
| Copy Branch Name | Copy tên vào clipboard. |

### 2.4 Context menu — branch **remote**

Checkout (tạo local tracking branch cùng tên) · Checkout and Update · New Branch from Selected… · Compare with Current · Show Diff with Working Tree · Merge into Current · Rebase Current onto · Pull into Current · Delete on Remote (confirm gắt) · Copy Branch Name.

### 2.5 Context menu — tag

Checkout revision (detached HEAD, cảnh báo) · New Branch from Tag… · Delete tag (local, + option xoá trên remote) · Copy tag name · Show in log.

### 2.6 Context menu — stash

Apply (giữ stash) · Pop (apply + xoá) · Drop (confirm) · Show diff (file trong stash) · Create branch from stash.

---

## 3. Pane giữa — Commit list + Graph

### 3.1 Cột

| Cột | Nội dung |
|---|---|
| Graph | Lane màu, node commit, đường nối parent. Merge commit rẽ nhánh. |
| Subject | Message dòng đầu + **ref chip** (branch local, remote, tag, `HEAD`). Chip rút gọn nếu chật. |
| Author | Tên tác giả. |
| Date | Ngày giờ commit. Tuỳ chọn hiện dạng tương đối ("2 giờ trước"). |

Row đầu tiên có thể là **Uncommitted changes** (giả) nếu working tree dirty — click ra danh sách file đang đổi.

### 3.2 Virtual scroll

- Row cao cố định. Chỉ render các row trong khung nhìn + overscan.
- Log nạp theo page, cuộn gần đáy tự nạp tiếp. Scrollbar phản ánh tổng số commit thật (đếm nền), không nhảy giật.
- Repo cỡ trăm nghìn commit vẫn cuộn mượt; không dựng DOM cho commit ngoài khung nhìn.

### 3.3 Filter bar

- **Text** — lọc theo message hoặc hash. Bật được chế độ **regex** và **match case**.
- **Branch** — chọn 1 hoặc nhiều branch (mặc định: All / hoặc chỉ branch hiện tại).
- **User** — chọn author (có mục "me").
- **Path** — lọc commit đụng tới file/folder (chọn từ picker hoặc kéo file vào).
- **Date** — khoảng thời gian (từ / đến / preset: hôm nay, 7 ngày, 30 ngày).
- Các filter cộng dồn (AND). Có nút xoá hết filter. Filter đang bật hiển thị dạng chip.
- **Go to Hash/Branch/Tag** — ô nhảy nhanh tới commit theo hash/ref.

### 3.4 Chọn & điều hướng

- Chọn 1 commit → pane phải hiện detail + changed files.
- Chọn 2 commit (Ctrl/Shift) → menu có **Compare Versions** (diff giữa 2 revision).
- Chọn nhiều commit liền kề → cherry-pick / revert hàng loạt (theo đúng thứ tự).
- Phím: ↑/↓ chuyển commit, ←/→ nhảy parent/child theo graph, Enter mở diff, Ctrl+F focus filter.

### 3.5 Context menu — commit

| Action | Hành vi |
|---|---|
| Checkout Revision | Checkout commit → detached HEAD. Cảnh báo trước. |
| New Branch here… | Tạo branch tại commit (checkbox checkout). |
| New Tag here… | Tạo tag tại commit (nhập tên + message). |
| Cherry-Pick | Áp commit lên HEAD. Nhiều commit → áp theo thứ tự cũ→mới. Option *no-commit*. |
| Revert Commit | Tạo commit đảo ngược. Giữ nguyên history. |
| Undo Commit | Chỉ với commit đỉnh: gỡ commit, đưa change về working tree (soft). |
| Drop Commit | Xoá hẳn commit khỏi history (rebase bỏ commit). Cảnh báo cần force push; chặn nếu commit đã push lên protected branch. |
| Reset Current Branch to Here | Dialog 4 mode: **Soft** (change vào staged) · **Mixed** (change giữ, unstaged) · **Hard** (mất hết change) · **Keep** (bỏ commit, giữ local modification). Hard → confirm gắt. |
| Compare with Local | Diff commit vs working tree. |
| Compare Versions | Chỉ hiện khi chọn đúng 2 commit. |
| Show Repository at Revision | Mở cây file toàn repo tại commit đó (read-only). |
| Copy Revision Number | Copy full hash. Kèm *Copy short hash*, *Copy message*. |
| Open on GitLab/GitHub | Mở commit trên web remote (suy từ URL remote). |
| Interactive Rebase from Here | *(giai đoạn sau)* |

### 3.6 Commit detail (pane phải, nửa dưới)

Message đầy đủ · full hash (click copy) · author + email + ngày author · committer nếu khác · ref chip (`HEAD → develop`, `origin/develop`) · parent hash (click nhảy tới) · số file thay đổi + tổng +/-.

---

## 4. Pane phải — Changed Files

- Danh sách file trong commit đang chọn. Hai chế độ: **tree** (theo folder) / **flat** (đường dẫn đầy đủ). Có nút toggle + nút gấp/bung hết.
- Mỗi file: icon trạng thái (Added / Modified / Deleted / Renamed / Copied), tên, đường dẫn thư mục mờ phía sau, số +/- .
- Click file → mở diff của file đó trong commit (so với parent).
- Merge commit → cho chọn so với parent nào (parent 1 / parent 2), hoặc xem combined diff.

### Context menu — file trong commit

| Action | Hành vi |
|---|---|
| Show Diff | Diff file so parent. |
| Show File History | Mở lịch sử file (nối vào panel history đã có). |
| Open Version at Revision | Mở nội dung file tại commit đó (read-only). |
| Get File from Revision | Ghi đè file trong working tree bằng bản ở commit này (confirm). |
| Revert Selected Changes | Tạo commit (hoặc thay đổi local) đảo ngược riêng file này trong commit. |
| Copy Path / Copy Relative Path | Copy đường dẫn. |
| Open in Editor | Mở file bản working tree. |

---

## 5. Toolbar

| Nút | Hành vi |
|---|---|
| Refresh | Nạp lại log + branch + trạng thái. |
| Fetch | `fetch --all --prune`. Cập nhật ahead/behind. Không đụng working tree. Có auto-fetch nền (bật/tắt được, chu kỳ cấu hình được, mặc định 20 phút). |
| **Update Project** | Dialog chọn strategy: **Merge** · **Rebase** · **Reset to Remote Branch** (huỷ commit local, khớp remote — confirm gắt). Nhớ lựa chọn lần trước. Chạy fetch trước rồi tích hợp. |
| Pull | Pull branch hiện tại theo strategy mặc định. |
| Push | Dialog: hiện commit sắp push, remote + branch đích, checkbox *Force with lease*, *Push tags*. Bị reject → gợi ý Update Project rồi push lại. |
| Stash / Shelve | Tạo stash (nhập message, checkbox *include untracked*, *keep index*). |
| New Branch | Tạo branch từ HEAD. |
| View Options | Toggle: hiện/ẩn date, author, ref chip; date tương đối; tree/flat cho changed files; compact graph. |
| Repo picker | Chỉ hiện khi workspace có nhiều git repo. Chọn repo đang xem. |

---

## 6. Uncommitted changes (mức tối thiểu)

Không thay thế SCM view của VSCode; chỉ đủ dùng hằng ngày:

- Row "Uncommitted changes" ở đỉnh commit list → click hiện danh sách file đang đổi ở pane phải.
- Context menu file: Show Diff · **Rollback** (bỏ thay đổi file, confirm) · Open in Editor.

---

## 7. Conflict

- Merge / rebase / cherry-pick / revert / stash-apply dính conflict → panel hiện banner trạng thái (`MERGING`, `REBASING`, `CHERRY-PICKING`) + danh sách file conflict.
- Click file conflict → mở **merge editor 3-way sẵn có của VSCode**.
- Banner có nút: **Continue** (tiếp tục sau khi resolve hết) · **Abort** (huỷ, về trạng thái trước) · **Skip** (chỉ với rebase/cherry-pick).
- Còn file chưa resolve mà bấm Continue → chặn, báo file nào còn.

---

## 8. Lỗi & an toàn

- Mọi lệnh phá huỷ (reset --hard, drop commit, delete remote branch, force push, Reset to Remote Branch, rollback, drop stash) → confirm modal ghi rõ hậu quả.
- Lệnh cần working tree sạch mà tree dirty → hỏi trước: **Stash & tiếp tục** / **Force** / **Huỷ**.
- Git trả lỗi → hiện stderr thật, không nuốt lỗi. Lỗi có thao tác gỡ (ví dụ push bị reject) → gợi ý action tiếp theo.
- Long-running (fetch/pull/push/rebase) → progress + nút cancel.
- Sau mọi mutation → refresh panel + đồng bộ với SCM view của VSCode.

---

## 9. Ngoài phạm vi (chưa làm)

- Interactive rebase GUI (kéo thả reorder / squash / edit) — cân nhắc giai đoạn sau.
- Annotate/blame gutter — đã có extension riêng.
- Git log indexing, patch create/apply, submodule, worktree.
- Commit dialog với staging theo hunk — dùng SCM view sẵn có.
