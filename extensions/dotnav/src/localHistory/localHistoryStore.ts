import * as path from 'path';
import { randomUUID } from 'crypto';
import { ContentStore } from './contentStore';
import { EventJournal } from './eventJournal';
import {
  LocalHistoryEvent,
  LocalHistoryEventSource,
  LocalHistoryRevision,
  LocalHistoryRevisionPage
} from './localHistoryTypes';

export class LocalHistoryStore {
  private readonly journal: EventJournal;
  private readonly contents: ContentStore;
  private events: LocalHistoryEvent[] = [];
  private readonly currentFileIds = new Map<string, string>();
  private readonly knownFileIds = new Map<string, string>();
  private readonly latestEventsByFileId = new Map<string, LocalHistoryEvent>();
  private readonly snapshotEventsByFileId = new Map<string, LocalHistoryEvent[]>();
  private operationQueue: Promise<void> = Promise.resolve();

  constructor(storageRoot: string) {
    this.journal = new EventJournal(storageRoot);
    this.contents = new ContentStore(storageRoot);
  }

  async initialize(retentionDays: number, maximumStorageBytes: number, maximumRevisionsPerFile = 250): Promise<void> {
    await Promise.all([this.journal.initialize(), this.contents.initialize()]);
    this.events = await this.journal.readAll();
    this.rebuildIndexes();
    await this.prune(retentionDays, maximumStorageBytes, maximumRevisionsPerFile);
  }

  snapshot(filePath: string, content: Uint8Array, source: LocalHistoryEventSource): Promise<LocalHistoryEvent | undefined> {
    return this.enqueue(async () => {
      const normalizedPath = path.resolve(filePath);
      const pathKey = normalizePathKey(normalizedPath);
      const fileId = this.currentFileIds.get(pathKey) ?? randomUUID();
      const contentHash = this.contents.hash(content);
      const latest = this.latestEvent(fileId);
      if (latest?.kind === 'snapshot' && latest.contentHash === contentHash && latest.path === normalizedPath) {
        return undefined;
      }

      await this.contents.put(content, contentHash);
      const event: LocalHistoryEvent = {
        id: randomUUID(),
        fileId,
        kind: 'snapshot',
        timestamp: Date.now(),
        path: normalizedPath,
        contentHash,
        contentSize: content.byteLength,
        source
      };
      await this.append(event);
      return event;
    });
  }

  recordDelete(filePath: string, source: LocalHistoryEventSource): Promise<void> {
    return this.enqueue(async () => {
      const normalizedPath = path.resolve(filePath);
      const fileId = this.currentFileIds.get(normalizePathKey(normalizedPath));
      if (!fileId) {
        return;
      }
      await this.append({
        id: randomUUID(),
        fileId,
        kind: 'delete',
        timestamp: Date.now(),
        path: normalizedPath,
        source
      });
    });
  }

  recordRename(previousPath: string, nextPath: string, source: LocalHistoryEventSource): Promise<void> {
    return this.enqueue(async () => {
      const normalizedPreviousPath = path.resolve(previousPath);
      const normalizedNextPath = path.resolve(nextPath);
      const fileId = this.currentFileIds.get(normalizePathKey(normalizedPreviousPath));
      if (!fileId) {
        return;
      }
      await this.append({
        id: randomUUID(),
        fileId,
        kind: 'rename',
        timestamp: Date.now(),
        path: normalizedNextPath,
        previousPath: normalizedPreviousPath,
        source
      });
    });
  }

  getRevisions(filePath: string): LocalHistoryRevision[] {
    const normalizedPath = path.resolve(filePath);
    const fileId = this.currentFileIds.get(normalizePathKey(normalizedPath))
      ?? this.knownFileIds.get(normalizePathKey(normalizedPath));
    if (!fileId) {
      return [];
    }

    return (this.snapshotEventsByFileId.get(fileId) ?? [])
      .map(event => ({ event, displayPath: event.path }))
      .reverse();
  }

  getRevisionPage(filePath: string, cursor: string | undefined, pageSize: number): LocalHistoryRevisionPage {
    const revisions = this.getRevisions(filePath);
    const totalRevisions = Math.max(0, revisions.length - 1);
    const boundedPageSize = Math.max(1, Math.floor(pageSize));
    let startIndex = 0;
    if (cursor) {
      const cursorIndex = revisions.findIndex(revision => revision.event.id === cursor);
      if (cursorIndex < 0) {
        return { revisions: [], totalRevisions };
      }
      startIndex = cursorIndex + 1;
    }

    const pageRevisions = revisions.slice(startIndex, Math.min(startIndex + boundedPageSize, totalRevisions));
    const nextIndex = startIndex + pageRevisions.length;
    return {
      revisions: pageRevisions,
      lookaheadRevision: pageRevisions.length > 0 ? revisions[nextIndex] : undefined,
      nextCursor: nextIndex < totalRevisions ? pageRevisions.at(-1)?.event.id : undefined,
      totalRevisions
    };
  }

  waitForIdle(): Promise<void> {
    return this.operationQueue;
  }

  async readRevision(revision: LocalHistoryRevision): Promise<Buffer> {
    if (!revision.event.contentHash) {
      throw new Error('The selected local history revision has no stored content.');
    }
    return this.contents.get(revision.event.contentHash);
  }

  async prune(retentionDays: number, maximumStorageBytes: number, maximumRevisionsPerFile = 250): Promise<void> {
    await this.enqueue(async () => {
      const cutoff = Date.now() - Math.max(1, retentionDays) * 24 * 60 * 60 * 1000;
      let retained = retainNewestSnapshotsPerFile(
        this.events.filter(event => event.timestamp >= cutoff),
        maximumRevisionsPerFile + 1
      );
      const hashes = uniqueContentHashes(retained);
      const objectSizes = await this.contents.sizes([...hashes]);

      retained = retainWithinStorageLimit(retained, objectSizes, maximumStorageBytes);
      if (retained.length !== this.events.length) {
        this.events = retained;
        await this.journal.rewrite(this.events);
        this.rebuildIndexes();
      }
      await this.contents.removeUnreferenced(uniqueContentHashes(this.events));
    });
  }

  private async append(event: LocalHistoryEvent): Promise<void> {
    await this.journal.append(event);
    this.events.push(event);
    this.applyToIndexes(event);
  }

  private latestEvent(fileId: string): LocalHistoryEvent | undefined {
    return this.latestEventsByFileId.get(fileId);
  }

  private rebuildIndexes(): void {
    this.currentFileIds.clear();
    this.knownFileIds.clear();
    this.latestEventsByFileId.clear();
    this.snapshotEventsByFileId.clear();
    for (const event of this.events) {
      this.applyToIndexes(event);
    }
  }

  private applyToIndexes(event: LocalHistoryEvent): void {
    this.latestEventsByFileId.set(event.fileId, event);
    this.knownFileIds.set(normalizePathKey(event.path), event.fileId);
    if (event.previousPath) {
      this.knownFileIds.set(normalizePathKey(event.previousPath), event.fileId);
    }
    if (event.kind === 'snapshot') {
      const snapshots = this.snapshotEventsByFileId.get(event.fileId) ?? [];
      snapshots.push(event);
      this.snapshotEventsByFileId.set(event.fileId, snapshots);
    }
    if (event.previousPath) {
      this.currentFileIds.delete(normalizePathKey(event.previousPath));
    }
    if (event.kind === 'delete') {
      this.currentFileIds.delete(normalizePathKey(event.path));
      return;
    }
    this.currentFileIds.set(normalizePathKey(event.path), event.fileId);
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.operationQueue.then(operation, operation);
    this.operationQueue = result.then(() => undefined, () => undefined);
    return result;
  }
}

export function retainWithinStorageLimit(
  events: readonly LocalHistoryEvent[],
  objectSizes: ReadonlyMap<string, number>,
  maximumStorageBytes: number
): LocalHistoryEvent[] {
  const references = new Map<string, number>();
  for (const event of events) {
    if (event.contentHash) {
      references.set(event.contentHash, (references.get(event.contentHash) ?? 0) + 1);
    }
  }
  let total = [...references.keys()].reduce((sum, hash) => sum + (objectSizes.get(hash) ?? 0), 0);
  let firstRetainedIndex = 0;
  while (total > maximumStorageBytes && firstRetainedIndex < events.length) {
    const removed = events[firstRetainedIndex++];
    if (!removed.contentHash) {
      continue;
    }
    const remainingReferences = (references.get(removed.contentHash) ?? 1) - 1;
    if (remainingReferences === 0) {
      references.delete(removed.contentHash);
      total -= objectSizes.get(removed.contentHash) ?? 0;
    } else {
      references.set(removed.contentHash, remainingReferences);
    }
  }
  return events.slice(firstRetainedIndex);
}

export function retainNewestSnapshotsPerFile(
  events: readonly LocalHistoryEvent[],
  maximumSnapshotsPerFile: number
): LocalHistoryEvent[] {
  const snapshotCounts = new Map<string, number>();
  const retained: LocalHistoryEvent[] = [];
  for (let index = events.length - 1; index >= 0; index--) {
    const event = events[index];
    if (event.kind !== 'snapshot') {
      retained.push(event);
      continue;
    }
    const count = (snapshotCounts.get(event.fileId) ?? 0) + 1;
    snapshotCounts.set(event.fileId, count);
    if (count <= maximumSnapshotsPerFile) {
      retained.push(event);
    }
  }
  return retained.reverse();
}

function uniqueContentHashes(events: readonly LocalHistoryEvent[]): Set<string> {
  return new Set(events.flatMap(event => event.contentHash ? [event.contentHash] : []));
}

function normalizePathKey(filePath: string): string {
  const normalized = path.normalize(filePath);
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}
