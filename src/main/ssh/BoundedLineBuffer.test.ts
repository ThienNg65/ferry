import { describe, expect, it } from 'vitest'
import { BoundedLineBuffer, TRUNCATED_LINE_SUFFIX } from './BoundedLineBuffer'

describe('BoundedLineBuffer', () => {
  it('bounds chunked unterminated lines and resumes after the next newline', () => {
    const buffer = new BoundedLineBuffer(8)
    const lines: string[] = []

    buffer.push('1234', (line) => lines.push(line))
    buffer.push('5678', (line) => lines.push(line))
    buffer.push('9abc', (line) => lines.push(line))
    expect(lines).toEqual([])

    buffer.push('\nnext line\n', (line) => lines.push(line))

    expect(lines).toEqual(['12345678' + TRUNCATED_LINE_SUFFIX, 'next line'])
  })

  it('does not split a multibyte UTF-8 character at the byte limit', () => {
    const buffer = new BoundedLineBuffer(5)
    const lines: string[] = []

    buffer.push('ab😀overflow\n', (line) => lines.push(line))

    expect(lines).toEqual(['ab' + TRUNCATED_LINE_SUFFIX])
    expect(Buffer.byteLength(lines[0].slice(0, -TRUNCATED_LINE_SUFFIX.length), 'utf8')).toBe(2)
    expect(lines[0]).not.toContain('�')
  })

  it('does not mark a line that exactly reaches the byte limit as truncated', () => {
    const buffer = new BoundedLineBuffer(4)
    const lines: string[] = []

    buffer.push('éé\n', (line) => lines.push(line))

    expect(lines).toEqual(['éé'])
  })

  it('marks an oversized final line when the stream closes without a newline', () => {
    const buffer = new BoundedLineBuffer(4)
    const lines: string[] = []

    buffer.push('12345', (line) => lines.push(line))
    buffer.flush((line) => lines.push(line))

    expect(lines).toEqual(['1234' + TRUNCATED_LINE_SUFFIX])
  })

  it('rejects invalid buffer limits', () => {
    expect(() => new BoundedLineBuffer(0)).toThrow(RangeError)
    expect(() => new BoundedLineBuffer(Number.POSITIVE_INFINITY)).toThrow(RangeError)
  })
})
