import { defineStore } from 'pinia'
import { EVENT_CHANNELS, INVOKE_CHANNELS } from '@shared/contract'
import type { MonitorSample, MonitorStatus, MonitorStatusEvent } from '@shared/contract'
import { invoke, onEvent } from '../api'
import { useSessionsStore } from './sessions.store'
import { migrateLegacyPref, readStored, writeStored } from '../utils/uiPref'

/** ~3 minutes of history at the default 2s tick. */
const HISTORY_LENGTH = 90
const INTERVAL_KEY = 'ferry:ui:monitorIntervalMs'
const LEGACY_INTERVAL_KEY = 'ferry:monitor:intervalMs'
export const MONITOR_INTERVAL_OPTIONS = [1000, 2000, 5000, 10000, 30000] as const
const DEFAULT_INTERVAL_MS = 2000

function loadIntervalMs(): number {
  migrateLegacyPref(LEGACY_INTERVAL_KEY, INTERVAL_KEY)
  const raw = Number(readStored(INTERVAL_KEY))
  return (MONITOR_INTERVAL_OPTIONS as readonly number[]).includes(raw) ? raw : DEFAULT_INTERVAL_MS
}

/** Only lightweight points are needed for CPU history, not past process snapshots. */
interface MonitorHistoryPoint {
  timestamp: number
  cpuPct: number | null
}

/** Per-session monitor state — mirrors remoteFs.store.ts's bySession keying so each open tab tracks its own server independently. */
interface PerSessionMonitor {
  latest: MonitorSample | null
  history: MonitorHistoryPoint[]
  status: MonitorStatus | 'idle'
  statusMessage: string | null
  paused: boolean
}

function freshMonitorState(): PerSessionMonitor {
  return { latest: null, history: [], status: 'idle', statusMessage: null, paused: false }
}

/** Read-only fallback for "no session (yet)" — never written into `bySession`. */
const EMPTY_DEFAULT: PerSessionMonitor = Object.freeze(freshMonitorState())

interface MonitorState {
  bySession: Record<string, PerSessionMonitor>
  intervalMs: number
  unsubscribe: (() => void) | null
}

/**
 * Remote resource-monitor state, keyed by sessionId (the remoteFs.store.ts
 * pattern) so switching site tabs shows each server's own samples. History
 * survives stop()/start() — collapsing the dock and reopening it resumes the
 * sparkline with a visible gap rather than losing it.
 */
export const useMonitorStore = defineStore('monitor', {
  state: (): MonitorState => ({ bySession: {}, intervalMs: loadIntervalMs(), unsubscribe: null }),

  getters: {
    current(state): PerSessionMonitor {
      const sessionId = useSessionsStore().activeSessionId
      return (sessionId && state.bySession[sessionId]) || EMPTY_DEFAULT
    },
    latest(): MonitorSample | null {
      return this.current.latest
    },
    history(): MonitorHistoryPoint[] {
      return this.current.history
    },
    status(): MonitorStatus | 'idle' {
      return this.current.status
    },
    statusMessage(): string | null {
      return this.current.statusMessage
    },
    paused(): boolean {
      return this.current.paused
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
        const bucket = this.bySession[sample.sessionId]
        if (!bucket) return
        bucket.latest = sample
        bucket.status = 'started'
        bucket.statusMessage = null
        bucket.history.push({ timestamp: sample.timestamp, cpuPct: sample.cpu?.aggregatePct ?? null })
        if (bucket.history.length > HISTORY_LENGTH) {
          bucket.history.shift()
        }
      })
      const statusUnsub = onEvent<MonitorStatusEvent>(EVENT_CHANNELS.monitorStatus, (evt) => {
        const bucket = this.bySession[evt.sessionId]
        if (!bucket) return
        if (evt.state === 'stopped' && (bucket.status === 'unsupported' || bucket.status === 'error')) {
          return
        }
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
      const bucket = this.ensureBucket(sessionId)
      bucket.paused = false
      await invoke<void>(INVOKE_CHANNELS.monitorStart, { sessionId, intervalMs: this.intervalMs })
    },

    async stop(sessionId: string): Promise<void> {
      await invoke<void>(INVOKE_CHANNELS.monitorStop, sessionId)
    },

    async pause(sessionId: string): Promise<void> {
      const bucket = this.ensureBucket(sessionId)
      bucket.paused = true
      await this.stop(sessionId)
    },

    async resume(sessionId: string): Promise<void> {
      await this.start(sessionId)
    },

    reloadIntervalMs(): void {
      this.intervalMs = loadIntervalMs()
    },

    async setIntervalMs(sessionId: string | null, ms: number): Promise<void> {
      if (!(MONITOR_INTERVAL_OPTIONS as readonly number[]).includes(ms)) {
        return
      }
      this.intervalMs = ms
      writeStored(INTERVAL_KEY, String(ms))
      if (sessionId && useSessionsStore().status === 'connected' && !this.ensureBucket(sessionId).paused) {
        await this.start(sessionId)
      }
    },

    /** Drops a session's bucket entirely — called when its tab closes/disconnects. */
    clearSession(sessionId: string): void {
      delete this.bySession[sessionId]
    }
  }
})
