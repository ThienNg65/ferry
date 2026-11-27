import { describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import type { FileEntry } from '@shared/contract'

vi.mock('../stores/ui.store', () => ({
  useUiStore: () => ({ showLocalPane: true, toggleShowHidden: vi.fn() })
}))

class DummyHTMLElement {
  isContentEditable = false
  private readonly selectorMatch: string | null
  constructor(selectorMatch: string | null = null) {
    this.selectorMatch = selectorMatch
  }
  closest(selector: string): object | null {
    return this.selectorMatch && selector.includes(this.selectorMatch) ? this : null
  }
}
class DummyInputElement extends DummyHTMLElement {}
class DummyTextAreaElement extends DummyHTMLElement {}
class DummySelectElement extends DummyHTMLElement {}
Object.assign(globalThis, {
  HTMLInputElement: DummyInputElement,
  HTMLTextAreaElement: DummyTextAreaElement,
  HTMLSelectElement: DummySelectElement,
  HTMLElement: DummyHTMLElement
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

  it('extends Shift+ArrowUp multi-row selection upward beyond one item', async () => {
    const entries = makeEntries(6)
    let selected = new Set<string>(['/dir/file-4.txt'])
    let anchor: string | null = '/dir/file-4.txt'
    const store = {
      get selected() {
        return selected
      },
      selectOnly: (p: string) => {
        selected = new Set([p])
        anchor = p
      },
      selectRange: (p: string) => {
        const a = entries.findIndex((e) => e.path === anchor)
        const b = entries.findIndex((e) => e.path === p)
        const lo = Math.min(a, b)
        const hi = Math.max(a, b)
        selected = new Set(entries.slice(lo, hi + 1).map((e) => e.path))
      }
    }

    const onKeydown = usePaneKeyboard({
      side: 'local',
      store: store as never,
      renamingPath: ref(null),
      filterText: ref(''),
      filteredEntries: ref(entries),
      toolbarRef: ref(null),
      fileListRef: ref({ scrollToIndex: vi.fn() }),
      onTransferSelected: vi.fn(),
      onOpen: vi.fn(),
      confirmDeleteEntries: vi.fn()
    })

    await onKeydown(makeKeyEvent('ArrowUp', true))
    expect([...selected]).toEqual(['/dir/file-3.txt', '/dir/file-4.txt'])

    await onKeydown(makeKeyEvent('ArrowUp', true))
    expect([...selected]).toEqual(['/dir/file-2.txt', '/dir/file-3.txt', '/dir/file-4.txt'])
  })

  it('supports Ctrl/Cmd+C and Ctrl/Cmd+V with input, selection, terminal, and dialog guards', async () => {
    const entries = makeEntries(2)
    const selected = new Set<string>(['/dir/file-0.txt'])
    const onCopySelected = vi.fn()
    const onPaste = vi.fn().mockResolvedValue(undefined)
    let pasteReady = false
    const renamingPath = ref<string | null>(null)

    const onKeydown = usePaneKeyboard({
      side: 'local',
      store: { entries, selected } as never,
      renamingPath,
      filterText: ref(''),
      filteredEntries: ref(entries),
      toolbarRef: ref(null),
      fileListRef: ref(null),
      onTransferSelected: vi.fn(),
      onOpen: vi.fn(),
      confirmDeleteEntries: vi.fn(),
      onCopySelected,
      onPaste,
      canPaste: () => pasteReady
    })

    const makeModKey = (
      key: string,
      opts: { ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean; target?: unknown } = {}
    ): KeyboardEvent =>
      ({
        key,
        ctrlKey: opts.ctrlKey ?? true,
        metaKey: opts.metaKey ?? false,
        shiftKey: opts.shiftKey ?? false,
        altKey: false,
        target: opts.target ?? null,
        preventDefault: vi.fn()
      }) as unknown as KeyboardEvent

    // Ctrl+C copies when visible items are selected
    const copyEvt = makeModKey('c', { ctrlKey: true })
    await onKeydown(copyEvt)
    expect(copyEvt.preventDefault).toHaveBeenCalled()
    expect(onCopySelected).toHaveBeenCalledTimes(1)

    // Cmd+C also copies
    const cmdCopyEvt = makeModKey('c', { ctrlKey: false, metaKey: true })
    await onKeydown(cmdCopyEvt)
    expect(cmdCopyEvt.preventDefault).toHaveBeenCalled()
    expect(onCopySelected).toHaveBeenCalledTimes(2)

    // Ctrl+V does not prevent default or paste when clipboard cannot paste
    const pasteBlockedEvt = makeModKey('v', { ctrlKey: true })
    await onKeydown(pasteBlockedEvt)
    expect(pasteBlockedEvt.preventDefault).not.toHaveBeenCalled()
    expect(onPaste).not.toHaveBeenCalled()

    // Ctrl+V / Cmd+V paste when ready
    pasteReady = true
    const pasteEvt = makeModKey('v', { ctrlKey: true })
    await onKeydown(pasteEvt)
    expect(pasteEvt.preventDefault).toHaveBeenCalled()
    expect(onPaste).toHaveBeenCalledTimes(1)

    const cmdPasteEvt = makeModKey('v', { ctrlKey: false, metaKey: true })
    await onKeydown(cmdPasteEvt)
    expect(cmdPasteEvt.preventDefault).toHaveBeenCalled()
    expect(onPaste).toHaveBeenCalledTimes(2)

    // Ctrl+Shift+C / Ctrl+Shift+V are ignored (terminal shortcuts)
    await onKeydown(makeModKey('C', { shiftKey: true }))
    await onKeydown(makeModKey('V', { shiftKey: true }))
    expect(onCopySelected).toHaveBeenCalledTimes(2)
    expect(onPaste).toHaveBeenCalledTimes(2)

    // Guards: inputs, selects, contentEditable, .xterm, [role="dialog"], renaming, active text selection
    const editable = new DummyHTMLElement()
    editable.isContentEditable = true
    for (const target of [
      new DummyInputElement(),
      new DummyTextAreaElement(),
      new DummySelectElement(),
      editable,
      new DummyHTMLElement('.xterm'),
      new DummyHTMLElement('[role="dialog"]')
    ]) {
      const evtC = makeModKey('c', { target })
      const evtV = makeModKey('v', { target })
      await onKeydown(evtC)
      await onKeydown(evtV)
      expect(evtC.preventDefault).not.toHaveBeenCalled()
      expect(evtV.preventDefault).not.toHaveBeenCalled()
    }
    expect(onCopySelected).toHaveBeenCalledTimes(2)
    expect(onPaste).toHaveBeenCalledTimes(2)

    renamingPath.value = '/dir/file-0.txt'
    await onKeydown(makeModKey('c'))
    await onKeydown(makeModKey('v'))
    expect(onCopySelected).toHaveBeenCalledTimes(2)
    expect(onPaste).toHaveBeenCalledTimes(2)
    renamingPath.value = null

    vi.stubGlobal('window', { getSelection: () => ({ toString: () => 'selected text' }) })
    try {
      const textSelCopy = makeModKey('c')
      await onKeydown(textSelCopy)
      expect(textSelCopy.preventDefault).not.toHaveBeenCalled()
      expect(onCopySelected).toHaveBeenCalledTimes(2)
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
