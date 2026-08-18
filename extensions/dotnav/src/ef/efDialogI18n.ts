export type EfLocale = 'en' | 'vi';

export interface LocalizedText {
  readonly en: string;
  readonly vi: string;
}

const vietnamese: Record<string, string> = {
  'EF Core Center': 'Trung tâm EF Core',
  'Migration workspace': 'Không gian quản lý migration',
  'Migrations': 'Migration',
  'Database': 'Cơ sở dữ liệu',
  'Scripts': 'Script',
  'Advanced': 'Nâng cao',
  'Danger zone': 'Vùng nguy hiểm',
  'Add Migration': 'Thêm migration',
  'Create Empty Migration': 'Tạo migration rỗng',
  'Remove Last': 'Xóa migration cuối',
  'Remove Last Migration': 'Xóa migration cuối',
  'Browse Migrations': 'Duyệt migration',
  'Visual Migration Timeline': 'Dòng thời gian migration',
  'Update Database': 'Cập nhật cơ sở dữ liệu',
  'Check Model': 'Kiểm tra model',
  'Check Pending Model Changes': 'Kiểm tra thay đổi model',
  'DbContext Info': 'Thông tin DbContext',
  'Generate SQL': 'Tạo SQL',
  'Generate SQL Script': 'Tạo SQL migration',
  'Migration Bundle': 'Gói migration',
  'Create Migration Bundle': 'Tạo gói migration',
  'Optimize DbContext': 'Tối ưu DbContext',
  'Drop Database': 'Xóa cơ sở dữ liệu',
  'Capture the current model changes in a new migration.':
    'Ghi nhận các thay đổi model hiện tại vào một migration mới.',
  'Create an empty migration boilerplate instantly without running dotnet ef.':
    'Khởi tạo file migration rỗng tức thì mà không cần chạy dotnet ef.',
  'Remove the most recent migration from the project.':
    'Xóa migration mới nhất khỏi project.',
  'Inspect migration history for the selected DbContext.':
    'Xem lịch sử migration của DbContext đang chọn.',
  'Bring the target database to a selected migration.':
    'Đưa cơ sở dữ liệu đích tới migration đã chọn.',
  'Verify whether the model needs a new migration.':
    'Kiểm tra model hiện tại có cần migration mới hay không.',
  'Inspect provider and database details for this DbContext.':
    'Xem provider và thông tin cơ sở dữ liệu của DbContext.',
  'Generate a reviewable SQL migration script.':
    'Tạo SQL migration để kiểm tra hoặc triển khai.',
  'Create a deployable migration executable.':
    'Tạo file thực thi migration để triển khai.',
  'Generate a compiled model for faster startup.':
    'Tạo compiled model giúp ứng dụng khởi động nhanh hơn.',
  'Permanently delete the selected database.':
    'Xóa vĩnh viễn cơ sở dữ liệu đang chọn.',
  'Configure and run this EF Core operation.': 'Cấu hình và chạy thao tác EF Core này.',
  'Project': 'Project',
  'Runtime': 'Phiên bản',
  'Active EF Core target': 'Đích EF Core hiện tại',
  'EF Core tools': 'Công cụ EF Core',
  'Refresh': 'Làm mới',
  'Output': 'Kết quả',
  'Settings': 'Cài đặt',
  'Rescan projects, DbContexts and migrations': 'Quét lại project, DbContext và migration',
  'Refresh EF Core projects': 'Làm mới các project EF Core',
  'Show DotNav EF Core output': 'Hiển thị kết quả DotNav EF Core',
  'Show EF Core output': 'Hiển thị kết quả EF Core',
  'Install or update dotnet-ef': 'Cài đặt hoặc cập nhật dotnet-ef',
  'Manage dotnet-ef tool': 'Quản lý công cụ dotnet-ef',
  'Open EF Core settings': 'Mở cài đặt EF Core',
  'Configuration': 'Cấu hình',
  'Review the execution target before running': 'Kiểm tra đích thực thi trước khi chạy',
  'Advanced options': 'Tùy chọn nâng cao',
  'Generated command': 'Lệnh được tạo',
  'Inspect the exact dotnet ef command before execution':
    'Kiểm tra chính xác lệnh dotnet ef trước khi thực thi',
  'Copy generated command': 'Sao chép lệnh được tạo',
  'Press Enter to run · Esc to cancel': 'Nhấn Enter để chạy · Esc để hủy',
  'Cancel': 'Hủy',
  'Create': 'Tạo',
  'Create Migration': 'Tạo migration',
  'Remove': 'Xóa',
  'Update': 'Cập nhật',
  'Generate': 'Tạo SQL',
  'Read Info': 'Đọc thông tin',
  'Open Migration Browser': 'Mở danh sách migration',
  'Create Bundle': 'Tạo bundle',
  'Generate Optimized Model': 'Tạo model tối ưu',
  'Choose...': 'Chọn...',
  'Check database': 'Kiểm tra database',
  'Identify database': 'Xác định database',
  'Show': 'Hiện',
  'Hide': 'Ẩn',
  'Show value': 'Hiển thị giá trị',
  'Hide value': 'Ẩn giá trị',
  'No entries found': 'Không tìm thấy dữ liệu',
  'No match': 'Không có kết quả phù hợp',
  'How to use': 'Hướng dẫn sử dụng',
  'Guide': 'Hướng dẫn',
  'Open feature guide': 'Mở hướng dẫn tính năng',
  'Close guide': 'Đóng hướng dẫn',
  'Language': 'Ngôn ngữ',
  'Validate configuration': 'Kiểm tra cấu hình',
  'Prepare dotnet-ef': 'Chuẩn bị dotnet-ef',
  'Build, connect, and execute': 'Build, kết nối và thực thi',
  'Build and execute EF Core command': 'Build và thực thi lệnh EF Core',
  'Refresh changed files': 'Làm mới các file đã thay đổi',
  'Process command result': 'Xử lý kết quả lệnh',
  'EF Core is loading the project and connecting to the selected database.':
    'EF Core đang tải project và kết nối tới database đã chọn.',
  'EF Core is loading the selected project.': 'EF Core đang tải project đã chọn.',
  'The migrations project could not be resolved.': 'Không thể xác định project chứa migration.',
  'dotnet-ef is required to run this command.': 'Cần dotnet-ef để chạy lệnh này.',
  'Removing the last migration': 'Đang xóa migration cuối',
  'Updating database': 'Đang cập nhật database',
  'Checking applied migrations': 'Đang kiểm tra migration trên database',
  'Generating SQL script': 'Đang tạo SQL script',
  'Dropping the database': 'Đang xóa database',
  'Identifying the target database': 'Đang xác định database đích',
  'Reading DbContext info': 'Đang đọc thông tin DbContext',
  'Checking the EF Core model': 'Đang kiểm tra EF Core model',
  'Creating migration bundle': 'Đang tạo migration bundle',
  'Optimizing DbContext': 'Đang tối ưu DbContext',
  'e.g. AddOrders': 'ví dụ: AddOrders',
  'What this does': 'Chức năng',
  'When to use it': 'Khi nào nên sử dụng',
  'Before you run': 'Trước khi chạy',
  'Field guide': 'Hướng dẫn các field',
  'Expected result': 'Kết quả mong đợi',
  'Safety note': 'Lưu ý an toàn',
  'Required': 'Bắt buộc',
  'Optional': 'Tùy chọn',
  'Example': 'Ví dụ',
  'Migration name': 'Tên migration',
  'Migrations project': 'Project chứa migration',
  'Startup project': 'Project khởi động',
  'Connection string': 'Chuỗi kết nối',
  'Skip build (--no-build)': 'Bỏ qua build (--no-build)',
  'Additional arguments': 'Tham số bổ sung',
  'Force removal even if applied (--force)': 'Buộc xóa kể cả khi đã apply (--force)',
  'Remove without connecting to the database (--offline)':
    'Xóa mà không kết nối cơ sở dữ liệu (--offline)',
  'Target migration': 'Migration đích',
  'Create and apply a migration for pending model changes (--add)':
    'Tạo và apply migration cho các thay đổi model đang chờ (--add)',
  'New migration output directory': 'Thư mục output của migration mới',
  'New migration namespace': 'Namespace của migration mới',
  'From migration (exclusive)': 'Migration bắt đầu (không bao gồm)',
  'To migration (inclusive)': 'Migration kết thúc (có bao gồm)',
  'Idempotent script (--idempotent)': 'Script idempotent (--idempotent)',
  'Output file': 'Tệp đầu ra',
  'Database name confirmation': 'Xác nhận tên database',
  'Overwrite an existing bundle (--force)': 'Ghi đè bundle hiện có (--force)',
  'Include the .NET runtime (--self-contained)': 'Đóng gói kèm .NET runtime (--self-contained)',
  'Target runtime': 'Runtime đích',
  'Output directory': 'Thư mục output',
  'Namespace': 'Namespace',
  'Generated file suffix': 'Hậu tố file được tạo',
  'Use an existing compiled model (--no-scaffold)': 'Dùng compiled model hiện có (--no-scaffold)',
  'Generate precompiled queries (--precompile-queries)':
    'Tạo truy vấn biên dịch sẵn (--precompile-queries)',
  'Generate NativeAOT support (--nativeaot)': 'Tạo hỗ trợ NativeAOT (--nativeaot)',
  'Leave empty to use the startup project configuration':
    'Để trống để dùng cấu hình của startup project',
  'Overrides the connection resolved from appsettings. Accepts Name=ConnectionStrings:Something too.':
    'Ghi đè kết nối đọc từ appsettings. Cũng hỗ trợ Name=ConnectionStrings:Something.',
  'Much faster, but requires the project to already be built.':
    'Nhanh hơn, nhưng project phải được build trước.',
  'No DbContext class was found in this project by source scan.':
    'Không tìm thấy lớp DbContext trong project khi quét source.',
  'Leave empty for the latest migration': 'Để trống để dùng migration mới nhất',
  'Enter 0 to revert every migration.': 'Nhập 0 để rollback toàn bộ migration.',
  'EF Core 11+. Target migration becomes the new migration name.':
    'Yêu cầu EF Core 11+. Migration đích sẽ trở thành tên migration mới.',
  'Leave empty to start from an empty database':
    'Để trống để bắt đầu từ database rỗng',
  'Safe to run against a database at any migration.':
    'Có thể chạy trên database đang ở bất kỳ migration nào.',
  'Leave empty to open an unsaved SQL editor':
    'Để trống để mở SQL trong editor chưa lưu',
  'Identify the database first': 'Hãy xác định database trước',
  'Leave empty to let EF Core choose': 'Để trống để EF Core tự chọn',
  'This removes the most recent migration in the selected project.\nIf it has already been applied to a database, roll the database back first or the schema and code go out of sync.':
    'Thao tác này xóa migration mới nhất trong project đã chọn.\nNếu migration đã được apply, hãy rollback database trước để tránh schema và source code lệch nhau.',
  'Applying or reverting migrations changes the target database. Reverting can drop data.':
    'Apply hoặc rollback migration sẽ thay đổi database đích. Rollback có thể làm mất dữ liệu.',
  'This deletes the entire database for the selected DbContext. THIS CANNOT BE UNDONE.\nIdentify the target database first, then type its name exactly to enable the button.':
    'Thao tác này xóa toàn bộ database của DbContext đã chọn và KHÔNG THỂ HOÀN TÁC.\nHãy xác định database đích, sau đó nhập chính xác tên database để bật nút xóa.',
  'Reading DbContext info builds the project and resolves the configured connection.':
    'Đọc thông tin DbContext sẽ build project và phân giải kết nối đã cấu hình.',
  'This builds the selected projects but does not connect to or modify a database.':
    'Thao tác này build các project đã chọn nhưng không kết nối hoặc thay đổi database.',
  'This generates compiled model source files in the migrations project.':
    'Thao tác này tạo source code compiled model trong project migration.'
};

export function localized(en: string, vi: string): LocalizedText {
  return { en, vi };
}

export function localizeEfText(text: string, locale: EfLocale): string {
  return locale === 'vi' ? vietnamese[text] ?? text : text;
}

export function localizedEfText(text: string): LocalizedText {
  return localized(text, vietnamese[text] ?? text);
}

export function hasVietnameseTranslation(text: string): boolean {
  return Object.prototype.hasOwnProperty.call(vietnamese, text);
}
