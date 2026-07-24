import assert from 'node:assert/strict';
import test from 'node:test';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import {
  findDbContextClasses,
  invalidateEfModel,
  loadEfModel,
  migrationsForContext
} from '../ef/efModel';

async function makeProject(): Promise<{ directory: string; cleanup: () => Promise<void> }> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'dotnav-efmodel-'));
  return { directory, cleanup: () => fs.rm(directory, { recursive: true, force: true }) };
}

test('finds DbContext classes across common declaration shapes', () => {
  const source = `
    public class AppDbContext : DbContext { }
    internal sealed class AuditContext : Microsoft.EntityFrameworkCore.DbContext { }
    public partial class IdentityContext : IdentityDbContext<User, Role, Guid> { }
    public class Repo : IRepository { }
    public class AppDbContextFactory : IDesignTimeDbContextFactory<AppDbContext> { }
    public class Snapshot : ModelSnapshot { }
  `;
  assert.deepEqual(findDbContextClasses(source), ['AppDbContext', 'AuditContext', 'IdentityContext']);
});

test('ignores classes that only mention a context as a generic argument', () => {
  // Real shape from ELDesk: a repository parameterised by the context.
  const source = `
    public class SubmitFormRepository : EFCoreBulkExtensionTenantRepository<SubmitForm, CustomAppDbContext>, ISubmitFormRepository { }
    public class Deps : BaseRepository<CustomAppDbContext> { }
  `;
  assert.deepEqual(findDbContextClasses(source), []);
});

test('recognises custom intermediate bases regardless of casing', () => {
  // Real shape from ELDesk: `AuditlogDBContext` with a capital B.
  const source = 'public class CustomAppDbContext : AuditlogDBContext\n{\n}';
  assert.deepEqual(findDbContextClasses(source), ['CustomAppDbContext']);
});

test('picks up a context named only by a model snapshot attribute', async () => {
  const { directory, cleanup } = await makeProject();
  try {
    // Partial class whose base lives in another file, as ELDesk.IAM does.
    await fs.writeFile(
      path.join(directory, 'IdentityContext.cs'),
      'namespace ELDesk.IAM.Infrastructure;\npublic partial class IdentityContext\n{\n}'
    );
    const migrations = path.join(directory, 'Migrations');
    await fs.mkdir(migrations);
    await fs.writeFile(path.join(migrations, '20260101120000_Init.cs'), '// migration');
    await fs.writeFile(
      path.join(migrations, 'IdentityContextModelSnapshot.cs'),
      'namespace ELDesk.IAM.Infrastructure.Migrations\n{\n    [DbContext(typeof(IdentityContext))]\n' +
      '    partial class IdentityContextModelSnapshot : ModelSnapshot { }\n}'
    );

    const model = await loadEfModel(directory);
    assert.deepEqual(model.contexts.map(context => context.name), ['IdentityContext']);
    assert.equal(model.contexts[0].fullName, 'ELDesk.IAM.Infrastructure.IdentityContext');
  } finally {
    await cleanup();
  }
});

test('discovers contexts and migrations without running the CLI', async () => {
  const { directory, cleanup } = await makeProject();
  try {
    await fs.writeFile(
      path.join(directory, 'AppDbContext.cs'),
      'namespace MyApp.Data;\npublic class AppDbContext : DbContext { }\n'
    );
    const migrations = path.join(directory, 'Migrations');
    await fs.mkdir(migrations);
    await fs.writeFile(path.join(migrations, '20260101120000_Init.cs'), '// migration');
    await fs.writeFile(path.join(migrations, '20260202120000_AddOrders.cs'), '// migration');
    await fs.writeFile(path.join(migrations, 'AppDbContextModelSnapshot.cs'), '// snapshot');
    // bin/obj content must never leak into the model.
    await fs.mkdir(path.join(directory, 'obj'));
    await fs.writeFile(path.join(directory, 'obj', '20269999999999_Ghost.cs'), '');

    const model = await loadEfModel(directory);
    assert.deepEqual(model.contexts.map(context => context.name), ['AppDbContext']);
    assert.equal(model.contexts[0].fullName, 'MyApp.Data.AppDbContext');
    assert.deepEqual(model.migrations.map(migration => migration.name), ['Init', 'AddOrders']);
  } finally {
    await cleanup();
  }
});

test('groups migrations by the DbContext named in the designer file', async () => {
  const { directory, cleanup } = await makeProject();
  try {
    await fs.writeFile(
      path.join(directory, 'Contexts.cs'),
      'namespace App;\npublic class MainContext : DbContext { }\npublic class AuditContext : DbContext { }\n'
    );
    const migrations = path.join(directory, 'Migrations');
    await fs.mkdir(migrations);
    await fs.writeFile(path.join(migrations, '20260101120000_Init.cs'), '// migration');
    await fs.writeFile(
      path.join(migrations, '20260101120000_Init.Designer.cs'),
      '[DbContext(typeof(App.MainContext))]\npartial class Init { }'
    );
    await fs.writeFile(path.join(migrations, '20260202120000_Audit.cs'), '// migration');
    await fs.writeFile(
      path.join(migrations, '20260202120000_Audit.Designer.cs'),
      '[DbContext(typeof(App.AuditContext))]\npartial class Audit { }'
    );

    const model = await loadEfModel(directory);
    assert.deepEqual(
      migrationsForContext(model, 'MainContext').map(migration => migration.name),
      ['Init']
    );
    assert.deepEqual(
      migrationsForContext(model, 'AuditContext').map(migration => migration.name),
      ['Audit']
    );
    assert.equal(migrationsForContext(model).length, 2);
  } finally {
    await cleanup();
  }
});

test('single-context projects return every migration regardless of name', async () => {
  const { directory, cleanup } = await makeProject();
  try {
    await fs.writeFile(path.join(directory, 'Db.cs'), 'namespace App;\npublic class AppDbContext : DbContext { }');
    const migrations = path.join(directory, 'Migrations');
    await fs.mkdir(migrations);
    await fs.writeFile(path.join(migrations, '20260101120000_Init.cs'), '// migration');

    const model = await loadEfModel(directory);
    assert.equal(migrationsForContext(model, 'AppDbContext').length, 1);
  } finally {
    await cleanup();
  }
});

test('reads only the head of very large generated files', async () => {
  const { directory, cleanup } = await makeProject();
  try {
    const migrations = path.join(directory, 'Migrations');
    await fs.mkdir(migrations);
    await fs.writeFile(path.join(directory, 'Db.cs'), 'namespace App;\npublic class BigDbContext : DbContext { }');
    await fs.writeFile(path.join(migrations, '20260101120000_Init.cs'), '// migration');
    // 700 KB designer, attribute at the top like the real generator emits.
    await fs.writeFile(
      path.join(migrations, '20260101120000_Init.Designer.cs'),
      '[DbContext(typeof(App.BigDbContext))]\n' + 'x'.repeat(700 * 1024)
    );

    const model = await loadEfModel(directory);
    assert.deepEqual(
      migrationsForContext(model, 'BigDbContext').map(migration => migration.name),
      ['Init']
    );
  } finally {
    await cleanup();
  }
});

test('caches until a file changes, then re-reads', async () => {
  const { directory, cleanup } = await makeProject();
  try {
    await fs.writeFile(path.join(directory, 'Db.cs'), 'namespace App;\npublic class AppDbContext : DbContext { }');
    const first = await loadEfModel(directory);
    assert.equal(first.contexts.length, 1);

    const second = await loadEfModel(directory);
    assert.strictEqual(second, first, 'unchanged directory must return the cached model');

    await fs.writeFile(path.join(directory, 'Other.cs'), 'namespace App;\npublic class OtherDbContext : DbContext { }');
    const third = await loadEfModel(directory);
    assert.equal(third.contexts.length, 2);

    invalidateEfModel(directory);
    const fourth = await loadEfModel(directory);
    assert.notStrictEqual(fourth, third, 'invalidation must force a fresh scan');
    assert.equal(fourth.contexts.length, 2);
  } finally {
    await cleanup();
  }
});
