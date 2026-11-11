import { describe, expect, it } from 'vitest'
import { clampLocalPaneWidth } from './paneColumns'

describe('clampLocalPaneWidth', () => {
  it('keeps both panes at least 320px', () => {
    expect(clampLocalPaneWidth(10, 1000)).toBeCloseTo(32)
    expect(clampLocalPaneWidth(90, 1000)).toBeCloseTo(68)
    expect(clampLocalPaneWidth(50, 1000)).toBe(50)
  })
  it('never inverts on a very narrow viewport', () => {
    expect(clampLocalPaneWidth(10, 500)).toBe(50)
  })
})
