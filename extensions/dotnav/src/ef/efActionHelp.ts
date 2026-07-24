import { LocalizedText, localized } from './efDialogI18n';

export interface EfFieldHelp {
  readonly description: LocalizedText;
  readonly example?: LocalizedText;
}

export interface EfActionHelp {
  readonly purpose: LocalizedText;
  readonly whenToUse: readonly LocalizedText[];
  readonly prerequisites: readonly LocalizedText[];
  readonly fields: Readonly<Record<string, EfFieldHelp>>;
  readonly result: LocalizedText;
  readonly caution?: LocalizedText;
}

const commonFields: Readonly<Record<string, EfFieldHelp>> = {
  project: {
    description: localized(
      'The class library that owns the DbContext, migration files, and model snapshot.',
      'Class library chứa DbContext, các file migration và model snapshot.'
    ),
    example: localized('MyApp.Infrastructure', 'MyApp.Infrastructure')
  },
  startup: {
    description: localized(
      'The executable project EF Core builds to load configuration, dependency injection, and design-time services.',
      'Project thực thi mà EF Core build để tải cấu hình, dependency injection và design-time services.'
    ),
    example: localized('MyApp.Api', 'MyApp.Api')
  },
  context: {
    description: localized(
      'The DbContext this operation targets. Always verify it in solutions with more than one context.',
      'DbContext mà thao tác sẽ sử dụng. Luôn kiểm tra kỹ khi solution có nhiều DbContext.'
    ),
    example: localized('ApplicationDbContext', 'ApplicationDbContext')
  },
  connection: {
    description: localized(
      'Optional one-time connection override. It is kept only while the Center is open and is never saved by DotNav.',
      'Chuỗi kết nối ghi đè dùng một lần. DotNav chỉ giữ khi Center đang mở và không lưu lại.'
    ),
    example: localized(
      'Name=ConnectionStrings:Default or Server=...;Database=...',
      'Name=ConnectionStrings:Default hoặc Server=...;Database=...'
    )
  },
  configuration: {
    description: localized(
      'The MSBuild configuration used by dotnet ef.',
      'Cấu hình MSBuild được dotnet ef sử dụng.'
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
      'Optional arguments not already managed by this form. Shell operators and duplicate managed options are rejected.',
      'Các tham số bổ sung chưa được form quản lý. Shell operator và option trùng sẽ bị từ chối.'
    ),
    example: localized('--namespace MyApp.Data.Migrations', '--namespace MyApp.Data.Migrations')
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
      'Creates migration source files that describe the difference between the current EF model and the latest model snapshot.',
      'Tạo các file migration mô tả khác biệt giữa EF model hiện tại và model snapshot mới nhất.'
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
    fields: withCommon({
      force: {
        description: localized(
          'Forces removal when EF Core believes the migration may already be applied. Use only after verifying the database state.',
          'Buộc xóa khi EF Core cho rằng migration có thể đã được apply. Chỉ dùng sau khi xác minh trạng thái database.'
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
    fields: {
      project: commonFields.project,
      context: commonFields.context
    },
    result: localized(
      'DotNav opens a searchable migration picker. Select an item to open its source file or use its copy button.',
      'DotNav mở danh sách migration có tìm kiếm. Chọn một item để mở source hoặc dùng nút sao chép tên.'
    )
  },
  'dotnav.ef.updateDatabase': {
    purpose: localized(
      'Applies pending migrations or rolls the target database backward to a selected migration.',
      'Apply các migration đang chờ hoặc rollback database đích về migration đã chọn.'
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
    fields: withCommon({
      target: {
        description: localized(
          'Leave empty to apply through the latest migration. Select an older migration to roll back, or enter 0 to remove every migration.',
          'Để trống để apply tới migration mới nhất. Chọn migration cũ để rollback, hoặc nhập 0 để gỡ toàn bộ migration.'
        ),
        example: localized('20260724090000_AddOrders or 0', '20260724090000_AddOrders hoặc 0')
      },
      add: {
        description: localized(
          'EF Core 11+: creates a migration from pending model changes and applies it in one operation.',
          'EF Core 11+: tạo migration từ các thay đổi model đang chờ và apply trong một thao tác.'
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
      'This operation changes the database. Rolling back can drop tables, columns, and data.',
      'Thao tác này thay đổi database. Rollback có thể xóa bảng, cột và dữ liệu.'
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
    fields: withCommon({}),
    result: localized(
      'DotNav reports either that the model is synchronized or that pending changes require a new migration.',
      'DotNav báo model đã đồng bộ hoặc còn thay đổi cần tạo migration mới.'
    ),
    caution: localized(
      'This builds the project but does not connect to or modify a database.',
      'Thao tác này build project nhưng không kết nối hoặc thay đổi database.'
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
    fields: withCommon({
      from: {
        description: localized(
          'The starting migration is exclusive: its SQL is not included. Leave empty to start from an empty database.',
          'Migration bắt đầu không được bao gồm trong SQL. Để trống để bắt đầu từ database rỗng.'
        ),
        example: localized('InitialCreate', 'InitialCreate')
      },
      to: {
        description: localized(
          'The ending migration is inclusive. Leave empty to generate through the latest migration.',
          'Migration kết thúc được bao gồm. Để trống để tạo SQL tới migration mới nhất.'
        ),
        example: localized('AddOrderStatus', 'AddOrderStatus')
      },
      idempotent: {
        description: localized(
          'Adds migration-history checks so one script can safely target databases currently at different migrations.',
          'Thêm kiểm tra lịch sử migration để một script có thể chạy an toàn trên các database đang ở migration khác nhau.'
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
      'Compiled model source files are generated in the selected output directory.',
      'Các file source compiled model được tạo trong thư mục output đã chọn.'
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
