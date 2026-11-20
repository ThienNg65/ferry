import { describe, expect, it } from 'vitest'
import { formatDateTime, formatShortDate, formatSpeed } from './format'

describe('formatShortDate', () => {
  const now = new Date(2026, 10, 10, 12, 0)

  it('shows time and no year within the current year', () => {
    const out = formatShortDate(new Date(2026, 10, 10, 14, 32).toISOString(), now)
    expect(out).toMatch(/32/)
    expect(out).not.toContain('2026')
  })

  it('shows the year and no time for other years', () => {
    const out = formatShortDate(new Date(2025, 10, 10, 14, 32).toISOString(), now)
    expect(out).toContain('2025')
    expect(out).not.toContain('14:32')
  })

  it('returns an empty string for null', () => {
    expect(formatShortDate(null, now)).toBe('')
  })
})

describe('formatDateTime and formatSpeed', () => {
  it('formats a timestamp and returns an empty string for null', () => {
    expect(formatDateTime(new Date(2026, 10, 10, 14, 32).getTime())).toContain('2026')
    expect(formatDateTime(null)).toBe('')
  })

  it('formats a speed with the shared byte formatter', () => {
    expect(formatSpeed(1536)).toBe('1.5 KB/s')
  })
})
