export class OutputBatcher {
  private chunks: Buffer[] = []
  private size = 0
  private cooldownTimer: NodeJS.Timeout | null = null

  constructor(
    private readonly emit: (data: Buffer) => void,
    private readonly delayMs = 8,
    private readonly maxBytes = 64 * 1024
  ) {}

  push(chunk: Buffer): void {
    if (chunk.length === 0) {
      return
    }
    // Leading-edge emit when idle so interactive character echo has 0ms batcher delay;
    // any follow-up chunks within delayMs coalesce into the next window.
    if (this.cooldownTimer === null && this.size === 0) {
      this.armCooldown()
      this.emit(chunk)
      return
    }
    this.chunks.push(chunk)
    this.size += chunk.length
    if (this.size >= this.maxBytes) {
      this.flushBuffered()
    } else if (this.cooldownTimer === null) {
      this.armCooldown()
    }
  }

  private armCooldown(): void {
    this.cooldownTimer = setTimeout(() => {
      this.cooldownTimer = null
      if (this.size > 0) {
        this.flushBuffered()
        this.armCooldown()
      }
    }, this.delayMs)
  }

  private flushBuffered(): void {
    if (this.size === 0) {
      return
    }
    const merged = this.chunks.length === 1 ? this.chunks[0] : Buffer.concat(this.chunks, this.size)
    this.chunks = []
    this.size = 0
    this.emit(merged)
  }

  flush(): void {
    if (this.cooldownTimer !== null) {
      clearTimeout(this.cooldownTimer)
      this.cooldownTimer = null
    }
    this.flushBuffered()
  }
}
