import * as fs from 'fs';
import * as path from 'path';
import { EntityModel, EntityProperty, EntityRelationship } from './efDiagramModel';

export interface RawClassInfo {
  name: string;
  fullName?: string;
  tableName?: string;
  schemaName?: string;
  filePath: string;
  line: number;
  projectName: string;
  properties: EntityProperty[];
  baseTypes: string[];
  attributes: string;
  hasTableAttribute: boolean;
  isDbContext: boolean;
}

export interface FluentConfigRule {
  entityName: string;
  tableName?: string;
  schemaName?: string;
  primaryKeys?: string[];
  relationships: Array<{
    principalEntity?: string;
    dependentEntity?: string;
    navigationName?: string;
    inverseNavigationName?: string;
    foreignKeyName?: string;
    cardinality: 'one-to-many' | 'one-to-one' | 'many-to-many';
    deleteBehavior?: string;
  }>;
}

export interface SnapshotEntityInfo {
  fullName: string;
  shortName: string;
  tableName?: string;
  schemaName?: string;
  primaryKeys: string[];
  properties: EntityProperty[];
  relationships: EntityRelationship[];
}

export interface SnapshotContextResult {
  dbContextName: string;
  filePath: string;
  entities: SnapshotEntityInfo[];
}

const STRICT_EXCLUDE_SUFFIXES = [
  'Controller', 'Service', 'Repository', 'Handler', 'Command', 'Query',
  'Validator', 'Config', 'Configuration', 'Tests', 'Test', 'Manager',
  'Provider', 'Notifier', 'Cloner', 'Extension', 'Extensions', 'Settings',
  'Setting', 'Options', 'Option', 'Result', 'Results', 'Response', 'Request',
  'Token', 'Middleware', 'Filter', 'Hub', 'Factory', 'Context', 'DTO', 'Dto', 'ViewModel'
];

const KNOWN_BASE_ENTITY_NAMES = new Set([
  'entity', 'baseentity', 'tenantentity', 'aggregateroot',
  'fulllauditedentity', 'auditedentity', 'creationauditedentity',
  'idomainentity', 'domainentity', 'identityuser', 'identityrole',
  'entitybase', 'iauditentitybase'
]);

/**
 * Parses EF Core *ModelSnapshot.cs files and merges multi-block entity definitions (properties, relationships, navigations).
 */
export function parseModelSnapshotFromCSharp(code: string, filePath: string): SnapshotContextResult | undefined {
  if (!code.includes('ModelSnapshot') && !code.includes('[DbContext(')) {
    return undefined;
  }

  // Extract DbContext name: [DbContext(typeof(CustomAppDbContext))] or class CustomAppDbContextModelSnapshot
  let dbContextName = '';
  const contextAttrMatch = code.match(/\[DbContext\s*\(\s*typeof\s*\(\s*([A-Za-z0-9_.]+)\s*\)\s*\)\]/);
  if (contextAttrMatch) {
    dbContextName = contextAttrMatch[1].split('.').pop() || '';
  } else {
    const classMatch = code.match(/class\s+([A-Za-z0-9_]+)ModelSnapshot\s*:\s*ModelSnapshot/);
    if (classMatch) {
      dbContextName = classMatch[1];
    }
  }

  if (!dbContextName) {
    return undefined;
  }

  // Use Map to merge multiple modelBuilder.Entity("AppWidget", b => ...) blocks for the SAME entity
  const entityMap = new Map<string, SnapshotEntityInfo>();

  // Match: modelBuilder.Entity("ELDesk.CustomApp.SharedDomain.Entities.Applications.Entities.AppField", b => { ... });
  const entityBlockRegex = /modelBuilder\.Entity\s*\(\s*["']([^"']+)["']\s*,\s*([a-zA-Z0-9_]+)\s*=>\s*\{/g;
  let match: RegExpExecArray | null;

  while ((match = entityBlockRegex.exec(code)) !== null) {
    const fullName = match[1];
    const shortName = fullName.split('.').pop() || fullName;
    const builderVar = match[2];
    const blockStart = match.index + match[0].length;

    // Find closing brace of lambda
    let braceDepth = 1;
    let blockEnd = blockStart;
    for (let i = blockStart; i < code.length; i++) {
      if (code[i] === '{') braceDepth++;
      else if (code[i] === '}') {
        braceDepth--;
        if (braceDepth === 0) {
          blockEnd = i;
          break;
        }
      }
    }

    const entityBody = code.substring(blockStart, blockEnd);

    // Retrieve or initialize the merged entity entry
    let entityInfo = entityMap.get(fullName);
    if (!entityInfo) {
      entityInfo = {
        fullName,
        shortName,
        primaryKeys: [],
        properties: [],
        relationships: []
      };
      entityMap.set(fullName, entityInfo);
    }

    // 1. Extract table & schema: b.ToTable("formelement", "custom"); or b.ToTable("appwidget", (string)null);
    const tableMatch = entityBody.match(new RegExp(`${builderVar}\\.ToTable\\s*\\(\\s*["']([^"']+)["'](?:\\s*,\\s*(?:["']([^"']+)["']|\\(string\\)null))?\\s*\\)`));
    if (tableMatch) {
      entityInfo.tableName = tableMatch[1];
      if (tableMatch[2]) {
        entityInfo.schemaName = tableMatch[2];
      }
    }

    // 2. Extract Primary Keys: b.HasKey("Id"); or b.HasKey("Id", "TenantId");
    const keyMatch = entityBody.match(new RegExp(`${builderVar}\\.HasKey\\s*\\(\\s*([^)]+)\\s*\\)`));
    if (keyMatch) {
      const keys = keyMatch[1].match(/["']([^"']+)["']/g);
      if (keys) {
        for (const k of keys) {
          const cleanK = k.replace(/["']/g, '');
          if (!entityInfo.primaryKeys.includes(cleanK)) {
            entityInfo.primaryKeys.push(cleanK);
          }
        }
      }
    }

    // 3. Extract Properties: b.Property<int>("Id");
    const propRegex = new RegExp(`${builderVar}\\.Property\\s*(?:<([^>]+)>)?\\s*\\(\\s*["']([^"']+)["']\\s*\\)`, 'g');
    let propMatch: RegExpExecArray | null;

    while ((propMatch = propRegex.exec(entityBody)) !== null) {
      const typeStr = propMatch[1] || 'object';
      const propName = propMatch[2];
      const isPk = entityInfo.primaryKeys.includes(propName);
      let isFk = false;
      let fkTarget: string | undefined;

      if (!isPk && propName.endsWith('Id') && propName.length > 2) {
        isFk = true;
        fkTarget = propName === 'TenantId' ? 'Tenant' : propName.slice(0, -2);
      }

      // Avoid duplicate properties
      if (!entityInfo.properties.some(p => p.name.toLowerCase() === propName.toLowerCase())) {
        entityInfo.properties.push({
          name: propName,
          type: typeStr,
          isPrimaryKey: isPk,
          isForeignKey: isFk,
          isNullable: typeStr.endsWith('?') || typeStr.startsWith('Nullable<'),
          isNavigation: false,
          foreignKeyTargetEntity: fkTarget
        });
      }
    }

    // 4. Extract Relationships: b.HasOne(...).WithMany(...).HasForeignKey("FormId");
    const relRegex = new RegExp(
      `${builderVar}\\.HasOne\\s*\\(\\s*["']([^"']+)["'](?:\\s*,\\s*["']([^"']+)["'])?\\s*\\)(?:\\s*\\.WithMany\\s*\\(\\s*(?:["']([^"']+)["'])?\\s*\\)|\\s*\\.WithOne\\s*\\(\\s*(?:["']([^"']+)["'])?\\s*\\))?(?:\\s*\\.HasForeignKey\\s*\\(\\s*(?:["'][^"']+["']\\s*,\\s*)?["']([^"']+)["']\\s*\\))?`,
      'g'
    );
    let relMatch: RegExpExecArray | null;

    while ((relMatch = relRegex.exec(entityBody)) !== null) {
      const principalFull = relMatch[1];
      const principalShort = principalFull.split('.').pop() || principalFull;
      const navName = relMatch[2];
      const fkName = relMatch[5];

      const relId = `${principalShort}->${shortName}:${fkName || navName || 'Id'}`;
      if (!entityInfo.relationships.some(r => r.id === relId)) {
        entityInfo.relationships.push({
          id: relId,
          fromEntity: principalShort,
          fromProperty: 'Id',
          toEntity: shortName,
          toProperty: fkName,
          cardinality: 'one-to-many',
          foreignKeyName: fkName ? `FK_${shortName}_${principalShort}_${fkName}` : undefined
        });
      }
    }
  }

  // Update PK flags in properties if HasKey was declared after Property
  for (const entity of entityMap.values()) {
    for (const prop of entity.properties) {
      if (entity.primaryKeys.includes(prop.name)) {
        (prop as any).isPrimaryKey = true;
      }
    }
  }

  // Filter out any empty stub that has neither properties nor table
  const validEntities = Array.from(entityMap.values()).filter(e => e.properties.length > 0 || !!e.tableName);

  return {
    dbContextName,
    filePath,
    entities: validEntities
  };
}

export function parseRawClassesFromCSharp(
  code: string,
  filePath: string,
  projectName: string
): RawClassInfo[] {
  const classes: RawClassInfo[] = [];

  // Match class / record declarations: class AppForm : TenantEntity
  const classRegex = /(?:\[([^\]]+)\]\s*)*(?:public|internal|protected|private)?\s*(?:static|abstract|sealed|partial)*\s*(?:class|record)\s+([A-Za-z0-9_]+)(?:<[^>]+>)?(?:\s*:\s*([^{;\r\n]+))?\s*\{/g;
  let match: RegExpExecArray | null;

  while ((match = classRegex.exec(code)) !== null) {
    const attributes = match[1] || '';
    const className = match[2];
    const rawBaseTypes = match[3] ? match[3].trim() : '';
    const classStartIndex = match.index + match[0].length;
    const line = code.substring(0, match.index).split(/\r?\n/).length;

    let tableName = className;
    let schemaName: string | undefined;
    let hasTableAttribute = false;

    const tableAttrMatch = attributes.match(/Table\s*\(\s*["']([^"']+)["'](?:\s*,\s*Schema\s*=\s*["']([^"']+)["'])?\s*\)/i);
    if (tableAttrMatch) {
      tableName = tableAttrMatch[1];
      schemaName = tableAttrMatch[2];
      hasTableAttribute = true;
    }

    const isDbContext = 
      (className.endsWith('DbContext') || className.endsWith('Context')) &&
      !STRICT_EXCLUDE_SUFFIXES.some(s => s !== 'Context' && className.endsWith(s)) &&
      (/\b(?:DbContext|AuditlogDBContext|CleeksyDbContext|EFIntegrationEventContext|IdentityDbContext)\b/i.test(rawBaseTypes) ||
       /DbSet<[A-Za-z0-9_]+>/.test(code.substring(classStartIndex)));

    // Find class closing brace
    let braceDepth = 1;
    let classEndIndex = classStartIndex;
    for (let i = classStartIndex; i < code.length; i++) {
      if (code[i] === '{') braceDepth++;
      else if (code[i] === '}') {
        braceDepth--;
        if (braceDepth === 0) {
          classEndIndex = i;
          break;
        }
      }
    }

    const classBody = code.substring(classStartIndex, classEndIndex);
    const properties = parsePropertiesFromBody(classBody, className);

    const baseTypes = rawBaseTypes
      .split(',')
      .map(b => b.trim().replace(/<[^>]+>/g, '').trim())
      .filter(Boolean);

    classes.push({
      name: className,
      tableName,
      schemaName,
      filePath,
      line,
      projectName,
      properties,
      baseTypes,
      attributes,
      hasTableAttribute,
      isDbContext
    });
  }

  return classes;
}

export function parsePropertiesFromBody(body: string, className: string): EntityProperty[] {
  const properties: EntityProperty[] = [];

  // Match properties: [Key] public virtual ICollection<AppFormField> Fields { get; set; }
  const propRegex = /(?:\[([^\]]+)\]\s*)*(?:public|protected|internal|private)?\s*([A-Za-z0-9_<>?,. ]+?)\s+([A-Za-z0-9_]+)\s*\{/g;
  let match: RegExpExecArray | null;

  while ((match = propRegex.exec(body)) !== null) {
    const attrs = match[1] || '';

    // Ignore [NotMapped] EF Core properties (such as DomainEvents, IntegrationEvents, etc.)
    if (/NotMapped\b/i.test(attrs)) {
      continue;
    }

    let rawType = match[2]
      .replace(/\b(public|protected|internal|private|virtual|override|new|readonly|static|required)\b/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    const propName = match[3].trim();

    // Skip methods or events matching regex incorrectly
    if (rawType.startsWith('class ') || rawType.startsWith('void ') || rawType === 'event' || !rawType) {
      continue;
    }

    let isNullable = rawType.endsWith('?') || rawType.startsWith('Nullable<');
    let cleanType = rawType.replace(/\?$/, '').replace(/^Nullable<([^>]+)>$/, '$1').trim();

    // Check Key Attributes
    let isPrimaryKey = /Key\b|PrimaryKey\b/i.test(attrs) || propName === 'Id' || propName === `${className}Id`;
    let isForeignKey = /ForeignKey\b/i.test(attrs);
    let foreignKeyTargetEntity: string | undefined;

    // Check Navigation Properties (e.g. ICollection<T>, List<T>, IEnumerable<T>)
    let isNavigation = false;
    let isCollectionNavigation = false;
    let navigationTargetEntity: string | undefined;

    const collectionMatch = cleanType.match(/^(?:ICollection|IList|List|IEnumerable|HashSet|ISet)<([A-Za-z0-9_]+)>$/);
    if (collectionMatch) {
      isNavigation = true;
      isCollectionNavigation = true;
      navigationTargetEntity = collectionMatch[1];
    } else if (
      !/^(int|long|short|byte|string|Guid|DateTime|DateTimeOffset|DateOnly|TimeOnly|bool|double|float|decimal|char|object|byte\[\]|byte\?)$/i.test(
        cleanType
      )
    ) {
      // Non-primitive type may be a reference navigation
      if (/^[A-Z][A-Za-z0-9_]*$/.test(cleanType)) {
        isNavigation = true;
        isCollectionNavigation = false;
        navigationTargetEntity = cleanType;
      }
    }

    // Convention FK check: e.g. FormId -> Form, TenantId -> Tenant, DataEntityId -> DataEntity
    if (!isPrimaryKey && !isNavigation && propName.endsWith('Id') && propName.length > 2) {
      isForeignKey = true;
      foreignKeyTargetEntity = propName === 'TenantId' ? 'Tenant' : propName.slice(0, -2);
    }

    // Explicit [ForeignKey("UserId")]
    const fkAttrMatch = attrs.match(/ForeignKey\s*\(\s*["']([^"']+)["']\s*\)/i);
    if (fkAttrMatch) {
      isForeignKey = true;
      foreignKeyTargetEntity = fkAttrMatch[1];
    }

    properties.push({
      name: propName,
      type: cleanType + (isNullable ? '?' : ''),
      isPrimaryKey,
      isForeignKey,
      isNullable,
      isNavigation,
      foreignKeyTargetEntity,
      navigationTargetEntity,
      isCollectionNavigation
    });
  }

  return properties;
}

export function parseFluentConfigurations(code: string): FluentConfigRule[] {
  const rules: FluentConfigRule[] = [];

  // Match class ... : IEntityTypeConfiguration<T>
  const configClassRegex = /class\s+([A-Za-z0-9_]+)\s*:\s*IEntityTypeConfiguration<([A-Za-z0-9_]+)>/g;
  let classMatch: RegExpExecArray | null;

  while ((classMatch = configClassRegex.exec(code)) !== null) {
    const entityName = classMatch[2];
    const rule: FluentConfigRule = {
      entityName,
      relationships: []
    };

    // ToTable("Forms", "custom")
    const tableMatch = code.match(/builder\.ToTable\s*\(\s*["']([^"']+)["'](?:\s*,\s*["']([^"']+)["'])?\s*\)/);
    if (tableMatch) {
      rule.tableName = tableMatch[1];
      rule.schemaName = tableMatch[2];
    }

    // HasKey(x => x.Id)
    const keyMatch = code.match(/builder\.HasKey\s*\(\s*(?:[a-zA-Z0-9_]+\s*=>\s*)?(?:new\s*\{([^}]+)\}|[a-zA-Z0-9_.]+\.([a-zA-Z0-9_]+))\s*\)/);
    if (keyMatch) {
      if (keyMatch[2]) {
        rule.primaryKeys = [keyMatch[2]];
      } else if (keyMatch[1]) {
        rule.primaryKeys = keyMatch[1].split(',').map(k => k.trim().split('.').pop() || '').filter(Boolean);
      }
    }

    // HasMany(...).WithOne(...).HasForeignKey(...)
    const hasManyWithOneRegex = /builder\.HasMany\s*\(\s*(?:[a-zA-Z0-9_]+\s*=>\s*[a-zA-Z0-9_.]+\.([a-zA-Z0-9_]+))?\s*\)\s*\.WithOne\s*\(\s*(?:[a-zA-Z0-9_]+\s*=>\s*[a-zA-Z0-9_.]+\.([a-zA-Z0-9_]+))?\s*\)(?:\s*\.HasForeignKey\s*\(\s*(?:[a-zA-Z0-9_]+\s*=>\s*[a-zA-Z0-9_.]+\.([a-zA-Z0-9_]+))?\s*\))?(?:\s*\.OnDelete\s*\(\s*DeleteBehavior\.([A-Za-z0-9_]+)\s*\))?/g;
    let relMatch: RegExpExecArray | null;
    while ((relMatch = hasManyWithOneRegex.exec(code)) !== null) {
      rule.relationships.push({
        principalEntity: entityName,
        navigationName: relMatch[1],
        inverseNavigationName: relMatch[2],
        foreignKeyName: relMatch[3],
        cardinality: 'one-to-many',
        deleteBehavior: relMatch[4]
      });
    }

    // HasOne(...).WithMany(...).HasForeignKey(...)
    const hasOneWithManyRegex = /builder\.HasOne\s*\(\s*(?:[a-zA-Z0-9_]+\s*=>\s*[a-zA-Z0-9_.]+\.([a-zA-Z0-9_]+))?\s*\)\s*\.WithMany\s*\(\s*(?:[a-zA-Z0-9_]+\s*=>\s*[a-zA-Z0-9_.]+\.([a-zA-Z0-9_]+))?\s*\)(?:\s*\.HasForeignKey\s*\(\s*(?:[a-zA-Z0-9_]+\s*=>\s*[a-zA-Z0-9_.]+\.([a-zA-Z0-9_]+))?\s*\))?(?:\s*\.OnDelete\s*\(\s*DeleteBehavior\.([A-Za-z0-9_]+)\s*\))?/g;
    while ((relMatch = hasOneWithManyRegex.exec(code)) !== null) {
      rule.relationships.push({
        dependentEntity: entityName,
        navigationName: relMatch[1],
        inverseNavigationName: relMatch[2],
        foreignKeyName: relMatch[3],
        cardinality: 'one-to-many',
        deleteBehavior: relMatch[4]
      });
    }

    rules.push(rule);
  }

  return rules;
}

export function parseDbContextDbSets(code: string): { dbContextName: string; entityTypes: string[] }[] {
  const results: { dbContextName: string; entityTypes: string[] }[] = [];

  // Match class declarations: class IdentityContext : AuditlogDBContext
  const classMatchRegex = /(?:public|internal|protected)?\s*(?:abstract|sealed|partial)*\s*class\s+([A-Za-z0-9_]+)(?:<[^>]+>)?(?:\s*:\s*([^{;\r\n]+))?\s*\{/g;
  let match: RegExpExecArray | null;

  while ((match = classMatchRegex.exec(code)) !== null) {
    const className = match[1];
    const baseTypes = match[2] || '';
    const startIndex = match.index;

    // Discard any excluded suffixes
    if (STRICT_EXCLUDE_SUFFIXES.some(s => s !== 'Context' && className.endsWith(s))) {
      continue;
    }

    // Check if this class is a DbContext (including base contexts like AuditlogDBContext, CleeksyDbContext, EFIntegrationEventContext)
    const isDbContext = 
      /\b(?:DbContext|AuditlogDBContext|CleeksyDbContext|EFIntegrationEventContext|IdentityDbContext)\b/i.test(baseTypes) ||
      className.endsWith('DbContext') ||
      className.endsWith('Context') ||
      /DbSet<[A-Za-z0-9_]+>/.test(code.substring(startIndex));

    if (isDbContext) {
      const entityTypes: string[] = [];
      const dbSetRegex = /public\s+(?:virtual\s+)?DbSet<([A-Za-z0-9_]+)>\s+([A-Za-z0-9_]+)/g;
      let setMatch: RegExpExecArray | null;
      while ((setMatch = dbSetRegex.exec(code)) !== null) {
        if (setMatch.index >= startIndex) {
          entityTypes.push(setMatch[1]);
        }
      }

      if (entityTypes.length > 0) {
        results.push({ dbContextName: className, entityTypes });
      }
    }
  }

  return results;
}

/**
 * Builds DbContext-Scoped Entities & Relationships matching EF Core Migration model building.
 */
export function buildDbContextScopedModel(
  rawClasses: RawClassInfo[],
  fluentRules: FluentConfigRule[],
  dbContextSets: { dbContextName: string; entityTypes: string[] }[],
  snapshots: SnapshotContextResult[]
): {
  availableDbContexts: string[];
  entitiesByContext: Record<string, EntityModel[]>;
  relationshipsByContext: Record<string, EntityRelationship[]>;
} {
  const classMap = new Map<string, RawClassInfo>();
  for (const c of rawClasses) {
    classMap.set(c.name.toLowerCase(), c);
  }

  // 1. Gather all unique DbContext names (filter out noise like Repository)
  const contextNameSet = new Set<string>();
  for (const db of dbContextSets) {
    if (db.entityTypes.length > 0 && !STRICT_EXCLUDE_SUFFIXES.some(s => s !== 'Context' && db.dbContextName.endsWith(s))) {
      contextNameSet.add(db.dbContextName);
    }
  }
  for (const snap of snapshots) {
    if (snap.entities.length > 0) {
      contextNameSet.add(snap.dbContextName);
    }
  }

  // Resolve inheritance between DbContexts (e.g. CustomAppDbContext -> CustomAppSharedDbContext)
  const dbContextChildToParent = new Map<string, string>();
  for (const c of rawClasses) {
    if (c.isDbContext) {
      for (const b of c.baseTypes) {
        if (contextNameSet.has(b) && b !== c.name) {
          dbContextChildToParent.set(c.name, b);
        }
      }
    }
  }

  const entitiesByContext: Record<string, EntityModel[]> = {};
  const relationshipsByContext: Record<string, EntityRelationship[]> = {};

  for (const contextName of contextNameSet) {
    // Check if we have a direct ModelSnapshot for this DbContext
    const snapshot = snapshots.find(s => s.dbContextName.toLowerCase() === contextName.toLowerCase());
    
    if (snapshot && snapshot.entities.length > 0) {
      // Use Snapshot's authoritative entities
      const entities: EntityModel[] = [];
      for (const snapEntity of snapshot.entities) {
        const matchingClass = classMap.get(snapEntity.shortName.toLowerCase());
        entities.push({
          id: matchingClass ? `${matchingClass.filePath}:${matchingClass.line}:${snapEntity.shortName}` : `${snapEntity.shortName}`,
          name: snapEntity.shortName,
          tableName: snapEntity.tableName,
          schemaName: snapEntity.schemaName,
          filePath: matchingClass?.filePath || snapshot.filePath,
          line: matchingClass?.line || 1,
          projectName: matchingClass?.projectName || contextName,
          properties: snapEntity.properties,
          dbContextNames: [contextName]
        });
      }

      // Collect relationships from snapshot + navigations
      const relationships = buildRelationships(entities);
      for (const snapEntity of snapshot.entities) {
        for (const rel of snapEntity.relationships) {
          if (!relationships.some(r => r.fromEntity === rel.fromEntity && r.toEntity === rel.toEntity)) {
            relationships.push(rel);
          }
        }
      }

      entitiesByContext[contextName] = entities.sort((a, b) => a.name.localeCompare(b.name));
      relationshipsByContext[contextName] = relationships;
      continue;
    }

    // Otherwise, build from DbSet hierarchy + Fluent configurations
    const entityTypesForContext = new Set<string>();

    // 1. Direct DbSets
    for (const db of dbContextSets) {
      if (db.dbContextName.toLowerCase() === contextName.toLowerCase()) {
        db.entityTypes.forEach(t => entityTypesForContext.add(t.toLowerCase()));
      }
    }

    // 2. Inherited DbSets from base DbContext (e.g. CustomAppDbContext inherits CustomAppSharedDbContext)
    let parent = dbContextChildToParent.get(contextName);
    while (parent) {
      for (const db of dbContextSets) {
        if (db.dbContextName.toLowerCase() === parent.toLowerCase()) {
          db.entityTypes.forEach(t => entityTypesForContext.add(t.toLowerCase()));
        }
      }
      parent = dbContextChildToParent.get(parent);
    }

    // 3. Collect matching entities
    const entities: EntityModel[] = [];
    for (const typeLower of entityTypesForContext) {
      const rawClass = classMap.get(typeLower);
      if (!rawClass) continue;

      // Resolve inherited properties (TenantEntity -> Entity<TKey>)
      const resolvedProps: EntityProperty[] = [...rawClass.properties];
      const seenPropNames = new Set(resolvedProps.map(p => p.name.toLowerCase()));

      const visited = new Set<string>();
      const queue = [...rawClass.baseTypes];

      while (queue.length > 0) {
        const baseName = queue.shift()!;
        const baseLower = baseName.toLowerCase();
        if (visited.has(baseLower)) continue;
        visited.add(baseLower);

        const baseClass = classMap.get(baseLower);
        if (baseClass) {
          for (const p of baseClass.properties) {
            if (!seenPropNames.has(p.name.toLowerCase())) {
              seenPropNames.add(p.name.toLowerCase());
              resolvedProps.push(p);
            }
          }
          queue.push(...baseClass.baseTypes);
        }
      }

      // Apply Fluent rule overrides
      const rule = fluentRules.find(r => r.entityName.toLowerCase() === typeLower);
      let tableName = rule?.tableName || rawClass.tableName || rawClass.name;
      let schemaName = rule?.schemaName || rawClass.schemaName;

      if (rule?.primaryKeys && rule.primaryKeys.length > 0) {
        const pkSet = new Set(rule.primaryKeys.map(k => k.toLowerCase()));
        for (let i = 0; i < resolvedProps.length; i++) {
          if (pkSet.has(resolvedProps[i].name.toLowerCase())) {
            resolvedProps[i] = { ...resolvedProps[i], isPrimaryKey: true };
          }
        }
      }

      entities.push({
        id: `${rawClass.filePath}:${rawClass.line}:${rawClass.name}`,
        name: rawClass.name,
        tableName,
        schemaName,
        filePath: rawClass.filePath,
        line: rawClass.line,
        projectName: rawClass.projectName,
        properties: resolvedProps,
        dbContextNames: [contextName]
      });
    }

    const rels = buildRelationships(entities);
    entitiesByContext[contextName] = entities.sort((a, b) => a.name.localeCompare(b.name));
    relationshipsByContext[contextName] = rels;
  }

  // Only return DbContexts that have at least 1 entity
  const availableDbContexts = Array.from(contextNameSet)
    .filter(ctx => (entitiesByContext[ctx] || []).length > 0)
    .sort();

  return {
    availableDbContexts,
    entitiesByContext,
    relationshipsByContext
  };
}

export function buildRelationships(entities: readonly EntityModel[]): EntityRelationship[] {
  const relationships: EntityRelationship[] = [];
  const entityMap = new Map<string, EntityModel>();
  for (const e of entities) {
    entityMap.set(e.name.toLowerCase(), e);
  }

  const seenRelKeys = new Set<string>();

  for (const entity of entities) {
    // 1. Check foreign key properties (e.g. AppFormField.FormId -> AppForm.Id)
    for (const prop of entity.properties) {
      if (prop.isForeignKey && prop.foreignKeyTargetEntity) {
        const targetEntity = entityMap.get(prop.foreignKeyTargetEntity.toLowerCase());
        if (targetEntity) {
          const key = `${targetEntity.name}->${entity.name}:${prop.name}`;
          if (!seenRelKeys.has(key)) {
            seenRelKeys.add(key);
            relationships.push({
              id: key,
              fromEntity: targetEntity.name,
              fromProperty: 'Id',
              toEntity: entity.name,
              toProperty: prop.name,
              cardinality: 'one-to-many',
              foreignKeyName: `FK_${entity.name}_${targetEntity.name}_${prop.name}`
            });
          }
        }
      }
    }

    // 2. Check collection navigation properties (e.g. AppForm.Fields -> AppFormField)
    for (const prop of entity.properties) {
      if (prop.isNavigation && prop.navigationTargetEntity) {
        const target = entityMap.get(prop.navigationTargetEntity.toLowerCase());
        if (target) {
          if (prop.isCollectionNavigation) {
            // 1-N from entity to target
            const key = `${entity.name}->${target.name}:${prop.name}`;
            if (!seenRelKeys.has(key)) {
              seenRelKeys.add(key);
              relationships.push({
                id: key,
                fromEntity: entity.name,
                fromProperty: 'Id',
                toEntity: target.name,
                toProperty: `${entity.name}Id`,
                cardinality: 'one-to-many',
                foreignKeyName: `FK_${target.name}_${entity.name}`
              });
            }
          }
        }
      }
    }
  }

  return relationships;
}
