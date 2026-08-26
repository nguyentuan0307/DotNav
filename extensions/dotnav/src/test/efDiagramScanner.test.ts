import * as assert from 'assert';
import { describe, it } from 'node:test';
import {
  parseEntityPropertiesFromCSharp,
  parseFluentConfigurations,
  buildRelationships
} from '../ef/diagram/efDiagramScanner';
import { liveSyncDiagramWithCode } from '../ef/diagram/efDiagramStorage';
import { DiagramFile, EntityModel } from '../ef/diagram/efDiagramModel';

describe('EF Core Diagram Scanner & Storage', () => {
  it('parseEntityPropertiesFromCSharp extracts scalar, PK, FK, and navigation properties', () => {
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

    const candidates = parseEntityPropertiesFromCSharp(code, '/src/AppForm.cs', 'ELDesk.CustomApp');
    assert.equal(candidates.length, 1);

    const form = candidates[0];
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
