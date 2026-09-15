import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { test } from 'node:test';
import { UniversalSymbol } from '../solutionSearch/searchModel';
import { DiskSymbolStore } from '../solutionSearch/searchDiskStore';
import { UniversalSymbolIndex } from '../solutionSearch/searchScanner';
import { readGzipNdjson, writeGzipNdjson } from '../solutionSearch/streamingCache';

const Module = require('module');
const originalLoad = Module._load;
Module._load = function(request: string, parent: any, isMain: boolean) {
  if (request === 'vscode') {
    return {
      workspace: { workspaceFolders: [], getConfiguration: () => ({ get: () => true }) },
      extensions: { getExtension: () => undefined }
    };
  }
  return originalLoad(request, parent, isMain);
};
const { getCacheFilePath, loadSnapshotFromDisk, saveSnapshotToDisk } = require('../solutionSearch/searchCommands');
Module._load = originalLoad;

function createSymbols(filePath: string, count: number): UniversalSymbol[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `${filePath}:${index + 1}:class:Symbol${index}`,
    name: `Symbol${index}`,
    kind: 'class' as const,
    filePath,
    relativePath: path.basename(filePath),
    projectName: 'App',
    line: index + 1,
    column: 1
  }));
}

test('hot search cache v8 streams chunks, round-trips, and rejects an incomplete cache', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dotnav-hot-cache-v8-'));
  const context = { storageUri: { fsPath: tempDir } };
  const filePath = '/src/LargeSymbols.cs';
  const index = new UniversalSymbolIndex();
  index.beginSnapshotLoad();
  index.loadSnapshotFile(filePath, 1700000000000, createSymbols(filePath, 205));
  index.finishSnapshotLoad();

  const legacyPath = path.join(tempDir, 'dotnav_search_cache_default.json.gz');
  const previousPath = path.join(tempDir, 'dotnav_search_cache_v7_default.ndjson.gz');
  fs.writeFileSync(legacyPath, 'legacy');
  await writeGzipNdjson(previousPath, [
    { type: 'dotnav-search-cache', version: 7 },
    { type: 'complete', fileCount: 0 }
  ]);
  assert.equal(await loadSnapshotFromDisk(context, new UniversalSymbolIndex()), false);
  assert.equal(await saveSnapshotToDisk(context, index), true);

  const cachePath = getCacheFilePath(context);
  assert.ok(cachePath.endsWith('dotnav_search_cache_v8_default.ndjson.gz'));
  assert.equal(fs.existsSync(`${cachePath}.tmp`), false);
  assert.equal(fs.existsSync(legacyPath), false);
  assert.equal(fs.existsSync(previousPath), false);

  const records: any[] = [];
  for await (const record of readGzipNdjson(cachePath)) records.push(record);
  const fileRecords = records.filter(record => record.type === 'file');
  assert.deepEqual(fileRecords.map(record => record.symbols.length), [100, 100, 5]);
  assert.deepEqual(records.at(-1), { type: 'complete', fileCount: 1 });

  const restored = new UniversalSymbolIndex();
  assert.equal(await loadSnapshotFromDisk(context, restored), true);
  assert.equal(restored.count, 205);
  assert.equal(restored.getFileTimestamp(filePath), 1700000000000);

  await writeGzipNdjson(cachePath, [
    { type: 'dotnav-search-cache', version: 8 },
    { type: 'file', filePath, mtime: 1, symbols: createSymbols(filePath, 1) }
  ]);
  assert.equal(await loadSnapshotFromDisk(context, restored), false);
  assert.equal(restored.count, 0);
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('cold symbol cache v8 preserves empty markers and rejects corrupt gzip data', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dotnav-cold-cache-v8-'));
  const store = new DiskSymbolStore(tempDir);
  store.registerFileSymbols('/src/Empty.cs', 'Empty.cs', 'App', []);
  store.registerFileSymbols('/src/Large.cs', 'Large.cs', 'App', createSymbols('/src/Large.cs', 205));
  const legacyPath = path.join(tempDir, 'cold_symbols.gz');
  const previousPath = path.join(tempDir, 'cold_symbols_v7.ndjson.gz');
  fs.writeFileSync(legacyPath, 'legacy');
  await writeGzipNdjson(previousPath, [
    { type: 'dotnav-cold-symbols', version: 7 },
    { type: 'complete', fileCount: 0 }
  ]);
  assert.equal(await new DiskSymbolStore(tempDir).loadFromDisk(), false);

  await store.saveToDisk();
  assert.equal(fs.existsSync(legacyPath), false);
  assert.equal(fs.existsSync(previousPath), false);
  assert.equal(fs.existsSync(`${store.storagePath}.tmp`), false);

  const records: any[] = [];
  for await (const record of readGzipNdjson(store.storagePath)) records.push(record);
  assert.deepEqual(
    records.filter(record => record.type === 'file').map(record => record.symbols.length),
    [0, 100, 100, 5]
  );

  const restored = new DiskSymbolStore(tempDir);
  assert.equal(await restored.loadFromDisk(), true);
  assert.equal(restored.hasFile('/src/Empty.cs'), true);
  assert.equal(restored.count, 205);

  fs.writeFileSync(store.storagePath, 'not gzip');
  assert.equal(await restored.loadFromDisk(), false);
  assert.equal(restored.count, 0);
  store.clear();
  restored.clear();
  fs.rmSync(tempDir, { recursive: true, force: true });
});
