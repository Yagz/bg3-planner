/** A `Storage` held in a Map, whose writes can be made to fail like a full or blocked `localStorage`. */
export class MemoryBackend implements Storage {
  readonly items = new Map<string, string>();
  failWrites: string | null = null;
  failReads: string | null = null;

  get length(): number {
    this.checkRead();
    return this.items.size;
  }

  key(index: number): string | null {
    this.checkRead();
    return [...this.items.keys()][index] ?? null;
  }

  getItem(key: string): string | null {
    this.checkRead();
    return this.items.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    if (this.failWrites !== null) throw new DOMException("The quota has been exceeded.", this.failWrites);
    this.items.set(key, String(value));
  }

  removeItem(key: string): void {
    if (this.failWrites !== null) throw new DOMException("The quota has been exceeded.", this.failWrites);
    this.items.delete(key);
  }

  clear(): void {
    this.items.clear();
  }

  private checkRead(): void {
    if (this.failReads !== null) throw new DOMException("Access denied.", this.failReads);
  }

  [name: string]: unknown;
}
