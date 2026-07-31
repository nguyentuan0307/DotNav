export interface RepositoryDomainCacheStats {
  readonly hits: number;
  readonly misses: number;
}

interface RepositoryDomainCacheEntry<T> {
  readonly expiresAt: number;
  readonly value: T;
}

export class RepositoryDomainCache<T> {
  private readonly values = new Map<string, RepositoryDomainCacheEntry<T>>();
  private readonly inFlight = new Map<string, Promise<T>>();
  private readonly generations = new Map<string, number>();
  private hitCount = 0;
  private missCount = 0;

  constructor(private readonly ttlMs: number) {}

  async read(
    root: string,
    loader: () => Promise<T>,
    options: { readonly force?: boolean; readonly shareInFlight?: boolean } = {}
  ): Promise<T> {
    const force = options.force === true;
    const shareInFlight = options.shareInFlight !== false;
    const cached = this.values.get(root);
    if (!force && cached && cached.expiresAt > Date.now()) {
      this.hitCount++;
      return cached.value;
    }
    if (!force && shareInFlight) {
      const running = this.inFlight.get(root);
      if (running) {
        this.hitCount++;
        return running;
      }
    }

    this.missCount++;
    const generation = this.generations.get(root) ?? 0;
    const request = loader();
    if (shareInFlight) this.inFlight.set(root, request);
    try {
      const value = await request;
      if ((this.generations.get(root) ?? 0) === generation) {
        this.values.set(root, { value, expiresAt: Date.now() + this.ttlMs });
      }
      return value;
    } finally {
      if (this.inFlight.get(root) === request) this.inFlight.delete(root);
    }
  }

  invalidate(root: string): void {
    this.generations.set(root, (this.generations.get(root) ?? 0) + 1);
    this.values.delete(root);
  }

  get stats(): RepositoryDomainCacheStats {
    return { hits: this.hitCount, misses: this.missCount };
  }
}
