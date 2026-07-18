import { describe, expect, it } from 'vitest'
import { clampDockHeight, MIN_DOCK_HEIGHT } from './ui.store'

describe('clampDockHeight', () => {
  it('floors a too-small value at MIN_DOCK_HEIGHT', () => {
    expect(clampDockHeight(0, 1200)).toBe(MIN_DOCK_HEIGHT)
    expect(clampDockHeight(-50, 1200)).toBe(MIN_DOCK_HEIGHT)
  })

  it('caps at 70% of window height when that is the tighter bound', () => {
    // 70% of 2000 = 1400, which is well under (2000 - 260) = 1740.
    expect(clampDockHeight(5000, 2000)).toBe(1400)
  })

  it('caps at (window - reserved chrome) when that is the tighter bound', () => {
    // At a small window, window - 260 is tighter than 70% of window.
    // 600 - 260 = 340 < 600 * 0.7 = 420.
    expect(clampDockHeight(5000, 600)).toBe(340)
  })

  it('still yields at least MIN_DOCK_HEIGHT even at a tiny window', () => {
    expect(clampDockHeight(5000, 100)).toBe(MIN_DOCK_HEIGHT)
  })

  it('passes through an in-range value unchanged', () => {
    expect(clampDockHeight(300, 1200)).toBe(300)
  })
})
