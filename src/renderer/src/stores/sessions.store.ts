import { useBookmarksStore } from './bookmarks.store'
import { defineStore } from 'pinia'
import { INVOKE_CHANNELS, EVENT_CHANNELS } from '@shared/contract'
import type {
  AppSettings,
  AuthMethod,
  HostKeyPromptEvent,
  KeyboardInteractiveRequestEvent,
  QuickConnectInput,
  RemoteHostInfo,
  Site,
  SessionHostInfoEvent,
  SessionOpenResult,
  SessionStatus,
  SessionStatusEvent,
  SessionProgressEvent
} from '@shared/contract'
import { invoke, IpcError, onEvent } from '../api'
import { useNotify } from '../composables/useNotify'
import { useCompanionStore } from './companion.store'
import { useLocalFsStore } from './localFs.store'
import { useRemoteFsStore } from './remoteFs.store'
import { useTerminalStreamsStore } from './terminalStreams.store'
import { useTailStreamsStore } from './tailStreams.store'
import { useSitesStore } from './sites.store'
import { useMonitorStore } from './monitor.store'
import {
  resolveConnectionFilterKey,
  resolveLegacyConnectionFilterKey,
  useFileFiltersStore
} from './fileFilters.store'

export interface RecentQuickConnect {
  host: string
  port: number
  username: string
  authMethod: AuthMethod
  privateKeyPath?: string
  proxyMode?: 'inherit' | 'none' | 'custom'
}

const RECENT_QUICK_CONNECT_KEY = 'ferry:recentQuickConnect'
const MAX_RECENT_QUICK_CONNECTS = 8

/** Volatile in-memory Quick Connect credentials keyed by tabId — never persisted to localStorage. */
const ephemeralQuickSecrets = new Map<string, { password?: string; passphrase?: string }>()

function teardownSession(sessionId: string, rebindTailsTo?: string): Promise<void> {
  useRemoteFsStore().clearSession(sessionId)
  useFileFiltersStore().clearEphemeralSession(sessionId)
  useMonitorStore().clearSession(sessionId)
  void useTerminalStreamsStore().disposeForSession(sessionId).catch(() => {})
  const tails = useTailStreamsStore()
  if (rebindTailsTo) {
    tails.rebindSession?.(sessionId, rebindTailsTo)
    return Promise.resolve()
  }
  return tails.closeForSession(sessionId)
}

function sanitizeQuickConnectInput(
  input: QuickConnectInput
): Omit<QuickConnectInput, 'password' | 'passphrase'> {
  const { password: _pw, passphrase: _pp, ...rest } = input
  return { ...rest }
}

function toRecentEntry(
  input: Pick<RecentQuickConnect, 'host' | 'port' | 'username' | 'authMethod' | 'privateKeyPath' | 'proxyMode'>
): RecentQuickConnect {
  return {
    host: input.host,
    port: input.port,
    username: input.username,
    authMethod: input.authMethod,
    privateKeyPath: input.authMethod === 'privateKey' ? input.privateKeyPath || undefined : undefined,
    proxyMode: input.proxyMode
  }
}

function loadRecentQuickConnects(): RecentQuickConnect[] {
  try {
    if (typeof localStorage === 'undefined') return []
    const raw = localStorage.getItem(RECENT_QUICK_CONNECT_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    const entries: RecentQuickConnect[] = []
    for (const item of parsed) {
      if (!item || typeof item !== 'object') continue
      const rec = item as Record<string, unknown>
      if (typeof rec.host !== 'string' || typeof rec.username !== 'string') continue
      const port = Number(rec.port)
      if (!Number.isInteger(port) || port < 1 || port > 65535) continue
      const authMethod: AuthMethod =
        rec.authMethod === 'privateKey' || rec.authMethod === 'agent' ? rec.authMethod : 'password'
      entries.push(
        toRecentEntry({
          host: rec.host,
          port,
          username: rec.username,
          authMethod,
          privateKeyPath: typeof rec.privateKeyPath === 'string' ? rec.privateKeyPath : undefined,
          proxyMode:
            rec.proxyMode === 'inherit' || rec.proxyMode === 'none' || rec.proxyMode === 'custom'
              ? rec.proxyMode
              : undefined
        })
      )
      if (entries.length >= MAX_RECENT_QUICK_CONNECTS) break
    }
    return entries
  } catch {
    return []
  }
}

function saveRecentQuickConnects(entries: RecentQuickConnect[]): void {
  try {
    if (typeof localStorage === 'undefined') return
    localStorage.setItem(RECENT_QUICK_CONNECT_KEY, JSON.stringify(entries.slice(0, MAX_RECENT_QUICK_CONNECTS)))
  } catch {
    // Ignore storage quota / disabled localStorage errors.
  }
}

/** One open site tab — a browser-tab-like slot that is either "picker" (not yet connected) or bound to a live session. */
export interface SessionTab {
  /** Client-generated, stable for the tab's whole life (independent of `sessionId`, which can be reassigned on reconnect). */
  tabId: string
  /** Null while the tab is showing the site picker (not connected yet). */
  sessionId: string | null
  /** Saved site id this tab is connected to, or null for quick-connect (ad-hoc, no stable identity to dedup on). */
  siteId: string | null
  label: string | null
  /** `username@host`, shown as the Terminal tab's live-shell label. */
  hostLabel: string | null
  /** Null means "picker" — no connection attempt has been made yet for this tab. */
  status: SessionStatus | null
  statusMessage: string | null
  connecting: boolean
  progressMessages: string[]
  /** The in-flight `openSession` call while `connecting` is true — lets `closeTab` wait for it
   * to settle instead of detaching the tab from a session that's still being opened underneath it. */
  connectPromise: Promise<void> | null
  /** True once this tab has reached `'connected'` at least once — distinguishes initial connect failures from mid-session drops. */
  hadConnected: boolean
  /** Snapshot of tab identity before an in-flight connect attempt so `cancelConnect` restores the picker cleanly. */
  preConnectSnapshot?: {
    siteId: string | null
    label: string | null
    hostLabel: string | null
    status: SessionStatus | null
    hadConnected: boolean
    quickConnectInput?: Omit<QuickConnectInput, 'password' | 'passphrase'>
  } | null
  /** Set when the last connect attempt failed because the server's host key changed — surfaced as a warning dialog, not a plain toast, since accepting it needs an explicit user decision. */
  pendingHostKeyMismatch: PendingHostKeyMismatch | null
  /** Sanitized Quick Connect parameters (secrets stripped) for promoting an active Quick Connect session to a saved site. */
  quickConnectInput?: Omit<QuickConnectInput, 'password' | 'passphrase'>
  /** Automatically probed remote OS/distro/shell/init metadata for this connected session. */
  remoteHostInfo?: RemoteHostInfo | null
}

type ConnectRequest = { siteId: string } | { quickConnect: QuickConnectInput }

interface PendingHostKeyMismatch {
  message: string
  request: ConnectRequest
  label: string
  hostLabel: string
  siteId: string | null
  /** The specific hop/target host:port that mismatched — retry only force-trusts this one. */
  hostKey?: { host: string; port: number }
}

interface SessionsState {
  tabs: SessionTab[]
  activeTabId: string
  recentQuickConnects: RecentQuickConnect[]
  unsubscribeStatus: (() => void) | null
  unsubscribeProgress: (() => void) | null
  unsubscribeHostInfo: (() => void) | null
  unsubscribeKeyboardInteractive: (() => void) | null
  /** Per-session queue of live keyboard-interactive (2FA/OTP) prompts so concurrent tab connects never overwrite each other. */
  pendingKeyboardPrompts: KeyboardInteractiveRequestEvent[]
  unsubscribeHostKey: (() => void) | null
  /** Per-session queue of first-use host-key confirmation prompts. */
  pendingHostKeyPrompts: HostKeyPromptEvent[]
  /** Generation counter bumped on cancelConnect so an in-flight reconnectAll() stops queuing remaining tabs. */
  reconnectAllGen: number
}

function freshTab(): SessionTab {
  return {
    tabId: crypto.randomUUID(),
    sessionId: null,
    siteId: null,
    label: null,
    hostLabel: null,
    status: null,
    statusMessage: null,
    connecting: false,
    progressMessages: [],
    connectPromise: null,
    hadConnected: false,
    preConnectSnapshot: null,
    pendingHostKeyMismatch: null
  }
}

export const useSessionsStore = defineStore('sessions', {
  state: (): SessionsState => {
    const initial = freshTab()
    return {
      tabs: [initial],
      activeTabId: initial.tabId,
      recentQuickConnects: loadRecentQuickConnects(),
      unsubscribeStatus: null,
      unsubscribeProgress: null,
      unsubscribeHostInfo: null,
      unsubscribeKeyboardInteractive: null,
      pendingKeyboardPrompts: [],
      unsubscribeHostKey: null,
      pendingHostKeyPrompts: [],
      reconnectAllGen: 0
    }
  },

  getters: {
    activeTab(state): SessionTab {
      return state.tabs.find((t) => t.tabId === state.activeTabId) ?? state.tabs[0]
    },
    activeSessionId(): string | null {
      return this.activeTab?.sessionId ?? null
    },
    status(): SessionStatus | null {
      return this.activeTab?.status ?? null
    },
    statusMessage(): string | null {
      return this.activeTab?.statusMessage ?? null
    },
    connecting(): boolean {
      return this.activeTab?.connecting ?? false
    },
    pendingHostKeyMismatch(): PendingHostKeyMismatch | null {
      return this.activeTab?.pendingHostKeyMismatch ?? null
    },
    pendingKeyboardPrompt(state): KeyboardInteractiveRequestEvent | null {
      const activeSid = this.activeTab?.sessionId ?? null
      if (activeSid) {
        const match = state.pendingKeyboardPrompts.find((p) => p.sessionId === activeSid)
        if (match) return match
      }
      return state.pendingKeyboardPrompts[0] ?? null
    },
    pendingHostKeyPrompt(state): HostKeyPromptEvent | null {
      const activeSid = this.activeTab?.sessionId ?? null
      if (activeSid) {
        const match = state.pendingHostKeyPrompts.find((p) => p.sessionId === activeSid)
        if (match) return match
      }
      return state.pendingHostKeyPrompts[0] ?? null
    },
    pendingKeyboardPromptTab(state): SessionTab | null {
      const prompt = this.pendingKeyboardPrompt
      if (!prompt) return null
      return state.tabs.find((t) => t.sessionId === prompt.sessionId) ?? null
    },
    pendingHostKeyPromptTab(state): SessionTab | null {
      const prompt = this.pendingHostKeyPrompt
      if (!prompt) return null
      return state.tabs.find((t) => t.sessionId === prompt.sessionId) ?? null
    },
    restoredSiteTabs(): SessionTab[] {
      return this.tabs.filter((t) => t.siteId !== null && t.status === null && !t.connecting && t.sessionId === null)
    }
  },

  actions: {
    /** Writes the siteId of every currently open, saved-site-backed tab to disk — restored (not auto-connected) on next launch. */
    async persistOpenTabs(): Promise<void> {
      const siteIds = this.tabs.filter((t): t is SessionTab & { siteId: string } => t.siteId !== null).map((t) => t.siteId)
      await invoke<void>(INVOKE_CHANNELS.settingsSetOpenTabs, siteIds)
    },

    /**
     * Recreates picker tabs for whatever saved sites were open at last shutdown.
     * Deliberately does NOT auto-connect — restoring a tab is a UI-state
     * convenience, not a background connection attempt with saved credentials,
     * so the user still clicks to connect just like any other picker tab.
     */
    async restoreOpenTabs(): Promise<void> {
      const sitesStore = useSitesStore()
      await sitesStore.fetchSites()
      const settings = await invoke<AppSettings>(INVOKE_CHANNELS.settingsGet)
      const restored: SessionTab[] = []
      for (const siteId of settings.openTabSiteIds) {
        const site = sitesStore.sites.find((s) => s.id === siteId)
        if (!site) {
          continue
        }
        const tab = freshTab()
        tab.siteId = site.id
        tab.label = site.name
        tab.hostLabel = `${site.username}@${site.host}`
        restored.push(tab)
      }
      if (restored.length === 0) {
        return
      }
      this.tabs = [...restored, ...this.tabs]
      this.activeTabId = restored[0].tabId
    },

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
        // Publish connected alongside the first directory request when session:open resolves.
        if (evt.status === 'connected' && tab.connecting) return
        const wasConnected = tab.status === 'connected'
        tab.status = evt.status
        if (evt.status === 'connected') {
          tab.hadConnected = true
        }
        tab.statusMessage = evt.message ?? null
        if (wasConnected && evt.status === 'error') {
          notify.error('Connection lost', tab.label ? `${tab.label}: ${evt.message ?? ''}` : evt.message)
          try {
            useCompanionStore().notifyWorkspaceError({
              scopeKey: evt.sessionId,
              category: 'ssh-connect',
              hostLabel: tab.hostLabel ?? tab.label ?? undefined,
              error: evt.message || 'SSH connection dropped unexpectedly'
            })
          } catch {
            // Non-fatal in isolated store tests.
          }
        }
      })
      this.unsubscribeProgress = onEvent<SessionProgressEvent>(EVENT_CHANNELS.sessionProgress, (evt) => {
        const tab = this.tabs.find((t) => t.sessionId === evt.sessionId)
        if (!tab) return
        tab.progressMessages.push(evt.message)
      })
      this.unsubscribeHostInfo = onEvent<SessionHostInfoEvent>(EVENT_CHANNELS.sessionHostInfo, (evt) => {
        const tab = this.tabs.find((t) => t.sessionId === evt.sessionId)
        if (!tab) return
        tab.remoteHostInfo = evt.info
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

    ensureKeyboardInteractiveSubscription(): void {
      if (this.unsubscribeKeyboardInteractive) {
        return
      }
      this.unsubscribeKeyboardInteractive = onEvent<KeyboardInteractiveRequestEvent>(
        EVENT_CHANNELS.keyboardInteractivePrompt,
        (evt) => {
          this.pendingKeyboardPrompts.push(evt)
        }
      )
    },

    ensureHostKeySubscription(): void {
      if (this.unsubscribeHostKey) {
        return
      }
      this.unsubscribeHostKey = onEvent<HostKeyPromptEvent>(EVENT_CHANNELS.hostKeyPrompt, (evt) => {
        this.pendingHostKeyPrompts.push(evt)
      })
    },

    clearPromptsForSession(sessionId: string | null): void {
      if (!sessionId) return
      this.pendingKeyboardPrompts = this.pendingKeyboardPrompts.filter((p) => p.sessionId !== sessionId)
      this.pendingHostKeyPrompts = this.pendingHostKeyPrompts.filter((p) => p.sessionId !== sessionId)
    },

    async respondHostKey(accept: boolean): Promise<void> {
      const pending = this.pendingHostKeyPrompt
      if (!pending) {
        return
      }
      this.pendingHostKeyPrompts = this.pendingHostKeyPrompts.filter((p) => p.requestId !== pending.requestId)
      await invoke<void>(INVOKE_CHANNELS.sessionHostKeyRespond, { requestId: pending.requestId, accept })
    },

    /** Submits the user's answers to the current keyboard-interactive challenge (e.g. a typed OTP code). */
    async respondKeyboardInteractive(responses: string[]): Promise<void> {
      const pending = this.pendingKeyboardPrompt
      if (!pending) {
        return
      }
      this.pendingKeyboardPrompts = this.pendingKeyboardPrompts.filter((p) => p.requestId !== pending.requestId)
      await invoke<void>(INVOKE_CHANNELS.sessionKeyboardInteractiveRespond, {
        requestId: pending.requestId,
        responses
      })
    },

    /** User dismissed the challenge without answering — sends empty answers, which the server will simply reject as failed auth. */
    async cancelKeyboardInteractive(): Promise<void> {
      const pending = this.pendingKeyboardPrompt
      if (!pending) {
        return
      }
      await this.respondKeyboardInteractive(pending.prompts.map(() => ''))
    },

    /** Shared connect path for both quick-connect and saved-site connect — defaults to the active tab unless `targetTabId` is given. */
    async openSession(
      request: ConnectRequest,
      label: string,
      hostLabel: string,
      siteId: string | null,
      trustedHostKey?: { host: string; port: number },
      targetTabId?: string
    ): Promise<void> {
      this.ensureStatusSubscription()
      this.ensureKeyboardInteractiveSubscription()
      this.ensureHostKeySubscription()
      const tab = (targetTabId ? this.tabs.find((t) => t.tabId === targetTabId) : undefined) ?? this.activeTab
      tab.preConnectSnapshot = {
        siteId: tab.siteId,
        label: tab.label,
        hostLabel: tab.hostLabel,
        status: tab.status,
        hadConnected: tab.hadConnected,
        quickConnectInput: tab.quickConnectInput ? { ...tab.quickConnectInput } : undefined
      }
      const previousSessionId = tab.sessionId
      tab.connecting = true
      tab.status = 'connecting'
      tab.hadConnected = false
      const nextSessionId = crypto.randomUUID()
      tab.sessionId = nextSessionId
      if (previousSessionId) {
        this.clearPromptsForSession(previousSessionId)
        void teardownSession(previousSessionId, nextSessionId)
        void invoke<void>(INVOKE_CHANNELS.sessionClose, previousSessionId).catch(() => {})
      }
      tab.progressMessages = []
      tab.statusMessage = null
      tab.pendingHostKeyMismatch = null
      tab.remoteHostInfo = null
      tab.label = label
      tab.hostLabel = hostLabel
      tab.siteId = siteId
      if (siteId !== null) {
        tab.quickConnectInput = undefined
        ephemeralQuickSecrets.delete(tab.tabId)
      }
      void this.persistOpenTabs()
      // Tracked on the tab itself so closeTab() can await this exact attempt instead of
      // detaching the tab while a session is still being opened underneath it (which would
      // otherwise orphan a real SSH connection with no UI path left to close it).
      const attempt = this.performOpenSession(tab, request, label, hostLabel, siteId, trustedHostKey)
      tab.connectPromise = attempt
      return attempt
    },

    /** The actual connect body, split out from {@link openSession} so its own promise can be assigned to `tab.connectPromise` before this starts running, instead of self-referencing a variable being initialized. */
    async performOpenSession(
      tab: SessionTab,
      request: ConnectRequest,
      label: string,
      hostLabel: string,
      siteId: string | null,
      trustedHostKey?: { host: string; port: number }
    ): Promise<void> {
      const notify = useNotify()
      const startedSessionId = tab.sessionId
      const isAbandoned = (): boolean =>
        tab.sessionId !== startedSessionId || !this.tabs.some((t) => t.tabId === tab.tabId)
      try {
        const result = await invoke<SessionOpenResult>(INVOKE_CHANNELS.sessionOpen, {
          ...request,
          sessionId: tab.sessionId,
          trustedHostKey
        })
        if (isAbandoned()) {
          return
        }
        if (tab.status === 'error' || tab.status === 'disconnected') return
        const siteRemotePath = 'quickConnect' in request
          ? request.quickConnect.remoteInitialPath
          : useSitesStore().sites.find((site) => site.id === request.siteId)?.remoteInitialPath
        const remoteFs = useRemoteFsStore()
        if (siteRemotePath) void remoteFs.loadForSession(result.sessionId, siteRemotePath)
        else void remoteFs.loadForSession(result.sessionId)
        tab.status = result.status
        tab.hadConnected = result.status === 'connected'
        if (result.status === 'connected') {
          try {
            useCompanionStore().clearWorkspaceError(tab.tabId)
          } catch {
            // Non-fatal in isolated store tests.
          }
        }
        tab.connecting = false
        tab.preConnectSnapshot = null
        notify.success(`Connected to ${label}`)
        void useTerminalStreamsStore().ensureTerminal(result.sessionId).catch(() => {})
        const siteLocalPath =
          result.localInitialPath ??
          ('quickConnect' in request
            ? request.quickConnect.localInitialPath
            : useSitesStore().sites.find((s) => s.id === request.siteId)?.localInitialPath)
        if (siteLocalPath && this.activeTabId === tab.tabId) {
          const localFs = useLocalFsStore()
          await localFs.load(siteLocalPath)
          if (isAbandoned()) {
            return
          }
          if (localFs.error) {
            notify.error('Local start path unavailable', localFs.error)
            if (!localFs.currentPath) {
              await localFs.load()
              if (isAbandoned()) {
                return
              }
            }
          }
        }
      } catch (e) {
        if (startedSessionId) {
          this.clearPromptsForSession(startedSessionId)
          void teardownSession(startedSessionId).catch(() => {})
        }
        if (isAbandoned()) {
          return
        }
        tab.status = 'error'
        tab.statusMessage = e instanceof Error ? e.message : String(e)
        tab.preConnectSnapshot = null
        const errMsg = tab.statusMessage
        const category =
          e instanceof IpcError && e.code === 'HOST_KEY_MISMATCH'
            ? 'host-key'
            : /\b(proxy|socks5?)\b/i.test(errMsg)
              ? 'proxy'
              : /\b(jump\s*host|bastion|hop\s*\d)\b/i.test(errMsg)
                ? 'bastion'
                : 'ssh-connect'
        try {
          useCompanionStore().notifyWorkspaceError({
            scopeKey: tab.tabId,
            category,
            hostLabel: hostLabel || label,
            error: errMsg
          })
        } catch {
          // Non-fatal in isolated store tests.
        }
        if (e instanceof IpcError && e.code === 'HOST_KEY_MISMATCH') {
          tab.pendingHostKeyMismatch = { message: e.message, request, label, hostLabel, siteId, hostKey: e.hostKey }
        } else {
          notify.error('Connection failed', tab.statusMessage)
        }
        throw e
      } finally {
        if (!isAbandoned()) {
          tab.connecting = false
          tab.connectPromise = null
        }
      }
    },

    recordRecentQuickConnect(input: Omit<QuickConnectInput, 'password' | 'passphrase'>): void {
      const entry = toRecentEntry(input)
      const filtered = this.recentQuickConnects.filter(
        (item) => !(item.host === entry.host && item.port === entry.port && item.username === entry.username)
      )
      this.recentQuickConnects = [entry, ...filtered].slice(0, MAX_RECENT_QUICK_CONNECTS)
      saveRecentQuickConnects(this.recentQuickConnects)
    },

    async promoteTabToSite(tabId: string, site: Site): Promise<void> {
      const tab = this.tabs.find((t) => t.tabId === tabId)
      if (!tab) {
        return
      }
      const fromKey = resolveConnectionFilterKey(tab)
      if (fromKey) {
        const filters = useFileFiltersStore()
        filters.getFilter(fromKey, resolveLegacyConnectionFilterKey(tab))
        filters.migrateConnectionFilter(fromKey, `site:${site.id}`)
      }
      const destinationKey = resolveConnectionFilterKey({ ...tab, siteId: null, quickConnectInput: site })
      if (!tab.siteId && tab.quickConnectInput && fromKey && fromKey === destinationKey) {
        await useBookmarksStore().copyEndpointToSite(fromKey, site.id)
        if (!this.tabs.includes(tab) || resolveConnectionFilterKey(tab) !== fromKey) return
      }
      tab.siteId = site.id
      tab.label = site.name
      tab.quickConnectInput = undefined
      ephemeralQuickSecrets.delete(tabId)
      void this.persistOpenTabs()
    },

    async connect(input: QuickConnectInput): Promise<void> {
      const tab = this.activeTab
      const priorQuickConnect = tab.quickConnectInput ? { ...tab.quickConnectInput } : undefined
      const sanitized = sanitizeQuickConnectInput(input)
      tab.quickConnectInput = sanitized
      if (input.password || input.passphrase) {
        ephemeralQuickSecrets.set(tab.tabId, {
          password: input.password || undefined,
          passphrase: input.passphrase || undefined
        })
      } else {
        ephemeralQuickSecrets.delete(tab.tabId)
      }
      this.recordRecentQuickConnect(sanitized)
      const attempt = this.openSession(
        { quickConnect: input },
        input.name || input.host,
        `${input.username}@${input.host}`,
        null
      )
      if (tab.preConnectSnapshot) {
        tab.preConnectSnapshot.quickConnectInput = priorQuickConnect
      }
      await attempt
    },

    /** User accepted a changed host key after being warned — retries the exact same connect attempt with the override set. */
    async acceptHostKeyAndRetry(tabId: string): Promise<void> {
      const tab = this.tabs.find((t) => t.tabId === tabId)
      const pending = tab?.pendingHostKeyMismatch
      if (!tab || !pending) {
        return
      }
      tab.pendingHostKeyMismatch = null
      this.setActiveTab(tabId)
      await this.openSession(pending.request, pending.label, pending.hostLabel, pending.siteId, pending.hostKey)
    },

    /** User declined a changed host key — just clears the warning, leaving the tab in its error state. */
    dismissHostKeyMismatch(tabId: string): void {
      const tab = this.tabs.find((t) => t.tabId === tabId)
      if (tab) {
        tab.pendingHostKeyMismatch = null
      }
    },

    /** Clears an initial-connect Quick Connect error so switching auth modes removes stale alerts. */
    clearQuickConnectError(tabId: string): void {
      const tab = this.tabs.find((t) => t.tabId === tabId)
      if (!tab || tab.siteId !== null || tab.hadConnected || tab.status !== 'error') {
        return
      }
      tab.status = null
      tab.statusMessage = null
    },

    /** Connects to a saved site — switches to an already-open/connecting tab for the same site unless `forceNewTab` is set. */
    async connectToSite(site: Site, options?: { newTabIfBusy?: boolean; forceNewTab?: boolean }): Promise<void> {
      const existing = !options?.forceNewTab
        ? this.tabs.find(
            (t) => t.siteId === site.id && t.tabId !== this.activeTabId && (t.status === 'connected' || t.connecting)
          )
        : undefined
      if (existing) {
        const previousTab = this.activeTab
        const previousWasEmptyPicker =
          previousTab.sessionId === null &&
          previousTab.siteId === null &&
          previousTab.status === null &&
          !previousTab.connecting
        this.setActiveTab(existing.tabId)
        if (previousWasEmptyPicker && previousTab.tabId !== existing.tabId) {
          this.tabs = this.tabs.filter((t) => t.tabId !== previousTab.tabId)
        }
        return
      }
      if ((options?.newTabIfBusy || options?.forceNewTab) && (this.activeTab.connecting || this.activeTab.sessionId !== null || this.activeTab.siteId !== null)) {
        this.openNewTab()
      } else if (this.activeTab.connecting) {
        // A second request from the picker would redirect the in-flight picker tab to a different site.
        return
      } else if (this.activeTab.sessionId !== null) {
        // Never overwrite and orphan an already-live session on the active tab (e.g. via CommandPalette).
        this.openNewTab()
      }
      await this.openSession({ siteId: site.id }, site.name, `${site.username}@${site.host}`, site.id)
    },

    async reconnectAll(): Promise<void> {
      const sitesStore = useSitesStore()
      const notify = useNotify()
      const gen = this.reconnectAllGen
      const targets = [...this.restoredSiteTabs]
      let failed = 0
      for (const tab of targets) {
        if (this.reconnectAllGen !== gen) {
          break
        }
        const site = sitesStore.sites.find((s) => s.id === tab.siteId)
        if (!site) {
          continue
        }
        try {
          await this.openSession(
            { siteId: site.id },
            site.name,
            `${site.username}@${site.host}`,
            site.id,
            undefined,
            tab.tabId
          )
        } catch {
          failed += 1
        }
      }
      if (failed > 0 && this.reconnectAllGen === gen) {
        notify.error('Reconnect incomplete', `${failed} of ${targets.length} restored tabs failed to connect`)
      }
    },

    async cancelConnect(tabId: string): Promise<void> {
      this.reconnectAllGen += 1
      const tab = this.tabs.find((t) => t.tabId === tabId)
      if (!tab || !tab.connecting || !tab.sessionId) {
        return
      }
      const sessionId = tab.sessionId
      const snap = tab.preConnectSnapshot
      tab.sessionId = null
      tab.status = snap?.status ?? null
      tab.statusMessage = null
      tab.progressMessages = []
      tab.connecting = false
      tab.connectPromise = null
      tab.hadConnected = snap?.hadConnected ?? false
      tab.siteId = snap?.siteId ?? null
      tab.label = snap?.label ?? null
      tab.hostLabel = snap?.hostLabel ?? null
      tab.quickConnectInput = snap?.quickConnectInput
      tab.preConnectSnapshot = null
      if (!snap?.quickConnectInput) {
        ephemeralQuickSecrets.delete(tab.tabId)
      }
      this.clearPromptsForSession(sessionId)
      void this.persistOpenTabs()
      try {
        await invoke<void>(INVOKE_CHANNELS.sessionClose, sessionId)
      } finally {
        await teardownSession(sessionId)
      }
    },

    /** Disconnects a tab's live SSH/SFTP session while keeping the tab (and any ephemeral Quick Connect secrets) for reconnect. */
    async disconnectTab(tabId: string): Promise<void> {
      const tab = this.tabs.find((t) => t.tabId === tabId)
      if (!tab || (!tab.sessionId && tab.status !== 'connected' && !tab.connecting)) {
        return
      }
      const sid = tab.sessionId
      this.clearPromptsForSession(sid)
      tab.sessionId = null
      tab.status = 'disconnected'
      tab.connecting = false
      tab.connectPromise = null
      tab.statusMessage = null
      tab.pendingHostKeyMismatch = null
      tab.remoteHostInfo = null
      tab.preConnectSnapshot = null
      if (sid) {
        try {
          await invoke<void>(INVOKE_CHANNELS.sessionClose, sid)
        } finally {
          await teardownSession(sid)
        }
      }
    },

    /** Reconnects a disconnected or errored tab (saved site or Quick Connect). */
    async reconnectTab(tabId: string): Promise<void> {
      const tab = this.tabs.find((t) => t.tabId === tabId)
      if (!tab || tab.connecting) {
        return
      }
      this.setActiveTab(tabId)
      if (tab.siteId) {
        const site = useSitesStore().sites.find((s) => s.id === tab.siteId)
        if (site) {
          await this.openSession({ siteId: site.id }, site.name, `${site.username}@${site.host}`, site.id)
        } else {
          tab.status = null
          tab.statusMessage = null
        }
        return
      }
      if (tab.quickConnectInput) {
        const secret = ephemeralQuickSecrets.get(tabId)
        if (tab.quickConnectInput.authMethod !== 'password' || secret?.password) {
          await this.connect({ ...tab.quickConnectInput, ...secret })
        } else {
          tab.status = null
          tab.statusMessage = null
        }
      }
    },

    /** Opens a new tab cloned from an existing tab and connects it (when backed by a site or reusable Quick Connect credentials). */
    async duplicateTab(tabId: string): Promise<void> {
      const source = this.tabs.find((t) => t.tabId === tabId)
      if (!source) {
        return
      }
      const newTab = freshTab()
      this.tabs.push(newTab)
      this.activeTabId = newTab.tabId
      const secret = ephemeralQuickSecrets.get(tabId)
      if (secret) {
        ephemeralQuickSecrets.set(newTab.tabId, { ...secret })
      }
      if (source.siteId) {
        const site = useSitesStore().sites.find((s) => s.id === source.siteId)
        if (site) {
          await this.openSession({ siteId: site.id }, site.name, `${site.username}@${site.host}`, site.id)
        }
      } else if (source.quickConnectInput) {
        if (source.quickConnectInput.authMethod !== 'password' || secret?.password) {
          await this.connect({ ...source.quickConnectInput, ...secret })
        } else {
          newTab.quickConnectInput = { ...source.quickConnectInput }
          newTab.label = source.label
          newTab.hostLabel = source.hostLabel
        }
      }
    },

    /** Closes every open tab except `keepTabId`. */
    async closeOtherTabs(keepTabId: string): Promise<void> {
      if (!this.tabs.some((t) => t.tabId === keepTabId)) {
        return
      }
      this.setActiveTab(keepTabId)
      const toClose = this.tabs.filter((t) => t.tabId !== keepTabId)
      // Every closeTab updates the visible tab list before its first await.
      // Do not serialize native SSH shutdowns: one hung close must not block the rest.
      const closing = toClose.map((tab) => this.closeTab(tab.tabId, false))
      if (toClose.length > 0) {
        void this.persistOpenTabs()
      }
      await Promise.allSettled(closing)
    },

    /** Unlinks or closes tabs referencing deleted saved sites so no ghost siteId remains. */
    async unlinkDeletedSites(siteIds: string[]): Promise<void> {
      if (siteIds.length === 0) return
      const deleted = new Set(siteIds)
      const toClose: string[] = []
      for (const tab of this.tabs) {
        if (tab.preConnectSnapshot?.siteId && deleted.has(tab.preConnectSnapshot.siteId)) {
          tab.preConnectSnapshot.siteId = null
        }
        if (!tab.siteId || !deleted.has(tab.siteId)) continue
        if (tab.status === 'connected' || tab.connecting) {
          tab.siteId = null
        } else {
          toClose.push(tab.tabId)
        }
      }
      const closing = toClose.map((tabId) => this.closeTab(tabId, false))
      void this.persistOpenTabs()
      await Promise.allSettled(closing)
    },

    /** Removes a tab immediately so a slow or failed SSH teardown never blocks the site picker. */
    async closeTab(tabId: string, persist = true): Promise<void> {
      const closedIndex = this.tabs.findIndex((t) => t.tabId === tabId)
      if (closedIndex === -1) {
        return
      }
      const tab = this.tabs[closedIndex]
      const sid = tab.sessionId
      const pendingConnect = tab.connectPromise
      tab.sessionId = null
      tab.connecting = false
      tab.connectPromise = null
      this.clearPromptsForSession(sid)
      ephemeralQuickSecrets.delete(tabId)

      // Update the visible tab state without ever exposing an empty `tabs` array
      // to synchronous watchers (e.g. CompareDialog/SyncDialog) before IPC teardown.
      const remaining = this.tabs.filter((t) => t.tabId !== tabId)
      if (remaining.length === 0) {
        const replacement = freshTab()
        this.$patch({
          tabs: [replacement],
          activeTabId: replacement.tabId
        })
      } else {
        const nextActiveTabId =
          this.activeTabId === tabId
            ? remaining[Math.min(closedIndex, remaining.length - 1)].tabId
            : this.activeTabId
        this.$patch({
          activeTabId: nextActiveTabId,
          tabs: remaining
        })
      }
      if (persist) {
        void this.persistOpenTabs()
      }

      if (!sid) {
        return
      }
      try {
        await invoke<void>(INVOKE_CHANNELS.sessionClose, sid)
        if (pendingConnect) {
          await pendingConnect.catch(() => undefined)
        }
      } catch (error) {
        useNotify().error(
          'Could not close SSH session',
          error instanceof Error ? error.message : String(error)
        )
      } finally {
        try {
          await teardownSession(sid)
        } catch (error) {
          useNotify().error(
            'Could not clean up session streams',
            error instanceof Error ? error.message : String(error)
          )
        }
      }
    }
  }
})
