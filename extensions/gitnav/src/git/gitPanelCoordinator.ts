export type GitReadChannel = string;
export type LocalRefreshKind = 'status' | 'history';

export interface GitRequestIdentity {
  readonly repositoryId: string;
  readonly generation: number;
  readonly requestId: number;
}

export class GitRequestCoordinator {
  private nextRequestId = 1;
  private readonly generations = new Map<string, number>();
  private readonly active = new Map<GitReadChannel, GitRequestIdentity>();

  begin(channel: GitReadChannel, repositoryId: string, generation?: number): GitRequestIdentity {
    const current = this.generations.get(repositoryId) ?? 0;
    const effectiveGeneration = generation ?? current;
    const identity = { repositoryId, generation: effectiveGeneration, requestId: this.nextRequestId++ };
    if (effectiveGeneration < current) return identity;
    if (effectiveGeneration > current) this.generations.set(repositoryId, effectiveGeneration);
    this.active.set(channel, identity);
    return identity;
  }

  advance(repositoryId: string): number {
    const generation = (this.generations.get(repositoryId) ?? 0) + 1;
    this.generations.set(repositoryId, generation);
    return generation;
  }

  isCurrent(channel: GitReadChannel, identity: GitRequestIdentity, selectedRepositoryId: string | undefined): boolean {
    const active = this.active.get(channel);
    return selectedRepositoryId === identity.repositoryId
      && active?.requestId === identity.requestId
      && active.generation === identity.generation
      && (this.generations.get(identity.repositoryId) ?? 0) === identity.generation;
  }

  isGenerationCurrent(identity: GitRequestIdentity, selectedRepositoryId: string | undefined): boolean {
    return selectedRepositoryId === identity.repositoryId
      && (this.generations.get(identity.repositoryId) ?? 0) === identity.generation;
  }

  invalidate(repositoryId: string): void {
    this.advance(repositoryId);
    for (const [channel, identity] of this.active) {
      if (identity.repositoryId === repositoryId) this.active.delete(channel);
    }
  }
}

export class RepositoryValueStore<T> {
  private readonly values = new Map<string, T>();

  get(repositoryId: string, fallback: T): T {
    return this.values.get(repositoryId) ?? fallback;
  }

  set(repositoryId: string, value: T): void {
    this.values.set(repositoryId, value);
  }
}

export class LocalRepositoryRefreshScheduler {
  private readonly pending = new Map<string, { kind: LocalRefreshKind; timer: NodeJS.Timeout }>();

  constructor(
    private readonly callback: (root: string, kind: LocalRefreshKind) => void,
    private readonly delayMs = 180
  ) {}

  schedule(root: string, kind: LocalRefreshKind): void {
    const existing = this.pending.get(root);
    if (existing) clearTimeout(existing.timer);
    const effectiveKind = existing?.kind === 'history' || kind === 'history' ? 'history' : 'status';
    const timer = setTimeout(() => {
      this.pending.delete(root);
      this.callback(root, effectiveKind);
    }, this.delayMs);
    this.pending.set(root, { kind: effectiveKind, timer });
  }

  dispose(): void {
    for (const pending of this.pending.values()) clearTimeout(pending.timer);
    this.pending.clear();
  }
}

export class RepositoryMutationQueue {
  private readonly tails = new Map<string, Promise<void>>();
  private readonly busy = new Set<string>();

  isBusy(repositoryId: string): boolean { return this.busy.has(repositoryId); }

  enqueue<T>(repositoryId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(repositoryId) ?? Promise.resolve();
    const result = previous.catch(() => undefined).then(async () => {
      this.busy.add(repositoryId);
      try { return await operation(); }
      finally { this.busy.delete(repositoryId); }
    });
    const tail = result.then(() => undefined, () => undefined);
    this.tails.set(repositoryId, tail);
    tail.finally(() => { if (this.tails.get(repositoryId) === tail) this.tails.delete(repositoryId); });
    return result;
  }
}

export class CoalescedRefreshRunner {
  private running?: Promise<void>;
  private requested = false;

  run(operation: () => Promise<void>): Promise<void> {
    this.requested = true;
    if (!this.running) {
      this.running = this.drain(operation).finally(() => { this.running = undefined; });
    }
    return this.running;
  }

  private async drain(operation: () => Promise<void>): Promise<void> {
    let failure: unknown;
    do {
      this.requested = false;
      try { await operation(); }
      catch (error) { failure ??= error; }
    } while (this.requested);
    if (failure) throw failure;
  }
}

export class InFlightOperationGuard {
  private readonly active = new Set<string>();

  tryEnter(key: string): boolean {
    if (this.active.has(key)) return false;
    this.active.add(key);
    return true;
  }

  leave(key: string): void { this.active.delete(key); }
}
