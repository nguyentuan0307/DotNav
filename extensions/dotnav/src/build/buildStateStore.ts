import * as fs from 'fs/promises';
import * as path from 'path';

export const buildStateSchemaVersion = 1;

export interface StoredFileFingerprint {
  readonly size: number;
  readonly mtimeMs: number;
  readonly sha256: string;
}

export interface StoredProjectState {
  readonly projectFingerprint: string;
  readonly inputs: Record<string, StoredFileFingerprint>;
  readonly outputs: Record<string, StoredFileFingerprint>;
  readonly referenceAssemblySha256?: string;
  readonly implementationAssemblySha256?: string;
  readonly lastSuccessfulBuildStart: number;
  readonly lastSuccessfulBuildEnd: number;
}

export interface StoredBuildState {
  readonly schemaVersion: number;
  readonly graphFingerprint: string;
  readonly projects: Record<string, StoredProjectState>;
}

export class BuildStateStore {
  private state?: StoredBuildState;
  private loaded = false;

  constructor(private readonly directory: string) {}

  async load(): Promise<StoredBuildState | undefined> {
    if (this.loaded) return this.state;
    this.loaded = true;
    try {
      const content = await fs.readFile(this.statePath, 'utf8');
      const parsed = JSON.parse(content) as StoredBuildState;
      if (parsed.schemaVersion !== buildStateSchemaVersion || typeof parsed.projects !== 'object') {
        return undefined;
      }
      this.state = parsed;
      return parsed;
    } catch {
      return undefined;
    }
  }

  async save(state: StoredBuildState): Promise<void> {
    await fs.mkdir(this.directory, { recursive: true });
    const temporaryPath = `${this.statePath}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(temporaryPath, JSON.stringify(state), 'utf8');
    await fs.rename(temporaryPath, this.statePath);
    this.state = state;
    this.loaded = true;
  }

  async clear(): Promise<void> {
    this.state = undefined;
    this.loaded = true;
    try {
      await fs.unlink(this.statePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }

  private get statePath(): string {
    return path.join(this.directory, 'solution-state.json');
  }
}
