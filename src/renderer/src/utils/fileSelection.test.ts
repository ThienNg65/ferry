import { describe, expect, it } from 'vitest'
import { selectAll, selectOnly, selectRange, toggleSelect } from './fileSelection'
import type { FileEntry } from '@shared/contract'

function entry(path: string): FileEntry {
  return { name: path, path, isDir: false, size: 0, modifiedAt: null, isSymlink: false }
}

const entries = ['a', 'b', 'c', 'd', 'e'].map(entry)

describe('selectOnly', () => {
  it('selects exactly one path and sets it as the anchor', () => {
    const result = selectOnly('b')
    expect(result.selected).toEqual(new Set(['b']))
    expect(result.anchor).toBe('b')
  })
})

describe('toggleSelect', () => {
  it('adds a not-yet-selected path and moves the anchor to it', () => {
    const result = toggleSelect(new Set(['a']), 'b')
    expect(result.selected).toEqual(new Set(['a', 'b']))
    expect(result.anchor).toBe('b')
  })

  it('removes an already-selected path', () => {
    const result = toggleSelect(new Set(['a', 'b']), 'b')
    expect(result.selected).toEqual(new Set(['a']))
  })

  it('does not mutate the input set', () => {
    const input = new Set(['a'])
    toggleSelect(input, 'b')
    expect(input).toEqual(new Set(['a']))
  })
})

describe('selectRange', () => {
  it('selects every entry between anchor and target, inclusive, forward', () => {
    const result = selectRange(entries, 'b', 'd')
    expect(result.selected).toEqual(new Set(['b', 'c', 'd']))
    expect(result.anchor).toBe('b')
  })

  it('selects every entry between anchor and target, inclusive, when target is before anchor', () => {
    const result = selectRange(entries, 'd', 'b')
    expect(result.selected).toEqual(new Set(['b', 'c', 'd']))
    expect(result.anchor).toBe('d')
  })

  it('falls back to selectOnly(path) when there is no anchor yet', () => {
    const result = selectRange(entries, null, 'c')
    expect(result.selected).toEqual(new Set(['c']))
    expect(result.anchor).toBe('c')
  })

  it('falls back to selectOnly(path) when the anchor no longer exists in the listing', () => {
    const result = selectRange(entries, 'stale-path', 'c')
    expect(result.selected).toEqual(new Set(['c']))
  })
})

describe('selectAll', () => {
  it('selects every entry and clears the anchor', () => {
    const result = selectAll(entries)
    expect(result.selected).toEqual(new Set(['a', 'b', 'c', 'd', 'e']))
    expect(result.anchor).toBeNull()
  })
})
