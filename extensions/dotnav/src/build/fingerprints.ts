import { createHash } from 'crypto';
import * as fs from 'fs';
import * as fsp from 'fs/promises';
import { StoredFileFingerprint } from './buildStateStore';

export class FingerprintSession {
  private readonly cache = new Map<string, Promise<StoredFileFingerprint | undefined>>();

  fingerprint(filePath: string): Promise<StoredFileFingerprint | undefined> {
    let pending = this.cache.get(filePath);
    if (!pending) {
      pending = fingerprintFile(filePath);
      this.cache.set(filePath, pending);
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
