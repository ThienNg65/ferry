import { ref } from 'vue'
import type { FileEntry } from '@shared/contract'

export interface DragPayload {
  side: 'local' | 'remote'
  entry: FileEntry
}

// Module-scoped (not per-component) so every FileRow/FilePane instance shares
// the same drag state — an in-memory payload rather than `dataTransfer` JSON,
// which avoids serialization limits for a same-window drag.
const payload = ref<DragPayload | null>(null)

/** Shares drag state between the local and remote file panes. */
export function useDragAndDrop() {
  function startDrag(side: 'local' | 'remote', entry: FileEntry): void {
    payload.value = { side, entry }
  }
  function clearDrag(): void {
    payload.value = null
  }
  function getDragPayload(): DragPayload | null {
    return payload.value
  }
  return { startDrag, clearDrag, getDragPayload }
}
