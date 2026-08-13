import * as fs from 'fs/promises';
import * as path from 'path';
import { FingerprintSession, sameFingerprint } from './fingerprints';
import { BuildFileCopy } from './types';

export interface CopySynchronizationResult {
  readonly copied: BuildFileCopy[];
  readonly failed: Array<{ readonly copy: BuildFileCopy; readonly error: string }>;
}

/** Copies only explicitly evaluated CopyToOutputDirectory items and verifies bytes after each copy. */
export async function synchronizeCopies(copies: readonly BuildFileCopy[]): Promise<CopySynchronizationResult> {
  const copied: BuildFileCopy[] = [];
  const failed: Array<{ copy: BuildFileCopy; error: string }> = [];
  for (const copy of copies) {
    try {
      if (samePath(copy.source, copy.destination)) {
        copied.push(copy);
        continue;
      }
      await fs.mkdir(path.dirname(copy.destination), { recursive: true });
      await fs.copyFile(copy.source, copy.destination);
      if (process.platform !== 'win32') {
        const sourceStat = await fs.stat(copy.source);
        await fs.chmod(copy.destination, sourceStat.mode);
      }
      const fingerprints = new FingerprintSession();
      const [source, destination] = await Promise.all([
        fingerprints.fingerprint(copy.source), fingerprints.fingerprint(copy.destination)
      ]);
      if (!source || !destination || !sameFingerprint(source, destination)) {
        throw new Error('destination verification failed');
      }
      copied.push(copy);
    } catch (error) {
      failed.push({ copy, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return { copied, failed };
}

function samePath(left: string, right: string): boolean {
  const a = path.resolve(left);
  const b = path.resolve(right);
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}
