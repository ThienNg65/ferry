import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import type { FileEntry } from '@shared/contract'

export interface FileClipboardPayload {
  side: 'local' | 'remote'
  sessionId: string | null
  entries: FileEntry[]
  copiedAt: number
}

export const useFileClipboardStore = defineStore('fileClipboard', () => {
  const payload = ref<FileClipboardPayload | null>(null)

  const hasItems = computed(() => (payload.value?.entries.length ?? 0) > 0)
  const count = computed(() => payload.value?.entries.length ?? 0)
  const sourceSide = computed(() => payload.value?.side ?? null)
  const sourceSessionId = computed(() => payload.value?.sessionId ?? null)

  function copy(side: 'local' | 'remote', entries: FileEntry[], sessionId: string | null): void {
    if (entries.length === 0) return
    payload.value = {
      side,
      sessionId: side === 'remote' ? sessionId : null,
      entries: entries.map((e) => ({ ...e })),
      copiedAt: Date.now()
    }
  }

  function clear(): void {
    payload.value = null
  }

  function canPasteInto(
    targetSide: 'local' | 'remote',
    activeSessionId: string | null,
    isConnected: boolean
  ): boolean {
    if (!hasItems.value || !payload.value) return false
    if (targetSide === 'remote' && (!isConnected || !activeSessionId)) return false
    if (
      payload.value.side === 'remote' &&
      (!isConnected || !activeSessionId || payload.value.sessionId !== activeSessionId)
    ) {
      return false
    }
    return true
  }

  return {
    payload,
    hasItems,
    count,
    sourceSide,
    sourceSessionId,
    copy,
    clear,
    canPasteInto
  }
})
