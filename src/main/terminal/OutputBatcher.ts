export class OutputBatcher {
  private chunks: Buffer[] = []
  private size = 0
  private timer: NodeJS.Timeout | null = null

  constructor(
    private readonly emit: (data: Uint8Array) => void,
    private readonly delayMs = 8,
    private readonly maxBytes = 64 * 1024
  ) {}

  push(chunk: Buffer): void {
    this.chunks.push(chunk)
    this.size += chunk.length
    if (this.size >= this.maxBytes) {
      this.flush()
    } else if (this.timer === null) {
      this.timer = setTimeout(() => this.flush(), this.delayMs)
    }
  }

  flush(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer)
      this.timer = null
    }
    if (this.size === 0) {
      return
    }
    const merged = Buffer.concat(this.chunks, this.size)
    this.chunks = []
    this.size = 0
    this.emit(new Uint8Array(merged))
  }
}
