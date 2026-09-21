export class BoundedCache<T> {
  private readonly values = new Map<string, T>();

  constructor(private readonly capacity: number) {}

  has(key: string): boolean {
    return this.values.has(key);
  }

  get(key: string): T | undefined {
    if (!this.values.has(key)) return undefined;
    const value = this.values.get(key) as T;
    this.values.delete(key);
    this.values.set(key, value);
    return value;
  }

  set(key: string, value: T): void {
    this.values.delete(key);
    this.values.set(key, value);
    while (this.values.size > this.capacity) this.values.delete(this.values.keys().next().value!);
  }

  deletePrefix(prefix: string): void {
    for (const key of this.values.keys()) if (key.startsWith(prefix)) this.values.delete(key);
  }

  clear(): void {
    this.values.clear();
  }

  get size(): number { return this.values.size; }
}
