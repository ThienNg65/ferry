import { defineStore } from 'pinia'
import { EVENT_CHANNELS, INVOKE_CHANNELS } from '@shared/contract'
import type { ActivityEntry } from '@shared/contract'
import { invoke, onEvent } from '../api'

/** Entries beyond this count are dropped from the front, oldest first. */
const MAX_ENTRIES = 2000

interface ActivityLogState {
  entries: ActivityEntry[]
  subscribed: boolean
  loaded: boolean
}

/**
 * Renderer-side mirror of the main process's ActivityLog ring buffer.
 * Subscribes for live events immediately and backfills history once — this
 * is purely local app/session activity, never gated on remote I/O, so it
 * must always feel instant.
 */
export const useActivityLogStore = defineStore('activityLog', {
  state: (): ActivityLogState => ({
    entries: [],
    subscribed: false,
    loaded: false
  }),

  actions: {
    ensureSubscription(): void {
      if (this.subscribed) {
        return
      }
      this.subscribed = true
      onEvent<ActivityEntry>(EVENT_CHANNELS.activityEvent, (entry) => {
        this.entries.push(entry)
        if (this.entries.length > MAX_ENTRIES) {
          this.entries.splice(0, this.entries.length - MAX_ENTRIES)
        }
      })
    },

    async loadHistory(): Promise<void> {
      this.ensureSubscription()
      if (this.loaded) {
        return
      }
      this.loaded = true
      this.entries = await invoke<ActivityEntry[]>(INVOKE_CHANNELS.activityHistory)
    }
  }
})
