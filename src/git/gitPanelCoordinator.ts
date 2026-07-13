export type GitReadChannel = string;

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
    if (effectiveGeneration > current) this.generations.set(repositoryId, effectiveGeneration);
    const identity = { repositoryId, generation: effectiveGeneration, requestId: this.nextRequestId++ };
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

  invalidate(repositoryId: string): void {
    this.advance(repositoryId);
    for (const [channel, identity] of this.active) {
      if (identity.repositoryId === repositoryId) this.active.delete(channel);
    }
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
