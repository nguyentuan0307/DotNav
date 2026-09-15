export const SEARCH_QUERY_DEBOUNCE_MS = 100;

export class LatestQueryScheduler {
  private timer?: NodeJS.Timeout;
  private generation = 0;

  constructor(private readonly update: (query: string) => void) {}

  public schedule(query: string): void {
    const generation = ++this.generation;
    if (this.timer) {
      clearTimeout(this.timer);
    }
    this.timer = setTimeout(() => {
      this.timer = undefined;
      if (generation === this.generation) {
        this.update(query);
      }
    }, SEARCH_QUERY_DEBOUNCE_MS);
  }

  public runNow(query: string): void {
    this.generation++;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    this.update(query);
  }

  public dispose(): void {
    this.generation++;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
  }
}
