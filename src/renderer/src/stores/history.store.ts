import { defineStore } from 'pinia'
import { INVOKE_CHANNELS } from '@shared/contract'
import type { HistoryEntry, HistoryQuery } from '@shared/contract'
import { invoke } from '../api'

interface HistoryState {
  entries: HistoryEntry[]
  loading: boolean
  /** Request-sequencing token — bumped on every `list()` call so a slower, superseded response (e.g. from rapid search-box typing) can detect it's stale and skip applying its result. */
  requestSeq: number
}

export const useHistoryStore = defineStore('history', {
  state: (): HistoryState => ({
    entries: [],
    loading: false,
    requestSeq: 0
  }),

  actions: {
    async list(query?: HistoryQuery): Promise<void> {
      const seq = ++this.requestSeq
      this.loading = true
      try {
        const result = await invoke<HistoryEntry[]>(INVOKE_CHANNELS.historyList, query)
        if (seq !== this.requestSeq) {
          return
        }
        this.entries = result
      } finally {
        if (seq === this.requestSeq) {
          this.loading = false
        }
      }
    },

    async clear(): Promise<void> {
      await invoke<void>(INVOKE_CHANNELS.historyClear)
      this.entries = []
    }
  }
})
