/**
 * Bounds an incomplete streamed line so a remote peer cannot retain an
 * arbitrarily large record in memory while withholding its newline.
 */
export const MAX_BUFFERED_LINE_BYTES = 64 * 1024
export const TRUNCATED_LINE_SUFFIX = ' … [truncated]'

function utf8Prefix(value: string, maxBytes: number): string {
  let byteLength = 0
  let end = 0
  for (const character of value) {
    const characterBytes = Buffer.byteLength(character, 'utf8')
    if (byteLength + characterBytes > maxBytes) {
      break
    }
    byteLength += characterBytes
    end += character.length
  }
  return value.slice(0, end)
}

/**
 * Incrementally splits newline-delimited text while retaining at most
 * MAX_BUFFERED_LINE_BYTES of content for an incomplete line. Once a line
 * exceeds the limit, the remainder is discarded through its next newline and
 * the emitted prefix is explicitly marked as truncated.
 */
export class BoundedLineBuffer {
  private line = ''
  private lineBytes = 0
  private truncated = false

  constructor(private readonly maxBytes = MAX_BUFFERED_LINE_BYTES) {
    if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
      throw new RangeError('maxBytes must be a positive safe integer')
    }
  }

  push(chunk: string, onLine: (line: string) => void): void {
    let offset = 0
    while (offset < chunk.length) {
      const newline = chunk.indexOf('\n', offset)
      const end = newline === -1 ? chunk.length : newline
      this.append(chunk.slice(offset, end))

      if (newline === -1) {
        return
      }

      this.emit(onLine)
      offset = newline + 1
    }
  }

  flush(onLine: (line: string) => void): void {
    if (this.line.length > 0 || this.truncated) {
      this.emit(onLine)
    }
  }

  private append(value: string): void {
    if (this.truncated || value.length === 0) {
      return
    }

    const valueBytes = Buffer.byteLength(value, 'utf8')
    const remainingBytes = this.maxBytes - this.lineBytes
    if (valueBytes <= remainingBytes) {
      this.line += value
      this.lineBytes += valueBytes
      return
    }

    const prefix = utf8Prefix(value, remainingBytes)
    this.line += prefix
    this.lineBytes += Buffer.byteLength(prefix, 'utf8')
    this.truncated = true
  }

  private emit(onLine: (line: string) => void): void {
    const line = this.line + (this.truncated ? TRUNCATED_LINE_SUFFIX : '')
    this.line = ''
    this.lineBytes = 0
    this.truncated = false
    onLine(line)
  }
}
