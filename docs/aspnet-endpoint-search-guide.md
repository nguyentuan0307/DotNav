# Giải pháp Tìm kiếm Route Nâng cao & ASP.NET Core Endpoint Explorer trong DotNav

Tài liệu này trình bày kiến trúc và giải pháp cho tính năng **ASP.NET Core Endpoint Explorer** tích hợp thuật toán tìm kiếm route thông minh (**Flexible Fuzzy Route Search**) trong extension **DotNav**.

---

## 1. Vấn đề thực tế (Problem Statement)

Trong các dự án ASP.NET Core Web API (cả Controller-based lẫn Minimal APIs), route của endpoint thường bị phân mảnh và chứa nhiều tham số động phức tạp:
- Route kết hợp giữa Class attribute và Action attribute: `[Route("api/[controller]")]` + `[HttpGet("interface-views/{interfaceViewId:int}/filter-fields")]`.
- Định tuyến chứa ràng buộc kiểu dữ liệu (`:int`, `:guid`, `:regex`, `:min`, `?`, `=default`).
- Lập trình viên khi cần tra cứu endpoint thường không nhớ chính xác tên tham số hoặc kiểu ràng buộc, mà chỉ nhớ các từ khóa chính:
  - Tìm `interface-views//filter-fields` (bỏ qua đoạn tham số `{interfaceViewId:int}` ở giữa).
  - Tìm `interface-views/filter-fields`.
  - Tìm `GET filter-fields` hoặc `POST interface-views`.
  - Tìm `InterfaceViewsController` hoặc `GetFilterFields`.

---

## 2. Giải pháp thuật toán (Smart Flexible Route Matching Algorithm)

DotNav giải quyết bài toán này thông qua bộ xử lý 3 giai đoạn:

```
[User Search Query] 
        │
        ▼
[1. Query Decomposition] ───► Tách HTTP Method (GET, POST...) + Tách Token (`/`, `//`, spaces)
        │
        ▼
[2. Route Normalization] ───► Bóc tách Segment + Chuẩn hóa Regex Parameter Constraints
        │
        ▼
[3. Subsequence & Gap Matching] ──► Chấm điểm Score (1-100%) + Xếp hạng kết quả
```

### 2.1. Phân tách truy vấn (Query Decomposition)
- Tự động nhận diện HTTP Method đứng đầu hoặc đứng cuối (ví dụ: `GET ...` hoặc `... POST`).
- Chia chuỗi tìm kiếm thành danh sách các token theo dấu phân cách `/+`, khoảng trắng hoặc `\`:
  - Query: `interface-views//filter-fields` ➔ Tokens: `["interface-views", "filter-fields"]`.

### 2.2. Chuẩn hóa Route Template (Route Normalization)
- Tách route thành các segment:
  - `interface-views/{interfaceViewId:int}/filter-fields` ➔ Segments: `["interface-views", "{interfaceViewId:int}", "filter-fields"]`.
- Loại bỏ ràng buộc kiểu dữ liệu để sinh template chuẩn: `{interfaceViewId:int}` ➔ `{interfaceViewId}`.

### 2.3. Khớp chuỗi con thứ tự kèm Wildcard khoảng trống (Subsequence Gap Matching)
- So khớp tuần tự từng token với các segment của route:
  - Token 0 (`"interface-views"`) ➔ khớp chính xác với Segment 0 (`"interface-views"`).
  - Token 1 (`"filter-fields"`) ➔ khớp chính xác với Segment 2 (`"filter-fields"`).
- Khoảng cách giữa Segment 0 và Segment 2 chính là Segment 1 (`"{interfaceViewId:int}"` - Route Parameter).
- Thuật toán tự động nhận diện khoảng cách `//` như một ký tự đại diện (wildcard) cho tham số và chấm điểm cao nhất (**95% Match Score**).

### 2.4. Trọng số & Chấm điểm (Scoring Matrix)

| Mức độ khớp | Điểm cơ bản | Mô tả |
| :--- | :---: | :--- |
| **Exact Route Match** | 100% | Toàn bộ route khớp tuyệt đối. |
| **Segment Subsequence with Param Gap** | 90 - 95% | Khớp các token theo thứ tự qua các segment tham số (`interface-views//filter-fields`). |
| **Multi-token Substring Match** | 80% | Các token xuất hiện rải rác trong route / controller / action. |
| **Route Substring Match** | 75% | Chuỗi tìm kiếm là chuỗi con của route. |
| **Method Filter Match Bonus** | +15% | Khớp chính xác phương thức HTTP (ví dụ tìm `GET ...`). |

---

## 3. Các tính năng chính của Endpoint Explorer

| Tính năng | Mô tả |
| :--- | :--- |
| 🔍 **Live Interactive QuickPick** | Gõ từ khóa tìm kiếm và nhận kết quả tức thì với badge `[GET]`, `[POST]`, điểm % match và lý do khớp. |
| ⚡ **Jump to Action / Handler** | Nhấn `Enter` để mở ngay file `.cs` và di chuyển con trỏ tới đúng dòng định nghĩa action. |
| 📋 **Copy Route Template** | Nút copy nhanh đường dẫn route template vào clipboard. |
| 📝 **Copy as .http Request** | Tự động sinh cú pháp `.http` (tương thích REST Client / Visual Studio .http file) kèm header `Accept: application/json` và body mẫu cho `POST`/`PUT`. |
| 🔄 **Auto Workspace Invalidation** | Tự động cập nhật chỉ mục khi lập trình viên chỉnh sửa, thêm mới hoặc xóa file `.cs` trong workspace. |

---

## 4. Hướng dẫn sử dụng

1. Mở Command Palette (`Ctrl+Shift+P` hoặc `Cmd+Shift+P`).
2. Gõ: `DotNav: Search ASP.NET Core Endpoints (API Search)`.
3. Nhập từ khóa tìm kiếm:
   - `interface-views//filter-fields`
   - `GET users`
   - `api/orders/{id}`
   - `POST upload`
4. Dùng phím mũi tên để duyệt, nhấn `Enter` để nhảy tới code hoặc bấm các icon hành động ở góc phải mục tìm kiếm.
