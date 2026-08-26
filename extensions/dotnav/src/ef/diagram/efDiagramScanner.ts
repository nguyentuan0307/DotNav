import * as fs from 'fs';
import * as path from 'path';
import { EntityModel, EntityProperty, EntityRelationship } from './efDiagramModel';

export interface RawEntityCandidate {
  name: string;
  tableName?: string;
  schemaName?: string;
  filePath: string;
  line: number;
  projectName: string;
  properties: EntityProperty[];
  baseType?: string;
  dbContexts: Set<string>;
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

export function parseEntityPropertiesFromCSharp(
  code: string,
  filePath: string,
  projectName: string
): RawEntityCandidate[] {
  const candidates: RawEntityCandidate[] = [];

  // Match classes / records: class AppForm : TenantEntity
  const classRegex = /(?:\[([^\]]+)\]\s*)*(?:public|internal|protected|private)?\s*(?:static|abstract|sealed|partial)*\s*(?:class|record)\s+([A-Za-z0-9_]+)(?:<[^>]+>)?(?:\s*:\s*([^{;\r\n]+))?\s*\{/g;
  let match: RegExpExecArray | null;

  while ((match = classRegex.exec(code)) !== null) {
    const attributes = match[1] || '';
    const className = match[2];
    const baseTypeList = match[3] ? match[3].trim() : '';
    const classStartIndex = match.index + match[0].length;
    const line = code.substring(0, match.index).split(/\r?\n/).length;

    // Extract table name from [Table("Forms", Schema = "custom")]
    let tableName = className;
    let schemaName: string | undefined;
    const tableAttrMatch = attributes.match(/Table\s*\(\s*["']([^"']+)["'](?:\s*,\s*Schema\s*=\s*["']([^"']+)["'])?\s*\)/i);
    if (tableAttrMatch) {
      tableName = tableAttrMatch[1];
      schemaName = tableAttrMatch[2];
    }

    // Heuristic: skip non-entity helper / test / controller classes
    if (
      className.endsWith('Controller') ||
      className.endsWith('Service') ||
      className.endsWith('Repository') ||
      className.endsWith('Handler') ||
      className.endsWith('Command') ||
      className.endsWith('Query') ||
      className.endsWith('Validator') ||
      className.endsWith('Config') ||
      className.endsWith('Configuration') ||
      className.endsWith('Tests')
    ) {
      continue;
    }

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

    if (properties.length > 0) {
      candidates.push({
        name: className,
        tableName,
        schemaName,
        filePath,
        line,
        projectName,
        properties,
        baseType: baseTypeList,
        dbContexts: new Set<string>()
      });
    }
  }

  return candidates;
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
