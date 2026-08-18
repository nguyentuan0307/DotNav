# Giải pháp Tìm kiếm Route Nâng cao & ASP.NET Core Endpoint Explorer trong DotNav

Tài liệu này trình bày kiến trúc và giải pháp cho tính năng **ASP.NET Core Endpoint Explorer** tích hợp thuật toán tìm kiếm route siêu thông minh (**Ultra-Smart Flexible Route Search Engine**) trong extension **DotNav**.

---

## 1. Vấn đề thực tế (Problem Statement)

Trong các dự án ASP.NET Core Web API (cả Controller-based lẫn Minimal APIs), route của endpoint thường bị phân mảnh và chứa nhiều tham số động phức tạp:
- Route kết hợp giữa Class attribute và Action attribute: `[Route("api/[controller]")]` + `[HttpGet("{fieldId:int}/validation")]`.
- Định tuyến chứa ràng buộc kiểu dữ liệu (`:int`, `:guid`, `:regex`, `:min`, `?`, `=default`).
- Lập trình viên khi cần tra cứu endpoint thường không nhớ chính xác tên tham số hoặc kiểu ràng buộc, mà chỉ nhớ các từ khóa chính:
  - Tìm `fields//validation` (bỏ qua đoạn tham số `{fieldId:int}` ở giữa).
  - Tìm `fields//sub-items//validation` (bỏ qua nhiều đoạn tham số độc lập).
  - Tìm theo từ viết tắt: `iv/ff` hoặc `afv`.
  - Tìm theo tên/kiểu tham số: `fieldId:int` hoặc `id:guid`.
  - Bắt lỗi gõ nhầm chính tả: `feilds//validation`.
  - Tìm theo phương thức: `GET fields//validation` hoặc `POST validation`.

---

## 2. Kiến trúc Thuật toán 5 Tầng (5-Tier Ultra-Smart Search Pipeline)

DotNav giải quyết bài toán này thông qua bộ xử lý 5 tầng tính điểm và lọc:

```
[User Search Query] 
        │
        ▼
[1. Query Decomposition] ───► Tách HTTP Method (GET, POST...) + Tách Token (`/`, `//`, `*`, spaces)
        │
        ▼
[2. Route Normalization] ───► Bóc tách SegmentDescriptor (raw, isParam, paramName, constraint, variations)
        │
        ▼
[3. Multi-Engine Scorer] ───► 5 Tầng so khớp:
        │                      • Tier 1: Exact / Normalized Match (Score 100)
        │                      • Tier 2: Multi-Gap Subsequence Matcher with Parameter Skips (Score 90-98)
        │                      • Tier 3: Parameter Constraint & Name Matcher (Score 85-90)
        │                      • Tier 4: Acronym & Word-Boundary Matcher (Score 80)
        │                      • Tier 5: Damerau-Levenshtein Typo Tolerance (Score 75)
        │                      • Method Bonus (+15) / Penalty (-40)
        ▼
[4. Ranked Results & DX] ───► QuickPick Items + Copy Route + Copy Resolved URL + Copy .http + Copy cURL
```

### 2.1. Phân tách truy vấn (Query Decomposition)
- Tự động nhận diện HTTP Method đứng đầu hoặc đứng cuối (ví dụ: `GET ...` hoặc `... POST`).
- Chia chuỗi tìm kiếm thành danh sách các token theo dấu phân cách `/+`, `\\+`, `\*+`, hoặc khoảng trắng:
  - Query: `fields//validation` ➔ Tokens: `["fields", "validation"]`.
  - Query: `fields//sub-items//validation` ➔ Tokens: `["fields", "sub-items", "validation"]`.

### 2.2. Bóc tách SegmentDescriptor & Biến thể Naming
- Mỗi segment được phân tích chi tiết:
  ```typescript
  interface RouteSegmentDescriptor {
    readonly raw: string;             // "{fieldId:int}"
    readonly isParam: boolean;        // true
    readonly paramName?: string;      // "fieldId"
    readonly constraint?: string;     // "int"
    readonly cleanText: string;       // "fieldId"
    readonly variations: string[];    // ["fieldid", "field-id", "fieldId", "fieldid:int"]
  }
  ```

### 2.3. Multi-Gap Subsequence Matcher (Xử lý `fields//validation`)
- Duyệt tuần tự các token so với các segment của route theo đúng thứ tự.
- Khi bỏ qua segment giữa token $T_i$ và $T_{i+1}$:
  - Nếu segment bị bỏ qua là một **Route Parameter** (`isParam === true`), điểm số được bảo toàn tối đa (-1 điểm/gap).
  - Nếu segment bị bỏ qua là segment tĩnh, trừ 3 điểm/gap.
- Đảm bảo các route có đúng cấu trúc khoảng trống tham số luôn đứng **#1** với điểm số **93% - 96%**.

### 2.4. Trọng số & Chấm điểm (Scoring Matrix)

| Tầng khớp | Điểm cơ bản | Kịch bản ví dụ |
| :--- | :---: | :--- |
| **Tier 1: Exact Match** | 100% | `api/fields/{fieldId:int}/validation` |
| **Tier 2: Multi-Gap Subsequence** | 90 - 98% | `fields//validation`, `fields//sub-items//validation` |
| **Tier 3: Parameter & Constraint** | 85 - 90% | `fieldId:int`, `subItemId:guid`, `id` |
| **Tier 4: Acronym Match** | 80% | `iv/ff` ➔ `interface-views/filter-fields`, `afv` ➔ `api/fields/validation` |
| **Tier 5: Typo Tolerance** | 75% | `feilds//validation` ➔ `fields/validation` (Damerau-Levenshtein) |
| **Method Filter Bonus/Penalty** | +15 / -40 | `GET fields//validation` ưu tiên verb GET, đẩy verb khác xuống |

---

## 3. Các tính năng chính của Endpoint Explorer

| Tính năng | Mô tả |
| :--- | :--- |
| 🔍 **Live Interactive QuickPick** | Gõ từ khóa tìm kiếm và nhận kết quả tức thì với badge màu `[GET]`, `[POST]`, điểm % match và lý do khớp chi tiết. |
| ⚡ **Jump to Action / Handler** | Nhấn `Enter` để mở ngay file `.cs` và di chuyển con trỏ tới đúng dòng định nghĩa action/endpoint. |
| 📋 **Copy Route Template** | Nút copy nhanh đường dẫn route template nguyên bản vào clipboard. |
| 🔗 **Copy Resolved Test URL** | Tự động sinh URL thực thi với **Mock Data** theo kiểu dữ liệu tham số (ví dụ: `https://localhost:5001/api/fields/1/validation`). |
| 📝 **Copy as .http Request** | Tự động sinh cú pháp `.http` (tương thích REST Client / VS Code .http) kèm pre-populated body JSON. |
| 💻 **Copy as cURL Command** | Tự động sinh lệnh `curl` hoàn chỉnh kèm URL đã điền mock param và Content-Type. |
| 🔄 **Auto Workspace Invalidation** | Tự động cập nhật chỉ mục khi lập trình viên chỉnh sửa, thêm mới hoặc xóa file `.cs` trong workspace. |

---

## 4. Hướng dẫn sử dụng

1. Mở Command Palette (`Ctrl+Shift+P` hoặc `Cmd+Shift+P`).
2. Gõ: `DotNav: Search ASP.NET Core Endpoints (API Search)`.
3. Nhập từ khóa tìm kiếm:
   - `fields//validation`
   - `fields//sub-items//validation`
   - `iv/ff` (tìm theo viết tắt)
   - `fieldId:int` (tìm theo kiểu dữ liệu tham số)
   - `feilds//validation` (bắt lỗi chính tả)
   - `GET users`
4. Dùng phím mũi tên để duyệt, nhấn `Enter` để nhảy tới code hoặc bấm các icon hành động ở góc phải mục tìm kiếm.
