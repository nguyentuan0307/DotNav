import * as fs from 'fs/promises';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { LocalHistoryEvent } from './localHistoryTypes';

const journalFileName = 'events.jsonl';

export class EventJournal {
  private readonly journalPath: string;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(private readonly storageRoot: string) {
    this.journalPath = path.join(storageRoot, journalFileName);
  }

  async initialize(): Promise<void> {
    await fs.mkdir(this.storageRoot, { recursive: true });
  }

  async readAll(): Promise<LocalHistoryEvent[]> {
    let content: string;
    try {
      content = await fs.readFile(this.journalPath, 'utf8');
    } catch (error) {
      if (isNotFound(error)) {
        return [];
      }
      throw error;
    }

    return parseJournal(content);
  }

  append(event: LocalHistoryEvent): Promise<void> {
    this.writeQueue = this.writeQueue.then(() => fs.appendFile(this.journalPath, `${JSON.stringify(event)}\n`, 'utf8'));
    return this.writeQueue;
  }

  rewrite(events: readonly LocalHistoryEvent[]): Promise<void> {
    this.writeQueue = this.writeQueue.then(async () => {
      const temporaryPath = `${this.journalPath}.${randomUUID()}.tmp`;
      const content = events.map(event => JSON.stringify(event)).join('\n');
      await fs.writeFile(temporaryPath, content.length > 0 ? `${content}\n` : '', 'utf8');
      await fs.rename(temporaryPath, this.journalPath);
    });
    return this.writeQueue;
  }
}

export function parseJournal(content: string): LocalHistoryEvent[] {
  const events: LocalHistoryEvent[] = [];
  for (const line of content.split('\n')) {
    if (line.trim().length === 0) {
      continue;
    }
    try {
      const event = JSON.parse(line) as LocalHistoryEvent;
      if (isLocalHistoryEvent(event)) {
        events.push(event);
      }
    } catch {
      // A crash can leave the final JSONL record incomplete. Valid records remain usable.
    }
  }
  return events;
}

function isLocalHistoryEvent(value: LocalHistoryEvent): boolean {
  return typeof value?.id === 'string'
    && typeof value.fileId === 'string'
    && typeof value.path === 'string'
    && typeof value.timestamp === 'number'
    && ['snapshot', 'delete', 'rename'].includes(value.kind);
}

function isNotFound(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT');
}
