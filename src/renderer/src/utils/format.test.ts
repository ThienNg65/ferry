import { describe, expect, it } from 'vitest'
import { formatShortDate } from './format'

describe('formatShortDate', () => {
  const now = new Date(2026, 10, 10, 12, 0)

  it('shows time and no year within the current year', () => {
    const out = formatShortDate(new Date(2026, 10, 10, 14, 32).toISOString(), now)
    expect(out).toContain('14:32')
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
