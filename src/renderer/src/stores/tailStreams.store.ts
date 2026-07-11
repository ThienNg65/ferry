import { defineStore } from 'pinia'
import { INVOKE_CHANNELS } from '@shared/contract'
import { invoke } from '../api'

export interface OpenTail {
  tailId: string
  remotePath: string
}

interface TailStartResult {
  tailId: string
}

interface TailStreamsState {
  tabs: OpenTail[]
  activeTailId: string | null
}

/** Tracks which remote files currently have an open `tail -F` tab in the dock. */
export const useTailStreamsStore = defineStore('tailStreams', {
  state: (): TailStreamsState => ({
    tabs: [],
    activeTailId: null
  }),

  actions: {
    async open(sessionId: string, remotePath: string): Promise<void> {
      const existing = this.tabs.find((t) => t.remotePath === remotePath)
      if (existing) {
        this.activeTailId = existing.tailId
        return
      }
      const result = await invoke<TailStartResult>(INVOKE_CHANNELS.tailStart, { sessionId, remotePath })
      this.tabs.push({ tailId: result.tailId, remotePath })
      this.activeTailId = result.tailId
    },

    async close(tailId: string): Promise<void> {
      await invoke<void>(INVOKE_CHANNELS.tailStop, tailId)
      this.tabs = this.tabs.filter((t) => t.tailId !== tailId)
      if (this.activeTailId === tailId) {
        this.activeTailId = this.tabs[0]?.tailId ?? null
      }
    }
  }
})
