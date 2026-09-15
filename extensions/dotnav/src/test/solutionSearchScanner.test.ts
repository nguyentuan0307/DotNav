import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  isIgnoredSearchFile,
  isSupportedSolutionSearchFile,
  parseSymbolsFromAppSettings,
  parseSymbolsFromCSharp,
  UniversalSymbolIndex
} from '../solutionSearch/searchScanner';
import { DiskSymbolStore } from '../solutionSearch/searchDiskStore';

test('isIgnoredSearchFile ignores bin, obj, generated files and designer files', () => {
  assert.equal(isIgnoredSearchFile('/repo/src/bin/Debug/app.dll'), true);
  assert.equal(isIgnoredSearchFile('/repo/src/obj/Debug/net8.0/AssemblyInfo.cs'), true);
  assert.equal(isIgnoredSearchFile('/repo/src/Views/Main.Designer.cs'), true);
  assert.equal(isIgnoredSearchFile('/repo/src/Models/User.g.cs'), true);
  assert.equal(isIgnoredSearchFile('/repo/src/Migrations/AppDbContextModelSnapshot.cs'), true);
  assert.equal(isIgnoredSearchFile('/repo/src/Migrations/20260915_AddOrders.cs'), false);
  assert.equal(isIgnoredSearchFile('/repo/src/Models/User.cs'), false);
  assert.equal(isIgnoredSearchFile('/repo/src/Controllers/OrdersController.cs'), false);
});

test('isSupportedSolutionSearchFile only allows solution-relevant search files', () => {
  assert.equal(isSupportedSolutionSearchFile('/repo/src/Models/User.cs'), true);
  assert.equal(isSupportedSolutionSearchFile('/repo/src/App.csproj'), true);
  assert.equal(isSupportedSolutionSearchFile('/repo/src/Resources/Labels.resx'), true);
  assert.equal(isSupportedSolutionSearchFile('/repo/src/appsettings.production.json'), true);
  assert.equal(isSupportedSolutionSearchFile('/repo/src/AppSettings.json'), true);
  assert.equal(isSupportedSolutionSearchFile('/repo/src/appsettingsCustom.json'), true);

  assert.equal(isSupportedSolutionSearchFile('/repo/src/schema.sql'), false);
  assert.equal(isSupportedSolutionSearchFile('/repo/src/README.md'), false);
  assert.equal(isSupportedSolutionSearchFile('/repo/src/collector.yaml'), false);
  assert.equal(isSupportedSolutionSearchFile('/repo/src/service.proto'), false);
  assert.equal(isSupportedSolutionSearchFile('/repo/src/ocelot.json'), false);
  assert.equal(isSupportedSolutionSearchFile('/repo/src/Properties/launchSettings.json'), false);
  assert.equal(isSupportedSolutionSearchFile('/repo/src/Views/Main.Designer.cs'), false);
  assert.equal(isSupportedSolutionSearchFile('/repo/src/Migrations/AppDbContextModelSnapshot.cs'), false);
});

test('UniversalSymbolIndex rejects unsupported files at the scanner boundary', () => {
  const index = new UniversalSymbolIndex();
  assert.deepEqual(index.scanFileContent('/repo/schema.sql', 'CREATE TABLE Orders (Id int);', 'App', 'schema.sql'), []);
  assert.deepEqual(index.scanFileContent('/repo/README.md', '# Orders', 'App', 'README.md'), []);
  assert.deepEqual(index.scanFileContent('/repo/ocelot.json', '{"Routes":[]}', 'App', 'ocelot.json'), []);
  assert.equal(index.getFilePaths().length, 0);

  const appSettingsSymbols = index.scanFileContent(
    '/repo/appsettings.production.json',
    '{"ConnectionStrings":{"Main":"Host=localhost"}}',
    'App',
    'appsettings.production.json'
  );
  assert.ok(appSettingsSymbols.length > 0);
});

test('UniversalSymbolIndex rejects unsupported files during cache hydration', () => {
  const index = new UniversalSymbolIndex();
  index.beginSnapshotLoad();
  index.loadSnapshotFile('/repo/schema.sql', 1, [{
    id: 'sql-table',
    name: 'Orders',
    kind: 'db_table',
    filePath: '/repo/schema.sql',
    relativePath: 'schema.sql',
    projectName: 'App',
    line: 1,
    column: 1
  }]);
  index.finishSnapshotLoad();

  assert.equal(index.count, 0);
  assert.deepEqual(index.getFilePaths(), []);
});

test('parseSymbolsFromCSharp parses CQRS Commands, Handlers, Events and Queries', () => {
  const code = `
namespace ELDesk.Work.Commands;

public record CreateOrderCommand(int CustomerId, decimal Total) : IRequest<int>;

public class CreateOrderCommandHandler : IRequestHandler<CreateOrderCommand, int> {
    public async Task<int> Handle(CreateOrderCommand request, CancellationToken cancellationToken) {
        return 1;
    }
}

public class OrderCreatedEvent : INotification {
    public int OrderId { get; init; }
}

public class GetOrderByIdQuery : IRequest<OrderDto> {
    public int Id { get; init; }
}
`;

  const symbols = parseSymbolsFromCSharp(code, '/src/Commands/CreateOrder.cs', 'ELDesk.Work', 'Commands/CreateOrder.cs');
  assert.equal(symbols.some(s => s.name === 'CreateOrderCommand' && s.kind === 'cqrs_command'), true);
  assert.equal(symbols.some(s => s.name === 'CreateOrderCommandHandler' && s.kind === 'cqrs_handler'), true);
  assert.equal(symbols.some(s => s.name === 'OrderCreatedEvent' && s.kind === 'cqrs_event'), true);
  assert.equal(symbols.some(s => s.name === 'GetOrderByIdQuery' && s.kind === 'cqrs_query'), true);
});

test('parseSymbolsFromCSharp parses EF Core DbSets, Migrations, Enums and Methods', () => {
  const code = `
namespace ELDesk.Data;

public class AppDbContext : DbContext {
    public DbSet<AppEntity> Apps { get; set; }
    public DbSet<FieldEntity> Fields { get; set; }
}

public enum FieldType {
    Text = 1,
    Number = 2,
    Formula = 3
}

public class FieldValidator {
    public bool ValidateFormulaExpressionValue(string formula, int appId) {
        return true;
    }
}

public class AddRowVersionTrigger : Migration {
    protected override void Up(MigrationBuilder migrationBuilder) {}
}
`;

  const symbols = parseSymbolsFromCSharp(code, '/src/Data/AppDbContext.cs', 'ELDesk.Data', 'Data/AppDbContext.cs');
  assert.equal(symbols.some(s => s.name.includes('DbSet<AppEntity>') && s.kind === 'ef_dbset'), true);
  assert.equal(symbols.some(s => s.name === 'FieldType' && s.kind === 'enum'), true);
  assert.equal(symbols.some(s => s.name === 'FieldType.Formula' && s.kind === 'enum_member'), true);
  assert.equal(symbols.some(s => s.name.includes('ValidateFormulaExpressionValue') && s.kind === 'method'), true);
  assert.equal(symbols.some(s => s.name === 'AddRowVersionTrigger' && s.kind === 'ef_migration'), true);
});

test('parseSymbolsFromAppSettings flattens json keys', () => {
  const json = JSON.stringify({
    ConnectionStrings: {
      DefaultConnection: "Server=localhost;Database=ELDesk;",
      Redis: "localhost:6379"
    },
    Jwt: {
      SecretKey: "supersecretkey"
    }
  });

  const symbols = parseSymbolsFromAppSettings(json, '/src/appsettings.json', 'ELDesk.Web', 'appsettings.json');
  assert.equal(symbols.length, 3);
  assert.equal(symbols.some(s => s.name === 'ConnectionStrings:DefaultConnection'), true);
  assert.equal(symbols.some(s => s.name === 'Jwt:SecretKey'), true);
});

test('UniversalSymbolIndex handles incremental updates and full scan tracking', () => {
  const index = new UniversalSymbolIndex();
  assert.equal(index.isFullScanCompleted, false);

  index.scanFileContent('/src/User.cs', 'public class User {}', 'MyProject', 'User.cs');
  assert.equal(index.count, 2); // Class and File
  assert.equal(index.fileCount, 1);

  index.markFullScanCompleted();
  assert.equal(index.isFullScanCompleted, true);

  index.invalidateFile('/src/User.cs');
  assert.equal(index.count, 0);

  index.clear();
  assert.equal(index.isFullScanCompleted, false);
});

test('UniversalSymbolIndex does not parse ModelSnapshot content but keeps migration source searchable', () => {
  const index = new UniversalSymbolIndex();
  const snapshotSymbols = index.scanFileContent(
    '/src/Migrations/AppDbContextModelSnapshot.cs',
    'public class ExpensiveSnapshot { public void BuildModel() {} }',
    'App',
    'Migrations/AppDbContextModelSnapshot.cs'
  );
  const migrationSymbols = index.scanFileContent(
    '/src/Migrations/20260915_AddOrders.cs',
    'public class AddOrders : Migration { protected override void Up(MigrationBuilder builder) {} }',
    'App',
    'Migrations/20260915_AddOrders.cs'
  );

  assert.equal(snapshotSymbols.length, 0);
  assert.equal(index.hasFile('/src/Migrations/AppDbContextModelSnapshot.cs'), false);
  assert.ok(migrationSymbols.some(symbol => symbol.name === 'AddOrders' && symbol.kind === 'ef_migration'));
});

test('extractIndexTokens and internString optimize candidate lookups and memory', () => {
  const { extractIndexTokens, internString } = require('../solutionSearch/searchScanner');
  
  const s1 = internString('ELDesk.CustomApp');
  const s2 = internString('ELDesk.CustomApp');
  assert.strictEqual(s1, s2); // Reuses exact string reference

  const sym = {
    id: '1',
    name: 'UpdateRecordFieldValueAsync(...)',
    kind: 'method',
    filePath: '/src/Service.cs',
    relativePath: 'Service.cs',
    projectName: 'ELDesk.CustomApp',
    line: 10,
    column: 1
  };

  const tokens = extractIndexTokens(sym);
  assert.ok(tokens.includes('update'));
  assert.ok(tokens.includes('record'));
  assert.ok(tokens.includes('field'));
  assert.ok(tokens.includes('value'));
  assert.ok(tokens.includes('async'));
  assert.ok(tokens.includes('urfva')); // Acronym U-R-F-V-A

  const index = new UniversalSymbolIndex();
  index.scanFileContent(
    '/src/Service.cs',
    'public class WebService {\n    private async Task UpdateRecordFieldValueAsync() {}\n}',
    'ELDesk.CustomApp',
    'Service.cs'
  );
  
  const candidates = index.getCandidates('all', ['updaterecordfieldvalueasync']);
  assert.ok(candidates.length >= 1);
  assert.ok(candidates.some(s => s.name.includes('UpdateRecordFieldValueAsync')));
});

test('UniversalSymbolIndex snapshot uses v8 without cold-store duplication', () => {
  const store = new DiskSymbolStore();
  const index = new UniversalSymbolIndex();
  index.setDiskStore(store);
  index.scanFileContent(
    '/src/SubmitService.cs',
    'public class SubmitService {\n    public void ProcessOrder() {}\n}',
    'ELDesk.Sales',
    'SubmitService.cs',
    1700000000000
  );

  assert.equal(index.count, 2); // Class and File in RAM (Method is in cold store)
  assert.equal(index.getFileTimestamp('/src/SubmitService.cs'), 1700000000000);
  assert.equal(store.coldSymbolCount, 1); // ProcessOrder is in cold store

  const snapshot = index.exportSnapshot();
  assert.equal(snapshot.version, 8);
  assert.equal(snapshot.fileTimestamps['/src/SubmitService.cs'], 1700000000000);
  assert.ok(snapshot.symbolsByFile['/src/SubmitService.cs']);
  assert.equal(snapshot.coldSymbolsByFile, undefined);

  const restoredStore = new DiskSymbolStore();
  const restoredIndex = new UniversalSymbolIndex();
  restoredIndex.setDiskStore(restoredStore);
  restoredIndex.loadSnapshot(snapshot);

  assert.equal(restoredIndex.count, 2);
  assert.equal(restoredIndex.getFileTimestamp('/src/SubmitService.cs'), 1700000000000);
  assert.equal(restoredStore.coldSymbolCount, 0);

  store.clear();
  restoredStore.clear();
});

test('DiskSymbolStore tracks files with no cold symbols and removes invalidated files', () => {
  const store = new DiskSymbolStore();
  const index = new UniversalSymbolIndex();
  index.setDiskStore(store);

  index.scanFileContent('/src/Marker.cs', 'public class Marker {}', 'App', 'Marker.cs');
  assert.equal(store.hasFile('/src/Marker.cs'), true);

  index.invalidateFile('/src/Marker.cs');
  assert.equal(store.hasFile('/src/Marker.cs'), false);
  store.clear();
});

test('CQRS Flow Builder traces Command -> Handler -> Domain Event -> Listener flow', () => {
  const index = new UniversalSymbolIndex();

  const commandCode = `
namespace ELDesk.CustomApp.Commands
{
    public class AddAppFieldCommand : IRequest<Guid>
    {
        public int AppId { get; set; }
    }
}`;

  const handlerCode = `
namespace ELDesk.CustomApp.Handlers
{
    public class AddAppFieldCommandHandler : IRequestHandler<AddAppFieldCommand, Guid>
    {
        public async Task<Guid> Handle(AddAppFieldCommand request, CancellationToken ct)
        {
            var evt = new AppFieldAddedDomainEvent(request.AppId);
            return Guid.NewGuid();
        }
    }
}`;

  const eventCode = `
namespace ELDesk.CustomApp.Events
{
    public class AppFieldAddedDomainEvent : INotification
    {
        public int AppId { get; set; }
    }
}`;

  const listenerCode = `
namespace ELDesk.CustomApp.DomainEventHandlers
{
    public class AppFieldAddedDomainEventHandler : INotificationHandler<AppFieldAddedDomainEvent>
    {
        public async Task Handle(AppFieldAddedDomainEvent notification, CancellationToken ct) {}
    }
}`;

  index.scanFileContent('/src/AddAppFieldCommand.cs', commandCode, 'ELDesk.CustomApp', 'Commands/AddAppFieldCommand.cs');
  index.scanFileContent('/src/AddAppFieldCommandHandler.cs', handlerCode, 'ELDesk.CustomApp.AppCore', 'Handlers/AddAppFieldCommandHandler.cs');
  index.scanFileContent('/src/AppFieldAddedDomainEvent.cs', eventCode, 'ELDesk.CustomApp.SharedDomain', 'Events/AppFieldAddedDomainEvent.cs');
  index.scanFileContent('/src/AppFieldAddedDomainEventHandler.cs', listenerCode, 'ELDesk.CustomApp.AppCore', 'DomainEventHandlers/AppFieldAddedDomainEventHandler.cs');
  index.markFullScanCompleted();

  const { buildCqrsFlow } = require('../solutionSearch/searchScanner');
  const flow = buildCqrsFlow('AddAppField', index);

  assert.ok(flow);
  assert.equal(flow.rootNoun, 'AppField');
  assert.equal(flow.nodes.length, 4);

  assert.equal(flow.nodes[0].category, '1. Request / Command');
  assert.equal(flow.nodes[0].symbol.name, 'AddAppFieldCommand');

  assert.equal(flow.nodes[1].category, '2. Command Handler');
  assert.equal(flow.nodes[1].symbol.name, 'AddAppFieldCommandHandler');
  assert.equal(flow.nodes[1].symbol.metadata.handledType, 'AddAppFieldCommand');

  assert.equal(flow.nodes[2].category, '3. Domain Event');
  assert.equal(flow.nodes[2].symbol.name, 'AppFieldAddedDomainEvent');

  assert.equal(flow.nodes[3].category, '4. Event Listener');
  assert.equal(flow.nodes[3].symbol.name, 'AppFieldAddedDomainEventHandler');
  assert.equal(flow.nodes[3].symbol.metadata.handledType, 'AppFieldAddedDomainEvent');
});

test('detectActiveCqrsContext correctly extracts symbol from URI or Mock Editor', () => {
  const { detectActiveCqrsContext } = require('../solutionSearch/searchScanner');

  // Test 1: From Uri object
  const mockUri = { fsPath: '/path/to/DataEntityCreatedDomainEvent.cs' };
  assert.equal(detectActiveCqrsContext(mockUri), 'DataEntityCreatedDomainEvent');

  // Test 2: From Mock Active Editor with class definition
  const mockEditor = {
    document: {
      fileName: '/src/SomeFile.cs',
      getText: (range?: any) => range ? '' : 'public class DataEntityCreatedDomainEvent : INotification {}',
      getWordRangeAtPosition: () => undefined
    },
    selection: { isEmpty: true, active: {} }
  };
  assert.equal(detectActiveCqrsContext(undefined, mockEditor as any), 'DataEntityCreatedDomainEvent');

  // Test 3: From UniversalSymbol
  const mockSym = { name: 'AddAppFieldCommandHandler', kind: 'cqrs_handler' };
  assert.equal(detectActiveCqrsContext(mockSym), 'AddAppFieldCommandHandler');
});

test('Wide-Scope Search parses Constructors, DI, Database Tables, Background Jobs, and Multi-files', () => {
  const {
    parseSymbolsFromCSharp,
    parseSymbolsFromSql,
    parseSymbolsFromYaml,
    parseSymbolsFromProto,
    parseSymbolsFromMarkdown
  } = require('../solutionSearch/searchScanner');
  const { searchUniversalSymbols } = require('../solutionSearch/searchEngine');

  const csharpCode = `
public class DataEntityService : IDataEntityService
{
    private readonly IUnitOfWorkBase _unitOfWork;
    private readonly IAppFieldRepository _appFieldRepo;

    public DataEntityService(IUnitOfWorkBase unitOfWork, IAppFieldRepository appFieldRepo)
    {
        _unitOfWork = unitOfWork;
        _appFieldRepo = appFieldRepo;
    }

    public async Task CreateAsync(CreateDataEntityDto dto)
    {
        _backgroundJobManager.Enqueue<CreateDataEntityStorageContainerJob>(job => job.ExecuteAsync());
    }
}

public class Startup
{
    public void ConfigureServices(IServiceCollection services)
    {
        services.AddScoped<IDataEntityService, DataEntityService>();
    }
}

public class DataEntityConfiguration : IEntityTypeConfiguration<DataEntity>
{
    public void Configure(EntityTypeBuilder<DataEntity> builder)
    {
        builder.ToTable("DataEntities");
    }
}
`;

  const symbols = parseSymbolsFromCSharp(csharpCode, '/src/DataEntityService.cs', 'CustomApp', 'Services/DataEntityService.cs');
  
  // Verify Constructor & Injected params
  const ctorSym = symbols.find((s: any) => s.id.includes(':ctor:'));
  assert.ok(ctorSym);
  assert.ok(ctorSym.metadata.injectedParams.includes('IUnitOfWorkBase'));
  assert.ok(ctorSym.metadata.injectedParams.includes('IAppFieldRepository'));

  // Verify DI Registration
  const diSym = symbols.find((s: any) => s.kind === 'di_registration');
  assert.ok(diSym);
  assert.equal(diSym.name, 'AddScoped<IDataEntityService, DataEntityService>');

  // Verify Database Table
  const tableSym = symbols.find((s: any) => s.kind === 'db_table');
  assert.ok(tableSym);
  assert.equal(tableSym.name, 'Table: DataEntities');

  // Verify Background Job Enqueue
  const jobSym = symbols.find((s: any) => s.kind === 'background_job');
  assert.ok(jobSym);
  assert.equal(jobSym.name, 'Job: CreateDataEntityStorageContainerJob');

  // Verify SQL Parser
  const sqlCode = 'CREATE TABLE "AppFields" (Id INT PRIMARY KEY);\n\nCREATE PROCEDURE sp_ProcessOrders AS SELECT 1;';
  const sqlSyms = parseSymbolsFromSql(sqlCode, '/db/schema.sql', 'CustomApp', 'db/schema.sql');
  assert.equal(sqlSyms.length, 2);
  assert.equal(sqlSyms[0].name, 'TABLE AppFields');
  assert.equal(sqlSyms[1].name, 'PROCEDURE sp_ProcessOrders');
  assert.equal(sqlSyms[0].line, 1);
  assert.equal(sqlSyms[1].line, 3);

  // Verify YAML Parser
  const yamlCode = 'services:\n  customapp-api:\n    image: customapp:latest\n    environment:\n      ASPNETCORE_ENVIRONMENT: Development';
  const yamlSyms = parseSymbolsFromYaml(yamlCode, '/docker-compose.yml', 'Root', 'docker-compose.yml');
  assert.ok(yamlSyms.some((s: any) => s.name.includes('customapp-api')));

  // Verify Proto Parser
  const protoCode = 'service DataEntityService { rpc GetDataEntity (GetRequest) returns (GetResponse); } message GetRequest { int32 id = 1; }';
  const protoSyms = parseSymbolsFromProto(protoCode, '/proto/data.proto', 'Protos', 'proto/data.proto');
  assert.equal(protoSyms.length, 3);
  assert.equal(protoSyms[0].name, 'service DataEntityService');
  assert.equal(protoSyms[1].name, 'rpc GetDataEntity');
  assert.equal(protoSyms[2].name, 'message GetRequest');

  // Verify Markdown Parser
  const mdCode = '# Architecture Overview\n## CQRS Pipelines\n## Database Design';
  const mdSyms = parseSymbolsFromMarkdown(mdCode, '/docs/arch.md', 'Docs', 'docs/arch.md');
  assert.equal(mdSyms.length, 3);
  assert.equal(mdSyms[0].name, '# Architecture Overview');
});

test('DiskSymbolStore saves, streams, and searches cold secondary symbols without RAM overhead', async () => {
  const { DiskSymbolStore } = require('../solutionSearch/searchDiskStore');
  const { UniversalSymbolIndex } = require('../solutionSearch/searchScanner');
  const { searchUniversalSymbols } = require('../solutionSearch/searchEngine');
  const os = require('os');
  const path = require('path');
  const fs = require('fs');

  const tmpDir = path.join(os.tmpdir(), `dotnav_test_store_${Date.now()}`);
  const store = new DiskSymbolStore(tmpDir);
  await store.initialize();

  const csharpCode = `
public class OrderService
{
    public string OrderId { get; set; }
    public decimal TotalAmount { get; set; }

    public async Task ProcessOrderAsync(int orderId)
    {
    }

    private void CalculateTax()
    {
    }
}
`;

  const index = new UniversalSymbolIndex();
  index.setDiskStore(store);

  // Scan file with DiskStore attached
  const syms = index.scanFileContent('/src/OrderService.cs', csharpCode, 'OrderApp', 'src/OrderService.cs');
  assert.ok(syms.length > 0);

  // Verify that only primary symbols (class) are retained in RAM fileCache
  const ramSymbols = index.getAllSymbols();
  assert.ok(ramSymbols.some((s: any) => s.kind === 'class' && s.name === 'OrderService'));
  // Methods and properties should NOT be in RAM fileCache
  assert.ok(!ramSymbols.some((s: any) => s.kind === 'method' && s.name.startsWith('ProcessOrderAsync')));

  // Verify that cold symbols (methods & properties) ARE registered in DiskStore
  const diskMatches = store.searchColdSymbols(['ProcessOrder']);
  assert.ok(diskMatches.length > 0);
  assert.ok(diskMatches.some((s: any) => s.name.startsWith('ProcessOrderAsync')));

  // Test Two-Phase Search via searchUniversalSymbols
  const hotResults = searchUniversalSymbols(index, 'OrderService');
  assert.ok(hotResults.length > 0);
  assert.equal(hotResults[0].symbol.name, 'OrderService');

  const coldResults = searchUniversalSymbols(index, 'ProcessOrder');
  assert.ok(coldResults.length > 0);
  assert.ok(coldResults.some((r: any) => r.symbol.name.startsWith('ProcessOrderAsync')));

  // Save to disk and reload
  await store.saveToDisk();
  assert.ok(fs.existsSync(store.storagePath));

  const store2 = new DiskSymbolStore(tmpDir);
  const loaded = await store2.loadFromDisk();
  assert.strictEqual(loaded, true);
  assert.ok(store2.count > 0);
  const reloadedMatches = store2.searchColdSymbols(['CalculateTax']);
  assert.ok(reloadedMatches.length > 0);
  assert.ok(reloadedMatches.some((s: any) => s.name.startsWith('CalculateTax')));

  // Test purgeDiskCache
  await store.purgeDiskCache();
  assert.strictEqual(store.count, 0);
  assert.strictEqual(fs.existsSync(store.storagePath), false);

  // Clean up
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {}
});

test('compactDirectoryPath, formatSymbolDescription and formatSymbolDetail format long paths cleanly', () => {
  const {
    compactDirectoryPath,
    compactFilePath,
    formatSymbolDescription,
    formatSymbolDetail,
    formatSymbolTooltip
  } = require('../solutionSearch/searchModel');

  // Test compactDirectoryPath with adaptive character limit (maxChars = 48)
  assert.equal(
    compactDirectoryPath('src/Services/CustomAppShared/Cleeksy.CustomApp.SharedService/Mappers/FormSubmissions/IFunctionManualPrefillProvider.cs'),
    '.../Mappers/FormSubmissions'
  );
  assert.equal(
    compactDirectoryPath('src/Controllers/Api/v1/Admin/OrdersController.cs'),
    '.../Controllers/Api/v1/Admin'
  );
  assert.equal(compactDirectoryPath('src/Controllers/OrdersController.cs'), 'src/Controllers');
  assert.equal(compactDirectoryPath('Program.cs'), '.');

  // Test compactFilePath for title bar
  assert.equal(
    compactFilePath('src/Services/CustomAppShared/Cleeksy.CustomApp.SharedService/SharedFeatures/Records/ConditionalFieldVisibilities/IRecordConditionalFieldVisibilityHandler.cs:18', 55),
    '.../IRecordConditionalFieldVisibilityHandler.cs:18'
  );
  assert.equal(
    compactFilePath('src/Controllers/OrdersController.cs:25', 55),
    'src/Controllers/OrdersController.cs:25'
  );

  // Test formatSymbolDescription
  const methodSym = {
    id: 'sym1',
    name: 'GetSpecificationPrefillValueAsync(...)',
    kind: 'method',
    filePath: '/repo/src/Services/CustomAppShared/Cleeksy.CustomApp.SharedService/Mappers/FormSubmissions/IFunctionManualPrefillProvider.cs',
    relativePath: 'src/Services/CustomAppShared/Cleeksy.CustomApp.SharedService/Mappers/FormSubmissions/IFunctionManualPrefillProvider.cs',
    projectName: 'Cleeksy.CustomApp.SharedService',
    line: 24,
    column: 1
  };

  const fileSym = {
    id: 'sym2',
    name: 'PrefillOptions.cs',
    kind: 'file',
    filePath: '/repo/src/Services/PrefillOptions.cs',
    relativePath: 'src/Services/PrefillOptions.cs',
    projectName: 'Workspace',
    line: 1,
    column: 1
  };

  const desc = formatSymbolDescription(methodSym);
  assert.equal(desc, 'IFunctionManualPrefillProvider.cs:24');

  const descWithScore = formatSymbolDescription(methodSym, { score: 98, matchReason: 'Exact match' }, true);
  assert.equal(descWithScore, '[Score: 98 | Exact match] • IFunctionManualPrefillProvider.cs:24');

  // File symbols should have clean empty description (no project/Workspace)
  const fileDesc = formatSymbolDescription(fileSym);
  assert.equal(fileDesc, '');

  // Test formatSymbolDetail - should not contain project name or Workspace
  const detail = formatSymbolDetail(methodSym);
  assert.ok(detail.includes('.../Mappers/FormSubmissions'));
  assert.ok(!detail.includes('$(project)'));
  assert.ok(!detail.includes('Workspace'));

  // Test formatSymbolTooltip - returns full relative path + line
  const tooltip = formatSymbolTooltip(methodSym);
  assert.equal(
    tooltip,
    'src/Services/CustomAppShared/Cleeksy.CustomApp.SharedService/Mappers/FormSubmissions/IFunctionManualPrefillProvider.cs:24'
  );
  const fileTooltip = formatSymbolTooltip(fileSym);
  assert.equal(fileTooltip, 'src/Services/PrefillOptions.cs:1');
});

test('SearchIndexStatusBar displays % progress, completes, and auto-hides', async () => {
  const { SearchIndexStatusBar } = require('../solutionSearch/searchStatusBar');

  const mockItem: any = {
    text: '',
    tooltip: '',
    command: '',
    name: '',
    visible: false,
    disposed: false,
    show() { this.visible = true; },
    hide() { this.visible = false; },
    dispose() { this.disposed = true; }
  };

  const statusBar = new SearchIndexStatusBar(mockItem);

  // 1. start
  statusBar.start(1000);
  assert.equal(mockItem.visible, true);
  assert.equal(mockItem.text, '$(sync~spin) DotNav: Updating index 0%');

  // 2. report progress
  statusBar.reportProgress(450, 1000);
  assert.equal(mockItem.text, '$(sync~spin) DotNav: Updating index 45%');

  // 3. complete
  statusBar.complete(1500, 2500);
  assert.equal(mockItem.visible, true);
  assert.equal(mockItem.text, '$(check) DotNav: Index ready');
  assert.ok(mockItem.tooltip.includes('in 2.5s'));

  statusBar.queued();
  assert.equal(mockItem.text, '$(clock) DotNav: Index update queued');
  statusBar.updating();
  assert.equal(mockItem.text, '$(sync~spin) DotNav: Updating index');
  statusBar.ready(1500);
  assert.equal(mockItem.text, '$(check) DotNav: Index ready');

  // 4. dispose
  statusBar.dispose();
  assert.equal(mockItem.disposed, true);
});
