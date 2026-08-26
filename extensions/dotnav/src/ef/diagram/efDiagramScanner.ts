import * as fs from 'fs';
import * as path from 'path';
import { EntityModel, EntityProperty, EntityRelationship } from './efDiagramModel';

export interface RawClassInfo {
  name: string;
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
  'idomainentity', 'domainentity', 'identityuser', 'identityrole'
]);

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

    const isDbContext = /\bDbContext\b/.test(rawBaseTypes) || className.endsWith('DbContext');

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
      foreignKeyTargetEntity = propName.slice(0, -2);
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

  const dbContextRegex = /class\s+([A-Za-z0-9_]+)\s*:\s*(?:[^{;\r\n]*\bDbContext\b[^{;\r\n]*)\s*\{/g;
  let match: RegExpExecArray | null;

  while ((match = dbContextRegex.exec(code)) !== null) {
    const dbContextName = match[1];
    const startIndex = match.index;
    
    // Find DbSets
    const entityTypes: string[] = [];
    const dbSetRegex = /public\s+(?:virtual\s+)?DbSet<([A-Za-z0-9_]+)>\s+([A-Za-z0-9_]+)/g;
    let setMatch: RegExpExecArray | null;
    while ((setMatch = dbSetRegex.exec(code)) !== null) {
      if (setMatch.index >= startIndex) {
        entityTypes.push(setMatch[1]);
      }
    }

    results.push({ dbContextName, entityTypes });
  }

  return results;
}

export function buildStrictWorkspaceEntities(
  rawClasses: RawClassInfo[],
  fluentRules: FluentConfigRule[],
  dbContextSets: { dbContextName: string; entityTypes: string[] }[]
): EntityModel[] {
  const classMap = new Map<string, RawClassInfo>();
  for (const c of rawClasses) {
    classMap.set(c.name.toLowerCase(), c);
  }

  // 1. Pass 1: Build Authoritative Entity Whitelist
  const authoritativeNames = new Set<string>();
  const entityDbContexts = new Map<string, Set<string>>();

  // 1a. From DbSets
  for (const db of dbContextSets) {
    for (const type of db.entityTypes) {
      const lower = type.toLowerCase();
      authoritativeNames.add(lower);
      if (!entityDbContexts.has(lower)) {
        entityDbContexts.set(lower, new Set());
      }
      entityDbContexts.get(lower)!.add(db.dbContextName);
    }
  }

  // 1b. From IEntityTypeConfiguration<T>
  for (const rule of fluentRules) {
    authoritativeNames.add(rule.entityName.toLowerCase());
  }

  // 1c. From [Table] attributes or Base Entity Inheritance or Entity directory location
  for (const c of rawClasses) {
    const lowerName = c.name.toLowerCase();

    // Skip strict excluded suffixes unless registered via DbSet/Fluent
    if (!authoritativeNames.has(lowerName)) {
      const isExcluded = STRICT_EXCLUDE_SUFFIXES.some(s => c.name.endsWith(s));
      if (isExcluded) {
        continue;
      }
    }

    // Has [Table] attribute
    if (c.hasTableAttribute) {
      authoritativeNames.add(lowerName);
    }

    // Derives from known base entity
    const derivesFromBaseEntity = c.baseTypes.some(b => {
      const lower = b.toLowerCase();
      return KNOWN_BASE_ENTITY_NAMES.has(lower) || lower.endsWith('entity') || lower.endsWith('model');
    });

    if (derivesFromBaseEntity) {
      authoritativeNames.add(lowerName);
    }

    // File in Domain/Entities directory with an Id property
    const normPath = c.filePath.replace(/\\/g, '/');
    if (
      (normPath.includes('/Domain/Entities/') || normPath.includes('/Entities/') || normPath.includes('/Models/Entities/')) &&
      c.properties.some(p => p.isPrimaryKey || p.name === 'Id')
    ) {
      authoritativeNames.add(lowerName);
    }
  }

  // 2. Pass 2: Property Extraction & Base Class Inheritance
  const entities: EntityModel[] = [];

  for (const c of rawClasses) {
    const lowerName = c.name.toLowerCase();
    if (!authoritativeNames.has(lowerName)) {
      continue;
    }

    // Resolve inherited properties from base classes
    const resolvedProps: EntityProperty[] = [...c.properties];
    const seenPropNames = new Set(resolvedProps.map(p => p.name.toLowerCase()));

    // Walk base class chain
    const visited = new Set<string>();
    const queue = [...c.baseTypes];

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

    // Apply Fluent Rule table name / schema / keys override if present
    const matchingRule = fluentRules.find(r => r.entityName.toLowerCase() === lowerName);
    let tableName = matchingRule?.tableName || c.tableName || c.name;
    let schemaName = matchingRule?.schemaName || c.schemaName;

    if (matchingRule?.primaryKeys && matchingRule.primaryKeys.length > 0) {
      const pkSet = new Set(matchingRule.primaryKeys.map(k => k.toLowerCase()));
      for (let i = 0; i < resolvedProps.length; i++) {
        if (pkSet.has(resolvedProps[i].name.toLowerCase())) {
          resolvedProps[i] = { ...resolvedProps[i], isPrimaryKey: true };
        }
      }
    }

    entities.push({
      id: `${c.filePath}:${c.line}:${c.name}`,
      name: c.name,
      tableName,
      schemaName,
      filePath: c.filePath,
      line: c.line,
      projectName: c.projectName,
      properties: resolvedProps,
      dbContextNames: Array.from(entityDbContexts.get(lowerName) || [])
    });
  }

  return entities.sort((a, b) => a.name.localeCompare(b.name));
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
