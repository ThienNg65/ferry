import { describe, expect, it } from 'vitest'
import { compareEntries } from './fileSort'
import type { FileEntry } from '@shared/contract'

function entry(overrides: Partial<FileEntry>): FileEntry {
  return {
    name: 'a',
    path: '/a',
    isDir: false,
    size: 0,
    modifiedAt: null,
    isSymlink: false,
    ...overrides
  }
}

describe('compareEntries', () => {
  it('always sorts directories before files, regardless of column/direction', () => {
    const dir = entry({ name: 'zzz-dir', isDir: true })
    const file = entry({ name: 'aaa-file', isDir: false })
    expect(compareEntries('name', 'asc')(dir, file)).toBeLessThan(0)
    expect(compareEntries('name', 'desc')(dir, file)).toBeLessThan(0)
    expect(compareEntries('size', 'asc')(file, dir)).toBeGreaterThan(0)
  })

  it('sorts by name using localeCompare, honoring direction', () => {
    const a = entry({ name: 'apple' })
    const b = entry({ name: 'banana' })
    expect(compareEntries('name', 'asc')(a, b)).toBeLessThan(0)
    expect(compareEntries('name', 'desc')(a, b)).toBeGreaterThan(0)
  })

  it('sorts by size numerically', () => {
    const small = entry({ name: 'a', size: 10 })
    const big = entry({ name: 'b', size: 1000 })
    expect(compareEntries('size', 'asc')(small, big)).toBeLessThan(0)
    expect(compareEntries('size', 'desc')(small, big)).toBeGreaterThan(0)
  })

  it('sorts by modified date, treating a missing date as epoch 0', () => {
    const older = entry({ name: 'a', modifiedAt: '2020-01-01T00:00:00.000Z' })
    const newer = entry({ name: 'b', modifiedAt: '2024-01-01T00:00:00.000Z' })
    const undated = entry({ name: 'c', modifiedAt: null })
    expect(compareEntries('modified', 'asc')(older, newer)).toBeLessThan(0)
    expect(compareEntries('modified', 'asc')(undated, older)).toBeLessThan(0)
  })
})
