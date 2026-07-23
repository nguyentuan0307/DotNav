// Pure helpers for parsing `dotnet ef` output. No vscode imports so the module
// can be unit-tested directly under node --test.

export interface EfMigrationEntry {
  readonly id: string;
  readonly name: string;
  readonly applied?: boolean;
}

export interface EfDbContextEntry {
  readonly fullName: string;
  readonly safeName: string;
  readonly name: string;
}

export interface EfDbContextInfo {
  readonly providerName?: string;
  readonly databaseName?: string;
  readonly dataSource?: string;
  readonly options?: string;
}

export type EfErrorKind =
  | 'buildError'
  | 'toolMissing'
  | 'dbConnection'
  | 'startupProject'
  | 'pendingModelChanges'
  | 'general';

/**
 * Extracts the JSON payload from `dotnet ef ... --json --prefix-output` output.
 * Prefixed runs emit the payload on `data:` lines; unprefixed runs mix build
 * noise with a trailing JSON document.
 */
export function extractJsonPayload(output: string): string | undefined {
  const lines = output.split(/\r?\n/);
  const dataLines = lines
    .filter(line => line.startsWith('data:'))
    .map(line => line.slice('data:'.length).replace(/^\s/, ''));
  if (dataLines.length > 0) {
    const joined = dataLines.join('\n').trim();
    return joined.length > 0 ? joined : undefined;
  }

  for (let index = 0; index < lines.length; index += 1) {
    const trimmed = lines[index].trim();
    if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
      const candidate = lines.slice(index).join('\n').trim();
      try {
        JSON.parse(candidate);
        return candidate;
      } catch {
        // Not the start of the payload; keep scanning.
      }
    }
  }

  return undefined;
}

function parseJsonArray(output: string): unknown[] | undefined {
  const payload = extractJsonPayload(output);
  if (!payload) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(payload);
    return Array.isArray(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function parseJsonObject(output: string): Record<string, unknown> | undefined {
  const payload = extractJsonPayload(output);
  if (!payload) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(payload);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : undefined;
  } catch {
    return undefined;
  }
}

export function parseMigrationsList(output: string): EfMigrationEntry[] | undefined {
  const items = parseJsonArray(output);
  if (!items) {
    return undefined;
  }

  const entries: EfMigrationEntry[] = [];
  for (const item of items) {
    if (!item || typeof item !== 'object') {
      continue;
    }

    const record = item as Record<string, unknown>;
    const id = typeof record.id === 'string' ? record.id : undefined;
    if (!id) {
      continue;
    }

    const name = typeof record.name === 'string' && record.name.length > 0
      ? record.name
      : migrationNameFromId(id);
    const applied = typeof record.applied === 'boolean' ? record.applied : undefined;
    entries.push({ id, name, applied });
  }

  return entries;
}

export function parseDbContextList(output: string): EfDbContextEntry[] | undefined {
  const items = parseJsonArray(output);
  if (!items) {
    return undefined;
  }

  const entries: EfDbContextEntry[] = [];
  for (const item of items) {
    if (!item || typeof item !== 'object') {
      continue;
    }

    const record = item as Record<string, unknown>;
    const fullName = typeof record.fullName === 'string' ? record.fullName : undefined;
    if (!fullName) {
      continue;
    }

    const shortName = fullName.split('.').pop() ?? fullName;
    entries.push({
      fullName,
      safeName: typeof record.safeName === 'string' ? record.safeName : shortName,
      name: typeof record.name === 'string' ? record.name : shortName
    });
  }

  return entries;
}

export function parseDbContextInfo(output: string): EfDbContextInfo | undefined {
  const record = parseJsonObject(output);
  if (!record) {
    return undefined;
  }

  const readString = (key: string): string | undefined =>
    typeof record[key] === 'string' && (record[key] as string).length > 0
      ? record[key] as string
      : undefined;

  return {
    providerName: readString('providerName'),
    databaseName: readString('databaseName'),
    dataSource: readString('dataSource'),
    options: readString('options')
  };
}

export function migrationNameFromId(id: string): string {
  const match = /^\d{14}_(.+)$/.exec(id);
  return match ? match[1] : id;
}

export function migrationTimestampFromId(id: string): Date | undefined {
  const match = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})_/.exec(id);
  if (!match) {
    return undefined;
  }

  const [, year, month, day, hour, minute, second] = match;
  const date = new Date(Date.UTC(
    Number(year), Number(month) - 1, Number(day),
    Number(hour), Number(minute), Number(second)
  ));
  return Number.isNaN(date.getTime()) ? undefined : date;
}

/** Matches generated migration files such as `20260101120000_AddOrders.cs`. */
export function parseMigrationFileName(fileName: string): { id: string; name: string } | undefined {
  if (/\.Designer\.cs$/i.test(fileName)) {
    return undefined;
  }

  const match = /^(\d{14}_(.+))\.cs$/i.exec(fileName);
  if (!match) {
    return undefined;
  }

  return { id: match[1], name: match[2] };
}

const connectionFailurePatterns: RegExp[] = [
  /network-related or instance-specific error/i,
  /login failed/i,
  /connection refused/i,
  /could not connect/i,
  /unable to connect/i,
  /no connection could be made/i,
  /database ['"]?[^'"]*['"]? does not exist/i,
  /unable to open database file/i,
  /database is locked/i,
  /the server was not found/i,
  /timeout expired/i,
  /28P01|3D000/, // Npgsql auth / missing database SQLSTATEs
  /certificate chain was issued by an authority that is not trusted/i
];

const toolMissingPatterns: RegExp[] = [
  /could not execute because the specified command or file was not found/i,
  /no executable found matching command ["']dotnet-ef["']/i,
  /dotnet-ef does not exist/i,
  /you must install dotnet ef/i,
  /dotnet tool restore/i
];

const startupProjectPatterns: RegExp[] = [
  /startup project ['"][^'"]*['"] doesn't reference/i,
  /add a reference to ['"]?Microsoft\.EntityFrameworkCore\.Design['"]?/i,
  /unable to create (an object|a 'DbContext')/i,
  /no project was found/i,
  /doesn't reference Microsoft\.EntityFrameworkCore\.Design/i
];

export function classifyEfError(stderr: string, stdout: string): EfErrorKind {
  const combined = `${stderr}\n${stdout}`;
  if (toolMissingPatterns.some(pattern => pattern.test(combined))) {
    return 'toolMissing';
  }

  if (/build failed/i.test(combined)) {
    return 'buildError';
  }

  if (/pending changes|PendingModelChangesWarning/i.test(combined)) {
    return 'pendingModelChanges';
  }

  if (startupProjectPatterns.some(pattern => pattern.test(combined))) {
    return 'startupProject';
  }

  if (connectionFailurePatterns.some(pattern => pattern.test(combined))) {
    return 'dbConnection';
  }

  return 'general';
}

/** Last meaningful line of stderr/stdout, stack frames stripped. */
export function summarizeEfError(stderr: string, stdout: string): string | undefined {
  const lines = `${stdout}\n${stderr}`
    .split(/\r?\n/)
    .map(line => line.replace(/^(error|fail|crit):\s*/i, '').trim())
    .filter(line => line.length > 0)
    .filter(line => !/^at\s+\S/.test(line))
    .filter(line => !line.startsWith('data:'))
    .filter(line => !/^---/.test(line));

  return lines.length > 0 ? lines[lines.length - 1] : undefined;
}

const secretKeyPattern = /(password|pwd|secret|token|accountkey|sharedaccesskey|apikey|api key)\s*=\s*[^;]*/gi;
const uriCredentialPattern = /(:\/\/[^:/@\s]+:)[^@/\s]+(@)/g;

/** Masks secret material in connection strings before anything is displayed or logged. */
export function maskConnectionString(value: string): string {
  return value
    .replace(secretKeyPattern, match => {
      const separatorIndex = match.indexOf('=');
      return `${match.slice(0, separatorIndex + 1)}***`;
    })
    .replace(uriCredentialPattern, '$1***$2');
}

/** Realtime validation for the Add Migration input box. */
export function validateMigrationName(name: string, existingNames: readonly string[]): string | undefined {
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    return 'Migration name is required.';
  }

  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(trimmed)) {
    return 'Use a valid C# identifier (letters, digits, underscore; cannot start with a digit).';
  }

  if (existingNames.some(existing => existing.toLowerCase() === trimmed.toLowerCase())) {
    return `A migration named '${trimmed}' already exists.`;
  }

  return undefined;
}
