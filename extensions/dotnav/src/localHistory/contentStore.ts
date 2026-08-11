import * as fs from 'fs/promises';
import * as path from 'path';
import { createHash } from 'crypto';
import { gzip, gunzip } from 'zlib';
import { promisify } from 'util';

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);

export interface ContentWriteResult {
  readonly hash: string;
  readonly compressedSize: number;
  readonly created: boolean;
}

export class ContentStore {
  private readonly objectsRoot: string;

  constructor(storageRoot: string) {
    this.objectsRoot = path.join(storageRoot, 'objects');
  }

  async initialize(): Promise<void> {
    await fs.mkdir(this.objectsRoot, { recursive: true });
  }

  hash(content: Uint8Array): string {
    return createHash('sha256').update(content).digest('hex');
  }

  async put(content: Uint8Array, hash: string): Promise<ContentWriteResult> {
    const objectPath = this.pathFor(hash);
    try {
      const stat = await fs.stat(objectPath);
      return { hash, compressedSize: stat.size, created: false };
    } catch {
      // The content is new.
    }

    await fs.mkdir(path.dirname(objectPath), { recursive: true });
    const compressed = await gzipAsync(content);
    const temporaryPath = `${objectPath}.${process.pid}.tmp`;
    await fs.writeFile(temporaryPath, compressed);
    try {
      await fs.rename(temporaryPath, objectPath);
    } catch (error) {
      await fs.rm(temporaryPath, { force: true });
      try {
        await fs.access(objectPath);
      } catch {
        throw error;
      }
    }
    return { hash, compressedSize: compressed.byteLength, created: true };
  }

  async get(hash: string): Promise<Buffer> {
    return gunzipAsync(await fs.readFile(this.pathFor(hash)));
  }

  async size(hash: string): Promise<number> {
    try {
      return (await fs.stat(this.pathFor(hash))).size;
    } catch {
      return 0;
    }
  }

  async sizes(hashes: readonly string[], concurrency = 16): Promise<Map<string, number>> {
    const result = new Map<string, number>();
    let nextIndex = 0;
    const workers = Array.from({ length: Math.min(concurrency, hashes.length) }, async () => {
      while (nextIndex < hashes.length) {
        const hash = hashes[nextIndex++];
        result.set(hash, await this.size(hash));
      }
    });
    await Promise.all(workers);
    return result;
  }

  async removeUnreferenced(referencedHashes: ReadonlySet<string>): Promise<void> {
    let prefixes: string[];
    try {
      prefixes = await fs.readdir(this.objectsRoot);
    } catch {
      return;
    }

    const pathsToRemove: string[] = [];
    for (const prefix of prefixes) {
      const prefixPath = path.join(this.objectsRoot, prefix);
      const entries = await fs.readdir(prefixPath, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isFile()) {
          continue;
        }
        const hash = `${prefix}${entry.name}`;
        if (!referencedHashes.has(hash)) {
          pathsToRemove.push(path.join(prefixPath, entry.name));
        }
      }
    }
    let nextIndex = 0;
    const workers = Array.from({ length: Math.min(16, pathsToRemove.length) }, async () => {
      while (nextIndex < pathsToRemove.length) {
        await fs.rm(pathsToRemove[nextIndex++], { force: true });
      }
    });
    await Promise.all(workers);
  }

  private pathFor(hash: string): string {
    return path.join(this.objectsRoot, hash.slice(0, 2), hash.slice(2));
  }
}
