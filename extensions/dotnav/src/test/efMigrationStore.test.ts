import assert from 'node:assert/strict';
import test from 'node:test';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { ProjectModel } from '../models';
import { EfCommandRequest, EfCommandResult } from '../ef/efCli';
import {
  EfCommandRunner,
  EfMigrationStore,
  findMigrationFiles,
  scanForDbContexts
} from '../ef/efMigrationStore';

function makeProject(directory: string): ProjectModel {
  return {
    name: 'Data',
    path: path.join(directory, 'Data.csproj'),
    directory,
    relativePath: 'Data.csproj',
    kind: 'library',
    targetFrameworks: ['net8.0'],
    launchProfiles: [],
    packageReferences: [],
    projectReferences: []
  };
}

function success(stdout: string): EfCommandResult {
  return { kind: 'success', exitCode: 0, stdout, stderr: '', durationMs: 1 };
}

class FakeCli implements EfCommandRunner {
  busy = false;
  readonly calls: EfCommandRequest[] = [];
  handler: (request: EfCommandRequest) => Promise<EfCommandResult> = async () =>
    success('data: []');

  run(request: EfCommandRequest): Promise<EfCommandResult> {
    this.calls.push(request);
    return this.handler(request);
  }
}

async function makeTempProject(): Promise<{ project: ProjectModel; cleanup: () => Promise<void> }> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'dotnav-ef-test-'));
  return {
    project: makeProject(directory),
    cleanup: () => fs.rm(directory, { recursive: true, force: true })
  };
}

test('caches migrations and serves cached data on repeat calls', async () => {
  const { project, cleanup } = await makeTempProject();
  try {
    const cli = new FakeCli();
    cli.handler = async () => success(
      'data: [{ "id": "20260101120000_Init", "name": "Init", "applied": true }]'
    );
    const store = new EfMigrationStore(cli);
    const resolution = { project, startupProjectPath: project.path };

    const first = await store.getMigrations(resolution, undefined);
    assert.equal(first.migrations.length, 1);
    assert.equal(first.migrations[0].status, 'applied');
    assert.equal(first.source, 'db');

    await store.getMigrations(resolution, undefined);
    assert.equal(cli.calls.length, 1, 'second call must hit the cache');
  } finally {
    await cleanup();
  }
});

test('stale results are discarded when a write bumps the generation mid-fetch', async () => {
  const { project, cleanup } = await makeTempProject();
  try {
    const cli = new FakeCli();
    const store = new EfMigrationStore(cli);
    const resolution = { project, startupProjectPath: project.path };

    let firstCall = true;
    cli.handler = async () => {
      if (firstCall) {
        firstCall = false;
        // Simulate a migration being added while the list request runs.
        store.invalidateProject(project.path);
        return success('data: [{ "id": "20260101120000_Init", "name": "Init", "applied": true }]');
      }

      return success(
        'data: [{ "id": "20260101120000_Init", "name": "Init", "applied": true },' +
        ' { "id": "20260202120000_AddOrders", "name": "AddOrders", "applied": false }]'
      );
    };

    const snapshot = await store.getMigrations(resolution, undefined);
    assert.equal(snapshot.migrations.length, 2, 'stale single-entry list must be discarded and refetched');
  } finally {
    await cleanup();
  }
});

test('falls back to folder scan when the CLI fails', async () => {
  const { project, cleanup } = await makeTempProject();
  try {
    const migrationsDir = path.join(project.directory, 'Migrations');
    await fs.mkdir(migrationsDir);
    await fs.writeFile(path.join(migrationsDir, '20260101120000_Init.cs'), '// migration');
    await fs.writeFile(path.join(migrationsDir, '20260101120000_Init.Designer.cs'), '// designer');
    await fs.writeFile(path.join(migrationsDir, 'AppDbContextModelSnapshot.cs'), '// snapshot');

    const cli = new FakeCli();
    cli.handler = async () => ({
      kind: 'error', errorKind: 'dbConnection', stdout: '', stderr: 'Login failed', durationMs: 1
    });
    const store = new EfMigrationStore(cli);

    const snapshot = await store.getMigrations({ project, startupProjectPath: project.path }, undefined);
    assert.equal(snapshot.source, 'folder');
    assert.equal(snapshot.migrations.length, 1);
    assert.equal(snapshot.migrations[0].name, 'Init');
    assert.equal(snapshot.migrations[0].status, 'unknown');
  } finally {
    await cleanup();
  }
});

test('buffers watcher events while the cli is busy and flushes afterwards', async () => {
  const { project, cleanup } = await makeTempProject();
  try {
    const cli = new FakeCli();
    const store = new EfMigrationStore(cli);
    let changes = 0;
    store.onDidChange(() => { changes += 1; });

    cli.busy = true;
    store.handleFileEvent(project.path);
    assert.equal(changes, 0, 'event must be buffered while busy');

    cli.busy = false;
    store.flushBufferedEvents();
    assert.equal(changes, 1, 'buffered event must flush once the queue drains');

    store.flushBufferedEvents();
    assert.equal(changes, 1, 'flush is idempotent');
  } finally {
    await cleanup();
  }
});

test('findMigrationFiles maps ids to paths and skips bin/obj', async () => {
  const { project, cleanup } = await makeTempProject();
  try {
    const migrationsDir = path.join(project.directory, 'Migrations');
    const objDir = path.join(project.directory, 'obj');
    await fs.mkdir(migrationsDir);
    await fs.mkdir(objDir);
    await fs.writeFile(path.join(migrationsDir, '20260101120000_Init.cs'), '');
    await fs.writeFile(path.join(objDir, '20269999999999_Ghost.cs'), '');

    const files = await findMigrationFiles(project.directory);
    assert.equal(files.size, 1);
    assert.ok(files.get('20260101120000_Init')?.endsWith('20260101120000_Init.cs'));
  } finally {
    await cleanup();
  }
});

test('static DbContext scan finds classes and skips factories', async () => {
  const { project, cleanup } = await makeTempProject();
  try {
    await fs.writeFile(
      path.join(project.directory, 'AppDbContext.cs'),
      'namespace MyApp.Data;\npublic class AppDbContext : DbContext { }\n' +
      'public class AppDbContextFactory : IDesignTimeDbContextFactory<AppDbContext> { }'
    );
    await fs.writeFile(
      path.join(project.directory, 'IdentityContext.cs'),
      'namespace MyApp.Data { public class IdentityContext : IdentityDbContext<User> { } }'
    );

    const contexts = await scanForDbContexts(project);
    assert.deepEqual(contexts.map(context => context.name), ['AppDbContext', 'IdentityContext']);
    assert.equal(contexts[0].fullName, 'MyApp.Data.AppDbContext');
    assert.equal(contexts[0].unverified, true);
  } finally {
    await cleanup();
  }
});
