import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import {
  discoverConnectionStrings,
  maskConnectionString,
  parseConnectionEndpoint
} from '../ef/efConnectionDetector';

describe('efConnectionDetector', () => {
  it('masks sensitive credentials in connection strings', () => {
    const conn1 = 'Host=localhost;Database=mydb;Username=postgres;Password=super_secret;Port=5432;';
    const masked1 = maskConnectionString(conn1);
    assert.ok(!masked1.includes('super_secret'));
    assert.ok(masked1.includes('Password=******'));

    const conn2 = 'Server=tcp:sqlserver.database.windows.net,1433;Initial Catalog=mydb;User ID=admin;Password=Secret123!;';
    const masked2 = maskConnectionString(conn2);
    assert.ok(!masked2.includes('Secret123!'));
    assert.ok(masked2.includes('Password=******'));
  });

  it('parses PostgreSQL, SQL Server, MySQL and SQLite endpoints', () => {
    const pg = parseConnectionEndpoint('Host=127.0.0.1;Port=5432;Database=CustomApp;Username=postgres;');
    assert.strictEqual(pg.provider, 'PostgreSQL');
    assert.strictEqual(pg.host, '127.0.0.1');
    assert.strictEqual(pg.port, 5432);
    assert.strictEqual(pg.database, 'CustomApp');

    const mssql = parseConnectionEndpoint('Server=localhost,1433;Database=OrderDb;User Id=sa;');
    assert.strictEqual(mssql.provider, 'SQL Server');
    assert.strictEqual(mssql.host, 'localhost');
    assert.strictEqual(mssql.port, 1433);
    assert.strictEqual(mssql.database, 'OrderDb');

    const sqlite = parseConnectionEndpoint('Data Source=./storage/app.db');
    assert.strictEqual(sqlite.provider, 'SQLite');
    assert.strictEqual(sqlite.host, 'local-file');
    assert.strictEqual(sqlite.port, 0);
  });

  it('discovers connection strings from appsettings JSON files', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dotnav-conn-test-'));
    try {
      const appsettings = {
        ConnectionStrings: {
          DefaultConnection: 'Host=localhost;Database=MainDb;Password=secret;',
          SlaveConnection: 'Host=localhost;Database=ReadDb;Password=secret2;'
        }
      };
      const devAppsettings = {
        ConnectionStrings: {
          DevConnection: 'Host=127.0.0.1;Database=DevDb;Password=devpass;'
        }
      };

      await fs.writeFile(path.join(tempDir, 'appsettings.json'), JSON.stringify(appsettings));
      await fs.writeFile(path.join(tempDir, 'appsettings.Development.json'), JSON.stringify(devAppsettings));

      const discovered = await discoverConnectionStrings(tempDir);
      assert.strictEqual(discovered.length, 3);

      const defaultConn = discovered.find(d => d.name === 'DefaultConnection');
      assert.ok(defaultConn);
      assert.strictEqual(defaultConn.maskedValue.includes('secret'), false);

      const devConn = discovered.find(d => d.name === 'DevConnection');
      assert.ok(devConn);
      assert.strictEqual(devConn.environment, 'Development');
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });
});
