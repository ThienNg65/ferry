export class FlowControl {
  private unacked = 0
  private paused = false

  constructor(
    private readonly pause: () => void,
    private readonly resume: () => void,
    private readonly highWater = 512 * 1024,
    private readonly lowWater = 128 * 1024
  ) {}

  sent(bytes: number): void {
    this.unacked += bytes
    if (!this.paused && this.unacked > this.highWater) {
      this.paused = true
      this.pause()
    }
  }

  ack(bytes: number): void {
    this.unacked = Math.max(0, this.unacked - bytes)
    if (this.paused && this.unacked < this.lowWater) {
      this.paused = false
      this.resume()
    }
  }
}
