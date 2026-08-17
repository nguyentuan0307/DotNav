import * as assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import {
  buildOptimizationArgs,
  buildOptimizationFlags,
  hasProjectAssets,
  shouldUseNoRestore
} from '../buildOptimizations';

test('build optimization flags include multicore, parallel, shared compilation, and acceleration', () => {
  const flags = buildOptimizationFlags();
  assert.match(flags, /-maxcpucount/);
  assert.match(flags, /-p:BuildInParallel=true/);
  assert.match(flags, /-p:UseSharedCompilation=true/);
  assert.match(flags, /-p:AccelerateBuildsInVisualStudio=true/);
  assert.match(flags, /-clp:NoSummary;Verbosity=minimal/);

  const args = buildOptimizationArgs();
  assert.deepEqual(args, [
    '-maxcpucount',
    '-p:BuildInParallel=true',
    '-p:UseSharedCompilation=true',
    '-p:AccelerateBuildsInVisualStudio=true',
    '-clp:NoSummary;Verbosity=minimal'
  ]);
});

test('hasProjectAssets returns false for missing directory or invalid path', () => {
  assert.equal(hasProjectAssets(''), false);
  assert.equal(hasProjectAssets('/non/existent/path/App.csproj'), false);
});

test('hasProjectAssets detects obj/project.assets.json correctly', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dotnav-opt-test-'));
  try {
    const projPath = path.join(tempDir, 'MyProject.csproj');
    await fs.writeFile(projPath, '<Project Sdk="Microsoft.NET.Sdk"></Project>', 'utf8');

    // Before restore: assets do not exist
    assert.equal(hasProjectAssets(projPath), false);
    assert.equal(shouldUseNoRestore(projPath, 'build'), false);

    // Create fake obj/project.assets.json
    const objDir = path.join(tempDir, 'obj');
    await fs.mkdir(objDir, { recursive: true });
    await fs.writeFile(path.join(objDir, 'project.assets.json'), '{}', 'utf8');

    // After restore: assets exist
    assert.equal(hasProjectAssets(projPath), true);
    assert.equal(hasProjectAssets(tempDir), true);
    assert.equal(shouldUseNoRestore(projPath, 'build'), true);

    // Clean and rebuild always bypass --no-restore
    assert.equal(shouldUseNoRestore(projPath, 'rebuild'), false);
    assert.equal(shouldUseNoRestore(projPath, 'clean'), false);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});
