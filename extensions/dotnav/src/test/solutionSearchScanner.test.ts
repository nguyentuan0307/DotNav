import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  isIgnoredSearchFile,
  parseSymbolsFromAppSettings,
  parseSymbolsFromCSharp,
  UniversalSymbolIndex
} from '../solutionSearch/searchScanner';

test('isIgnoredSearchFile ignores bin, obj, generated files and designer files', () => {
  assert.equal(isIgnoredSearchFile('/repo/src/bin/Debug/app.dll'), true);
  assert.equal(isIgnoredSearchFile('/repo/src/obj/Debug/net8.0/AssemblyInfo.cs'), true);
  assert.equal(isIgnoredSearchFile('/repo/src/Views/Main.Designer.cs'), true);
  assert.equal(isIgnoredSearchFile('/repo/src/Models/User.g.cs'), true);
  assert.equal(isIgnoredSearchFile('/repo/src/Models/User.cs'), false);
  assert.equal(isIgnoredSearchFile('/repo/src/Controllers/OrdersController.cs'), false);
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

test('UniversalSymbolIndex snapshot export and load restores all symbols and token buckets', () => {
  const index = new UniversalSymbolIndex();
  index.scanFileContent(
    '/src/SubmitService.cs',
    'public class SubmitService {\n    public void ProcessOrder() {}\n}',
    'ELDesk.Sales',
    'SubmitService.cs',
    1700000000000
  );

  assert.equal(index.count, 3); // Class, Method, and File
  assert.equal(index.getFileTimestamp('/src/SubmitService.cs'), 1700000000000);

  const snapshot = index.exportSnapshot();
  assert.equal(snapshot.version, 5);
  assert.equal(snapshot.fileTimestamps['/src/SubmitService.cs'], 1700000000000);
  assert.ok(snapshot.symbolsByFile['/src/SubmitService.cs']);

  const restoredIndex = new UniversalSymbolIndex();
  restoredIndex.loadSnapshot(snapshot);

  assert.equal(restoredIndex.count, 3);
  assert.equal(restoredIndex.getFileTimestamp('/src/SubmitService.cs'), 1700000000000);

  const searchResults = require('../solutionSearch/searchEngine').searchUniversalSymbols(restoredIndex, 'processorder');
  assert.ok(searchResults.length >= 1);
  assert.ok(searchResults.some((r: any) => r.symbol.name === 'ProcessOrder()'));
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
  const sqlCode = 'CREATE TABLE "AppFields" (Id INT PRIMARY KEY); CREATE PROCEDURE sp_ProcessOrders AS SELECT 1;';
  const sqlSyms = parseSymbolsFromSql(sqlCode, '/db/schema.sql', 'CustomApp', 'db/schema.sql');
  assert.equal(sqlSyms.length, 2);
  assert.equal(sqlSyms[0].name, 'TABLE AppFields');
  assert.equal(sqlSyms[1].name, 'PROCEDURE sp_ProcessOrders');

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

  // Clean up
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {}
});
