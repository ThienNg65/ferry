import { describe, expect, it } from 'vitest'
import { clampColumnWidth, defaultColumnPrefs, parseColumnPrefs } from './columnPrefs'

describe('columnPrefs', () => {
  it('falls back to defaults for missing or corrupt input', () => {
    expect(parseColumnPrefs(null)).toEqual(defaultColumnPrefs())
    expect(parseColumnPrefs('{nope')).toEqual(defaultColumnPrefs())
  })

  it('keeps valid hidden keys, clamps widths, and ignores junk', () => {
    const out = parseColumnPrefs(JSON.stringify({ hidden: ['size', 'bogus'], widths: { size: 9999, modified: 'x', permissions: 10 } }))
    expect(out.hidden).toEqual(['size'])
    expect(out.widths.size).toBe(320)
    expect(out.widths.modified).toBe(128)
    expect(out.widths.permissions).toBe(48)
    expect(clampColumnWidth(100.4)).toBe(100)
  })
})
