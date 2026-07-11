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
import { useRemoteFsStore } from './remoteFs.store'
import { useTerminalStreamsStore } from './terminalStreams.store'

/** One open site tab — a browser-tab-like slot that is either "picker" (not yet connected) or bound to a live session. */
export interface SessionTab {
  /** Client-generated, stable for the tab's whole life (independent of `sessionId`, which can be reassigned on reconnect). */
  tabId: string
  /** Null while the tab is showing the site picker (not connected yet). */
  sessionId: string | null
  label: string | null
  /** Null means "picker" — no connection attempt has been made yet for this tab. */
  status: SessionStatus | null
  statusMessage: string | null
  connecting: boolean
}

interface SessionsState {
  tabs: SessionTab[]
  activeTabId: string
  unsubscribeStatus: (() => void) | null
}

function freshTab(): SessionTab {
  return {
    tabId: crypto.randomUUID(),
    sessionId: null,
    label: null,
    status: null,
    statusMessage: null,
    connecting: false
  }
}

export const useSessionsStore = defineStore('sessions', {
  state: (): SessionsState => {
    const initial = freshTab()
    return {
      tabs: [initial],
      activeTabId: initial.tabId,
      unsubscribeStatus: null
    }
  },

  getters: {
    activeTab(state): SessionTab {
      return state.tabs.find((t) => t.tabId === state.activeTabId) ?? state.tabs[0]
    },
    activeSessionId(): string | null {
      return this.activeTab.sessionId
    },
    status(): SessionStatus | null {
      return this.activeTab.status
    },
    statusMessage(): string | null {
      return this.activeTab.statusMessage
    },
    connecting(): boolean {
      return this.activeTab.connecting
    }
  },

  actions: {
    ensureStatusSubscription(): void {
      if (this.unsubscribeStatus) {
        return
      }
      const notify = useNotify()
      this.unsubscribeStatus = onEvent<SessionStatusEvent>(EVENT_CHANNELS.sessionStatus, (evt) => {
        const tab = this.tabs.find((t) => t.sessionId === evt.sessionId)
        if (!tab) {
          return
        }
        const wasConnected = tab.status === 'connected'
        tab.status = evt.status
        tab.statusMessage = evt.message ?? null
        if (wasConnected && evt.status === 'error') {
          notify.error('Connection lost', tab.label ? `${tab.label}: ${evt.message ?? ''}` : evt.message)
        }
      })
    },

    /** Opens a new picker tab (site not chosen yet) and activates it. */
    openNewTab(): void {
      const tab = freshTab()
      this.tabs.push(tab)
      this.activeTabId = tab.tabId
    },

    setActiveTab(tabId: string): void {
      if (this.tabs.some((t) => t.tabId === tabId)) {
        this.activeTabId = tabId
      }
    },

    /** Shared connect path for both quick-connect and saved-site connect — always targets the active tab. */
    async openSession(
      request: { siteId: string } | { quickConnect: QuickConnectInput },
      label: string
    ): Promise<void> {
      this.ensureStatusSubscription()
      const tab = this.activeTab
      tab.connecting = true
      tab.statusMessage = null
      tab.label = label
      const notify = useNotify()
      try {
        const result = await invoke<SessionOpenResult>(INVOKE_CHANNELS.sessionOpen, request)
        tab.sessionId = result.sessionId
        tab.status = result.status
        notify.success(`Connected to ${label}`)
      } catch (e) {
        tab.status = 'error'
        tab.statusMessage = e instanceof Error ? e.message : String(e)
        notify.error('Connection failed', tab.statusMessage)
        throw e
      } finally {
        tab.connecting = false
      }
    },

    async connect(input: QuickConnectInput): Promise<void> {
      await this.openSession({ quickConnect: input }, input.name || input.host)
    },

    async connectToSite(site: Site): Promise<void> {
      await this.openSession({ siteId: site.id }, site.name)
    },

    /** Closes and removes a tab entirely, disconnecting its session first if connected. */
    async closeTab(tabId: string): Promise<void> {
      const tab = this.tabs.find((t) => t.tabId === tabId)
      if (!tab) {
        return
      }
      if (tab.sessionId) {
        await invoke<void>(INVOKE_CHANNELS.sessionClose, tab.sessionId)
        useRemoteFsStore().clearSession(tab.sessionId)
        useTerminalStreamsStore().disposeForSession(tab.sessionId)
      }
      const closedIndex = this.tabs.findIndex((t) => t.tabId === tabId)
      this.tabs = this.tabs.filter((t) => t.tabId !== tabId)
      if (this.tabs.length === 0) {
        this.openNewTab()
        return
      }
      if (this.activeTabId === tabId) {
        const neighborIndex = Math.min(closedIndex, this.tabs.length - 1)
        this.activeTabId = this.tabs[neighborIndex].tabId
      }
    }
  }
})
