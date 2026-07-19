import { defineStore } from 'pinia'
import { INVOKE_CHANNELS } from '@shared/contract'
import type { HistoryEntry, HistoryQuery } from '@shared/contract'
import { invoke } from '../api'

interface HistoryState {
  entries: HistoryEntry[]
  loading: boolean
}

export const useHistoryStore = defineStore('history', {
  state: (): HistoryState => ({
    entries: [],
    loading: false
  }),

  actions: {
    async list(query?: HistoryQuery): Promise<void> {
      this.loading = true
      try {
        this.entries = await invoke<HistoryEntry[]>(INVOKE_CHANNELS.historyList, query)
      } finally {
        this.loading = false
      }
    },

    async clear(): Promise<void> {
      await invoke<void>(INVOKE_CHANNELS.historyClear)
      this.entries = []
    }
  }
})
