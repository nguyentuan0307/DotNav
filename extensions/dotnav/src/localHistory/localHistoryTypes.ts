export type LocalHistoryEventKind = 'snapshot' | 'delete' | 'rename';
export type LocalHistoryEventSource = 'baseline' | 'save' | 'external' | 'command' | 'manual' | 'restore';

export interface LocalHistoryEvent {
  readonly id: string;
  readonly fileId: string;
  readonly kind: LocalHistoryEventKind;
  readonly timestamp: number;
  readonly path: string;
  readonly previousPath?: string;
  readonly contentHash?: string;
  readonly contentSize?: number;
  readonly source: LocalHistoryEventSource;
}

export interface LocalHistoryPolicy {
  readonly enabled: boolean;
  readonly retentionDays: number;
  readonly maximumStorageBytes: number;
  readonly maximumFileBytes: number;
  readonly maximumRevisionsPerFile: number;
  readonly snapshotCoalescingMs: number;
  readonly trackedExtensions: ReadonlySet<string>;
  readonly excludedDirectoryNames: ReadonlySet<string>;
}

export interface LocalHistoryRevision {
  readonly event: LocalHistoryEvent;
  readonly displayPath: string;
}

export interface LocalHistoryRevisionPage {
  readonly revisions: readonly LocalHistoryRevision[];
  readonly lookaheadRevision?: LocalHistoryRevision;
  readonly nextCursor?: string;
  readonly totalRevisions: number;
}
