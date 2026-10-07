import { LocalizedText, localized } from './efDialogI18n';

export interface EfFieldHelp {
  readonly description: LocalizedText;
  readonly example?: LocalizedText;
}

export interface EfActionHelp {
  readonly purpose: LocalizedText;
  readonly steps: readonly LocalizedText[];
  readonly whenToUse: readonly LocalizedText[];
  readonly prerequisites: readonly LocalizedText[];
  readonly fields: Readonly<Record<string, EfFieldHelp>>;
  readonly result: LocalizedText;
  readonly caution?: LocalizedText;
}

const commonFields: Readonly<Record<string, EfFieldHelp>> = {
  project: {
    description: localized(
      'Choose the project where EF reads or writes migration/model files. This can be your app or a separate library; it does not have to be the startup project.',
      'Chọn project chứa các file migration/model cần đọc hoặc tạo. Có thể là ứng dụng hoặc thư viện riêng, không nhất thiết trùng project khởi động.'
    ),
    example: localized('MyApp.Infrastructure', 'MyApp.Infrastructure')
  },
  startup: {
    description: localized(
      'Choose the project EF starts to load configuration and create the DbContext, usually your API or console app. It can be the same as the migrations project.',
      'Chọn project EF chạy để đọc cấu hình và tạo DbContext, thường là API hoặc console app. Có thể chọn cùng project chứa migration.'
    ),
    example: localized('MyApp.Api', 'MyApp.Api')
  },
  context: {
    description: localized(
      'DbContext is the C# class that defines which entities and database settings EF uses. Choose the one whose migrations you want to work with.',
      'DbContext là lớp C# xác định các entity và cấu hình database mà EF dùng. Chọn đúng DbContext có migration bạn muốn thao tác.'
    ),
    example: localized('ApplicationDbContext', 'ApplicationDbContext')
  },
  connection: {
    description: localized(
      'Leave empty to use the app connection; fill this to target another database. DotNav does not save it to project/settings files. Test Connection checks reachability, not login permissions or applied migrations.',
      'Để trống để dùng kết nối ứng dụng; nhập để chọn database khác. DotNav không ghi vào project/settings. Thử kết nối (Test Connection) chỉ kiểm tra khả năng truy cập, không xác minh đăng nhập hay migration đã áp dụng.'
    ),
    example: localized(
      'Name=ConnectionStrings:Default or Server=...;Database=...',
      'Name=ConnectionStrings:Default hoặc Server=...;Database=...'
    )
  },
  configuration: {
    description: localized(
      'Choose how to build the project, usually Debug for local work. Debug/Release is a build configuration, not the ASP.NET Core environment or database selection.',
      'Chọn cấu hình build, thường dùng Debug khi làm việc local. Debug/Release không phải môi trường ASP.NET Core và không tự chọn database.'
    ),
    example: localized('Debug or Release', 'Debug hoặc Release')
  },
  noBuild: {
    description: localized(
      'Skips compilation for faster execution. Use it only when the selected projects were already built after the latest source change.',
      'Bỏ qua compile để chạy nhanh hơn. Chỉ dùng khi các project đã được build sau thay đổi source gần nhất.'
    )
  },
  extraArgs: {
    description: localized(
      'Leave empty for normal use. Add supported dotnet ef options only when needed; use the form for project, context and connection instead of repeating those options.',
      'Thường để trống. Chỉ thêm option của dotnet ef khi cần; project, context và connection phải chọn bằng form, không nhập lại ở đây.'
    ),
    example: localized('--verbose', '--verbose')
  }
};

function withCommon(
  fields: Readonly<Record<string, EfFieldHelp>>
): Readonly<Record<string, EfFieldHelp>> {
  return { ...fields, ...commonFields };
}

export const EF_ACTION_HELP: Readonly<Record<string, EfActionHelp>> = {
  'dotnav.ef.addMigration': {
    purpose: localized(
      'A migration records a database-structure change in C# files. This action compares your entity mappings with the saved model snapshot and creates the next migration; it does not apply it.',
      'Migration ghi lại thay đổi cấu trúc database bằng file C#. Thao tác này so sánh cấu hình entity với bản model đã lưu (snapshot) để tạo migration mới, chưa cập nhật database.'
    ),
    whenToUse: [
      localized(
        'After adding, removing, or changing entities, properties, indexes, keys, or relationships.',
        'Sau khi thêm, xóa hoặc thay đổi entity, property, index, key hay relationship.'
      ),
      localized(
        'Before generating SQL or updating a database with those model changes.',
        'Trước khi tạo SQL hoặc cập nhật database với các thay đổi model đó.'
      )
    ],
    prerequisites: [
      localized(
        'The migrations project must reference Microsoft.EntityFrameworkCore.Design.',
        'Project migration phải tham chiếu Microsoft.EntityFrameworkCore.Design.'
      ),
      localized(
        'The startup project must be able to create the selected DbContext at design time.',
        'Startup project phải khởi tạo được DbContext đã chọn ở design time.'
      )
    ],
    steps: [
      localized(
        "Choose the migrations project, startup project and DbContext. Keep Skip build off after editing entities.",
        "Chọn project chứa migration, project khởi động và DbContext. Để tắt Skip build nếu vừa sửa entity."
      ),
      localized(
        "Enter a new descriptive name, such as AddOrderStatus. Click Create Migration.",
        "Nhập tên mới mô tả thay đổi, ví dụ AddOrderStatus. Bấm Tạo migration (Create Migration)."
      ),
      localized(
        "Read the generated Up (apply) and Down (undo) methods. Use Update Database later when you are ready to apply them.",
        "Đọc hàm Up (áp dụng) và Down (hoàn tác) được tạo. Khi đã kiểm tra xong, dùng Cập nhật cơ sở dữ liệu (Update Database) để áp dụng."
      )
    ],
    fields: withCommon({
      name: {
        description: localized(
          'A unique PascalCase name describing the schema change. Do not include spaces or a timestamp.',
          'Tên PascalCase duy nhất mô tả thay đổi schema. Không nhập khoảng trắng hoặc timestamp.'
        ),
        example: localized('AddOrderStatusIndex', 'AddOrderStatusIndex')
      }
    }),
    result: localized(
      'EF Core creates the migration, designer, and updated model snapshot files, then DotNav opens the new migration.',
      'EF Core tạo migration, file designer và cập nhật model snapshot; DotNav sẽ mở migration mới.'
    ),
    caution: localized(
      'Review the generated Up and Down methods before applying the migration to any database.',
      'Hãy kiểm tra kỹ các hàm Up và Down trước khi apply migration lên database.'
    )
  },
  'dotnav.ef.createEmptyMigration': {
    purpose: localized(
      'Creates empty migration files for changes you will write yourself, such as custom SQL or data updates. It does not discover entity changes or run dotnet ef.',
      'Tạo file migration rỗng để bạn tự viết thay đổi, như SQL riêng hoặc cập nhật dữ liệu. Thao tác này không tự tìm thay đổi entity và không chạy dotnet ef.'
    ),
    whenToUse: [localized('For a manual migration; use Add Migration for automatic entity/schema changes.', 'Dùng khi cần viết migration thủ công; dùng Add Migration nếu muốn tự sinh thay đổi từ entity.')],
    prerequisites: [localized('Know what code to write in Up and how to undo it in Down.', 'Biết nội dung cần viết trong Up và cách hoàn tác trong Down.')],
    steps: [
      localized('Choose project and DbContext, then enter a new migration name.', 'Chọn project và DbContext, rồi nhập tên migration mới.'),
      localized('Click Create. Write the required operations in Up and the reverse operations in Down.', 'Bấm Tạo (Create). Viết các thao tác trong Up và thao tác ngược lại trong Down.'),
      localized('Review and test your code before using Update Database to apply it.', 'Kiểm tra và thử code trước khi dùng Update Database để áp dụng.')
    ],
    fields: {
      project: commonFields.project,
      context: commonFields.context,
      name: { description: localized('A unique name for this manual change, without spaces or a timestamp.', 'Tên duy nhất mô tả thay đổi thủ công, không có khoảng trắng hoặc timestamp.'), example: localized('SeedMasterData', 'SeedMasterData') },
      startup: { description: localized('Not used by this source-only action; it does not build or start your application.', 'Thao tác chỉ tạo file này không dùng project khởi động, không build hoặc chạy ứng dụng.') },
      configuration: { description: localized('Not used; this action does not build.', 'Không dùng; thao tác này không build.') },
      noBuild: { description: localized('Not used; no build is performed regardless of this switch.', 'Không dùng; thao tác này không build dù bật hay tắt.') },
      extraArgs: { description: localized('Not used; this action does not run dotnet ef.', 'Không dùng; thao tác này không chạy dotnet ef.') }
    },
    result: localized('Empty migration and designer files are created and the migration opens for editing. The database is unchanged.', 'File migration rỗng và designer được tạo; migration mở để bạn sửa. Database chưa thay đổi.'),
    caution: localized('An empty migration does nothing until you fill it in. It is not a replacement for automatically capturing entity changes.', 'Migration rỗng chưa làm gì cho tới khi bạn điền code. Nó không thay thế việc tự sinh migration từ thay đổi entity.')
  },
  'dotnav.ef.removeLastMigration': {
    purpose: localized(
      'Removes the newest migration files and restores the model snapshot to its previous state.',
      'Xóa các file migration mới nhất và đưa model snapshot về trạng thái trước đó.'
    ),
    whenToUse: [
      localized(
        'When the latest migration is incorrect and has not been deployed.',
        'Khi migration mới nhất không đúng và chưa được triển khai.'
      )
    ],
    prerequisites: [
      localized(
        'If the migration was applied, roll the database back to the preceding migration first.',
        'Nếu migration đã được apply, hãy rollback database về migration trước đó trước.'
      )
    ],
    steps: [
      localized(
        "Choose the project and DbContext. Read the status to confirm exactly which last migration will be removed.",
        "Chọn project và DbContext. Đọc trạng thái để xác nhận chính xác migration cuối sẽ bị xóa."
      ),
      localized(
        "Normally keep Force and Offline off. If the migration was applied, roll the database back to the previous migration first.",
        "Thường để tắt Force và Offline. Nếu migration đã áp dụng, rollback database về migration trước đó trước."
      ),
      localized(
        "Click Remove. Inspect the changed migration files and snapshot in source control.",
        "Bấm Xóa (Remove). Kiểm tra các file migration và snapshot thay đổi trong Git."
      )
    ],
    fields: withCommon({
      force: {
        description: localized(
          'Can roll back the latest migration on the database as well as remove its files. If the database connection fails, EF may still remove only the files. Leave off unless you understand both effects.',
          'Có thể rollback migration cuối trên database rồi xóa file. Nếu kết nối database lỗi, EF vẫn có thể chỉ xóa file. Để tắt nếu bạn chưa hiểu rõ cả hai tác động.'
        )
      },
      offline: {
        description: localized(
          'EF Core 11+: removes the migration without connecting to a database. It cannot be combined with Force.',
          'EF Core 11+: xóa migration mà không kết nối database. Không thể dùng cùng Force.'
        )
      }
    }),
    result: localized(
      'The latest migration files are deleted and the snapshot is regenerated.',
      'Các file migration mới nhất bị xóa và snapshot được tạo lại.'
    ),
    caution: localized(
      'Removing an applied migration without rolling back first leaves the database schema and source code out of sync.',
      'Xóa migration đã apply mà chưa rollback sẽ khiến schema database và source code không đồng bộ.'
    )
  },
  'dotnav.ef.listMigrations': {
    purpose: localized(
      'Shows every migration discovered for the selected project and DbContext.',
      'Hiển thị toàn bộ migration tìm thấy cho project và DbContext đã chọn.'
    ),
    whenToUse: [
      localized(
        'To inspect migration order, open a migration file, or copy an exact migration name.',
        'Khi cần xem thứ tự, mở file hoặc sao chép chính xác tên migration.'
      )
    ],
    prerequisites: [
      localized(
        'Migration files must exist in the selected project.',
        'Project đã chọn phải có các file migration.'
      )
    ],
    steps: [
      localized(
        "Choose the project and DbContext whose migration history you want to read.",
        "Chọn project và DbContext có lịch sử migration cần xem."
      ),
      localized(
        "Click Open Migration Browser, then search by migration name.",
        "Bấm Mở danh sách migration (Open Migration Browser), rồi tìm theo tên."
      ),
      localized(
        "Select a row to choose an action. When opening Update Database or Generate SQL, check the target in that form before running.",
        "Chọn một dòng để chọn thao tác. Nếu mở Update Database hoặc Generate SQL, kiểm tra lại migration đích trong form trước khi chạy."
      )
    ],
    fields: {
      project: commonFields.project,
      context: commonFields.context
    },
    result: localized(
      'A searchable list opens. Select a migration to choose an action, or use its row buttons to open the file or copy its name. Browsing alone does not update the database.',
      'Danh sách có ô tìm kiếm sẽ mở. Chọn migration để xem các thao tác, hoặc dùng nút trên dòng để mở file/sao chép tên. Chỉ duyệt danh sách không cập nhật database.'
    )
  },
  'dotnav.ef.updateDatabase': {
    purpose: localized(
      'Changes the database structure to match a migration: applies missing changes or undoes later changes when you choose an older target.',
      'Đưa cấu trúc database tới một migration: áp dụng thay đổi còn thiếu, hoặc hoàn tác các thay đổi sau nó khi chọn đích cũ hơn.'
    ),
    whenToUse: [
      localized(
        'To update a local or development database after reviewing migrations.',
        'Khi cần cập nhật database local hoặc development sau khi đã review migration.'
      ),
      localized(
        'To roll back a database to a known migration during development.',
        'Khi cần rollback database về một migration xác định trong quá trình phát triển.'
      )
    ],
    prerequisites: [
      localized(
        'Verify the selected connection and use Check database before running.',
        'Kiểm tra kết nối đã chọn và dùng Kiểm tra database trước khi chạy.'
      ),
      localized(
        'Back up important data before any rollback.',
        'Sao lưu dữ liệu quan trọng trước mọi thao tác rollback.'
      )
    ],
    steps: [
      localized(
        "Choose project, startup project and DbContext. Leave Connection string empty to use app settings, or enter the intended database connection.",
        "Chọn project, project khởi động và DbContext. Để trống Chuỗi kết nối để dùng cấu hình ứng dụng, hoặc nhập kết nối tới database cần thao tác."
      ),
      localized(
        "For existing migrations, keep --add off if shown. Leave Target migration empty for latest, or select a target deliberately.",
        "Khi dùng migration đã có, để tắt --add nếu thấy tùy chọn này. Để trống Migration đích để tới bản mới nhất, hoặc chủ động chọn một bản đích."
      ),
      localized(
        "Click Check database. This reads applied migrations without applying them. Up to Date means no change is needed for the chosen target.",
        "Bấm Kiểm tra database (Check database). Nút này chỉ đọc migration đã áp dụng, chưa cập nhật. Up to Date nghĩa là không cần thay đổi để tới đích đã chọn."
      ),
      localized(
        "Review the Update/Apply/Revert label before clicking. If Check fails or cannot determine the state, inspect Output and the connection before deciding to run Update.",
        "Đọc nhãn Cập nhật/Apply/Revert trước khi bấm. Nếu Check lỗi hoặc chưa xác định được trạng thái, xem Output và kết nối trước khi quyết định chạy Update."
      )
    ],
    fields: withCommon({
      target: {
        description: localized(
          'Normally leave empty to apply all pending migrations. Choosing an earlier migration reverts every later applied migration; 0 reverts all. With --add enabled, enter a new migration name instead.',
          'Thường để trống để áp dụng các migration còn thiếu. Chọn migration cũ sẽ rollback các migration đã áp dụng sau nó; 0 rollback tất cả. Khi bật --add, ô này là tên migration mới.'
        ),
        example: localized('AddOrders or 0', 'AddOrders hoặc 0')
      },
      add: {
        description: localized(
          'EF Core 11+: creates and applies a new migration in one run. You must enter a unique new name in Target migration; turn this off to apply existing migrations.',
          'EF Core 11+: tạo và áp dụng migration mới trong một lần chạy. Phải nhập tên mới, không trùng, vào Target migration; tắt để áp dụng migration đã có.'
        )
      },
      outputDir: {
        description: localized(
          'Optional output folder used only when Create and apply is enabled.',
          'Thư mục output tùy chọn, chỉ dùng khi bật Tạo và apply.'
        ),
        example: localized('Migrations/Products', 'Migrations/Products')
      },
      namespace: {
        description: localized(
          'Optional namespace for the migration created by the Add operation.',
          'Namespace tùy chọn cho migration được tạo bởi thao tác Add.'
        ),
        example: localized('MyApp.Migrations', 'MyApp.Migrations')
      }
    }),
    result: localized(
      'The database schema is moved to the requested migration and the output reports every applied or reverted step.',
      'Schema database được đưa tới migration yêu cầu và output hiển thị từng bước apply hoặc rollback.'
    ),
    caution: localized(
      'This changes the database. Rollback can drop tables, columns and data. Cancel stops the command but does not undo completed changes; run Check database again afterwards.',
      'Thao tác này thay đổi database. Rollback có thể xóa bảng, cột và dữ liệu. Hủy chỉ dừng lệnh, không hoàn tác phần đã chạy; hãy dùng Check database để kiểm tra lại.'
    )
  },
  'dotnav.ef.pendingModelChanges': {
    purpose: localized(
      'Checks whether the current EF model differs from the latest model snapshot.',
      'Kiểm tra EF model hiện tại có khác model snapshot mới nhất hay không.'
    ),
    whenToUse: [
      localized(
        'Before committing or deploying to confirm that no migration was forgotten.',
        'Trước khi commit hoặc deploy để chắc chắn không bỏ sót migration.'
      )
    ],
    prerequisites: [
      localized(
        'Requires EF Core 8 or newer and a project that builds successfully.',
        'Yêu cầu EF Core 8 trở lên và project build thành công.'
      )
    ],
    steps: [
      localized(
        "Choose the migrations project, startup project and DbContext after saving your entity changes.",
        "Lưu các thay đổi entity, rồi chọn project chứa migration, project khởi động và DbContext."
      ),
      localized(
        "Click Check Model and read the result or Output.",
        "Bấm Kiểm tra model (Check Model) và đọc kết quả hoặc Output."
      ),
      localized(
        "If changes are pending, use Add Migration. If the model is synchronized, this check alone does not mean the database is up to date.",
        "Nếu còn thay đổi, dùng Thêm migration (Add Migration). Nếu model đã đồng bộ, kết quả này chưa khẳng định database đã được cập nhật."
      )
    ],
    fields: withCommon({}),
    result: localized(
      'DotNav reports either that the model is synchronized or that pending changes require a new migration.',
      'DotNav báo model đã đồng bộ hoặc còn thay đổi cần tạo migration mới.'
    ),
    caution: localized(
      'This compares model definitions, not the migrations applied to a database. Use Check database in Update Database to inspect applied migrations. It does not apply schema changes.',
      'Đây là kiểm tra định nghĩa model, không phải migration đã áp dụng trên database. Muốn kiểm tra migration đã áp dụng, dùng Check database trong Update Database. Thao tác này không áp dụng thay đổi schema.'
    )
  },
  'dotnav.ef.dbContextInfo': {
    purpose: localized(
      'Asks EF Core for the selected DbContext provider, database name, and data source.',
      'Đọc provider, tên database và data source của DbContext đã chọn từ EF Core.'
    ),
    whenToUse: [
      localized(
        'To verify which database and provider EF Core will use before a database-changing action.',
        'Khi cần xác minh EF Core sẽ dùng database và provider nào trước thao tác thay đổi database.'
      )
    ],
    prerequisites: [
      localized(
        'The startup project configuration must allow the DbContext to be created at design time.',
        'Cấu hình startup project phải cho phép tạo DbContext ở design time.'
      )
    ],
    steps: [
      localized(
        "Choose the project, startup project and DbContext to inspect.",
        "Chọn project, project khởi động và DbContext cần xem."
      ),
      localized(
        "Click Read Info. Read the provider (for example SQL Server), database name and server/data source.",
        "Bấm Đọc thông tin (Read Info). Xem provider (ví dụ SQL Server), tên database và server/data source."
      ),
      localized(
        "Use these details to check app configuration; this action does not test login permissions or list applied migrations.",
        "Dùng thông tin này để đối chiếu cấu hình ứng dụng; thao tác này không kiểm tra quyền đăng nhập hoặc liệt kê migration đã áp dụng."
      )
    ],
    fields: withCommon({}),
    result: localized(
      'A result dialog shows the provider, database, and masked data source, with full details available in Output.',
      'Hộp thoại kết quả hiển thị provider, database và data source đã che thông tin nhạy cảm; chi tiết đầy đủ nằm trong Output.'
    )
  },
  'dotnav.ef.generateScript': {
    purpose: localized(
      'Generates SQL for a migration range without applying it to a database.',
      'Tạo SQL cho một khoảng migration mà không apply lên database.'
    ),
    whenToUse: [
      localized(
        'For code review, controlled production deployment, DBA approval, or release artifacts.',
        'Dùng cho code review, triển khai production có kiểm soát, DBA phê duyệt hoặc tạo release artifact.'
      )
    ],
    prerequisites: [
      localized(
        'The selected project and DbContext must contain the migrations in the requested range.',
        'Project và DbContext đã chọn phải chứa các migration trong khoảng yêu cầu.'
      )
    ],
    steps: [
      localized(
        "Choose the project, startup project and DbContext.",
        "Chọn project, project khởi động và DbContext."
      ),
      localized(
        "Choose From as the current database state and To as the desired state. Empty From means before the first migration; empty To means latest. A newer From than To generates rollback SQL.",
        "Chọn From là trạng thái database hiện tại, To là trạng thái muốn đạt tới. From trống là trước migration đầu; To trống là mới nhất. From mới hơn To sẽ tạo SQL rollback."
      ),
      localized(
        "Optionally choose an output file, then click Generate. Review the SQL before anyone runs it on a database.",
        "Có thể chọn file lưu, rồi bấm Tạo SQL (Generate). Kiểm tra SQL trước khi chạy lên database."
      )
    ],
    fields: withCommon({
      from: {
        description: localized(
          'The last migration already applied before running the script. Leave empty for a database with no migrations applied. For example, From AddOrders to Init undoes AddOrders using its Down method.',
          'Migration cuối đã áp dụng trước khi chạy script. Để trống nếu database chưa áp dụng migration nào. Ví dụ From AddOrders tới Init sẽ hoàn tác AddOrders bằng hàm Down của nó.'
        ),
        example: localized('InitialCreate', 'InitialCreate')
      },
      to: {
        description: localized(
          'The migration that should remain applied after the script. Leave empty for the latest. Init to AddOrders applies AddOrders.Up; AddOrders to Init keeps Init and reverts later migrations.',
          'Migration cần được giữ ở trạng thái đã áp dụng sau script. Để trống để tới mới nhất. Init tới AddOrders chạy AddOrders.Up; AddOrders tới Init giữ Init và rollback các migration sau nó.'
        ),
        example: localized('AddOrderStatus', 'AddOrderStatus')
      },
      idempotent: {
        description: localized(
          'Checks migration history before each change and skips migrations already applied. Provider support varies; review the SQL, target database and backup before executing it.',
          'Kiểm tra lịch sử trước mỗi thay đổi và bỏ qua migration đã áp dụng. Khả năng hỗ trợ tùy provider; vẫn cần kiểm tra SQL, database đích và bản sao lưu trước khi chạy.'
        )
      },
      output: {
        description: localized(
          'Choose a .sql file to save directly. Leave empty to open the generated SQL in an unsaved editor.',
          'Chọn file .sql để lưu trực tiếp. Để trống để mở SQL được tạo trong editor chưa lưu.'
        ),
        example: localized('artifacts/migration.sql', 'artifacts/migration.sql')
      }
    }),
    result: localized(
      'A SQL script is written to the selected file or opened in a new SQL editor.',
      'SQL script được lưu vào file đã chọn hoặc mở trong một SQL editor mới.'
    ),
    caution: localized(
      'Review generated SQL and test it against a representative backup before production deployment.',
      'Review SQL được tạo và thử trên bản sao dữ liệu đại diện trước khi triển khai production.'
    )
  },
  'dotnav.ef.migrationsBundle': {
    purpose: localized(
      'Builds a standalone executable that applies EF Core migrations without requiring the application source.',
      'Build một file thực thi có thể apply EF Core migration mà không cần source của ứng dụng.'
    ),
    whenToUse: [
      localized(
        'For CI/CD or environments where deploying a reviewed executable is preferred to running dotnet ef.',
        'Dùng trong CI/CD hoặc môi trường ưu tiên triển khai file thực thi đã review thay vì chạy dotnet ef.'
      )
    ],
    prerequisites: [
      localized(
        'Requires an EF Core version that supports migration bundles and a successful Release-compatible build.',
        'Yêu cầu phiên bản EF Core hỗ trợ migration bundle và project có thể build thành công.'
      )
    ],
    steps: [
      localized(
        "Choose the project, startup project and DbContext that contain the reviewed migrations.",
        "Chọn project, project khởi động và DbContext có các migration đã kiểm tra."
      ),
      localized(
        "Enter an output path. Choose a runtime such as linux-x64 if targeting another platform; enable Self-contained if that machine lacks .NET.",
        "Nhập đường dẫn output. Chọn runtime như linux-x64 nếu máy đích khác nền tảng; bật Self-contained nếu máy đó chưa cài .NET."
      ),
      localized(
        "Click Create Bundle. Building it does not apply migrations; running the resulting executable later can update a database.",
        "Bấm Tạo bundle (Create Bundle). Việc tạo file chưa áp dụng migration; chạy file thực thi đó sau này có thể cập nhật database."
      )
    ],
    fields: withCommon({
      output: {
        description: localized(
          'The path of the bundle executable to create.',
          'Đường dẫn file thực thi bundle sẽ được tạo.'
        ),
        example: localized('artifacts/efbundle or efbundle.exe', 'artifacts/efbundle hoặc efbundle.exe')
      },
      force: {
        description: localized(
          'Allows EF Core to overwrite an existing bundle at the output path.',
          'Cho phép EF Core ghi đè bundle hiện có tại đường dẫn output.'
        )
      },
      selfContained: {
        description: localized(
          'Includes the .NET runtime, producing a larger bundle that does not require a matching runtime on the target machine.',
          'Đóng gói kèm .NET runtime, tạo bundle lớn hơn nhưng máy đích không cần cài runtime tương ứng.'
        )
      },
      runtime: {
        description: localized(
          'Optional runtime identifier for the target operating system and architecture.',
          'Runtime identifier tùy chọn cho hệ điều hành và kiến trúc máy đích.'
        ),
        example: localized('linux-x64, win-x64, or osx-arm64', 'linux-x64, win-x64 hoặc osx-arm64')
      }
    }),
    result: localized(
      'The bundle executable is created at the output path and can be published as a deployment artifact.',
      'File thực thi bundle được tạo tại đường dẫn output và có thể dùng làm deployment artifact.'
    )
  },
  'dotnav.ef.optimizeDbContext': {
    purpose: localized(
      'Generates compiled model source to reduce EF Core model initialization time.',
      'Tạo source compiled model để giảm thời gian khởi tạo EF Core model.'
    ),
    whenToUse: [
      localized(
        'For applications with large models or startup-time requirements after measuring model initialization cost.',
        'Dùng cho ứng dụng có model lớn hoặc yêu cầu startup nhanh sau khi đã đo chi phí khởi tạo model.'
      )
    ],
    prerequisites: [
      localized(
        'Use only with a supported EF Core version and commit the generated source with the application.',
        'Chỉ dùng với phiên bản EF Core được hỗ trợ và commit source được tạo cùng ứng dụng.'
      )
    ],
    steps: [
      localized(
        "Choose project, startup project and DbContext. Keep advanced switches off for a basic compiled model.",
        "Chọn project, project khởi động và DbContext. Để tắt các tùy chọn nâng cao khi tạo compiled model cơ bản."
      ),
      localized(
        "Choose an output directory, such as CompiledModels, then click Generate Optimized Model.",
        "Chọn thư mục output, ví dụ CompiledModels, rồi bấm Tạo model tối ưu (Generate Optimized Model)."
      ),
      localized(
        "Follow EF output to configure UseModel(...) in your app. Rebuild and measure startup; regenerate whenever entity mappings change.",
        "Làm theo Output của EF để cấu hình UseModel(...) trong ứng dụng. Build lại và đo thời gian khởi động; tạo lại khi cấu hình entity thay đổi."
      )
    ],
    fields: withCommon({
      outputDir: {
        description: localized(
          'Folder in the migrations project where compiled model source files are generated.',
          'Thư mục trong project migration nơi các file source compiled model được tạo.'
        ),
        example: localized('CompiledModels', 'CompiledModels')
      },
      namespace: {
        description: localized(
          'Optional namespace for generated types. Leave empty to let EF Core select one.',
          'Namespace tùy chọn cho các type được tạo. Để trống để EF Core tự chọn.'
        )
      },
      suffix: {
        description: localized(
          'Optional suffix appended to generated file names.',
          'Hậu tố tùy chọn được thêm vào tên các file được tạo.'
        )
      },
      noScaffold: {
        description: localized(
          'Uses an existing compiled model instead of generating it again.',
          'Dùng compiled model hiện có thay vì tạo lại.'
        )
      },
      precompileQueries: {
        description: localized(
          'EF Core 9+: generates interceptors for queries that can be determined at build time.',
          'EF Core 9+: tạo interceptor cho các query có thể xác định ở build time.'
        )
      },
      nativeAot: {
        description: localized(
          'Generates additional code needed by NativeAOT deployments.',
          'Tạo code bổ sung cần thiết cho triển khai NativeAOT.'
        )
      }
    }),
    result: localized(
      'Generated files appear in the output directory. Follow the UseModel(...) setup reported by EF to use the compiled model; creating files alone does not activate it. With --no-scaffold, the existing model is not regenerated.',
      'Các file được tạo trong thư mục output. Làm theo cấu hình UseModel(...) mà EF hướng dẫn để dùng compiled model; chỉ tạo file chưa kích hoạt nó. Khi bật --no-scaffold, model cũ không được tạo lại.'
    ),
    caution: localized(
      'Regenerate the compiled model whenever entity mappings change.',
      'Phải tạo lại compiled model mỗi khi mapping entity thay đổi.'
    )
  },
  'dotnav.ef.dropDatabase': {
    purpose: localized(
      'Permanently deletes the entire database resolved for the selected DbContext.',
      'Xóa vĩnh viễn toàn bộ database được phân giải cho DbContext đã chọn.'
    ),
    whenToUse: [
      localized(
        'Only to reset disposable local, development, or test databases.',
        'Chỉ dùng để reset database local, development hoặc test có thể xóa bỏ.'
      )
    ],
    prerequisites: [
      localized(
        'Use Identify database and verify the returned server and database name.',
        'Dùng Xác định database và kiểm tra server cùng tên database trả về.'
      ),
      localized(
        'Create a backup if any data may be needed later.',
        'Tạo backup nếu có bất kỳ dữ liệu nào có thể cần dùng lại.'
      )
    ],
    steps: [
      localized(
        "Choose the project, startup project and DbContext. Verify the connection points to a disposable database.",
        "Chọn project, project khởi động và DbContext. Xác minh kết nối trỏ tới database có thể xóa bỏ."
      ),
      localized(
        "Click Identify database. Check both server and database name, then type the returned database name exactly in the confirmation field.",
        "Bấm Xác định database (Identify database). Kiểm tra cả server và tên database, rồi nhập đúng tên được trả về vào ô xác nhận."
      ),
      localized(
        "Click Drop Database only after confirming deletion is intended. Every table and all data in that database will be removed.",
        "Chỉ bấm Xóa cơ sở dữ liệu (Drop Database) sau khi đã xác nhận muốn xóa. Toàn bộ bảng và dữ liệu trong database đó sẽ bị xóa."
      )
    ],
    fields: withCommon({
      confirm: {
        description: localized(
          'After identifying the target, type its database name exactly. This prevents accidental submission against an unknown target.',
          'Sau khi xác định đích, nhập chính xác tên database. Cơ chế này ngăn việc vô tình submit khi chưa biết database đích.'
        ),
        example: localized('MyApp_Development', 'MyApp_Development')
      }
    }),
    result: localized(
      'EF Core drops the selected database and all of its schema and data.',
      'EF Core xóa database đã chọn cùng toàn bộ schema và dữ liệu.'
    ),
    caution: localized(
      'This cannot be undone. Never use it against production unless deletion is explicitly intended and independently verified.',
      'Không thể hoàn tác. Không bao giờ dùng với production nếu việc xóa chưa được chủ động yêu cầu và xác minh độc lập.'
    )
  }
};

export function actionHelpFor(actionId: string | undefined): EfActionHelp | undefined {
  return actionId ? EF_ACTION_HELP[actionId] : undefined;
}
