import { describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import type { FileEntry } from '@shared/contract'

vi.mock('../stores/ui.store', () => ({
  useUiStore: () => ({ showLocalPane: true, toggleShowHidden: vi.fn() })
}))

class DummyEl {}
Object.assign(globalThis, {
  HTMLInputElement: DummyEl,
  HTMLTextAreaElement: DummyEl,
  HTMLElement: DummyEl
})

const { usePaneKeyboard } = await import('./usePaneKeyboard')

function makeEntries(count: number): FileEntry[] {
  return Array.from({ length: count }, (_, i) => ({
    name: `file-${i}.txt`,
    path: `/dir/file-${i}.txt`,
    isDir: false,
    isSymlink: false,
    size: 10,
    modifiedAt: '2026-11-14T00:00:00.000Z'
  }))
}

function makeKeyEvent(key: string, shiftKey = false): KeyboardEvent {
  return {
    key,
    shiftKey,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    target: null,
    preventDefault: vi.fn()
  } as unknown as KeyboardEvent
}

describe('usePaneKeyboard Home/End/PageUp/PageDown', () => {
  it('navigates with Home, End, PageDown, PageUp and supports Shift range selection', async () => {
    const entries = makeEntries(25)
    const selected = new Set<string>(['/dir/file-2.txt'])
    const selectOnly = vi.fn((path: string) => {
      selected.clear()
      selected.add(path)
    })
    const selectRange = vi.fn((path: string) => {
      selected.add(path)
    })
    const scrollToIndex = vi.fn()

    const onKeydown = usePaneKeyboard({
      side: 'local',
      store: { selected, selectOnly, selectRange } as never,
      renamingPath: ref(null),
      filterText: ref(''),
      filteredEntries: ref(entries),
      toolbarRef: ref(null),
      fileListRef: ref({ scrollToIndex }),
      onTransferSelected: vi.fn(),
      onOpen: vi.fn(),
      confirmDeleteEntries: vi.fn()
    })

    await onKeydown(makeKeyEvent('PageDown'))
    expect(selectOnly).toHaveBeenLastCalledWith('/dir/file-12.txt')
    expect(scrollToIndex).toHaveBeenLastCalledWith(12)

    await onKeydown(makeKeyEvent('PageUp'))
    expect(selectOnly).toHaveBeenLastCalledWith('/dir/file-2.txt')

    await onKeydown(makeKeyEvent('Home'))
    expect(selectOnly).toHaveBeenLastCalledWith('/dir/file-0.txt')

    await onKeydown(makeKeyEvent('End', true))
    expect(selectRange).toHaveBeenLastCalledWith('/dir/file-24.txt', entries)
    expect(scrollToIndex).toHaveBeenLastCalledWith(24)
  })

  it('Delete only targets visible selected entries and ignores hidden selections', async () => {
    const allEntries = makeEntries(3)
    const visibleEntries = [allEntries[0], allEntries[2]]
    const selected = new Set<string>(['/dir/file-0.txt', '/dir/file-1.txt'])
    const confirmDeleteEntries = vi.fn().mockResolvedValue(undefined)

    const onKeydown = usePaneKeyboard({
      side: 'remote',
      store: { entries: allEntries, selected } as never,
      renamingPath: ref(null),
      filterText: ref(''),
      filteredEntries: ref(visibleEntries),
      toolbarRef: ref(null),
      fileListRef: ref(null),
      onTransferSelected: vi.fn(),
      onOpen: vi.fn(),
      confirmDeleteEntries
    })

    await onKeydown(makeKeyEvent('Delete'))
    expect(confirmDeleteEntries).toHaveBeenCalledWith([allEntries[0]])
  })

  it('Escape clears search filterText or selection without clearing external visibility filter state', async () => {
    const entries = makeEntries(2)
    const selected = new Set<string>(['/dir/file-0.txt'])
    const selectAll = vi.fn(() => selected.clear())
    const filterText = ref('file')

    const onKeydown = usePaneKeyboard({
      side: 'remote',
      store: { entries, selected, selectAll } as never,
      renamingPath: ref(null),
      filterText,
      filteredEntries: ref(entries),
      toolbarRef: ref(null),
      fileListRef: ref(null),
      onTransferSelected: vi.fn(),
      onOpen: vi.fn(),
      confirmDeleteEntries: vi.fn()
    })

    await onKeydown(makeKeyEvent('Escape'))
    expect(filterText.value).toBe('')
    expect(selectAll).not.toHaveBeenCalled()

    await onKeydown(makeKeyEvent('Escape'))
    expect(selectAll).toHaveBeenCalledWith([])
  })

  it('F2, Enter, ArrowDown, and ContextMenu scope to visible selected entries when hidden selections exist', async () => {
    const allEntries = makeEntries(4)
    // file-0.txt is hidden by filter; file-2.txt is visible and selected alongside file-0.txt
    const visibleEntries = [allEntries[1], allEntries[2], allEntries[3]]
    const selected = new Set<string>(['/dir/file-0.txt', '/dir/file-2.txt'])
    const renamingPath = ref<string | null>(null)
    const scrollToIndex = vi.fn()
    const selectOnly = vi.fn()
    const onOpen = vi.fn()

    const dispatched: string[] = []
    vi.stubGlobal('MouseEvent', class {
      type: string
      constructor(type: string) {
        this.type = type
      }
    })
    vi.stubGlobal('document', {
      querySelectorAll: () => [
        {
          dataset: { rowPath: '/dir/file-2.txt' },
          getBoundingClientRect: () => ({ left: 10, bottom: 20 }),
          dispatchEvent: () => {
            dispatched.push('/dir/file-2.txt')
            return true
          }
        }
      ]
    })

    const onKeydown = usePaneKeyboard({
      side: 'remote',
      store: { entries: allEntries, selected, selectOnly } as never,
      renamingPath,
      filterText: ref(''),
      filteredEntries: ref(visibleEntries),
      toolbarRef: ref(null),
      fileListRef: ref({ scrollToIndex }),
      onTransferSelected: vi.fn(),
      onOpen,
      confirmDeleteEntries: vi.fn()
    })

    await onKeydown(makeKeyEvent('F2'))
    expect(renamingPath.value).toBe('/dir/file-2.txt')
    renamingPath.value = null

    await onKeydown(makeKeyEvent('Enter'))
    expect(onOpen).toHaveBeenCalledWith(allEntries[2])

    await onKeydown(makeKeyEvent('ArrowDown'))
    // file-2.txt is at index 1 in visibleEntries, so ArrowDown moves to index 2 (file-3.txt), not index 0 (file-1.txt)
    expect(selectOnly).toHaveBeenLastCalledWith('/dir/file-3.txt')

    await onKeydown(makeKeyEvent('ContextMenu'))
    expect(dispatched).toEqual(['/dir/file-2.txt'])

    // Even when hidden file-0.txt is the last-inserted entry in the Set, ArrowDown starts from visible file-2.txt
    selected.clear()
    selected.add('/dir/file-2.txt')
    selected.add('/dir/file-0.txt')
    await onKeydown(makeKeyEvent('ArrowDown'))
    expect(selectOnly).toHaveBeenLastCalledWith('/dir/file-3.txt')
  })
})
