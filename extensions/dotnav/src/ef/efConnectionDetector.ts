import * as fs from 'fs/promises';
import * as net from 'net';
import * as path from 'path';

export interface DiscoveredConnectionString {
  readonly name: string;
  readonly value: string;
  readonly maskedValue: string;
  readonly sourceFile: string;
  readonly environment?: string;
}

export interface DatabasePingResult {
  readonly online: boolean;
  readonly latencyMs: number;
  readonly provider: string;
  readonly host: string;
  readonly port: number;
  readonly database?: string;
  readonly error?: string;
}

export function maskConnectionString(connStr: string): string {
  if (!connStr) return '';
  return connStr
    .replace(/(password|pwd|secret|key)\s*=\s*([^;]+)/gi, '$1=******')
    .replace(/(user\s*id|uid|username)\s*=\s*([^;]+)/gi, '$1=***');
}

export interface ParsedConnectionEndpoint {
  readonly provider: string;
  readonly host: string;
  readonly port: number;
  readonly database?: string;
}

export function parseConnectionEndpoint(connStr: string): ParsedConnectionEndpoint {
  if (!connStr) {
    return { provider: 'Unknown', host: 'localhost', port: 5432 };
  }

  // SQLite check
  if (/data\s*source\s*=\s*[^;]+\.(db|sqlite|sqlite3)/i.test(connStr) || /filename\s*=/i.test(connStr)) {
    const dbMatch = /(?:data\s*source|filename)\s*=\s*([^;]+)/i.exec(connStr);
    return { provider: 'SQLite', host: 'local-file', port: 0, database: dbMatch?.[1] };
  }

  // Extract database name
  const dbMatch = /(?:database|initial\s*catalog)\s*=\s*([^;]+)/i.exec(connStr);
  const database = dbMatch?.[1]?.trim();

  // Host and Port extraction: allow comma or colon inside host spec
  const hostMatch = /(?:server|host|data\s*source|address)\s*=\s*([^;]+)/i.exec(connStr);
  const rawHost = hostMatch?.[1]?.trim() || 'localhost';

  const portMatch = /(?:port)\s*=\s*(\d+)/i.exec(connStr);
  let port = portMatch ? parseInt(portMatch[1], 10) : 0;

  // Check host for port in "localhost,1433" format (SQL Server) or "localhost:5432" format
  let host = rawHost;
  if (rawHost.includes(',')) {
    const parts = rawHost.split(',');
    host = parts[0].trim();
    if (!port && parts[1]) {
      port = parseInt(parts[1].trim(), 10);
    }
  } else if (rawHost.includes(':')) {
    const parts = rawHost.split(':');
    host = parts[0].trim();
    if (!port && parts[1]) {
      port = parseInt(parts[1].trim(), 10);
    }
  }

  // Determine provider by keywords or port
  let provider = 'Database';
  if (/postgres|npgsql/i.test(connStr) || port === 5432) {
    provider = 'PostgreSQL';
    if (!port) port = 5432;
  } else if (/sqlserver|mssql|initial\s*catalog|trusted_connection|multipleactiveresultsets/i.test(connStr) || port === 1433 || /server\s*=/i.test(connStr)) {
    provider = 'SQL Server';
    if (!port) port = 1433;
  } else if (/mysql|mariadb/i.test(connStr) || port === 3306) {
    provider = 'MySQL';
    if (!port) port = 3306;
  } else if (/oracle/i.test(connStr) || port === 1521) {
    provider = 'Oracle';
    if (!port) port = 1521;
  } else {
    if (!port) port = 5432; // Default fallback
  }

  return { provider, host, port, database };
}

export async function pingDatabaseConnection(
  connectionString: string,
  timeoutMs = 2000
): Promise<DatabasePingResult> {
  const endpoint = parseConnectionEndpoint(connectionString);
  if (endpoint.provider === 'SQLite') {
    return {
      online: true,
      latencyMs: 1,
      provider: 'SQLite',
      host: 'localhost',
      port: 0,
      database: endpoint.database
    };
  }

  const start = Date.now();
  return new Promise<DatabasePingResult>(resolve => {
    const socket = new net.Socket();
    let resolved = false;

    const cleanup = () => {
      if (!resolved) {
        resolved = true;
        socket.destroy();
      }
    };

    socket.setTimeout(timeoutMs);

    socket.once('connect', () => {
      const latencyMs = Date.now() - start;
      cleanup();
      resolve({
        online: true,
        latencyMs,
        provider: endpoint.provider,
        host: endpoint.host,
        port: endpoint.port,
        database: endpoint.database
      });
    });

    socket.once('timeout', () => {
      cleanup();
      resolve({
        online: false,
        latencyMs: timeoutMs,
        provider: endpoint.provider,
        host: endpoint.host,
        port: endpoint.port,
        database: endpoint.database,
        error: `Connection timed out after ${timeoutMs}ms.`
      });
    });

    socket.once('error', error => {
      cleanup();
      resolve({
        online: false,
        latencyMs: Date.now() - start,
        provider: endpoint.provider,
        host: endpoint.host,
        port: endpoint.port,
        database: endpoint.database,
        error: error.message
      });
    });

    try {
      socket.connect(endpoint.port, endpoint.host);
    } catch (err) {
      cleanup();
      resolve({
        online: false,
        latencyMs: 0,
        provider: endpoint.provider,
        host: endpoint.host,
        port: endpoint.port,
        database: endpoint.database,
        error: err instanceof Error ? err.message : String(err)
      });
    }
  });
}

export async function discoverConnectionStrings(
  projectDirectory: string
): Promise<DiscoveredConnectionString[]> {
  const results: DiscoveredConnectionString[] = [];
  try {
    const entries = await fs.readdir(projectDirectory);
    const jsonFiles = entries.filter(e => /^appsettings(\..+)?\.json$/i.test(e));

    for (const jsonFile of jsonFiles) {
      const filePath = path.join(projectDirectory, jsonFile);
      const envMatch = /^appsettings\.([^.]+)\.json$/i.exec(jsonFile);
      const environment = envMatch ? envMatch[1] : undefined;

      try {
        const raw = await fs.readFile(filePath, 'utf8');
        // Simple strip comments if any
        const cleaned = raw.replace(/\/\*[\s\S]*?\*\/|([^:]|^)\/\/.*$/gm, '$1');
        const parsed = JSON.parse(cleaned);

        if (typeof parsed.ConnectionString === 'string' && parsed.ConnectionString.trim()) {
          results.push({
            name: environment ? `ConnectionString (${environment})` : 'ConnectionString',
            value: parsed.ConnectionString.trim(),
            maskedValue: maskConnectionString(parsed.ConnectionString.trim()),
            sourceFile: jsonFile,
            environment
          });
        }

        if (parsed.ConnectionStrings && typeof parsed.ConnectionStrings === 'object') {
          for (const [name, val] of Object.entries(parsed.ConnectionStrings)) {
            if (typeof val === 'string' && val.trim()) {
              results.push({
                name,
                value: val.trim(),
                maskedValue: maskConnectionString(val.trim()),
                sourceFile: jsonFile,
                environment
              });
            }
          }
        }
      } catch {
        // Skip invalid JSON
      }
    }
  } catch {
    // Directory unreadable
  }

  return results;
}
