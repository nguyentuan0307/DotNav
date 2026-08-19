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
  assert.equal(index.count, 1);
  assert.equal(index.fileCount, 1);

  index.markFullScanCompleted();
  assert.equal(index.isFullScanCompleted, true);

  index.invalidateFile('/src/User.cs');
  assert.equal(index.count, 0);

  index.clear();
  assert.equal(index.isFullScanCompleted, false);
});
