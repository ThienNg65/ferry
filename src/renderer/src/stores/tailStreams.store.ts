import { defineStore } from 'pinia'
import { INVOKE_CHANNELS } from '@shared/contract'
import { invoke } from '../api'

export interface OpenTail {
  tailId: string
  sessionId: string
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
      const existing = this.tabs.find((t) => t.sessionId === sessionId && t.remotePath === remotePath)
      if (existing) {
        this.activeTailId = existing.tailId
        return
      }
      const result = await invoke<TailStartResult>(INVOKE_CHANNELS.tailStart, { sessionId, remotePath })
      this.tabs.push({ tailId: result.tailId, sessionId, remotePath })
      this.activeTailId = result.tailId
    },

    async close(tailId: string): Promise<void> {
      await invoke<void>(INVOKE_CHANNELS.tailStop, tailId)
      this.tabs = this.tabs.filter((t) => t.tailId !== tailId)
      if (this.activeTailId === tailId) {
        this.activeTailId = this.tabs[0]?.tailId ?? null
      }
    },

    /** Closes every tail tab belonging to a session — called when that session's tab closes, so a
     * stale entry can never be matched against a later, unrelated session (see `open`'s dedup). */
    async closeForSession(sessionId: string): Promise<void> {
      const targets = this.tabs.filter((t) => t.sessionId === sessionId)
      for (const t of targets) {
        await this.close(t.tailId)
      }
    }
  }
})
