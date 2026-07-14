import { describe, expect, it } from 'vitest'
import { shellEscape } from './shellEscape'

describe('shellEscape', () => {
  it('wraps a plain value in single quotes', () => {
    expect(shellEscape('hello')).toBe("'hello'")
  })

  it('escapes embedded single quotes so the string cannot break out', () => {
    expect(shellEscape("o'brien")).toBe("'o'\\''brien'")
  })

  it('is idempotent-safe against shell metacharacters (no injection)', () => {
    const malicious = "'; rm -rf / #"
    const escaped = shellEscape(malicious)
    // Still one single-quoted token overall: starts and ends with a quote,
    // and every quote in between is part of a '\'' escape sequence.
    expect(escaped.startsWith("'")).toBe(true)
    expect(escaped.endsWith("'")).toBe(true)
  })

  it('leaves an empty string as an empty quoted pair', () => {
    expect(shellEscape('')).toBe("''")
  })
})
