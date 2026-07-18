import { defineStore } from 'pinia'
import { EVENT_CHANNELS, INVOKE_CHANNELS } from '@shared/contract'
import type { MonitorSample, MonitorStatus, MonitorStatusEvent } from '@shared/contract'
import { invoke, onEvent } from '../api'
import { useSessionsStore } from './sessions.store'

/** ~3 minutes of history at the default 2s tick. */
const HISTORY_LENGTH = 90

/** Per-session monitor state — mirrors remoteFs.store.ts's bySession keying so each open tab tracks its own server independently. */
interface PerSessionMonitor {
  latest: MonitorSample | null
  history: MonitorSample[]
  status: MonitorStatus | 'idle'
  statusMessage: string | null
}

function freshMonitorState(): PerSessionMonitor {
  return { latest: null, history: [], status: 'idle', statusMessage: null }
}

/** Read-only fallback for "no session (yet)" — never written into `bySession`. */
const EMPTY_DEFAULT: PerSessionMonitor = Object.freeze(freshMonitorState())

interface MonitorState {
  bySession: Record<string, PerSessionMonitor>
  unsubscribe: (() => void) | null
}

/**
 * Remote resource-monitor state, keyed by sessionId (the remoteFs.store.ts
 * pattern) so switching site tabs shows each server's own samples. History
 * survives stop()/start() — collapsing the dock and reopening it resumes the
 * sparkline with a visible gap rather than losing it.
 */
export const useMonitorStore = defineStore('monitor', {
  state: (): MonitorState => ({ bySession: {}, unsubscribe: null }),

  getters: {
    current(state): PerSessionMonitor {
      const sessionId = useSessionsStore().activeSessionId
      return (sessionId && state.bySession[sessionId]) || EMPTY_DEFAULT
    },
    latest(): MonitorSample | null {
      return this.current.latest
    },
    history(): MonitorSample[] {
      return this.current.history
    },
    status(): MonitorStatus | 'idle' {
      return this.current.status
    },
    statusMessage(): string | null {
      return this.current.statusMessage
    }
  },

  actions: {
    ensureBucket(sessionId: string): PerSessionMonitor {
      if (!this.bySession[sessionId]) {
        this.bySession[sessionId] = freshMonitorState()
      }
      return this.bySession[sessionId]
    },

    ensureSubscription(): void {
      if (this.unsubscribe) {
        return
      }
      const sampleUnsub = onEvent<MonitorSample>(EVENT_CHANNELS.monitorSample, (sample) => {
        const bucket = this.ensureBucket(sample.sessionId)
        bucket.latest = sample
        bucket.status = 'started'
        bucket.statusMessage = null
        bucket.history.push(sample)
        if (bucket.history.length > HISTORY_LENGTH) {
          bucket.history.shift()
        }
      })
      const statusUnsub = onEvent<MonitorStatusEvent>(EVENT_CHANNELS.monitorStatus, (evt) => {
        const bucket = this.ensureBucket(evt.sessionId)
        bucket.status = evt.state
        bucket.statusMessage = evt.message ?? null
      })
      this.unsubscribe = (): void => {
        sampleUnsub()
        statusUnsub()
      }
    },

    async start(sessionId: string): Promise<void> {
      this.ensureSubscription()
      this.ensureBucket(sessionId)
      await invoke<void>(INVOKE_CHANNELS.monitorStart, { sessionId })
    },

    async stop(sessionId: string): Promise<void> {
      await invoke<void>(INVOKE_CHANNELS.monitorStop, sessionId)
    }
  }
})
