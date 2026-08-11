import { createLocalHistoryPatch, LocalHistoryPatchHunk } from './localHistoryDiff';
import { LocalHistoryRevision } from './localHistoryTypes';

export interface LocalHistoryLineRange {
  readonly startLine: number;
  readonly endLine: number;
}

export interface LocalHistoryPanelEntry {
  readonly revision: LocalHistoryRevision;
  readonly previousRevision?: LocalHistoryRevision;
  readonly hunks?: readonly LocalHistoryPatchHunk[];
}

export interface LocalHistoryEntryPage {
  readonly entries: readonly LocalHistoryPanelEntry[];
  readonly hasMore: boolean;
  readonly totalRevisions?: number;
}

interface LineChange {
  readonly oldStart: number;
  readonly oldCount: number;
  readonly newStart: number;
  readonly newCount: number;
  readonly hunkIndex: number;
}

export function buildFileHistoryEntries(
  revisions: readonly LocalHistoryRevision[],
  lookaheadRevision?: LocalHistoryRevision
): LocalHistoryPanelEntry[] {
  return revisions.flatMap((revision, index) => {
    const previousRevision = revisions[index + 1] ?? lookaheadRevision;
    if (!previousRevision) {
      return [];
    }
    return [{ revision, previousRevision }];
  });
}

export class SelectionHistoryPager {
  private readonly contentCache = new Map<string, Promise<string>>();
  private revisionIndex = 0;
  private trackedRange: LocalHistoryLineRange | undefined;

  constructor(
    private readonly revisions: readonly LocalHistoryRevision[],
    selectedRange: LocalHistoryLineRange,
    private readonly readRevision: (revision: LocalHistoryRevision) => Promise<string>
  ) {
    this.trackedRange = selectedRange;
  }

  async next(pageSize = 50): Promise<LocalHistoryEntryPage> {
    const entries: LocalHistoryPanelEntry[] = [];
    const boundedPageSize = Math.max(1, Math.floor(pageSize));
    while (entries.length < boundedPageSize && this.hasMore()) {
      const revision = this.revisions[this.revisionIndex];
      const previousRevision = this.revisions[this.revisionIndex + 1];
      const [revisionContent, previousContent] = await Promise.all([
        this.readCached(revision),
        this.readCached(previousRevision)
      ]);
      const hunks = createLocalHistoryPatch(previousContent, revisionContent);
      const changes = extractLineChanges(hunks);
      const currentRange = this.trackedRange!;
      const relevantHunkIndexes = new Set(changes
        .filter(change => changeTouchesRange(change, currentRange))
        .map(change => change.hunkIndex));
      if (relevantHunkIndexes.size > 0) {
        entries.push({
          revision,
          previousRevision,
          hunks: hunks.filter((_hunk, hunkIndex) => relevantHunkIndexes.has(hunkIndex))
        });
      }
      this.trackedRange = mapRangeToPrevious(changes, currentRange);
      this.revisionIndex += 1;
    }
    return { entries, hasMore: this.hasMore() };
  }

  private hasMore(): boolean {
    return Boolean(this.trackedRange && this.revisionIndex < this.revisions.length - 1);
  }

  private readCached(revision: LocalHistoryRevision): Promise<string> {
    const revisionId = revision.event.id;
    const existing = this.contentCache.get(revisionId);
    if (existing) {
      return existing;
    }
    const content = this.readRevision(revision);
    this.contentCache.set(revisionId, content);
    return content;
  }
}

export async function buildSelectionHistoryEntries(
  revisions: readonly LocalHistoryRevision[],
  selectedRange: LocalHistoryLineRange,
  readRevision: (revision: LocalHistoryRevision) => Promise<string>
): Promise<LocalHistoryPanelEntry[]> {
  const pager = new SelectionHistoryPager(revisions, selectedRange, readRevision);
  const entries: LocalHistoryPanelEntry[] = [];
  let page: LocalHistoryEntryPage;
  do {
    page = await pager.next(50);
    entries.push(...page.entries);
  } while (page.hasMore);
  return entries;
}

export function extractLineChanges(hunks: readonly LocalHistoryPatchHunk[]): LineChange[] {
  const changes: LineChange[] = [];
  hunks.forEach((hunk, hunkIndex) => {
    const starts = parseHunkStarts(hunk.header);
    if (!starts) {
      return;
    }
    let oldCursor = starts.oldStart;
    let newCursor = starts.newStart;
    let current: Omit<LineChange, 'hunkIndex'> | undefined;
    const flush = () => {
      if (current) {
        changes.push({ ...current, hunkIndex });
        current = undefined;
      }
    };

    for (const line of hunk.lines) {
      if (line.kind === 'context') {
        flush();
        oldCursor += 1;
        newCursor += 1;
        continue;
      }
      current ??= { oldStart: oldCursor, oldCount: 0, newStart: newCursor, newCount: 0 };
      if (line.kind === 'del') {
        current = { ...current, oldCount: current.oldCount + 1 };
        oldCursor += 1;
      } else {
        current = { ...current, newCount: current.newCount + 1 };
        newCursor += 1;
      }
    }
    flush();
  });
  return changes;
}

export function mapRangeToPrevious(
  changes: readonly LineChange[],
  range: LocalHistoryLineRange
): LocalHistoryLineRange | undefined {
  let mappedStart = Number.POSITIVE_INFINITY;
  let mappedEnd = Number.NEGATIVE_INFINITY;
  for (let line = range.startLine; line <= range.endLine; line++) {
    const mapped = mapLineToPrevious(changes, line);
    if (mapped !== undefined) {
      mappedStart = Math.min(mappedStart, mapped);
      mappedEnd = Math.max(mappedEnd, mapped);
    }
  }
  if (!Number.isFinite(mappedStart)) {
    return undefined;
  }
  return {
    startLine: mappedStart,
    endLine: mappedEnd
  };
}

function mapLineToPrevious(changes: readonly LineChange[], newLine: number): number | undefined {
  let delta = 0;
  for (const change of changes) {
    if (newLine < change.newStart) {
      break;
    }
    if (change.newCount > 0 && newLine < change.newStart + change.newCount) {
      if (change.oldCount === 0) {
        return undefined;
      }
      return change.oldStart + Math.min(newLine - change.newStart, change.oldCount - 1);
    }
    delta += change.oldCount - change.newCount;
  }
  return Math.max(1, newLine + delta);
}

function changeTouchesRange(change: LineChange, range: LocalHistoryLineRange): boolean {
  if (change.newCount === 0) {
    return change.newStart > range.startLine && change.newStart <= range.endLine;
  }
  const changeEnd = change.newStart + change.newCount - 1;
  return change.newStart <= range.endLine && changeEnd >= range.startLine;
}

function parseHunkStarts(header: string): { oldStart: number; newStart: number } | undefined {
  const match = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(header);
  return match ? { oldStart: Number(match[1]), newStart: Number(match[2]) } : undefined;
}
