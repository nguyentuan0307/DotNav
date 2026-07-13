export async function runMutationLifecycle(
  operation: () => Promise<void>,
  refresh: () => Promise<void>,
  onSecondaryError?: (error: unknown) => void
): Promise<void> {
  let failure: unknown;
  try { await operation(); }
  catch (error) { failure = error; }
  try { await refresh(); }
  catch (error) {
    if (!failure) failure = error;
    else onSecondaryError?.(error);
  }
  if (failure) throw failure;
}

export class MutationBusyTracker {
  private readonly counts = new Map<string, number>();

  begin(repositoryId: string): number {
    const count = (this.counts.get(repositoryId) ?? 0) + 1;
    this.counts.set(repositoryId, count);
    return count;
  }

  end(repositoryId: string): number {
    const remaining = Math.max(0, (this.counts.get(repositoryId) ?? 0) - 1);
    if (remaining) this.counts.set(repositoryId, remaining);
    else this.counts.delete(repositoryId);
    return remaining;
  }

  isBusy(repositoryId: string): boolean { return (this.counts.get(repositoryId) ?? 0) > 0; }
  pending(repositoryId: string): number { return this.counts.get(repositoryId) ?? 0; }
}
