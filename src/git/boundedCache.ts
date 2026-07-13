export class BoundedCache<T> {
  private readonly values = new Map<string, T>();

  constructor(private readonly capacity: number) {}

  get(key: string): T | undefined {
    const value = this.values.get(key);
    if (value === undefined) return undefined;
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

  get size(): number { return this.values.size; }
}
