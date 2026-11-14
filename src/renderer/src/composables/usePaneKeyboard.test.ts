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
    expect(selectRange).toHaveBeenLastCalledWith('/dir/file-24.txt')
    expect(scrollToIndex).toHaveBeenLastCalledWith(24)
  })
})
