import { defineStore } from 'pinia'
import { INVOKE_CHANNELS, EVENT_CHANNELS } from '@shared/contract'
import type {
  QuickConnectInput,
  Site,
  SessionOpenResult,
  SessionStatus,
  SessionStatusEvent
} from '@shared/contract'
import { invoke, onEvent } from '../api'
import { useNotify } from '../composables/useNotify'

interface SessionsState {
  activeSessionId: string | null
  status: SessionStatus | null
  statusMessage: string | null
  connecting: boolean
  pendingLabel: string | null
  unsubscribeStatus: (() => void) | null
}

export const useSessionsStore = defineStore('sessions', {
  state: (): SessionsState => ({
    activeSessionId: null,
    status: null,
    statusMessage: null,
    connecting: false,
    pendingLabel: null,
    unsubscribeStatus: null
  }),

  actions: {
    ensureStatusSubscription(): void {
      if (this.unsubscribeStatus) {
        return
      }
      const notify = useNotify()
      this.unsubscribeStatus = onEvent<SessionStatusEvent>(EVENT_CHANNELS.sessionStatus, (evt) => {
        if (evt.sessionId !== this.activeSessionId) {
          return
        }
        const wasConnected = this.status === 'connected'
        this.status = evt.status
        this.statusMessage = evt.message ?? null
        if (wasConnected && evt.status === 'error') {
          notify.error('Connection lost', evt.message)
        }
      })
    },

    /** Shared connect path for both quick-connect and saved-site connect. */
    async openSession(
      request: { siteId: string } | { quickConnect: QuickConnectInput },
      label: string
    ): Promise<void> {
      this.ensureStatusSubscription()
      this.connecting = true
      this.statusMessage = null
      this.pendingLabel = label
      const notify = useNotify()
      try {
        const result = await invoke<SessionOpenResult>(INVOKE_CHANNELS.sessionOpen, request)
        this.activeSessionId = result.sessionId
        this.status = result.status
        notify.success(`Connected to ${label}`)
      } catch (e) {
        this.status = 'error'
        this.statusMessage = e instanceof Error ? e.message : String(e)
        notify.error('Connection failed', this.statusMessage)
        throw e
      } finally {
        this.connecting = false
      }
    },

    async connect(input: QuickConnectInput): Promise<void> {
      await this.openSession({ quickConnect: input }, input.name || input.host)
    },

    async connectToSite(site: Site): Promise<void> {
      await this.openSession({ siteId: site.id }, site.name)
    },

    async disconnect(): Promise<void> {
      if (!this.activeSessionId) {
        return
      }
      await invoke<void>(INVOKE_CHANNELS.sessionClose, this.activeSessionId)
      this.activeSessionId = null
      this.status = null
      this.statusMessage = null
    }
  }
})
