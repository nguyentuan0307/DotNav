import { createHash } from 'crypto';
import * as fs from 'fs';
import * as fsp from 'fs/promises';
import { StoredFileFingerprint } from './buildStateStore';

export class FingerprintSession {
  private readonly cache = new Map<string, Promise<StoredFileFingerprint | undefined>>();

  private key(filePath: string): string {
    return process.platform === 'win32' ? filePath.toLowerCase() : filePath;
  }

  fingerprint(filePath: string): Promise<StoredFileFingerprint | undefined> {
    const k = this.key(filePath);
    let pending = this.cache.get(k);
    if (!pending) {
      pending = fingerprintFile(filePath);
      this.cache.set(k, pending);
    }
    return pending;
  }

  fingerprintAgainst(
    filePath: string,
    previous: StoredFileFingerprint | undefined,
    knownChanged = false
  ): Promise<StoredFileFingerprint | undefined> {
    if (!previous || knownChanged) return this.fingerprint(filePath);
    const k = this.key(filePath);
    let pending = this.cache.get(k);
    if (!pending) {
      pending = fingerprintFileAgainst(filePath, previous);
      this.cache.set(k, pending);
    }
    return pending;
  }
}

export function stableFingerprint(value: unknown): string {
  return createHash('sha256').update(stableJson(value)).digest('hex');
}

export function sameFingerprint(left: StoredFileFingerprint, right: StoredFileFingerprint): boolean {
  return left.size === right.size && left.sha256 === right.sha256;
}

export async function mapConcurrent<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  if (items.length === 0) return [];
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (nextIndex < items.length) {
      const current = nextIndex++;
      results[current] = await fn(items[current], current);
    }
  });
  await Promise.all(workers);
  return results;
}

async function fingerprintFile(filePath: string): Promise<StoredFileFingerprint | undefined> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const before = await fsp.stat(filePath);
      if (!before.isFile()) return undefined;
      const sha256 = await hashFile(filePath);
      const after = await fsp.stat(filePath);
      if (before.size === after.size && before.mtimeMs === after.mtimeMs) {
        return { size: after.size, mtimeMs: after.mtimeMs, sha256 };
      }
    } catch {
      return undefined;
    }
  }
  return undefined;
}

async function fingerprintFileAgainst(
  filePath: string,
  previous: StoredFileFingerprint
): Promise<StoredFileFingerprint | undefined> {
  try {
    const stat = await fsp.stat(filePath);
    if (!stat.isFile()) return undefined;
    if (stat.size === previous.size && stat.mtimeMs === previous.mtimeMs) return previous;
  } catch {
    return undefined;
  }
  return fingerprintFile(filePath);
}

function hashFile(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('error', reject);
    stream.on('data', chunk => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(',')}}`;
}
