import * as assert from 'assert';
import { describe, it } from 'node:test';
import {
  parseRawClassesFromCSharp,
  parseFluentConfigurations,
  parseDbContextDbSets,
  buildStrictWorkspaceEntities,
  buildRelationships
} from '../ef/diagram/efDiagramScanner';
import { liveSyncDiagramWithCode } from '../ef/diagram/efDiagramStorage';
import { DiagramFile, EntityModel } from '../ef/diagram/efDiagramModel';

describe('EF Core Diagram Scanner & Storage (Strict 2-Pass)', () => {
  it('parseRawClassesFromCSharp extracts scalar, PK, FK, and navigation properties', () => {
    const code = `
      namespace ELDesk.CustomApp.Domain.Entities;

      [Table("AppForms", Schema = "custom")]
      public class AppForm : TenantEntity
      {
          [Key]
          public int Id { get; set; }
          public string Title { get; set; }
          public int? AppFormMode { get; set; }
          
          public int DataEntityId { get; set; }
          public virtual DataEntity DataEntity { get; set; }

          public virtual ICollection<AppFormField> Fields { get; set; } = new List<AppFormField>();
      }
    `;

    const rawClasses = parseRawClassesFromCSharp(code, '/src/AppForm.cs', 'ELDesk.CustomApp');
    assert.equal(rawClasses.length, 1);

    const form = rawClasses[0];
    assert.equal(form.name, 'AppForm');
    assert.equal(form.tableName, 'AppForms');
    assert.equal(form.schemaName, 'custom');

    const idProp = form.properties.find(p => p.name === 'Id');
    assert.ok(idProp);
    assert.equal(idProp?.isPrimaryKey, true);

    const titleProp = form.properties.find(p => p.name === 'Title');
    assert.ok(titleProp);
    assert.equal(titleProp?.isPrimaryKey, false);
    assert.equal(titleProp?.isNullable, false);

    const modeProp = form.properties.find(p => p.name === 'AppFormMode');
    assert.ok(modeProp);
    assert.equal(modeProp?.isNullable, true);

    const dataEntityIdProp = form.properties.find(p => p.name === 'DataEntityId');
    assert.ok(dataEntityIdProp);
    assert.equal(dataEntityIdProp?.isForeignKey, true);
    assert.equal(dataEntityIdProp?.foreignKeyTargetEntity, 'DataEntity');

    const fieldsProp = form.properties.find(p => p.name === 'Fields');
    assert.ok(fieldsProp);
    assert.equal(fieldsProp?.isNavigation, true);
    assert.equal(fieldsProp?.isCollectionNavigation, true);
    assert.equal(fieldsProp?.navigationTargetEntity, 'AppFormField');
  });

  it('buildStrictWorkspaceEntities filters out Managers/Services/DTOs and inherits base class properties', () => {
    const rawClasses = [
      // 1. Base Entity
      ...parseRawClassesFromCSharp(
        `public class TenantEntity : BaseEntity { public int Id { get; set; } public int TenantId { get; set; } }`,
        '/src/TenantEntity.cs',
        'Shared'
      ),
      // 2. Domain Entity derived from TenantEntity
      ...parseRawClassesFromCSharp(
        `public class AppForm : TenantEntity { public string Title { get; set; } }`,
        '/src/Domain/Entities/AppForm.cs',
        'CustomApp'
      ),
      // 3. Entity configured via Fluent Config
      ...parseRawClassesFromCSharp(
        `public class DataEntity { public int Id { get; set; } public string Name { get; set; } }`,
        '/src/DataEntity.cs',
        'CustomApp'
      ),
      // 4. Non-Entity Classes that must be EXCLUDED
      ...parseRawClassesFromCSharp(
        `public class InternalClientManager { public int Timeout { get; set; } }`,
        '/src/InternalClientManager.cs',
        'CustomApp'
      ),
      ...parseRawClassesFromCSharp(
        `public class SolutionReleaseNotifier { public string Version { get; set; } }`,
        '/src/SolutionReleaseNotifier.cs',
        'CustomApp'
      ),
      ...parseRawClassesFromCSharp(
        `public class LoginResult { public string Token { get; set; } }`,
        '/src/LoginResult.cs',
        'CustomApp'
      ),
      ...parseRawClassesFromCSharp(
        `public class TracingSettings { public bool Enabled { get; set; } }`,
        '/src/TracingSettings.cs',
        'CustomApp'
      )
    ];

    const fluentRules = parseFluentConfigurations(`
      public class DataEntityConfig : IEntityTypeConfiguration<DataEntity>
      {
          public void Configure(EntityTypeBuilder<DataEntity> builder) { builder.ToTable("DataEntities"); }
      }
    `);

    const dbContextSets = parseDbContextDbSets(`
      public class AppDbContext : DbContext
      {
          public DbSet<AppForm> AppForms { get; set; }
      }
    `);

    const entities = buildStrictWorkspaceEntities(rawClasses, fluentRules, dbContextSets);
    const entityNames = entities.map(e => e.name);

    // MUST include valid entities
    assert.ok(entityNames.includes('AppForm'), 'Must include AppForm');
    assert.ok(entityNames.includes('DataEntity'), 'Must include DataEntity');
    assert.ok(entityNames.includes('TenantEntity'), 'Must include TenantEntity');

    // MUST strictly exclude non-entities
    assert.ok(!entityNames.includes('InternalClientManager'), 'Must exclude InternalClientManager');
    assert.ok(!entityNames.includes('SolutionReleaseNotifier'), 'Must exclude SolutionReleaseNotifier');
    assert.ok(!entityNames.includes('LoginResult'), 'Must exclude LoginResult');
    assert.ok(!entityNames.includes('TracingSettings'), 'Must exclude TracingSettings');

    // Verify AppForm inherited TenantId and Id from TenantEntity
    const appForm = entities.find(e => e.name === 'AppForm')!;
    assert.ok(appForm.properties.some(p => p.name === 'Title'), 'Must have own property Title');
    assert.ok(appForm.properties.some(p => p.name === 'TenantId'), 'Must inherit TenantId from TenantEntity');
    assert.ok(appForm.properties.some(p => p.name === 'Id'), 'Must inherit Id from TenantEntity');
  });

  it('parseFluentConfigurations extracts table name, keys, and HasMany relationships', () => {
    const configCode = `
      namespace Cleeksy.SolutionCanvas.Infrastructure.EntitiesConfig.Tenants;

      public class TenantEntityConfig : IEntityTypeConfiguration<TenantEntity>
      {
          public void Configure(EntityTypeBuilder<TenantEntity> builder)
          {
              builder.ToTable("Tenants", "iam");
              builder.HasKey(t => t.Id);

              builder.HasMany(t => t.Forms)
                     .WithOne(f => f.Tenant)
                     .HasForeignKey(f => f.TenantId)
                     .OnDelete(DeleteBehavior.Cascade);
          }
      }
    `;

    const rules = parseFluentConfigurations(configCode);
    assert.equal(rules.length, 1);
    assert.equal(rules[0].entityName, 'TenantEntity');
    assert.equal(rules[0].tableName, 'Tenants');
    assert.equal(rules[0].schemaName, 'iam');
    assert.deepEqual(rules[0].primaryKeys, ['Id']);
    assert.equal(rules[0].relationships.length, 1);
    assert.equal(rules[0].relationships[0].foreignKeyName, 'TenantId');
    assert.equal(rules[0].relationships[0].deleteBehavior, 'Cascade');
  });

  it('buildRelationships discovers relationships from navigation & FK properties', () => {
    const entities: EntityModel[] = [
      {
        id: '1',
        name: 'AppForm',
        filePath: '/src/AppForm.cs',
        line: 1,
        projectName: 'App',
        properties: [
          {
            name: 'Id',
            type: 'int',
            isPrimaryKey: true,
            isForeignKey: false,
            isNullable: false,
            isNavigation: false
          },
          {
            name: 'Fields',
            type: 'ICollection<AppFormField>',
            isPrimaryKey: false,
            isForeignKey: false,
            isNullable: false,
            isNavigation: true,
            isCollectionNavigation: true,
            navigationTargetEntity: 'AppFormField'
          }
        ]
      },
      {
        id: '2',
        name: 'AppFormField',
        filePath: '/src/AppFormField.cs',
        line: 1,
        projectName: 'App',
        properties: [
          {
            name: 'Id',
            type: 'int',
            isPrimaryKey: true,
            isForeignKey: false,
            isNullable: false,
            isNavigation: false
          },
          {
            name: 'FormId',
            type: 'int',
            isPrimaryKey: false,
            isForeignKey: true,
            isNullable: false,
            isNavigation: false,
            foreignKeyTargetEntity: 'AppForm'
          }
        ]
      }
    ];

    const rels = buildRelationships(entities);
    assert.ok(rels.length > 0);
    const formToField = rels.find(r => r.fromEntity === 'AppForm' && r.toEntity === 'AppFormField');
    assert.ok(formToField);
    assert.equal(formToField?.cardinality, 'one-to-many');
  });

  it('liveSyncDiagramWithCode preserves coordinates and prunes removed entities', () => {
    const saved: DiagramFile = {
      version: 1,
      name: 'Custom',
      createdAt: 100,
      updatedAt: 200,
      entities: {
        AppForm: { x: 120, y: 150 },
        OldDeletedEntity: { x: 500, y: 500 }
      }
    };

    const currentEntities: EntityModel[] = [
      {
        id: '1',
        name: 'AppForm',
        filePath: '/src/AppForm.cs',
        line: 1,
        projectName: 'App',
        properties: []
      }
    ];

    const synced = liveSyncDiagramWithCode(saved, currentEntities);
    assert.deepEqual(synced, {
      AppForm: { x: 120, y: 150 }
    });
  });
});
