import * as fs from 'fs';
import { once } from 'events';
import * as readline from 'readline';
import { pipeline } from 'stream/promises';
import * as zlib from 'zlib';

export const SEARCH_CACHE_VERSION = 8;
export const SEARCH_CACHE_CHUNK_SIZE = 100;
export const SEARCH_CACHE_SAVE_IDLE_MS = 15000;
export const SEARCH_CACHE_SAVE_MAX_MS = 60000;
const CPU_SLICE_MS = 8;

export async function yieldToExtensionHost(): Promise<void> {
  await new Promise<void>(resolve => setImmediate(resolve));
}

export async function writeGzipNdjson(filePath: string, records: Iterable<unknown>): Promise<void> {
  const tempPath = `${filePath}.tmp`;
  const gzip = zlib.createGzip({ level: 6 });
  const output = fs.createWriteStream(tempPath);
  const completed = pipeline(gzip, output);
  let sliceStartedAt = Date.now();

  try {
    for (const record of records) {
      if (!gzip.write(`${JSON.stringify(record)}\n`)) {
        await once(gzip, 'drain');
      }
      if (Date.now() - sliceStartedAt >= CPU_SLICE_MS) {
        await yieldToExtensionHost();
        sliceStartedAt = Date.now();
      }
    }
    gzip.end();
    await completed;
    await fs.promises.rename(tempPath, filePath);
  } catch (error) {
    gzip.destroy();
    output.destroy();
    await completed.catch(() => {});
    await fs.promises.unlink(tempPath).catch(() => {});
    throw error;
  }
}

export async function* readGzipNdjson(filePath: string): AsyncGenerator<unknown> {
  const input = fs.createReadStream(filePath).pipe(zlib.createGunzip());
  const lines = readline.createInterface({ input, crlfDelay: Infinity });
  let sliceStartedAt = Date.now();

  try {
    for await (const line of lines) {
      if (!line.trim()) continue;
      yield JSON.parse(line);
      if (Date.now() - sliceStartedAt >= CPU_SLICE_MS) {
        await yieldToExtensionHost();
        sliceStartedAt = Date.now();
      }
    }
  } finally {
    lines.close();
    input.destroy();
  }
}
