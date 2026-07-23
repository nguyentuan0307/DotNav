// Serial promise queue for `dotnet ef` invocations. Guarantees at most one EF
// process at a time (design §7.1). Pure module — no vscode imports.

export interface QueueEntry {
  readonly label: string;
  readonly write: boolean;
}

export interface QueueSnapshot {
  readonly running?: QueueEntry;
  readonly pending: readonly QueueEntry[];
}

export class QueueCancelledError extends Error {
  constructor(message = 'Command was cancelled before it started.') {
    super(message);
    this.name = 'QueueCancelledError';
  }
}

interface Job<T = unknown> {
  readonly entry: QueueEntry;
  readonly run: () => Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (error: unknown) => void;
  cancelled: boolean;
}

export class SerialQueue {
  private readonly jobs: Job[] = [];
  private runningJob: Job | undefined;
  private pumping = false;
  private readonly listeners = new Set<(snapshot: QueueSnapshot) => void>();

  onDidChange(listener: (snapshot: QueueSnapshot) => void): { dispose(): void } {
    this.listeners.add(listener);
    return { dispose: () => this.listeners.delete(listener) };
  }

  get snapshot(): QueueSnapshot {
    return {
      running: this.runningJob?.entry,
      pending: this.jobs.filter(job => !job.cancelled).map(job => job.entry)
    };
  }

  get busy(): boolean {
    return this.runningJob !== undefined || this.jobs.some(job => !job.cancelled);
  }

  get runningEntry(): QueueEntry | undefined {
    return this.runningJob?.entry;
  }

  enqueue<T>(label: string, write: boolean, run: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const job: Job<T> = { entry: { label, write }, run, resolve, reject, cancelled: false };
      this.jobs.push(job as Job);
      this.notify();
      void this.pump();
    });
  }

  /** Cancels every job that has not started yet. The running job is unaffected. */
  clearPending(): number {
    let cleared = 0;
    for (const job of this.jobs) {
      if (!job.cancelled) {
        job.cancelled = true;
        cleared += 1;
        job.reject(new QueueCancelledError());
      }
    }

    this.jobs.length = 0;
    if (cleared > 0) {
      this.notify();
    }

    return cleared;
  }

  private async pump(): Promise<void> {
    if (this.pumping) {
      return;
    }

    this.pumping = true;
    try {
      for (;;) {
        const job = this.jobs.shift();
        if (!job) {
          return;
        }

        if (job.cancelled) {
          continue;
        }

        this.runningJob = job;
        this.notify();
        try {
          const value = await job.run();
          job.resolve(value);
        } catch (error) {
          job.reject(error);
        } finally {
          this.runningJob = undefined;
          this.notify();
        }
      }
    } finally {
      this.pumping = false;
    }
  }

  private notify(): void {
    const snapshot = this.snapshot;
    for (const listener of this.listeners) {
      try {
        listener(snapshot);
      } catch {
        // Listeners must never break the queue.
      }
    }
  }
}

/** Monotonic generation counter per key (design §7.3). */
export class GenerationTracker {
  private readonly generations = new Map<string, number>();

  current(key: string): number {
    return this.generations.get(key) ?? 0;
  }

  bump(key: string): number {
    const next = this.current(key) + 1;
    this.generations.set(key, next);
    return next;
  }

  bumpAll(): void {
    for (const key of this.generations.keys()) {
      this.generations.set(key, (this.generations.get(key) ?? 0) + 1);
    }
  }

  isCurrent(key: string, generation: number): boolean {
    return this.current(key) === generation;
  }
}
