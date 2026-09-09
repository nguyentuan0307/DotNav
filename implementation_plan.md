# GitNav — Status filter dropdown

## Assumption

`Status` là một control duy nhất mở dropdown chứa checkbox đa chọn (OR filter). `All` bỏ chọn mọi status và hiển thị toàn bộ file.

## Files and changes

1. `extensions/gitnav/src/git/gitLogWebviewHtml.ts`
   - Thay dãy nút status ngang bằng trigger `Status` và menu checkbox `All/A/M/D/R/C`.
2. `extensions/gitnav/media/webview/git-log.js`
   - Lưu nhiều status được chọn, cập nhật label/count, giữ search và reset; hỗ trợ đóng bằng click ngoài hoặc `Escape`.
3. `extensions/gitnav/media/webview/git-log.css`
   - Style control/dropdown nhỏ gọn, neo đúng vị trí, không làm thay đổi layout mặc định.
4. `extensions/gitnav/src/test/gitFeatures.test.ts`, `extensions/gitnav/src/test/webviewUi.test.ts`
   - Cập nhật assertion cho trigger, checkbox và lọc đa status.

## Verification

- `node --check media/webview/git-log.js`
- `npm run compile`
- Test GitNav liên quan, sau đó `npm test`
- `git diff --check`

Đã triển khai sau khi plan được phê duyệt.

Verification thực tế: `npm run compile`, `npm test`, `npm run package:all`, `node --check` và `git diff --check` đều pass.
