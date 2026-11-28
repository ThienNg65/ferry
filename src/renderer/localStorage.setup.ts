// Node >= 25 ships an experimental global `localStorage` accessor that returns
// undefined unless Node starts with --localstorage-file. In the happy-dom test
// environment it shadows the DOM one (window === globalThis), so the renderer
// tests lose localStorage/sessionStorage. Install in-memory replacements then.
class MemoryStorage implements Storage {
  private data = new Map<string, string>()
  get length(): number {
    return this.data.size
  }
  clear(): void {
    this.data.clear()
  }
  getItem(key: string): string | null {
    return this.data.get(String(key)) ?? null
  }
  key(index: number): string | null {
    return [...this.data.keys()][index] ?? null
  }
  removeItem(key: string): void {
    this.data.delete(String(key))
  }
  setItem(key: string, value: string): void {
    this.data.set(String(key), String(value))
  }
  [name: string]: unknown
}

if (typeof (globalThis as { document?: unknown }).document !== 'undefined') {
  for (const name of ['localStorage', 'sessionStorage'] as const) {
    if (typeof globalThis[name] === 'undefined') {
      Object.defineProperty(globalThis, name, {
        value: new MemoryStorage(),
        configurable: true,
        writable: true
      })
    }
  }
}
