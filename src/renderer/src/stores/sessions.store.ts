import { defineStore } from 'pinia'
import { INVOKE_CHANNELS, EVENT_CHANNELS } from '@shared/contract'
import type { QuickConnectInput, SessionOpenResult, SessionStatus, SessionStatusEvent } from '@shared/contract'
import { invoke, onEvent } from '../api'

interface SessionsState {
  activeSessionId: string | null
  status: SessionStatus | null
  statusMessage: string | null
  connecting: boolean
  unsubscribeStatus: (() => void) | null
}

export const useSessionsStore = defineStore('sessions', {
  state: (): SessionsState => ({
    activeSessionId: null,
    status: null,
    statusMessage: null,
    connecting: false,
    unsubscribeStatus: null
  }),

  actions: {
    ensureStatusSubscription(): void {
      if (this.unsubscribeStatus) {
        return
      }
      this.unsubscribeStatus = onEvent<SessionStatusEvent>(EVENT_CHANNELS.sessionStatus, (evt) => {
        if (evt.sessionId !== this.activeSessionId) {
          return
        }
        this.status = evt.status
        this.statusMessage = evt.message ?? null
      })
    },

    async connect(input: QuickConnectInput): Promise<void> {
      this.ensureStatusSubscription()
      this.connecting = true
      this.statusMessage = null
      try {
        const result = await invoke<SessionOpenResult>(INVOKE_CHANNELS.sessionOpen, {
          quickConnect: input
        })
        this.activeSessionId = result.sessionId
        this.status = result.status
      } catch (e) {
        this.status = 'error'
        this.statusMessage = e instanceof Error ? e.message : String(e)
        throw e
      } finally {
        this.connecting = false
      }
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
