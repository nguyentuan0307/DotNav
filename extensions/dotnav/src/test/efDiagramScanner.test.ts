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

describe('EF Core Diagram Scanner & Storage (Backend Architecture Tailored)', () => {
  it('parseRawClassesFromCSharp extracts scalar, PK, FK, navigation, and ignores [NotMapped]', () => {
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

          [NotMapped]
          public IReadOnlyCollection<object> DomainEvents { get; set; }
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

    // [NotMapped] DomainEvents MUST be excluded
    const domainEventsProp = form.properties.find(p => p.name === 'DomainEvents');
    assert.equal(domainEventsProp, undefined, 'DomainEvents with [NotMapped] must not be included');
  });

  it('parseDbContextDbSets handles multi-level DbContext inheritance like AuditlogDBContext', () => {
    const customAppCode = `
      namespace ELDesk.CustomApp.SharedInfrastructure.DbContexts;
      public class CustomAppSharedDbContext : AuditlogDBContext
      {
          public virtual DbSet<Application> Application { get; set; } = null!;
          public virtual DbSet<Form> Form { get; set; } = null!;
      }
    `;

    const identityCode = `
      namespace ELDesk.IAM.Infrastructure;
      public partial class IdentityContext : AuditlogDBContext
      {
          public virtual DbSet<Tenant> Tenants { get; set; }
          public virtual DbSet<Role> Roles { get; set; }
      }
    `;

    const customAppSets = parseDbContextDbSets(customAppCode);
    assert.equal(customAppSets.length, 1);
    assert.equal(customAppSets[0].dbContextName, 'CustomAppSharedDbContext');
    assert.deepEqual(customAppSets[0].entityTypes, ['Application', 'Form']);

    const identitySets = parseDbContextDbSets(identityCode);
    assert.equal(identitySets.length, 1);
    assert.equal(identitySets[0].dbContextName, 'IdentityContext');
    assert.deepEqual(identitySets[0].entityTypes, ['Tenant', 'Role']);
  });

  it('buildStrictWorkspaceEntities maps entities to correct DbContexts and resolves TenantEntity inheritance', () => {
    const rawClasses = [
      // Base classes
      ...parseRawClassesFromCSharp(
        `public class Entity<TKey> { public TKey Id { get; set; } }`,
        '/src/Entity.cs',
        'ELDesk.Shared.Domain'
      ),
      ...parseRawClassesFromCSharp(
        `public class TenantEntity : Entity<int> { public int TenantId { get; set; } }`,
        '/src/TenantEntity.cs',
        'ELDesk.Shared.Domain'
      ),
      // Derived entities
      ...parseRawClassesFromCSharp(
        `public class Form : TenantEntity { public string Title { get; set; } }`,
        '/src/Form.cs',
        'ELDesk.CustomApp'
      ),
      ...parseRawClassesFromCSharp(
        `public class Tenant : Entity<int> { public string Name { get; set; } }`,
        '/src/Tenant.cs',
        'ELDesk.IAM'
      ),
      // Noise classes that must be excluded
      ...parseRawClassesFromCSharp(
        `public class InternalClientManager { public int Timeout { get; set; } }`,
        '/src/InternalClientManager.cs',
        'ELDesk.CustomApp'
      ),
      ...parseRawClassesFromCSharp(
        `public class TracingSettings { public bool Enabled { get; set; } }`,
        '/src/TracingSettings.cs',
        'ELDesk.CustomApp'
      )
    ];

    const dbContextSets = [
      { dbContextName: 'CustomAppSharedDbContext', entityTypes: ['Form'] },
      { dbContextName: 'IdentityContext', entityTypes: ['Tenant'] }
    ];

    const entities = buildStrictWorkspaceEntities(rawClasses, [], dbContextSets);
    const form = entities.find(e => e.name === 'Form');
    const tenant = entities.find(e => e.name === 'Tenant');

    assert.ok(form, 'Form must be found');
    assert.ok(tenant, 'Tenant must be found');

    // Context mapping
    assert.deepEqual(form?.dbContextNames, ['CustomAppSharedDbContext']);
    assert.deepEqual(tenant?.dbContextNames, ['IdentityContext']);

    // Inherited columns
    assert.ok(form?.properties.some(p => p.name === 'Id' && p.isPrimaryKey), 'Form must inherit Id PK');
    assert.ok(form?.properties.some(p => p.name === 'TenantId' && p.isForeignKey), 'Form must inherit TenantId FK');
  });

  it('buildRelationships discovers relationships from navigation & FK properties', () => {
    const entities: EntityModel[] = [
      {
        id: '1',
        name: 'Form',
        filePath: '/src/Form.cs',
        line: 1,
        projectName: 'App',
        properties: [
          { name: 'Id', type: 'int', isPrimaryKey: true, isForeignKey: false, isNullable: false, isNavigation: false },
          { name: 'Fields', type: 'ICollection<AppField>', isPrimaryKey: false, isForeignKey: false, isNullable: false, isNavigation: true, isCollectionNavigation: true, navigationTargetEntity: 'AppField' }
        ]
      },
      {
        id: '2',
        name: 'AppField',
        filePath: '/src/AppField.cs',
        line: 1,
        projectName: 'App',
        properties: [
          { name: 'Id', type: 'int', isPrimaryKey: true, isForeignKey: false, isNullable: false, isNavigation: false },
          { name: 'FormId', type: 'int', isPrimaryKey: false, isForeignKey: true, isNullable: false, isNavigation: false, foreignKeyTargetEntity: 'Form' }
        ]
      }
    ];

    const rels = buildRelationships(entities);
    assert.ok(rels.length > 0);
    const formToField = rels.find(r => r.fromEntity === 'Form' && r.toEntity === 'AppField');
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
        Form: { x: 120, y: 150 },
        DeletedOldEntity: { x: 500, y: 500 }
      }
    };

    const currentEntities: EntityModel[] = [
      {
        id: '1',
        name: 'Form',
        filePath: '/src/Form.cs',
        line: 1,
        projectName: 'App',
        properties: []
      }
    ];

    const synced = liveSyncDiagramWithCode(saved, currentEntities);
    assert.deepEqual(synced, {
      Form: { x: 120, y: 150 }
    });
  });
});
