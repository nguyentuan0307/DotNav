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

export type GitFetchScope =
  | { readonly kind: 'all' }
  | { readonly kind: 'branch'; readonly branch: string };

class ActiveGitFetch {
  constructor(
    readonly root: string,
    readonly scope: GitFetchScope,
    readonly promise: Promise<void>
  ) {}
}

export class GitFetchCoordinator {
  private readonly active = new Map<string, ActiveGitFetch[]>();

  run(root: string, scope: GitFetchScope, operation: () => Promise<void>): Promise<void> {
    const existing = this.active.get(root)?.find(fetch => this.covers(fetch.scope, scope));
    if (existing) return existing.promise;

    let fetch!: ActiveGitFetch;
    const promise = operation().finally(() => {
      const remaining = (this.active.get(root) ?? []).filter(item => item !== fetch);
      if (remaining.length) this.active.set(root, remaining);
      else this.active.delete(root);
    });
    fetch = new ActiveGitFetch(root, scope, promise);
    this.active.set(root, [...(this.active.get(root) ?? []), fetch]);
    return promise;
  }

  private covers(active: GitFetchScope, requested: GitFetchScope): boolean {
    return active.kind === 'all'
      || (requested.kind === 'branch' && active.kind === 'branch' && active.branch === requested.branch);
  }
}

export class CoalescedRefreshRunner {
  private running?: Promise<void>;

  run(operation: () => Promise<void>): Promise<void> {
    if (!this.running) this.running = operation().finally(() => { this.running = undefined; });
    return this.running;
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
