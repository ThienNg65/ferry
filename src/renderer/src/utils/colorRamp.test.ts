import { describe, expect, it } from 'vitest'
import { generateShadeRamp } from './colorRamp'

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
})
