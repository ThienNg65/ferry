import { describe, expect, it } from 'vitest'
import { contrastRatio, generateShadeRamp, isWarmAccent } from './colorRamp'

describe('generateShadeRamp', () => {
  it('produces all 11 shade keys as valid hex colors', () => {
    const ramp = generateShadeRamp('#0a84ff')
    const keys = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950] as const
    for (const key of keys) {
      expect(ramp[key]).toMatch(/^#[0-9a-f]{6}$/)
    }
  })

  it('gets monotonically darker from shade 50 to 950', () => {
    const ramp = generateShadeRamp('#0a84ff')
    const luminance = (hex: string): number => parseInt(hex.slice(1), 16)
    const keys = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950] as const
    for (let i = 1; i < keys.length; i++) {
      expect(luminance(ramp[keys[i]])).toBeLessThan(luminance(ramp[keys[i - 1]]))
    }
  })

  it('keeps the same hue family across shades regardless of the picked base color', () => {
    const greenRamp = generateShadeRamp('#22c55e')
    // Shade 500 should stay green-dominant (G channel highest), not drift toward the input's exact RGB.
    const [r, g, b] = [
      parseInt(greenRamp[500].slice(1, 3), 16),
      parseInt(greenRamp[500].slice(3, 5), 16),
      parseInt(greenRamp[500].slice(5, 7), 16)
    ]
    expect(g).toBeGreaterThan(r)
    expect(g).toBeGreaterThan(b)
  })

  it('handles a 3-digit hex shorthand', () => {
    const ramp = generateShadeRamp('#0af')
    expect(ramp[500]).toMatch(/^#[0-9a-f]{6}$/)
  })

  it('handles a grayscale input without throwing', () => {
    const ramp = generateShadeRamp('#808080')
    expect(ramp[500]).toMatch(/^#[0-9a-f]{6}$/)
  })

  it('meets WCAG AA 4.5:1 contrast for primary 600 on white and 400 on dark surface across bright hues', () => {
    for (const hex of ['#0a84ff', '#22c55e', '#14b8a6', '#f59e0b', '#ef4444', '#8b5cf6']) {
      const ramp = generateShadeRamp(hex)
      expect(contrastRatio(ramp[600], '#ffffff')).toBeGreaterThanOrEqual(4.5)
      expect(contrastRatio(ramp[400], '#18181b')).toBeGreaterThanOrEqual(4.5)
    }
  })
})

describe('isWarmAccent', () => {
  it('flags red, orange and amber accents', () => {
    // Gold/yellow (hue 50-60) reads as warning; hue 330+ is rose/red.
    for (const hex of ['#ef4444', '#f97316', '#f59e0b', '#e11d48', '#ffd700', '#fde047', '#ec4899']) expect(isWarmAccent(hex)).toBe(true)
  })

  it('accepts blue, purple, green, teal and greys', () => {
    for (const hex of ['#0a84ff', '#8b5cf6', '#22c55e', '#14b8a6', '#808080', '#a3a3a3']) expect(isWarmAccent(hex)).toBe(false)
  })
})
