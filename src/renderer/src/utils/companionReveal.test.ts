import { describe, expect, it } from 'vitest'
import { planReveal, REVEAL_MAX_TOTAL_MS, REVEAL_TICK_MS } from './companionReveal'

const words = (n: number) => Array.from({ length: n }, (_, i) => `w${i}`).join(' ')

describe('planReveal', () => {
  it('groups 3 words per chunk for short replies', () => {
    const plan = planReveal(words(9), false)!
    expect(plan.chunks).toHaveLength(3)
    expect(plan.tickMs).toBe(REVEAL_TICK_MS)
  })

  it('caps a long reply at 20 chunks within the total duration', () => {
    const plan = planReveal(words(1500), false)!
    expect(plan.chunks.length).toBeLessThanOrEqual(REVEAL_MAX_TOTAL_MS / REVEAL_TICK_MS)
    expect(plan.chunks.length * plan.tickMs).toBeLessThanOrEqual(REVEAL_MAX_TOTAL_MS)
  })

  it('joins back to the exact text, keeping newlines and leading whitespace', () => {
    const text = '  First line here.\n\nSecond   paragraph with more words and a tail \n'
    expect(planReveal(text, false)!.chunks.join('')).toBe(text)
  })

  it('returns null under reduced motion', () => {
    expect(planReveal(words(30), true)).toBeNull()
  })

  it('returns null for empty text or a single chunk', () => {
    expect(planReveal('   ', false)).toBeNull()
    expect(planReveal('two words', false)).toBeNull()
  })
})
