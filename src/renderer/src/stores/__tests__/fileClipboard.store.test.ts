import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { FileEntry } from '@shared/contract'
import { useFileClipboardStore } from '../fileClipboard.store'

function makeEntry(name: string, dir = false): FileEntry {
  return {
    name,
    path: `/dir/${name}`,
    isDir: dir,
    size: dir ? 0 : 42,
    modifiedAt: '2026-11-27T00:00:00.000Z',
    isSymlink: false
  }
}

describe('fileClipboard.store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('stores copied entries with snapshot isolation and clears cleanly', () => {
    const store = useFileClipboardStore()
    expect(store.hasItems).toBe(false)
    expect(store.count).toBe(0)

    store.copy('local', [], null)
    expect(store.hasItems).toBe(false)

    const source = [makeEntry('notes.txt'), makeEntry('docs', true)]
    store.copy('local', source, 'sess-ignored')
    source[0].name = 'mutated.txt'

    expect(store.hasItems).toBe(true)
    expect(store.count).toBe(2)
    expect(store.sourceSide).toBe('local')
    expect(store.payload?.sessionId).toBeNull()
    expect(store.payload?.entries[0].name).toBe('notes.txt')

    store.clear()
    expect(store.hasItems).toBe(false)
    expect(store.count).toBe(0)
    expect(store.payload).toBeNull()
  })

  it('enforces canPasteInto rules across local and remote sessions', () => {
    const store = useFileClipboardStore()
    expect(store.canPasteInto('local', null, false)).toBe(false)

    store.copy('local', [makeEntry('a.txt')], null)
    expect(store.canPasteInto('local', null, false)).toBe(true)
    expect(store.canPasteInto('remote', null, false)).toBe(false)
    expect(store.canPasteInto('remote', 'sess-1', false)).toBe(false)
    expect(store.canPasteInto('remote', 'sess-1', true)).toBe(true)

    store.copy('remote', [makeEntry('b.txt')], 'sess-1')
    expect(store.payload?.sessionId).toBe('sess-1')
    expect(store.canPasteInto('remote', 'sess-1', true)).toBe(true)
    expect(store.canPasteInto('local', 'sess-1', true)).toBe(true)
    expect(store.canPasteInto('remote', 'sess-2', true)).toBe(false)
    expect(store.canPasteInto('local', 'sess-2', true)).toBe(false)
    expect(store.canPasteInto('local', 'sess-1', false)).toBe(false)
  })
})
