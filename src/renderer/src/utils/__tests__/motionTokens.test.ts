// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FERRY_MOTION_TOKENS, prefersReducedMotion } from '../motionTokens'

function mockReducedMotion(matches: boolean): void {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: query.includes('prefers-reduced-motion') ? matches : false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn()
    }))
  )
}

describe('motionTokens', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('exposes canonical durations with exits faster than standard entrances', () => {
    expect(FERRY_MOTION_TOKENS.duration).toEqual({
      instant: 100,
      fast: 120,
      exit: 140,
      standard: 170,
      panel: 210,
      considered: 360,
      spring: 440
    })
    expect(FERRY_MOTION_TOKENS.duration.exit).toBeLessThan(FERRY_MOTION_TOKENS.duration.standard)
  })

  it('exposes CSS cubic-bezier curves and critically damped linear() spring curve', () => {
    expect(FERRY_MOTION_TOKENS.ease.emphasized).toBe('cubic-bezier(0.16, 1, 0.3, 1)')
    expect(FERRY_MOTION_TOKENS.ease.standard).toBe('cubic-bezier(0.22, 1, 0.36, 1)')
    expect(FERRY_MOTION_TOKENS.ease.out).toBe('cubic-bezier(0.2, 0.8, 0.2, 1)')
    expect(FERRY_MOTION_TOKENS.ease.exit).toBe('cubic-bezier(0.7, 0, 0.84, 0)')
    expect(FERRY_MOTION_TOKENS.ease.inOut).toBe('cubic-bezier(0.65, 0, 0.35, 1)')
    expect(FERRY_MOTION_TOKENS.ease.spring.startsWith('linear(0,')).toBe(true)
    expect(FERRY_MOTION_TOKENS.ease.spring.endsWith(', 1)')).toBe(true)
  })

  it('detects prefers-reduced-motion media query safely', () => {
    mockReducedMotion(false)
    expect(prefersReducedMotion()).toBe(false)

    mockReducedMotion(true)
    expect(prefersReducedMotion()).toBe(true)
  })
})
