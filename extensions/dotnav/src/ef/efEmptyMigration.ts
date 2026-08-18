import * as fs from 'fs/promises';
import * as path from 'path';

export interface EmptyMigrationParams {
  readonly projectDirectory: string;
  readonly migrationName: string;
  readonly dbContextName: string;
  readonly dbContextNamespace?: string;
  readonly outputDirectory?: string;
  readonly now?: Date;
}

export interface GeneratedEmptyMigrationResult {
  readonly migrationId: string;
  readonly migrationName: string;
  readonly migrationFilePath: string;
  readonly designerFilePath: string;
}

export function formatEfTimestamp(date: Date = new Date()): string {
  const yyyy = date.getUTCFullYear().toString().padStart(4, '0');
  const mm = (date.getUTCMonth() + 1).toString().padStart(2, '0');
  const dd = date.getUTCDate().toString().padStart(2, '0');
  const hh = date.getUTCHours().toString().padStart(2, '0');
  const min = date.getUTCMinutes().toString().padStart(2, '0');
  const ss = date.getUTCSeconds().toString().padStart(2, '0');
  return `${yyyy}${mm}${dd}${hh}${min}${ss}`;
}

export function sanitizeMigrationName(name: string): string {
  return name.trim().replace(/[^A-Za-z0-9_]/g, '_');
}

export async function detectProjectDefaultNamespace(projectDirectory: string): Promise<string> {
  try {
    const entries = await fs.readdir(projectDirectory);
    const projFile = entries.find(e => /\.(csproj|fsproj|vbproj)$/i.test(e));
    if (projFile) {
      const projPath = path.join(projectDirectory, projFile);
      const content = await fs.readFile(projPath, 'utf8');
      const rootNamespaceMatch = /<RootNamespace>([^<]+)<\/RootNamespace>/i.exec(content);
      if (rootNamespaceMatch) {
        return rootNamespaceMatch[1].trim();
      }
      return path.basename(projFile, path.extname(projFile));
    }
  } catch {
    // Fallback to directory name
  }
  return path.basename(projectDirectory);
}

export interface SnapshotData {
  readonly usings: readonly string[];
  readonly buildModelBody: string;
}

export async function extractExistingModelSnapshot(
  migrationsDirectory: string,
  dbContextName: string
): Promise<SnapshotData | undefined> {
  try {
    const entries = await fs.readdir(migrationsDirectory);
    const snapshotFiles = entries.filter(e => e.endsWith('ModelSnapshot.cs'));
    if (snapshotFiles.length === 0) {
      return undefined;
    }

    let matchedFile: string | undefined;
    for (const snap of snapshotFiles) {
      const fullPath = path.join(migrationsDirectory, snap);
      const content = await fs.readFile(fullPath, 'utf8');
      if (content.includes(`[DbContext(typeof(${dbContextName}))]`) || snap.toLowerCase().includes(dbContextName.toLowerCase())) {
        matchedFile = fullPath;
        break;
      }
    }

    if (!matchedFile && snapshotFiles.length > 0) {
      matchedFile = path.join(migrationsDirectory, snapshotFiles[0]);
    }

    if (matchedFile) {
      const content = await fs.readFile(matchedFile, 'utf8');
      const usingLines = content.split('\n')
        .map(l => l.trim())
        .filter(l => l.startsWith('using ') && l.endsWith(';'));

      const buildModelMatch = /protected\s+override\s+void\s+BuildModel\s*\(\s*ModelBuilder\s+modelBuilder\s*\)\s*\{([\s\S]*?)\n\s*\}\s*$/m.exec(content);
      if (buildModelMatch) {
        return {
          usings: [...new Set(usingLines)],
          buildModelBody: buildModelMatch[1]
        };
      }
    }
  } catch {
    // Snapshot not accessible
  }
  return undefined;
}

export function generateMigrationCode(
  migrationName: string,
  namespaceName: string
): string {
  return `using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ${namespaceName}
{
    /// <inheritdoc />
    public partial class ${migrationName} : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // Custom migration logic here (e.g. migrationBuilder.Sql("..."))
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // Custom rollback logic here
        }
    }
}
`;
}

export function generateDesignerCode(
  migrationId: string,
  migrationName: string,
  namespaceName: string,
  dbContextName: string,
  dbContextNamespace?: string,
  snapshot?: SnapshotData
): string {
  let usingsBlock = `using System;\nusing Microsoft.EntityFrameworkCore;\nusing Microsoft.EntityFrameworkCore.Infrastructure;\nusing Microsoft.EntityFrameworkCore.Migrations;\nusing Microsoft.EntityFrameworkCore.Storage.ValueConversion;`;

  if (snapshot && snapshot.usings.length > 0) {
    const combined = new Set([
      'using System;',
      'using Microsoft.EntityFrameworkCore;',
      'using Microsoft.EntityFrameworkCore.Infrastructure;',
      'using Microsoft.EntityFrameworkCore.Migrations;',
      'using Microsoft.EntityFrameworkCore.Storage.ValueConversion;',
      ...snapshot.usings
    ]);
    if (dbContextNamespace && dbContextNamespace !== namespaceName) {
      combined.add(`using ${dbContextNamespace};`);
    }
    usingsBlock = Array.from(combined).join('\n');
  } else if (dbContextNamespace && dbContextNamespace !== namespaceName) {
    usingsBlock += `\nusing ${dbContextNamespace};`;
  }

  const modelBody = snapshot && snapshot.buildModelBody.trim()
    ? snapshot.buildModelBody
    : `\n#pragma warning disable 612, 618\n            modelBuilder.HasAnnotation("ProductVersion", "8.0.0");\n#pragma warning restore 612, 618\n        `;

  return `// <auto-generated />
${usingsBlock}

#nullable disable

namespace ${namespaceName}
{
    [DbContext(typeof(${dbContextName}))]
    [Migration("${migrationId}")]
    partial class ${migrationName}
    {
        /// <inheritdoc />
        protected override void BuildTargetModel(ModelBuilder modelBuilder)
        {${modelBody}}
    }
}
`;
}

export async function createEmptyMigration(
  params: EmptyMigrationParams
): Promise<GeneratedEmptyMigrationResult> {
  const cleanName = sanitizeMigrationName(params.migrationName);
  if (!cleanName) {
    throw new Error('Migration name is required.');
  }

  const timestamp = formatEfTimestamp(params.now);
  const migrationId = `${timestamp}_${cleanName}`;
  const outDirName = params.outputDirectory || 'Migrations';
  const targetDir = path.isAbsolute(outDirName)
    ? outDirName
    : path.join(params.projectDirectory, outDirName);

  await fs.mkdir(targetDir, { recursive: true });

  const defaultNamespace = await detectProjectDefaultNamespace(params.projectDirectory);
  const migrationsNamespace = outDirName === 'Migrations'
    ? `${defaultNamespace}.Migrations`
    : `${defaultNamespace}.${outDirName.replace(/[\\/]/g, '.')}`;

  const snapshot = await extractExistingModelSnapshot(targetDir, params.dbContextName);

  const migrationCode = generateMigrationCode(cleanName, migrationsNamespace);
  const designerCode = generateDesignerCode(
    migrationId,
    cleanName,
    migrationsNamespace,
    params.dbContextName,
    params.dbContextNamespace,
    snapshot
  );

  const migrationFilePath = path.join(targetDir, `${migrationId}.cs`);
  const designerFilePath = path.join(targetDir, `${migrationId}.Designer.cs`);

  await fs.writeFile(migrationFilePath, migrationCode, 'utf8');
  await fs.writeFile(designerFilePath, designerCode, 'utf8');

  return {
    migrationId,
    migrationName: cleanName,
    migrationFilePath,
    designerFilePath
  };
}
