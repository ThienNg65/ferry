import { describe, expect, it } from 'vitest'
import { zebraRowClass } from './rowStyle'

describe('zebraRowClass', () => {
  it('returns no class for even indexes', () => {
    expect(zebraRowClass(0)).toBe('')
    expect(zebraRowClass(2)).toBe('')
    expect(zebraRowClass(100)).toBe('')
  })

  it('returns the zebra class for odd indexes', () => {
    expect(zebraRowClass(1)).toBe('bg-muted/40')
    expect(zebraRowClass(3)).toBe('bg-muted/40')
  })
})
