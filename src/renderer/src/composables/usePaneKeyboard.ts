import type { Ref } from 'vue'
import type { FileEntry } from '@shared/contract'
import { useLocalFsStore } from '../stores/localFs.store'
import { useRemoteFsStore } from '../stores/remoteFs.store'
import { useUiStore } from '../stores/ui.store'

export interface PaneKeyboardContext {
  side: 'local' | 'remote'
  store: ReturnType<typeof useLocalFsStore> | ReturnType<typeof useRemoteFsStore>
  renamingPath: Ref<string | null>
  filterText: Ref<string>
  filteredEntries: Ref<FileEntry[]>
  toolbarRef: Ref<{ focusFilter: () => void } | null>
  fileListRef: Ref<{ scrollToIndex: (index: number) => void } | null>
  onTransferSelected: () => Promise<void>
  onOpen: (entry: FileEntry) => void
  confirmDeleteEntries: (entries: FileEntry[]) => Promise<void>
}

export function usePaneKeyboard(ctx: PaneKeyboardContext): (event: KeyboardEvent) => Promise<void> {
  const ui = useUiStore()
  return async function onKeydown(event: KeyboardEvent): Promise<void> {
    // Typing in the filter box or the new-folder box must never fall through to pane shortcuts
    // (Delete/Ctrl+A/F2/Ctrl+R) — neither input stops keydown propagation like the rename row does.
    if (
      event.target instanceof HTMLInputElement ||
      event.target instanceof HTMLTextAreaElement ||
      (event.target instanceof HTMLElement && event.target.isContentEditable)
    ) {
      return
    }
    // While a row is mid-rename, its own input owns keyboard input (it stops keydown propagation) —
    // this guard is a second line of defense so a stray bubble never triggers delete/refresh.
    if (ctx.renamingPath.value !== null) {
      return
    }
    // F6 hops to the other pane (the Windows Explorer convention); Tab stays native so keyboard
    // users can still reach the toolbar, the ⋯ menu and the dock.
    if (event.key === 'F6' && !event.shiftKey && !event.ctrlKey && !event.altKey) {
      const other = ctx.side === 'local' ? 'remote' : 'local'
      const el = document.querySelector<HTMLElement>(`[data-pane="${other}"]`)
      if (el && !(other === 'local' && !ui.showLocalPane)) {
        event.preventDefault()
        el.focus()
      }
      return
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'r') {
      event.preventDefault()
      await ctx.store.load(ctx.store.currentPath, { forceRefresh: true })
      return
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'h') {
      event.preventDefault()
      ui.toggleShowHidden()
      return
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
      event.preventDefault()
      ctx.toolbarRef.value?.focusFilter()
      return
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
      event.preventDefault()
      ctx.store.selectAll(ctx.filteredEntries.value)
      return
    }
    if (event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey)) {
      const [path] = ctx.store.selected
      const row = [...document.querySelectorAll<HTMLElement>(`[data-pane="${ctx.side}"] [data-row-path]`)].find((el) => el.dataset.rowPath === path)
      if (row) {
        event.preventDefault()
        const rect = row.getBoundingClientRect()
        row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: rect.left + 24, clientY: rect.bottom }))
      }
      return
    }
    if (event.key === 'F5') {
      event.preventDefault()
      await ctx.onTransferSelected()
      return
    }
    if (event.key === 'F2') {
      event.preventDefault()
      if (ctx.store.selected.size === 1) {
        const [path] = ctx.store.selected
        ctx.renamingPath.value = path
      }
      return
    }
    if (event.key === 'Escape') {
      if (ctx.filterText.value) {
        event.preventDefault()
        ctx.filterText.value = ''
      } else if (ctx.store.selected.size > 0) {
        event.preventDefault()
        ctx.store.selectAll([])
      }
      return
    }
    if (event.altKey && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
      event.preventDefault()
      await (event.key === 'ArrowLeft' ? ctx.store.goBack() : ctx.store.goForward())
      return
    }
    if (event.key === 'Backspace') {
      event.preventDefault()
      await ctx.store.goUp()
      return
    }
    if (
      event.key === 'ArrowDown' ||
      event.key === 'ArrowUp' ||
      event.key === 'Home' ||
      event.key === 'End' ||
      event.key === 'PageDown' ||
      event.key === 'PageUp'
    ) {
      const list = ctx.filteredEntries.value
      if (list.length === 0) return
      event.preventDefault()
      const selectedPaths = Array.from(ctx.store.selected)
      const lastSelectedPath = selectedPaths[selectedPaths.length - 1]
      const currentIdx = lastSelectedPath ? list.findIndex((e) => e.path === lastSelectedPath) : -1
      const pageStep = 10
      let nextIdx = 0
      if (event.key === 'Home') {
        nextIdx = 0
      } else if (event.key === 'End') {
        nextIdx = list.length - 1
      } else if (event.key === 'PageDown') {
        nextIdx = Math.min(list.length - 1, (currentIdx < 0 ? 0 : currentIdx) + pageStep)
      } else if (event.key === 'PageUp') {
        nextIdx = Math.max(0, (currentIdx < 0 ? 0 : currentIdx) - pageStep)
      } else if (event.key === 'ArrowDown') {
        nextIdx = Math.min(list.length - 1, currentIdx + 1)
      } else {
        nextIdx = currentIdx <= 0 ? 0 : currentIdx - 1
      }
      const nextPath = list[nextIdx].path
      if (event.shiftKey) {
        ctx.store.selectRange(nextPath)
      } else {
        ctx.store.selectOnly(nextPath)
      }
      ctx.fileListRef.value?.scrollToIndex(nextIdx)
      return
    }
    if (event.key === 'Enter') {
      if (ctx.store.selected.size === 1) {
        const [path] = ctx.store.selected
        const entry = ctx.filteredEntries.value.find((e) => e.path === path)
        if (entry) {
          event.preventDefault()
          ctx.onOpen(entry)
        }
      }
      return
    }
    if (event.key !== 'Delete') {
      return
    }
    if (ctx.store.selected.size === 0) {
      return
    }
    event.preventDefault()
    void ctx.confirmDeleteEntries(ctx.store.entries.filter((e) => ctx.store.selected.has(e.path)))
  }
}
