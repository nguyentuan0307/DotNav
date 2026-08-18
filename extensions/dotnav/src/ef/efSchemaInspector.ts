import * as fs from 'fs/promises';

export type SchemaChangeType =
  | 'create-table'
  | 'drop-table'
  | 'rename-table'
  | 'add-column'
  | 'drop-column'
  | 'alter-column'
  | 'rename-column'
  | 'create-index'
  | 'drop-index'
  | 'add-fk'
  | 'drop-fk'
  | 'raw-sql';

export interface SchemaChangeItem {
  readonly type: SchemaChangeType;
  readonly target: string;
  readonly label: string;
  readonly icon: string;
  readonly detail?: string;
}

export interface MigrationSchemaSummary {
  readonly filePath: string;
  readonly changes: readonly SchemaChangeItem[];
  readonly totalChanges: number;
  readonly hasRawSql: boolean;
}

export function parseSchemaChangesFromCode(csharpCode: string, filePath = ''): MigrationSchemaSummary {
  const changes: SchemaChangeItem[] = [];
  if (!csharpCode) {
    return { filePath, changes: [], totalChanges: 0, hasRawSql: false };
  }

  // Extract Up method body to only analyze forward schema changes
  const upMatch = /protected\s+override\s+void\s+Up\s*\(\s*MigrationBuilder\s+\w+\s*\)\s*\{([\s\S]*?)\n\s*\}\s*(?:protected|\/\/\/|#)/m.exec(csharpCode);
  const upBody = upMatch ? upMatch[1] : csharpCode;

  // 1. CreateTable
  const createTableRegex = /\.CreateTable\s*\(\s*(?:name:\s*)?["']([^"']+)["']/g;
  for (const match of upBody.matchAll(createTableRegex)) {
    const tableName = match[1];
    changes.push({
      type: 'create-table',
      target: tableName,
      label: `+ Table: ${tableName}`,
      icon: 'add'
    });
  }

  // 2. DropTable
  const dropTableRegex = /\.DropTable\s*\(\s*(?:name:\s*)?["']([^"']+)["']/g;
  for (const match of upBody.matchAll(dropTableRegex)) {
    const tableName = match[1];
    changes.push({
      type: 'drop-table',
      target: tableName,
      label: `- Table: ${tableName}`,
      icon: 'delete'
    });
  }

  // 3. RenameTable
  const renameTableRegex = /\.RenameTable\s*\(\s*(?:name:\s*)?["']([^"']+)["']\s*,\s*(?:(?:schema:\s*[^,]+,\s*)?newName:\s*)?["']([^"']+)["']/g;
  for (const match of upBody.matchAll(renameTableRegex)) {
    const oldName = match[1];
    const newName = match[2];
    changes.push({
      type: 'rename-table',
      target: `${oldName} -> ${newName}`,
      label: `~ Table: ${oldName} → ${newName}`,
      icon: 'edit'
    });
  }

  // 4. AddColumn
  const addColumnRegex = /\.AddColumn\s*(?:<[^>]+>)?\s*\(\s*(?:name:\s*)?["']([^"']+)["']\s*,\s*(?:table:\s*)?["']([^"']+)["']/g;
  for (const match of upBody.matchAll(addColumnRegex)) {
    const colName = match[1];
    const tableName = match[2];
    changes.push({
      type: 'add-column',
      target: `${tableName}.${colName}`,
      label: `+ Column: ${tableName}.${colName}`,
      icon: 'add'
    });
  }

  // 5. DropColumn
  const dropColumnRegex = /\.DropColumn\s*\(\s*(?:name:\s*)?["']([^"']+)["']\s*,\s*(?:table:\s*)?["']([^"']+)["']/g;
  for (const match of upBody.matchAll(dropColumnRegex)) {
    const colName = match[1];
    const tableName = match[2];
    changes.push({
      type: 'drop-column',
      target: `${tableName}.${colName}`,
      label: `- Column: ${tableName}.${colName}`,
      icon: 'delete'
    });
  }

  // 6. AlterColumn
  const alterColumnRegex = /\.AlterColumn\s*(?:<[^>]+>)?\s*\(\s*(?:name:\s*)?["']([^"']+)["']\s*,\s*(?:table:\s*)?["']([^"']+)["']/g;
  for (const match of upBody.matchAll(alterColumnRegex)) {
    const colName = match[1];
    const tableName = match[2];
    changes.push({
      type: 'alter-column',
      target: `${tableName}.${colName}`,
      label: `~ Column: ${tableName}.${colName}`,
      icon: 'edit'
    });
  }

  // 7. RenameColumn
  const renameColumnRegex = /\.RenameColumn\s*\(\s*(?:name:\s*)?["']([^"']+)["']\s*,\s*(?:table:\s*)?["']([^"']+)["']\s*,\s*(?:newName:\s*)?["']([^"']+)["']/g;
  for (const match of upBody.matchAll(renameColumnRegex)) {
    const oldCol = match[1];
    const tableName = match[2];
    const newCol = match[3];
    changes.push({
      type: 'rename-column',
      target: `${tableName}.${oldCol} -> ${newCol}`,
      label: `~ Column: ${tableName}.${oldCol} → ${newCol}`,
      icon: 'edit'
    });
  }

  // 8. AddForeignKey
  const addFkRegex = /\.AddForeignKey\s*\(\s*(?:name:\s*)?["']([^"']+)["']\s*,\s*(?:table:\s*)?["']([^"']+)["'](?:\s*,\s*(?:column:\s*["'][^"']+["']|\w+:\s*[^,]+))*\s*,\s*(?:principalTable:\s*)?["']([^"']+)["']/g;
  for (const match of upBody.matchAll(addFkRegex)) {
    const fkName = match[1];
    const table = match[2];
    const principalTable = match[3] ?? 'ref';
    changes.push({
      type: 'add-fk',
      target: `${table} -> ${principalTable}`,
      label: `🔗 FK: ${fkName} (${table} → ${principalTable})`,
      icon: 'link'
    });
  }

  // 9. DropForeignKey
  const dropFkRegex = /\.DropForeignKey\s*\(\s*(?:name:\s*)?["']([^"']+)["']\s*,\s*(?:table:\s*)?["']([^"']+)["']/g;
  for (const match of upBody.matchAll(dropFkRegex)) {
    const fkName = match[1];
    const table = match[2];
    changes.push({
      type: 'drop-fk',
      target: `${table}.${fkName}`,
      label: `- FK: ${fkName}`,
      icon: 'delete'
    });
  }

  // 10. CreateIndex
  const createIndexRegex = /\.CreateIndex\s*\(\s*(?:name:\s*)?["']([^"']+)["']\s*,\s*(?:table:\s*)?["']([^"']+)["']/g;
  for (const match of upBody.matchAll(createIndexRegex)) {
    const indexName = match[1];
    const table = match[2];
    changes.push({
      type: 'create-index',
      target: `${table}.${indexName}`,
      label: `⚡ Index: ${table} (${indexName})`,
      icon: 'spark'
    });
  }

  // 11. Raw SQL
  const hasRawSql = /\.Sql\s*\(/.test(upBody);
  if (hasRawSql) {
    changes.push({
      type: 'raw-sql',
      target: 'Raw SQL Script',
      label: `⚡ Raw SQL Script Execution`,
      icon: 'code'
    });
  }

  return {
    filePath,
    changes,
    totalChanges: changes.length,
    hasRawSql
  };
}

export async function inspectMigrationFile(filePath: string): Promise<MigrationSchemaSummary> {
  try {
    const code = await fs.readFile(filePath, 'utf8');
    return parseSchemaChangesFromCode(code, filePath);
  } catch {
    return { filePath, changes: [], totalChanges: 0, hasRawSql: false };
  }
}
