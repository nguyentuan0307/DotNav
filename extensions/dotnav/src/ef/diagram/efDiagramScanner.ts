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
  propertyRules?: Record<string, { columnName?: string; columnType?: string; isRequired?: boolean }>;
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
  'entitybase', 'iauditentitybase', 'auditentity', 'fullauditentity'
]);

export const INVALID_PROPERTY_TYPES = new Set([
  'return', 'yield', 'throw', 'var', 'await', 'case', 'default', 'goto', 'break', 'continue',
  'if', 'else', 'while', 'do', 'for', 'foreach', 'switch', 'try', 'catch', 'finally',
  'lock', 'using', 'fixed', 'sizeof', 'typeof', 'nameof', 'class', 'struct', 'record',
  'interface', 'enum', 'delegate', 'event', 'void', 'null', 'true', 'false', 'base', 'this',
  'checked', 'unchecked', 'stackalloc', 'async', 'get', 'set', 'init', 'value', 'const'
]);

/**
 * Infers SQL standard column type from C# data type and property attributes.
 */
export function inferSqlTypeFromCSharp(csharpType: string, attrs: string = ''): string {
  const colTypeMatch = attrs.match(/TypeName\s*=\s*["']([^"']+)["']/i);
  if (colTypeMatch) return colTypeMatch[1];

  const cleanType = csharpType.replace(/\?$/, '').replace(/^Nullable<([^>]+)>$/, '$1').trim();

  if (cleanType === 'string') {
    const lenMatch = attrs.match(/(?:MaxLength|StringLength)\s*\(\s*(\d+)\s*\)/i);
    if (lenMatch) return `nvarchar(${lenMatch[1]})`;
    return 'nvarchar(max)';
  }

  if (cleanType === 'decimal') {
    const precMatch = attrs.match(/Precision\s*\(\s*(\d+)\s*(?:,\s*(\d+))?\s*\)/i);
    if (precMatch) {
      const p = precMatch[1];
      const s = precMatch[2] || '2';
      return `decimal(${p},${s})`;
    }
    return 'decimal(18,2)';
  }

  switch (cleanType) {
    case 'int': return 'int';
    case 'long': return 'bigint';
    case 'short': return 'smallint';
    case 'byte': return 'tinyint';
    case 'bool': return 'bit';
    case 'Guid': return 'uniqueidentifier';
    case 'DateTime': return 'datetime2';
    case 'DateTimeOffset': return 'datetimeoffset';
    case 'DateOnly': return 'date';
    case 'TimeOnly':
    case 'TimeSpan': return 'time';
    case 'double': return 'float';
    case 'float': return 'real';
    case 'byte[]': return 'varbinary(max)';
    default: return cleanType;
  }
}

/**
 * Parses EF Core *ModelSnapshot.cs files with authoritative PK and FK extraction.
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

      // Extract chain details (up to semicolon)
      const afterProp = entityBody.substring(propMatch.index);
      const chainEnd = afterProp.indexOf(';');
      const propChain = chainEnd !== -1 ? afterProp.substring(0, chainEnd) : afterProp;

      const colNameMatch = propChain.match(/\.HasColumnName\s*\(\s*["']([^"']+)["']\s*\)/);
      const columnName = colNameMatch ? colNameMatch[1] : propName;

      const colTypeMatch = propChain.match(/\.HasColumnType\s*\(\s*["']([^"']+)["']\s*\)/);
      let columnType = colTypeMatch ? colTypeMatch[1] : undefined;
      if (!columnType) {
        const maxLenMatch = propChain.match(/\.HasMaxLength\s*\(\s*(\d+)\s*\)/);
        if (maxLenMatch && typeStr.includes('string')) {
          columnType = `nvarchar(${maxLenMatch[1]})`;
        } else {
          columnType = inferSqlTypeFromCSharp(typeStr);
        }
      }

      // Avoid duplicate properties or update existing
      const existingProp = entityInfo.properties.find(p => p.name.toLowerCase() === propName.toLowerCase());
      if (!existingProp) {
        entityInfo.properties.push({
          name: propName,
          type: typeStr,
          isPrimaryKey: isPk,
          isForeignKey: false, // will be explicitly set by HasForeignKey
          isNullable: typeStr.endsWith('?') || typeStr.startsWith('Nullable<'),
          isNavigation: false,
          columnName,
          columnType
        });
      } else {
        if (colNameMatch) (existingProp as any).columnName = colNameMatch[1];
        if (colTypeMatch) (existingProp as any).columnType = colTypeMatch[1];
      }
    }

    // 4. Extract Relationships & Explicit Foreign Keys:
    // b.HasOne("...Application", "Application").WithMany(...).HasForeignKey("AppId")
    // or b.HasOne("...Form", "RecordEditForm").WithMany(...).HasForeignKey("RecordEditFormId")
    const hasOneRegex = new RegExp(
      `${builderVar}\\.HasOne\\s*\\(\\s*["']([^"']+)["'](?:\\s*,\\s*(?:["']([^"']+)["']|null))?\\s*\\)`,
      'g'
    );
    let hasOneMatch: RegExpExecArray | null;

    while ((hasOneMatch = hasOneRegex.exec(entityBody)) !== null) {
      const principalFull = hasOneMatch[1];
      const principalShort = principalFull.split('.').pop() || principalFull;
      const navName = hasOneMatch[2];
      const afterMatch = entityBody.substring(hasOneMatch.index);

      // Find HasForeignKey in this chain (before the next semicolon)
      const chainEnd = afterMatch.indexOf(';');
      const chainSegment = chainEnd !== -1 ? afterMatch.substring(0, chainEnd) : afterMatch;

      const fkMatch = chainSegment.match(/\.HasForeignKey\s*\(\s*(?:["'][^"']+["']\s*,\s*)?["']([^"']+)["']\s*\)/);
      const fkName = fkMatch ? fkMatch[1] : undefined;

      if (fkName) {
        // Explicitly mark FK on the matching property!
        const matchingProp = entityInfo.properties.find(p => p.name.toLowerCase() === fkName.toLowerCase());
        if (matchingProp) {
          (matchingProp as any).isForeignKey = true;
          (matchingProp as any).foreignKeyTargetEntity = principalShort;
        }

        // Extract DeleteBehavior, IsRequired, and Navigations from chain
        const deleteMatch = chainSegment.match(/\.OnDelete\s*\(\s*DeleteBehavior\.([A-Za-z0-9_]+)\s*\)/);
        const deleteBehavior = deleteMatch ? deleteMatch[1] : undefined;

        const isRequired = chainSegment.includes('.IsRequired()') || (matchingProp ? !matchingProp.isNullable : true);

        const withManyMatch = chainSegment.match(/\.WithMany\s*\(\s*(?:["']([^"']+)["'])?\s*\)/);
        const withOneMatch = chainSegment.match(/\.WithOne\s*\(\s*(?:["']([^"']+)["'])?\s*\)/);
        const isOneToOne = !!withOneMatch;
        const inverseNav = withManyMatch ? withManyMatch[1] : withOneMatch ? withOneMatch[1] : undefined;
        const constraintMatch = chainSegment.match(/\.HasConstraintName\s*\(\s*["']([^"']+)["']\s*\)/);

        const relId = `${principalShort}->${shortName}:${fkName}`;
        if (!entityInfo.relationships.some(r => r.id === relId)) {
          entityInfo.relationships.push({
            id: relId,
            fromEntity: principalShort,
            fromProperty: 'Id',
            toEntity: shortName,
            toProperty: fkName,
            cardinality: isOneToOne ? 'one-to-one' : 'one-to-many',
            foreignKeyName: constraintMatch?.[1] || `FK_${shortName}_${principalShort}_${fkName}`,
            deleteBehavior,
            isRequired,
            navigationName: navName,
            inverseNavigationName: inverseNav
          });
        }
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

  // Resolve the actual principal key instead of assuming every entity uses "Id".
  const entityByShortName = new Map<string, SnapshotEntityInfo>();
  for (const entity of entityMap.values()) {
    entityByShortName.set(entity.shortName.toLowerCase(), entity);
  }
  for (const entity of entityMap.values()) {
    for (const relationship of entity.relationships) {
      const principal = entityByShortName.get(relationship.fromEntity.toLowerCase());
      (relationship as any).fromProperty = principal?.primaryKeys[0] || 'Id';
    }
  }

  // Filter out any empty stub
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
  const rawProps: Array<{
    name: string;
    type: string;
    rawType: string;
    cleanType: string;
    isNullable: boolean;
    attrs: string;
  }> = [];

  // 1. First Pass: Collect all properties and attributes
  const propRegex = /((?:\[[^\]]+\]\s*)*)(?:public|protected|internal|private)?\s*([A-Za-z0-9_<>?,. ]+?)\s+([A-Za-z0-9_]+)\s*\{/g;
  let match: RegExpExecArray | null;

  while ((match = propRegex.exec(body)) !== null) {
    const attrs = match[1] || '';

    // Ignore [NotMapped] EF Core properties
    if (/NotMapped\b/i.test(attrs)) {
      continue;
    }

    let rawType = match[2]
      .replace(/\b(public|protected|internal|private|virtual|override|new|readonly|static|required)\b/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    const propName = match[3].trim();

    // CS0542: Member names cannot be the same as their enclosing type (e.g. constructors or object initializers)
    if (propName.toLowerCase() === className.toLowerCase()) {
      continue;
    }

    if (INVALID_PROPERTY_TYPES.has(propName.toLowerCase())) {
      continue;
    }

    if (rawType.startsWith('class ') || rawType.startsWith('void ') || rawType === 'event' || !rawType) {
      continue;
    }

    if (/\b(return|yield|throw|var|await|new|goto|case)\b/i.test(rawType)) {
      continue;
    }

    let isNullable = rawType.endsWith('?') || rawType.startsWith('Nullable<');
    let cleanType = rawType.replace(/\?$/, '').replace(/^Nullable<([^>]+)>$/, '$1').trim();

    if (INVALID_PROPERTY_TYPES.has(cleanType.toLowerCase())) {
      continue;
    }

    // Check that '{' opens a real property accessor block (get/set/init) rather than an object initializer
    const remainder = body.slice(match.index + match[0].length, match.index + match[0].length + 250);
    const cleanRemainder = remainder.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, '').trimStart();
    const hasAccessor = /^(?:(?:public|protected|internal|private)\s+)?(?:get|set|init)\s*(?:;|=>|\{)/.test(cleanRemainder);
    if (!hasAccessor) {
      continue;
    }

    rawProps.push({
      name: propName,
      type: cleanType + (isNullable ? '?' : ''),
      rawType,
      cleanType,
      isNullable,
      attrs
    });
  }

  // 2. Identify Navigation Properties in this class
  const navigations: Array<{ propName: string; targetEntity: string; isCollection: boolean }> = [];
  for (const p of rawProps) {
    const collectionMatch = p.cleanType.match(/^(?:ICollection|IList|List|IEnumerable|HashSet|ISet)<([A-Za-z0-9_]+)>$/);
    if (collectionMatch) {
      navigations.push({ propName: p.name, targetEntity: collectionMatch[1], isCollection: true });
    } else if (
      !/^(int|long|short|byte|string|Guid|DateTime|DateTimeOffset|DateOnly|TimeOnly|bool|double|float|decimal|char|object|byte\[\]|byte\?)$/i.test(
        p.cleanType
      ) &&
      /^[A-Z][A-Za-z0-9_]*$/.test(p.cleanType)
    ) {
      navigations.push({ propName: p.name, targetEntity: p.cleanType, isCollection: false });
    }
  }

  // [ForeignKey] is authoritative only when it can be resolved to a reference navigation.
  const explicitForeignKeys = new Map<string, string>();
  for (const p of rawProps) {
    const fkAttrMatch = p.attrs.match(
      /ForeignKey\s*\(\s*(?:nameof\s*\(\s*([A-Za-z0-9_]+)\s*\)|["']([^"']+)["'])\s*\)/i
    );
    const foreignKeyArgument = fkAttrMatch?.[1] || fkAttrMatch?.[2];
    if (!foreignKeyArgument) continue;

    const navigation = navigations.find(n => !n.isCollection && n.propName === p.name);
    if (navigation) {
      for (const foreignKeyName of foreignKeyArgument.split(',').map(name => name.trim()).filter(Boolean)) {
        explicitForeignKeys.set(foreignKeyName.toLowerCase(), navigation.targetEntity);
      }
      continue;
    }

    const targetNavigation = navigations.find(
      n => !n.isCollection && n.propName.toLowerCase() === foreignKeyArgument.toLowerCase()
    );
    if (targetNavigation) {
      explicitForeignKeys.set(p.name.toLowerCase(), targetNavigation.targetEntity);
    }
  }

  // 3. Second Pass: Determine PK and FK with strict navigation/attribute pairing
  const properties: EntityProperty[] = [];

  for (const p of rawProps) {
    // Check Key Attributes or Id
    let isPrimaryKey = /Key\b|PrimaryKey\b/i.test(p.attrs) || p.name === 'Id' || p.name === `${className}Id`;
    let isForeignKey = false;
    let foreignKeyTargetEntity: string | undefined;

    let isNavigation = false;
    let isCollectionNavigation = false;
    let navigationTargetEntity: string | undefined;

    const nav = navigations.find(n => n.propName === p.name);
    if (nav) {
      isNavigation = true;
      isCollectionNavigation = nav.isCollection;
      navigationTargetEntity = nav.targetEntity;
    } else if (!isPrimaryKey) {
      foreignKeyTargetEntity = explicitForeignKeys.get(p.name.toLowerCase());
      isForeignKey = !!foreignKeyTargetEntity;
    }

    // Check explicit [Column(...)]
    let columnName = p.name;
    let columnType = inferSqlTypeFromCSharp(p.cleanType, p.attrs);

    const colAttrMatch = p.attrs.match(/Column\s*\(\s*(?:["']([^"']+)["'])?(?:\s*,?\s*TypeName\s*=\s*["']([^"']+)["'])?\s*\)/i);
    if (colAttrMatch) {
      if (colAttrMatch[1]) columnName = colAttrMatch[1];
      if (colAttrMatch[2]) columnType = colAttrMatch[2];
    }

    properties.push({
      name: p.name,
      type: p.type,
      isPrimaryKey,
      isForeignKey,
      isNullable: p.isNullable,
      isNavigation,
      foreignKeyTargetEntity,
      navigationTargetEntity,
      isCollectionNavigation,
      columnName,
      columnType
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

    // Property configuration: builder.Property(x => x.PropName).HasColumnName("...").HasColumnType("...")
    const propConfigRegex = /builder\.Property\s*(?:<[^>]+>)?\s*\(\s*(?:[a-zA-Z0-9_]+\s*=>\s*[a-zA-Z0-9_.]+\.([a-zA-Z0-9_]+)|["']([^"']+)["'])\s*\)/g;
    let pMatch: RegExpExecArray | null;
    while ((pMatch = propConfigRegex.exec(code)) !== null) {
      const propName = pMatch[1] || pMatch[2];
      if (!propName) continue;
      const afterProp = code.substring(pMatch.index);
      const chainEnd = afterProp.indexOf(';');
      const propChain = chainEnd !== -1 ? afterProp.substring(0, chainEnd) : afterProp;

      const colNameMatch = propChain.match(/\.HasColumnName\s*\(\s*["']([^"']+)["']\s*\)/);
      const colTypeMatch = propChain.match(/\.HasColumnType\s*\(\s*["']([^"']+)["']\s*\)/);
      const isReq = propChain.includes('.IsRequired()');

      if (colNameMatch || colTypeMatch || isReq) {
        rule.propertyRules = rule.propertyRules || {};
        rule.propertyRules[propName.toLowerCase()] = {
          columnName: colNameMatch ? colNameMatch[1] : undefined,
          columnType: colTypeMatch ? colTypeMatch[1] : undefined,
          isRequired: isReq
        };
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
  const classGroups = new Map<string, RawClassInfo[]>();
  for (const c of rawClasses) {
    const key = c.name.toLowerCase();
    const group = classGroups.get(key) || [];
    group.push(c);
    classGroups.set(key, group);
  }

  const classMap = new Map<string, RawClassInfo>();
  for (const [key, group] of classGroups) {
    const ordered = [...group].sort((a, b) =>
      a.filePath.localeCompare(b.filePath) || a.line - b.line
    );
    const primary = [...ordered].sort((a, b) => {
      const aScore = (a.hasTableAttribute ? 10000 : 0) + (a.baseTypes.length * 1000) + a.properties.length;
      const bScore = (b.hasTableAttribute ? 10000 : 0) + (b.baseTypes.length * 1000) + b.properties.length;
      return bScore - aScore || a.filePath.localeCompare(b.filePath) || a.line - b.line;
    })[0];
    const tableSource = ordered.find(c => c.hasTableAttribute) || primary;
    const properties: EntityProperty[] = [];
    const propertyNames = new Set<string>();
    for (const fragment of ordered) {
      for (const property of fragment.properties) {
        const propertyName = property.name.toLowerCase();
        if (!propertyNames.has(propertyName)) {
          propertyNames.add(propertyName);
          properties.push(property);
        }
      }
    }

    classMap.set(key, {
      ...primary,
      tableName: tableSource.tableName,
      schemaName: tableSource.schemaName,
      properties,
      baseTypes: Array.from(new Set(ordered.flatMap(c => c.baseTypes))),
      attributes: ordered.map(c => c.attributes).filter(Boolean).join('\n'),
      hasTableAttribute: ordered.some(c => c.hasTableAttribute),
      isDbContext: ordered.some(c => c.isDbContext)
    });
  }

  // 1. Gather all unique DbContext names
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
  for (const c of classMap.values()) {
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

    // Gather entity types declared in DbSets (including inheritance)
    const entityTypesForContext = new Set<string>();
    for (const db of dbContextSets) {
      if (db.dbContextName.toLowerCase() === contextName.toLowerCase()) {
        db.entityTypes.forEach(t => entityTypesForContext.add(t.toLowerCase()));
      }
    }
    let parent = dbContextChildToParent.get(contextName);
    while (parent) {
      for (const db of dbContextSets) {
        if (db.dbContextName.toLowerCase() === parent.toLowerCase()) {
          db.entityTypes.forEach(t => entityTypesForContext.add(t.toLowerCase()));
        }
      }
      parent = dbContextChildToParent.get(parent);
    }
    
    if (snapshot && snapshot.entities.length > 0) {
      // 1. Snapshot Authoritative Baseline + Reconciliation with Live C# Code
      const entities: EntityModel[] = [];
      const snapEntityNameSet = new Set<string>();

      for (const snapEntity of snapshot.entities) {
        const shortLower = snapEntity.shortName.toLowerCase();
        snapEntityNameSet.add(shortLower);
        const matchingClass = classMap.get(shortLower);

        const mergedProperties: EntityProperty[] = [...snapEntity.properties];
        const seenPropNames = new Set(mergedProperties.map(p => p.name.toLowerCase()));

        // If C# source class is available, reconcile unmigrated properties and annotations
        if (matchingClass) {
          // Collect all C# properties including base class inheritance
          const liveProps: EntityProperty[] = [...matchingClass.properties];
          const visited = new Set<string>();
          const queue = [...matchingClass.baseTypes];

          while (queue.length > 0) {
            const baseName = queue.shift()!;
            const baseLower = baseName.toLowerCase();
            if (visited.has(baseLower)) continue;
            visited.add(baseLower);

            const baseClass = classMap.get(baseLower);
            if (baseClass) {
              for (const p of baseClass.properties) {
                if (!liveProps.some(lp => lp.name.toLowerCase() === p.name.toLowerCase())) {
                  liveProps.push(p);
                }
              }
              queue.push(...baseClass.baseTypes);
            }
          }

          // 1. Check for newly added C# properties not yet in Snapshot
          for (const lp of liveProps) {
            const lpLower = lp.name.toLowerCase();
            if (
              lpLower === shortLower ||
              INVALID_PROPERTY_TYPES.has(lpLower) ||
              INVALID_PROPERTY_TYPES.has(lp.type.replace(/\?$/, '').toLowerCase())
            ) {
              continue;
            }
            if (!seenPropNames.has(lpLower)) {
              seenPropNames.add(lpLower);
              mergedProperties.push({
                ...lp,
                isForeignKey: false,
                foreignKeyTargetEntity: undefined,
                isUnmigrated: true
              });
            }
          }

          // 2. Enhance existing snapshot properties with Fluent / Data Annotation column details
          const fluentRule = fluentRules.find(r => r.entityName.toLowerCase() === shortLower);
          for (let i = 0; i < mergedProperties.length; i++) {
            const p = mergedProperties[i];
            const pLower = p.name.toLowerCase();
            const liveProp = liveProps.find(lp => lp.name.toLowerCase() === pLower);
            const fluentPropRule = fluentRule?.propertyRules?.[pLower];

            const colName = fluentPropRule?.columnName || liveProp?.columnName || p.columnName || p.name;
            const colType = fluentPropRule?.columnType || liveProp?.columnType || p.columnType || inferSqlTypeFromCSharp(p.type);

            mergedProperties[i] = {
              ...p,
              columnName: colName,
              columnType: colType
            };
          }
        }

        entities.push({
          id: matchingClass ? `${matchingClass.filePath}:${matchingClass.line}:${snapEntity.shortName}` : `${snapEntity.shortName}`,
          name: snapEntity.shortName,
          tableName: snapEntity.tableName,
          schemaName: snapEntity.schemaName,
          filePath: matchingClass?.filePath || snapshot.filePath,
          line: matchingClass?.line || 1,
          projectName: matchingClass?.projectName || contextName,
          properties: mergedProperties,
          dbContextNames: [contextName]
        });
      }

      // 2. Supplement unmigrated new entities (in DbSet or with Table attribute) not in Snapshot
      if (rawClasses.length > 0) {
        for (const typeLower of entityTypesForContext) {
          if (snapEntityNameSet.has(typeLower)) continue;

          const rawClass = classMap.get(typeLower);
          if (!rawClass) continue;

          // Resolve inherited properties
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

          const rule = fluentRules.find(r => r.entityName.toLowerCase() === typeLower);
          const tableName = rule?.tableName || rawClass.tableName || rawClass.name;
          const schemaName = rule?.schemaName || rawClass.schemaName;

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
            properties: resolvedProps.map(p => ({
              ...p,
              isForeignKey: false,
              foreignKeyTargetEntity: undefined,
              isUnmigrated: true
            })),
            dbContextNames: [contextName],
            isUnmigrated: true
          });
        }
      }

      // 3. Snapshot relationships are authoritative. Live navigation properties must not add edges.
      const relationships: EntityRelationship[] = [];
      const relationshipKeys = new Set<string>();
      for (const snapEntity of snapshot.entities) {
        for (const rel of snapEntity.relationships) {
          const key = `${rel.fromEntity}->${rel.toEntity}:${rel.toProperty || ''}`;
          if (!relationshipKeys.has(key)) {
            relationshipKeys.add(key);
            relationships.push(rel);
          }
        }
      }

      entitiesByContext[contextName] = entities.sort((a, b) => a.name.localeCompare(b.name));
      relationshipsByContext[contextName] = relationships;
      continue;
    }

    // Otherwise, build from DbSet hierarchy + Fluent configurations (Tier 2 only)
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

    // Resolve only explicit Fluent API relationships. Convention and collection-only inference are intentionally excluded.
    const entityMap = new Map(entities.map(entity => [entity.name.toLowerCase(), entity]));
    for (const rule of fluentRules) {
      const configuredEntity = entityMap.get(rule.entityName.toLowerCase());
      if (!configuredEntity) continue;

      for (const relationship of rule.relationships) {
        if (!relationship.foreignKeyName || !relationship.navigationName) continue;

        let principal: EntityModel | undefined;
        let dependent: EntityModel | undefined;
        if (relationship.dependentEntity) {
          dependent = configuredEntity;
          const navigation = dependent.properties.find(
            property => property.name === relationship.navigationName && !property.isCollectionNavigation
          );
          if (navigation?.navigationTargetEntity) {
            principal = entityMap.get(navigation.navigationTargetEntity.toLowerCase());
          }
        } else if (relationship.principalEntity) {
          principal = configuredEntity;
          const navigation = principal.properties.find(
            property => property.name === relationship.navigationName && property.isCollectionNavigation
          );
          if (navigation?.navigationTargetEntity) {
            dependent = entityMap.get(navigation.navigationTargetEntity.toLowerCase());
          }
        }

        const foreignKey = dependent?.properties.find(
          property => property.name.toLowerCase() === relationship.foreignKeyName?.toLowerCase()
        );
        if (principal && dependent && foreignKey) {
          (foreignKey as any).isForeignKey = true;
          (foreignKey as any).foreignKeyTargetEntity = principal.name;
        }
      }
    }

    const rels = buildRelationships(entities);
    entitiesByContext[contextName] = entities.sort((a, b) => a.name.localeCompare(b.name));
    relationshipsByContext[contextName] = rels;
  }

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
    // 1. Check foreign key properties (e.g. ActionCommandSetting.AppId -> Application.Id)
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
              fromProperty: targetEntity.properties.find(p => p.isPrimaryKey)?.name || 'Id',
              toEntity: entity.name,
              toProperty: prop.name,
              cardinality: 'one-to-many',
              foreignKeyName: `FK_${entity.name}_${targetEntity.name}_${prop.name}`
            });
          }
        }
      }
    }

  }

  return relationships;
}
