import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import {
  createEmptyMigration,
  formatEfTimestamp,
  generateDesignerCode,
  generateMigrationCode,
  sanitizeMigrationName
} from '../ef/efEmptyMigration';

describe('efEmptyMigration', () => {
  it('formats EF Core timestamps correctly', () => {
    const fixedDate = new Date(Date.UTC(2026, 7, 18, 9, 30, 45));
    const timestamp = formatEfTimestamp(fixedDate);
    assert.strictEqual(timestamp, '20260818093045');
  });

  it('sanitizes migration names', () => {
    assert.strictEqual(sanitizeMigrationName('  Add-Order-Table! '), 'Add_Order_Table_');
    assert.strictEqual(sanitizeMigrationName('SeedMasterData'), 'SeedMasterData');
  });

  it('generates valid C# migration code with Up and Down methods', () => {
    const code = generateMigrationCode('SeedUsers', 'MyApp.Infrastructure.Migrations');
    assert.ok(code.includes('namespace MyApp.Infrastructure.Migrations'));
    assert.ok(code.includes('public partial class SeedUsers : Migration'));
    assert.ok(code.includes('protected override void Up(MigrationBuilder migrationBuilder)'));
    assert.ok(code.includes('protected override void Down(MigrationBuilder migrationBuilder)'));
  });

  it('generates valid C# designer code with DbContext and Migration attributes', () => {
    const designer = generateDesignerCode(
      '20260818093045_SeedUsers',
      'SeedUsers',
      'MyApp.Infrastructure.Migrations',
      'AppDbContext',
      'MyApp.Infrastructure'
    );
    assert.ok(designer.includes('[DbContext(typeof(AppDbContext))]'));
    assert.ok(designer.includes('[Migration("20260818093045_SeedUsers")]'));
    assert.ok(designer.includes('partial class SeedUsers'));
    assert.ok(designer.includes('using MyApp.Infrastructure;'));
  });

  it('creates physical migration and designer files, cloning snapshot if available', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dotnav-empty-mig-test-'));
    const migDir = path.join(tempDir, 'Migrations');
    await fs.mkdir(migDir, { recursive: true });

    try {
      // Create dummy csproj
      const csprojPath = path.join(tempDir, 'TestApp.csproj');
      await fs.writeFile(csprojPath, '<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><RootNamespace>MyCustomApp</RootNamespace></PropertyGroup></Project>');

      // Create an existing ModelSnapshot file
      const snapshotPath = path.join(migDir, 'CustomDbContextModelSnapshot.cs');
      const snapshotCode = `
using System;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;

namespace MyCustomApp.Migrations
{
    [DbContext(typeof(CustomDbContext))]
    partial class CustomDbContextModelSnapshot : ModelSnapshot
    {
        protected override void BuildModel(ModelBuilder modelBuilder)
        {
            modelBuilder.Entity("Order", b => { b.Property<int>("Id"); });
        }
    }
}
`;
      await fs.writeFile(snapshotPath, snapshotCode, 'utf8');

      const fixedDate = new Date(Date.UTC(2026, 7, 18, 12, 0, 0));
      const result = await createEmptyMigration({
        projectDirectory: tempDir,
        migrationName: 'SeedRoles',
        dbContextName: 'CustomDbContext',
        now: fixedDate
      });

      assert.strictEqual(result.migrationId, '20260818120000_SeedRoles');
      assert.strictEqual(result.migrationName, 'SeedRoles');

      const migrationExists = await fs.stat(result.migrationFilePath).then(() => true).catch(() => false);
      const designerExists = await fs.stat(result.designerFilePath).then(() => true).catch(() => false);

      assert.ok(migrationExists, 'Migration file should exist');
      assert.ok(designerExists, 'Designer file should exist');

      const designerContent = await fs.readFile(result.designerFilePath, 'utf8');
      assert.ok(designerContent.includes('using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;'), 'Should clone custom using from snapshot');
      assert.ok(designerContent.includes('modelBuilder.Entity("Order"'), 'Should clone entity mapping from snapshot');
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });
});
