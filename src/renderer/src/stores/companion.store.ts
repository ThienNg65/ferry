import { defineStore } from 'pinia'
import {
  escalateCommandRisk,
  EVENT_CHANNELS,
  formatRemoteOsLabel,
  INVOKE_CHANNELS,
  sanitizeCompanionCommand,
  SEND_CHANNELS,
  type CompanionAiChatRequest,
  type CompanionAiChatResult,
  type CompanionAiConfigInfo,
  type CompanionAiProvider,
  type CompanionAiConfigInput,
  type CompanionAiIntent,
  type CompanionAiStreamEvent,
  type CompanionCommandCard,
  type CompanionCommandRisk,
  type CompanionReleaseHighlight,
  type CompanionReleasesResult,
  type CompanionSiteEnvironment,
  type CompanionUiActionCard,
  type CompanionWorkspaceSignal,
  type MonitorSample,
  type OperationKind
} from '@shared/contract'
import { companionAiCancel, invoke, onEvent } from '../api'
import { openExternal } from '../bridge/neutralinoApi'
import { useCommandPalette } from '../composables/useCommandPalette'
import { useConfirm } from '../composables/useConfirm'
import { useDockState } from '../composables/useDockState'
import { useHistoryDialog } from '../composables/useHistoryDialog'
import { useSettingsDialog } from '../composables/useSettingsDialog'
import { useShortcutsDialog } from '../composables/useShortcutsDialog'
import { getBundledChangelogReleases, OFFICIAL_RELEASES_URL } from '../utils/companionChangelogFallback'
import {
  answerCompanionQuery,
  type CompanionActionChip,
  type CompanionReply
} from '../utils/companionEngine'
import { redactSensitiveText, type IssueCategory } from '../utils/companionPrivacy'
import {
  BUILT_IN_SNIPPETS,
  classifyCommandRisk,
  diagnoseLogSnippetOffline,
  diagnoseMonitorSpikeOffline,
  translatePlainEnglishCommandOffline,
  type CompanionCommandHistoryEntry,
  type CompanionSnippet
} from '../utils/companionSnippets'
import { planReveal } from '../utils/companionReveal'
import { COMPANION_TOUR_STEPS } from '../utils/companionTour'
import { evaluateVersionTransition } from '../utils/companionVersion'
import { prefersReducedMotion } from '../utils/motionTokens'
import { resolveConnectionFilterKey, useFileFiltersStore } from './fileFilters.store'
import { useMonitorStore } from './monitor.store'
import { useRemoteFsStore } from './remoteFs.store'
import { useSessionsStore } from './sessions.store'
import { useSettingsStore } from './settings.store'
import { useSitesStore } from './sites.store'
import { useTailStreamsStore } from './tailStreams.store'
import { useTerminalStreamsStore } from './terminalStreams.store'
import { useUiStore } from './ui.store'

export const OPEN_FILE_FILTERS_EVENT = 'ferry:open-file-filters'
export const OPEN_REMOTE_EDITOR_EVENT = 'ferry:open-remote-editor'

const QUIET_KEY = 'ferry:ui:companionQuiet'
const SHOW_IN_DOCK_KEY = 'ferry:ui:companionShowDock'
const RELEASES_PREF_KEY = 'ferry:ui:companionReleases'
const TIPS_PREF_KEY = 'ferry:ui:companionTips'
const SEEN_VERSION_KEY = 'ferry:ui:companionSeenVer'
const PREV_VERSION_KEY = 'ferry:ui:companionPrevVer'
const DISMISSED_VERSIONS_KEY = 'ferry:ui:companionDismissedVers'
const ONBOARDED_KEY = 'ferry:ui:companionOnboarded'
const GREET_DATE_KEY = 'ferry:ui:companionGreetDate'
const SNIPPETS_KEY = 'ferry:ui:companionSnippets'
const CMD_HISTORY_KEY = 'ferry:ui:companionCmdHistory'

const TRANSFER_TIP_DEBOUNCE_MS = 1_500
const TRANSFER_TIP_COOLDOWN_MS = 5 * 60 * 1_000
const MAX_DISMISSED_VERSIONS = 20
const MAX_CUSTOM_SNIPPETS = 100
const MAX_CMD_HISTORY = 30
const MAX_CHAT_MESSAGES = 100

let releasesInFlight: Promise<CompanionReleaseHighlight[]> | null = null

const PROVIDER_LABEL: Record<CompanionAiProvider, string> = { none: 'AI', gemini: 'Gemini', 'ferry-pro': 'Ferry Pro' }

export type CompanionAvatarState = 'idle' | 'listening' | 'thinking' | 'streaming' | 'error'
export type CompanionView = 'chat' | 'snippets' | 'whats-new' | 'report' | 'history'

export interface CompanionReveal {
  messageId: string
  chunks: string[]
  shown: number
}

export type CompanionErrorCategory = 'transfer' | 'ssh-connect' | 'host-key' | 'proxy' | 'bastion' | 'operation'

export interface CompanionTransferErrorRecord {
  sessionId: string
  category?: CompanionErrorCategory
  error: string
  direction?: 'upload' | 'download'
  localPath?: string
  remotePath?: string
  operationKind?: OperationKind
  label?: string
  hostLabel?: string
  occurredAt: string
}

export interface CompanionNotice {
  id: string
  kind: 'intro' | 'greeting' | 'upgrade' | 'transfer-error'
  title: string
  body: string
  ctaLabel: string
  version?: string
  errorSummary?: string
}

export interface CompanionAnnouncement {
  id: string
  kind: 'upgrade' | 'intro' | 'transfer-error'
  title: string
  body: string
  version?: string
  createdAt: string
  read: boolean
}

export interface CompanionMessage {
  id: string
  role: 'user' | 'assistant'
  text: string
  createdAt: string
  source?: 'local' | 'ai'
  feedback?: 'helpful' | 'not-helpful'
  rootCause?: string
  commandCards?: CompanionCommandCard[]
  uiActionCards?: CompanionUiActionCard[]
  actions?: CompanionActionChip[]
  releaseCard?: CompanionReply['releaseCard']
}

function readStored(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function writeStored(key: string, value: string, dirtyKeys?: Set<string>): void {
  dirtyKeys?.add(key)
  try {
    localStorage.setItem(key, value)
  } catch {
    // Ignore restricted storage errors.
  }
  if (typeof window !== 'undefined' && window.api) {
    void invoke<void>(INVOKE_CHANNELS.settingsSetUiPref, { key, value }).catch(() => {
      // Non-fatal in isolated unit tests or disconnected contexts.
    })
  }
}

function parseBool(raw: string | null | undefined, fallback: boolean): boolean {
  if (raw === 'true') return true
  if (raw === 'false') return false
  return fallback
}

function parseVersionList(raw: string | null | undefined): string[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter((v): v is string => typeof v === 'string' && v.trim().length > 0).slice(-MAX_DISMISSED_VERSIONS)
  } catch {
    return []
  }
}

function parseSnippetList(raw: string | null | undefined): CompanionSnippet[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter(
        (s): s is CompanionSnippet =>
          Boolean(
            s &&
              typeof s === 'object' &&
              typeof (s as CompanionSnippet).id === 'string' &&
              typeof (s as CompanionSnippet).label === 'string' &&
              typeof (s as CompanionSnippet).command === 'string' &&
              (s as CompanionSnippet).command.trim().length > 0
          )
      )
      .map((s) => {
        const command = sanitizeCompanionCommand(s.command)
        return {
          id: s.id,
          label: s.label.trim().slice(0, 80),
          command,
          description: typeof s.description === 'string' ? s.description.trim().slice(0, 240) : '',
          risk: classifyCommandRisk(command)
        }
      })
      .filter((s) => s.command.length > 0)
      .slice(0, MAX_CUSTOM_SNIPPETS)
  } catch {
    return []
  }
}

function parseCommandHistory(raw: string | null | undefined): CompanionCommandHistoryEntry[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter(
        (h): h is CompanionCommandHistoryEntry =>
          Boolean(
            h &&
              typeof h === 'object' &&
              typeof (h as CompanionCommandHistoryEntry).id === 'string' &&
              typeof (h as CompanionCommandHistoryEntry).command === 'string' &&
              typeof (h as CompanionCommandHistoryEntry).executedAt === 'string'
          )
      )
      .map((h) => {
        const command = sanitizeCompanionCommand(h.command)
        const rawRisk = h.risk === 'destructive' || h.risk === 'mutating' || h.risk === 'read_only' ? h.risk : 'read_only'
        return {
          ...h,
          command,
          risk: escalateCommandRisk(rawRisk, command),
          hostLabel: typeof h.hostLabel === 'string' ? h.hostLabel.trim().slice(0, 80) : null
        }
      })
      .filter((h) => h.command.length > 0)
      .slice(0, MAX_CMD_HISTORY)
  } catch {
    return []
  }
}

function todayLocalKey(now = new Date()): string {
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

let msgSeq = 0
function nextId(prefix: string): string {
  msgSeq += 1
  return `${prefix}-${Date.now()}-${msgSeq}`
}

interface CompanionState {
  open: boolean
  /** Transient overlay override (e.g. when opened from inside a modal like SyncDialog) so panel floats above backdrops. */
  forceOverlay: boolean
  hasOpenedOnce: boolean
  activeView: CompanionView
  reportCategory: IssueCategory
  quietMode: boolean
  showInDock: boolean
  showReleaseAnnouncements: boolean
  contextualTips: boolean
  lastSeenVersion: string | null
  previousVersion: string | null
  dismissedVersions: string[]
  onboarded: boolean
  lastGreetingDate: string | null
  currentVersion: string
  notice: CompanionNotice | null
  announcements: CompanionAnnouncement[]
  messages: CompanionMessage[]
  releases: CompanionReleaseHighlight[]
  releasesLoaded: boolean
  releasesLoading: boolean
  releasesOfflineFallback: boolean
  transferErrorsBySession: Record<string, CompanionTransferErrorRecord>
  tourStep: number | null
  aiConfig: CompanionAiConfigInfo
  aiConfigLoaded: boolean
  aiBusy: boolean
  aiGeneration: number
  activeAiRequestId: string | null
  chatStreamRequestId: string | null
  streamingMessageId: string | null
  unsubscribeAiStream: (() => void) | null
  customSnippets: CompanionSnippet[]
  commandHistory: CompanionCommandHistoryEntry[]
  lifecycleInitialized: boolean
  dirtyPrefKeys: Set<string>
  lastTransferTipAt: number
  transferTipTimer: ReturnType<typeof setTimeout> | null
  reveal: CompanionReveal | null
  revealTimer: ReturnType<typeof setInterval> | null
  aiErrorLabel: string | null
  listening: boolean
}

export const useCompanionStore = defineStore('companion', {
  state: (): CompanionState => ({
    open: false,
    forceOverlay: false,
    hasOpenedOnce: false,
    activeView: 'chat',
    reportCategory: 'bug',
    quietMode: parseBool(readStored(QUIET_KEY), false),
    showInDock: parseBool(readStored(SHOW_IN_DOCK_KEY), true),
    showReleaseAnnouncements: parseBool(readStored(RELEASES_PREF_KEY), true),
    contextualTips: parseBool(readStored(TIPS_PREF_KEY), true),
    lastSeenVersion: readStored(SEEN_VERSION_KEY),
    previousVersion: readStored(PREV_VERSION_KEY),
    dismissedVersions: parseVersionList(readStored(DISMISSED_VERSIONS_KEY)),
    onboarded: parseBool(readStored(ONBOARDED_KEY), false),
    lastGreetingDate: readStored(GREET_DATE_KEY),
    currentVersion: '',
    notice: null,
    announcements: [],
    messages: [],
    releases: [],
    releasesLoaded: false,
    releasesLoading: false,
    releasesOfflineFallback: false,
    transferErrorsBySession: {},
    tourStep: null,
    aiConfig: { provider: 'none', endpoint: '', model: '', hasApiKey: false },
    aiConfigLoaded: false,
    aiBusy: false,
    aiGeneration: 0,
    activeAiRequestId: null,
    chatStreamRequestId: null,
    streamingMessageId: null,
    unsubscribeAiStream: null,
    customSnippets: parseSnippetList(readStored(SNIPPETS_KEY)),
    commandHistory: parseCommandHistory(readStored(CMD_HISTORY_KEY)),
    lifecycleInitialized: false,
    dirtyPrefKeys: new Set<string>(),
    lastTransferTipAt: 0,
    transferTipTimer: null,
    reveal: null,
    revealTimer: null,
    aiErrorLabel: null,
    listening: false
  }),

  getters: {
    hasUnreadNotice: (state): boolean => state.notice !== null,
    unreadAnnouncementCount: (state): number => state.announcements.filter((a) => !a.read).length,
    allSnippets: (state): CompanionSnippet[] => [...state.customSnippets, ...BUILT_IN_SNIPPETS],
    effectiveAvatarState(state): CompanionAvatarState {
      if (state.streamingMessageId !== null) return 'streaming'
      if (state.aiBusy || state.releasesLoading) return 'thinking'
      if (state.reveal) return 'streaming'
      if (state.aiErrorLabel) return 'error'
      if (state.listening) return 'listening'
      return 'idle'
    },
    hasNotice: (state): boolean => state.notice !== null && !state.quietMode,
    lastTransferErrorRecord(state): CompanionTransferErrorRecord | null {
      const sessions = useSessionsStore()
      const sessionId = sessions.activeSessionId
      if (sessionId && state.transferErrorsBySession[sessionId]) {
        return state.transferErrorsBySession[sessionId]
      }
      const tabId = sessions.activeTab?.tabId
      if (tabId && state.transferErrorsBySession[tabId]) {
        return state.transferErrorsBySession[tabId]
      }
      return state.transferErrorsBySession.__global__ ?? null
    },
    lastTransferError(): string | null {
      return this.lastTransferErrorRecord?.error ?? null
    },
    prodSiteLabel(): string | null {
      const sessions = useSessionsStore()
      if (sessions.status !== 'connected') return null
      const tab = sessions.activeTab
      const site = tab?.siteId ? useSitesStore().sites.find((s) => s.id === tab.siteId) : undefined
      if (site?.environment !== 'prod') return null
      return `${tab.label ?? site.name}, Production`
    },
    isProd(): boolean {
      return this.prodSiteLabel !== null
    },
    avatarLabel(): string {
      switch (this.effectiveAvatarState) {
        case 'listening':
          return 'Listening'
        case 'thinking':
          return 'Thinking'
        case 'streaming':
          return 'Replying'
        case 'error':
          return this.aiErrorLabel ?? 'Companion'
        default:
          return 'Companion'
      }
    }
  },

  actions: {
    hydrateFromPrefs(prefs: Record<string, string>): void {
      if (!this.dirtyPrefKeys.has(QUIET_KEY) && QUIET_KEY in prefs) {
        this.quietMode = parseBool(prefs[QUIET_KEY], false)
      }
      if (!this.dirtyPrefKeys.has(SHOW_IN_DOCK_KEY) && SHOW_IN_DOCK_KEY in prefs) {
        this.showInDock = parseBool(prefs[SHOW_IN_DOCK_KEY], true)
      }
      if (!this.dirtyPrefKeys.has(RELEASES_PREF_KEY) && RELEASES_PREF_KEY in prefs) {
        this.showReleaseAnnouncements = parseBool(prefs[RELEASES_PREF_KEY], true)
      }
      if (!this.dirtyPrefKeys.has(TIPS_PREF_KEY) && TIPS_PREF_KEY in prefs) {
        this.contextualTips = parseBool(prefs[TIPS_PREF_KEY], true)
      }
      if (!this.dirtyPrefKeys.has(SEEN_VERSION_KEY) && SEEN_VERSION_KEY in prefs) {
        this.lastSeenVersion = prefs[SEEN_VERSION_KEY] || null
      }
      if (!this.dirtyPrefKeys.has(PREV_VERSION_KEY) && PREV_VERSION_KEY in prefs) {
        this.previousVersion = prefs[PREV_VERSION_KEY] || null
      }
      if (!this.dirtyPrefKeys.has(DISMISSED_VERSIONS_KEY) && DISMISSED_VERSIONS_KEY in prefs) {
        this.dismissedVersions = parseVersionList(prefs[DISMISSED_VERSIONS_KEY])
      }
      if (!this.dirtyPrefKeys.has(ONBOARDED_KEY) && ONBOARDED_KEY in prefs) {
        this.onboarded = parseBool(prefs[ONBOARDED_KEY], false)
      }
      if (!this.dirtyPrefKeys.has(GREET_DATE_KEY) && GREET_DATE_KEY in prefs) {
        this.lastGreetingDate = prefs[GREET_DATE_KEY] || null
      }
      if (!this.dirtyPrefKeys.has(SNIPPETS_KEY) && SNIPPETS_KEY in prefs) {
        this.customSnippets = parseSnippetList(prefs[SNIPPETS_KEY])
      }
      if (!this.dirtyPrefKeys.has(CMD_HISTORY_KEY) && CMD_HISTORY_KEY in prefs) {
        this.commandHistory = parseCommandHistory(prefs[CMD_HISTORY_KEY])
      }
    },

    setQuietMode(enabled: boolean): void {
      this.quietMode = enabled
      writeStored(QUIET_KEY, String(enabled), this.dirtyPrefKeys)
      if (enabled) {
        this.notice = null
      }
    },

    setShowInDock(enabled: boolean): void {
      this.showInDock = enabled
      writeStored(SHOW_IN_DOCK_KEY, String(enabled), this.dirtyPrefKeys)
    },

    setShowReleaseAnnouncements(enabled: boolean): void {
      this.showReleaseAnnouncements = enabled
      writeStored(RELEASES_PREF_KEY, String(enabled), this.dirtyPrefKeys)
      if (!enabled && this.notice?.kind === 'upgrade') {
        this.notice = null
      }
    },

    setContextualTips(enabled: boolean): void {
      this.contextualTips = enabled
      writeStored(TIPS_PREF_KEY, String(enabled), this.dirtyPrefKeys)
      if (!enabled && (this.notice?.kind === 'greeting' || this.notice?.kind === 'transfer-error')) {
        this.notice = null
      }
    },

    openPanel(view: CompanionView = 'chat', options?: { overlay?: boolean }): void {
      this.hasOpenedOnce = true
      if (options?.overlay) {
        this.forceOverlay = true
      }
      this.open = true
      this.activeView = view
      if (!this.aiConfigLoaded) {
        void this.loadAiConfig()
      }
      if (this.notice && this.notice.kind !== 'intro') {
        this.notice = null
      } else if (this.notice?.kind === 'intro') {
        this.notice = null
      }
      if (view === 'whats-new') {
        void this.ensureReleasesLoaded()
      }
    },

    async loadAiConfig(): Promise<CompanionAiConfigInfo> {
      try {
        const cfg = await invoke<CompanionAiConfigInfo>(INVOKE_CHANNELS.companionAiGetConfig)
        if (cfg && cfg.provider) {
          this.aiConfig = cfg
        }
      } catch {
        // Non-fatal in isolated tests or disconnected contexts.
      } finally {
        this.aiConfigLoaded = true
      }
      return this.aiConfig
    },

    async saveAiConfig(input: CompanionAiConfigInput): Promise<CompanionAiConfigInfo> {
      const saved = await invoke<CompanionAiConfigInfo>(INVOKE_CHANNELS.companionAiSetConfig, input)
      this.aiConfig = saved
      this.aiConfigLoaded = true
      return saved
    },

    async testAiConnection(override?: CompanionAiConfigInput): Promise<CompanionAiChatResult> {
      return invoke<CompanionAiChatResult>(INVOKE_CHANNELS.companionAiTest, override)
    },

    startTour(): void {
      this.activeView = 'chat'
      this.tourStep = 0
      this.markOnboarded()
    },

    nextTourStep(): void {
      if (this.tourStep === null) return
      if (this.tourStep + 1 >= COMPANION_TOUR_STEPS.length) {
        this.tourStep = null
        this.pushSystemNote('Tour complete! Ask me anything anytime.')
      } else {
        this.tourStep += 1
      }
    },

    prevTourStep(): void {
      if (this.tourStep === null || this.tourStep <= 0) return
      this.tourStep -= 1
    },

    endTour(): void {
      this.tourStep = null
    },

    setMessageFeedback(messageId: string, rating: 'helpful' | 'not-helpful'): void {
      const target = this.messages.find((m) => m.id === messageId && m.role === 'assistant')
      if (!target) return
      target.feedback = target.feedback === rating ? undefined : rating
    },

    closePanel(): void {
      this.open = false
      this.forceOverlay = false
      this.finishReveal()
      this.aiErrorLabel = null
      this.listening = false
    },

    setListening(value: boolean): void {
      this.listening = value
    },

    togglePanel(): void {
      if (this.open) {
        this.closePanel()
      } else {
        this.openPanel('chat')
      }
    },

    markOnboarded(): void {
      if (!this.onboarded) {
        this.onboarded = true
        writeStored(ONBOARDED_KEY, 'true', this.dirtyPrefKeys)
      }
    },

    dismissNotice(): void {
      const current = this.notice
      if (!current) return
      if (current.kind === 'upgrade' && current.version) {
        this.dismissVersion(current.version)
      } else if (current.kind === 'intro') {
        this.markOnboarded()
      }
      this.notice = null
    },

    dismissVersion(version: string): void {
      if (!version) return
      if (!this.dismissedVersions.includes(version)) {
        this.dismissedVersions = [...this.dismissedVersions, version].slice(-MAX_DISMISSED_VERSIONS)
        writeStored(DISMISSED_VERSIONS_KEY, JSON.stringify(this.dismissedVersions), this.dirtyPrefKeys)
      }
      for (const ann of this.announcements) {
        if (ann.version === version) ann.read = true
      }
      if (this.notice?.kind === 'upgrade' && this.notice.version === version) {
        this.notice = null
      }
    },

    recordAnnouncement(entry: Omit<CompanionAnnouncement, 'id' | 'createdAt' | 'read'>): void {
      this.announcements.unshift({
        ...entry,
        id: nextId('ann'),
        createdAt: new Date().toISOString(),
        read: false
      })
      if (this.announcements.length > 20) {
        this.announcements = this.announcements.slice(0, 20)
      }
    },

    initLifecycle(installedVersion: string, now = new Date()): void {
      if (this.lifecycleInitialized) return
      this.lifecycleInitialized = true
      this.currentVersion = installedVersion

      const transition = evaluateVersionTransition({
        currentVersion: installedVersion,
        lastSeenVersion: this.lastSeenVersion,
        dismissedVersions: this.dismissedVersions
      })

      if (transition.kind === 'first-run') {
        this.lastSeenVersion = installedVersion
        writeStored(SEEN_VERSION_KEY, installedVersion, this.dirtyPrefKeys)
        if (!this.onboarded && !this.quietMode) {
          this.notice = {
            id: nextId('notice'),
            kind: 'intro',
            title: 'Meet Ferry Companion',
            body: 'Need a quick tour, release highlights, or help reporting an issue? I stay out of your way until you click.',
            ctaLabel: 'Show me around'
          }
          this.recordAnnouncement({
            kind: 'intro',
            title: 'Welcome to Ferry',
            body: 'Optional quick tour and workspace tips are ready whenever you need them.'
          })
        }
        return
      }

      if (transition.kind === 'upgraded') {
        if (transition.previousVersion) {
          this.previousVersion = transition.previousVersion
          writeStored(PREV_VERSION_KEY, transition.previousVersion, this.dirtyPrefKeys)
        }
        this.lastSeenVersion = installedVersion
        writeStored(SEEN_VERSION_KEY, installedVersion, this.dirtyPrefKeys)

        this.recordAnnouncement({
          kind: 'upgrade',
          title: `Updated to Ferry v${installedVersion}`,
          body: transition.previousVersion
            ? `Upgraded from v${transition.previousVersion}. Open What's New to see what changed.`
            : `Ferry v${installedVersion} is now running.`,
          version: installedVersion
        })

        if (transition.shouldAnnounceUpgrade && this.showReleaseAnnouncements && !this.quietMode) {
          this.notice = {
            id: nextId('notice'),
            kind: 'upgrade',
            title: 'Ferry just got a little better!',
            body: `You're now running v${installedVersion}. Want a quick look at what's new?`,
            ctaLabel: "See what's new",
            version: installedVersion
          }
          // Pre-warm official release notes in the background only after a real upgrade.
          void this.ensureReleasesLoaded()
        }
        return
      }

      if (transition.kind === 'downgraded') {
        this.lastSeenVersion = installedVersion
        writeStored(SEEN_VERSION_KEY, installedVersion, this.dirtyPrefKeys)
        return
      }

      // Same-version relaunch: at most one non-blocking greeting per local day if enabled.
      const today = todayLocalKey(now)
      if (!this.quietMode && this.contextualTips && this.onboarded && this.lastGreetingDate !== today) {
        this.lastGreetingDate = today
        writeStored(GREET_DATE_KEY, today, this.dirtyPrefKeys)
        this.notice = {
          id: nextId('notice'),
          kind: 'greeting',
          title: 'Welcome back',
          body: 'Press Ctrl+Space anytime for shortcuts, release notes, or troubleshooting.',
          ctaLabel: 'Open Companion'
        }
      }
    },

    openNoticeAction(): void {
      const current = this.notice
      if (!current) {
        this.openPanel('chat')
        return
      }
      if (current.kind === 'upgrade') {
        if (current.version) this.dismissVersion(current.version)
        this.openPanel('whats-new')
        return
      }
      if (current.kind === 'intro') {
        this.markOnboarded()
        this.openPanel('chat')
        this.startTour()
        return
      }
      if (current.kind === 'transfer-error') {
        this.openPanel('chat')
        void this.ask('Help me troubleshoot a failed transfer')
        return
      }
      this.openPanel('chat')
    },

    async ensureReleasesLoaded(forceRefresh = false): Promise<CompanionReleaseHighlight[]> {
      if (this.releasesLoaded && !this.releasesOfflineFallback && !forceRefresh && this.releases.length > 0) {
        return this.releases
      }
      if (!forceRefresh && !useSettingsStore().autoCheckUpdates) {
        if (this.releases.length === 0) {
          this.releases = getBundledChangelogReleases()
          this.releasesOfflineFallback = true
          this.releasesLoaded = true
        }
        return this.releases
      }
      if (releasesInFlight && !forceRefresh) {
        return releasesInFlight
      }
      const run = async (): Promise<CompanionReleaseHighlight[]> => {
        this.releasesLoading = true
        try {
          const res = await invoke<CompanionReleasesResult>(INVOKE_CHANNELS.companionGetReleases, { forceRefresh })
          if (res && Array.isArray(res.releases) && res.releases.length > 0) {
            this.releases = res.releases
            this.releasesOfflineFallback = res.offlineFallback
            this.releasesLoaded = true
            return this.releases
          }
        } catch {
          // Fall through to bundled offline changelog.
        } finally {
          this.releasesLoading = false
        }

        this.releases = getBundledChangelogReleases()
        this.releasesOfflineFallback = true
        this.releasesLoaded = true
        return this.releases
      }
      const promise = run().finally(() => {
        if (releasesInFlight === promise) {
          releasesInFlight = null
        }
      })
      releasesInFlight = promise
      return promise
    },

    clearWorkspaceError(scopeKey: string): void {
      if (scopeKey in this.transferErrorsBySession) {
        const next = { ...this.transferErrorsBySession }
        delete next[scopeKey]
        this.transferErrorsBySession = next
      }
    },

    notifyWorkspaceError(input: {
      scopeKey?: string
      category: CompanionErrorCategory
      error: string
      direction?: 'upload' | 'download'
      localPath?: string
      remotePath?: string
      operationKind?: OperationKind
      label?: string
      hostLabel?: string
    }): void {
      const trimmed = input.error.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, 500)
      if (!trimmed) return
      const sessions = useSessionsStore()
      const scopeKey = input.scopeKey || sessions.activeSessionId || sessions.activeTab?.tabId || '__global__'
      this.transferErrorsBySession[scopeKey] = {
        sessionId: scopeKey,
        category: input.category,
        error: trimmed,
        direction: input.direction,
        localPath: input.localPath,
        remotePath: input.remotePath,
        operationKind: input.operationKind,
        label: input.label,
        hostLabel: input.hostLabel,
        occurredAt: new Date().toISOString()
      }

      const titleByCategory: Record<CompanionErrorCategory, string> = {
        transfer:
          input.direction === 'download'
            ? 'Download issue detected'
            : input.direction === 'upload'
              ? 'Upload issue detected'
              : 'Transfer issue detected',
        'ssh-connect': 'SSH connection issue detected',
        'host-key': 'Host key mismatch detected',
        proxy: 'Proxy connection issue detected',
        bastion: 'Jump host / bastion issue detected',
        operation: input.label ? `Operation failed: ${input.label}` : 'Remote operation failed'
      }

      this.recordAnnouncement({
        kind: 'transfer-error',
        title: titleByCategory[input.category],
        body: trimmed
      })

      if (this.quietMode || !this.contextualTips || this.open) return

      const now = Date.now()
      if (now - this.lastTransferTipAt < TRANSFER_TIP_COOLDOWN_MS) return

      const noticeTitle =
        input.category === 'transfer'
          ? 'Transfer ran into an issue'
          : input.category === 'operation'
            ? 'Remote operation failed'
            : 'Connection ran into an issue'

      if (this.transferTipTimer) clearTimeout(this.transferTipTimer)
      this.transferTipTimer = setTimeout(() => {
        this.transferTipTimer = null
        if (this.quietMode || !this.contextualTips || this.open) return
        if (this.notice === null) {
          this.lastTransferTipAt = Date.now()
          this.notice = {
            id: nextId('notice'),
            kind: 'transfer-error',
            title: noticeTitle,
            body: 'Want help investigating? Your error details stay local.',
            ctaLabel: 'Investigate',
            errorSummary: trimmed
          }
        }
      }, TRANSFER_TIP_DEBOUNCE_MS)
    },

    notifyTransferFailure(
      input:
        | string
        | {
            sessionId?: string
            direction?: 'upload' | 'download'
            localPath?: string
            remotePath?: string
            error: string
          },
      meta?: {
        sessionId?: string
        direction?: 'upload' | 'download'
        localPath?: string
        remotePath?: string
      }
    ): void {
      const errorMessage = typeof input === 'string' ? input : input.error
      const resolvedMeta = typeof input === 'string' ? meta : input
      this.notifyWorkspaceError({
        scopeKey: resolvedMeta?.sessionId,
        category: 'transfer',
        error: errorMessage,
        direction: resolvedMeta?.direction,
        localPath: resolvedMeta?.localPath,
        remotePath: resolvedMeta?.remotePath
      })
    },

    startReveal(messageId: string, text: string): void {
      this.finishReveal()
      const plan = planReveal(text, prefersReducedMotion())
      if (!plan) return
      this.reveal = { messageId, chunks: plan.chunks, shown: 1 }
      this.revealTimer = setInterval(() => {
        if (!this.reveal) return
        this.reveal.shown += 1
        if (this.reveal.shown >= this.reveal.chunks.length) this.finishReveal()
      }, plan.tickMs)
    },

    finishReveal(): void {
      if (this.revealTimer) {
        clearInterval(this.revealTimer)
        this.revealTimer = null
      }
      this.reveal = null
    },

    collectWorkspaceSignal(overrides?: Partial<CompanionWorkspaceSignal>): CompanionWorkspaceSignal | undefined {
      const signal: CompanionWorkspaceSignal = {}
      const sessions = useSessionsStore()
      const sessionId = sessions.activeSessionId
      const isConnected = sessions.status === 'connected' && Boolean(sessionId)

      if (isConnected && sessionId) {
        const tab = sessions.activeTab
        const site = tab?.siteId ? useSitesStore().sites.find((s) => s.id === tab.siteId) : undefined
        const rawSiteName = site?.name || tab?.label || ''
        if (rawSiteName) {
          signal.siteName = redactSensitiveText(rawSiteName, { mode: 'diagnostic' }).text.slice(0, 80)
        }
        if (
          site?.environment === 'prod' ||
          site?.environment === 'staging' ||
          site?.environment === 'dev' ||
          site?.environment === 'other'
        ) {
          signal.siteEnvironment = site.environment as CompanionSiteEnvironment
        }
        if (tab?.remoteHostInfo) {
          signal.remoteOs = formatRemoteOsLabel(tab.remoteHostInfo).slice(0, 120)
          if (tab.remoteHostInfo.shell) {
            signal.remoteShell = tab.remoteHostInfo.shell.slice(0, 80)
          }
        }

        const remoteFs = useRemoteFsStore()
        if (remoteFs.currentPath) {
          signal.remoteCwd = redactSensitiveText(remoteFs.currentPath, { mode: 'diagnostic' }).text.slice(0, 260)
          const selectedNames = Array.from(remoteFs.selected ?? []).slice(0, 5)
          const summaryParts = [`${remoteFs.entries.length} items in ${signal.remoteCwd}`]
          if (selectedNames.length > 0) {
            summaryParts.push(`selected: ${selectedNames.join(', ')}`)
          }
          signal.sftpSummary = redactSensitiveText(summaryParts.join('; '), { mode: 'diagnostic' }).text.slice(0, 400)
        }

        const terminalStreams = useTerminalStreamsStore()
        if (typeof terminalStreams.getRecentOutput === 'function') {
          const rawTail = terminalStreams.getRecentOutput(sessionId, 30)
          if (rawTail) {
            signal.terminalTail = redactSensitiveText(rawTail, { mode: 'diagnostic' }).text.slice(-2000)
          }
        }

        if (!overrides?.monitorSummary) {
          const sample = useMonitorStore().latest
          if (sample) {
            const cpuPct = sample.cpu ? sample.cpu.aggregatePct : null
            const memPct = sample.memory.totalBytes > 0 ? Math.round((sample.memory.usedBytes / sample.memory.totalBytes) * 100) : 0
            const swapPct = sample.swap.totalBytes > 0 ? Math.round((sample.swap.usedBytes / sample.swap.totalBytes) * 100) : 0
            const diskPct = sample.disk && sample.disk.totalBytes > 0 ? Math.round((sample.disk.usedBytes / sample.disk.totalBytes) * 100) : null
            const topProcs = sample.processes
              .slice(0, 3)
              .map((p) => {
                const cmd = p.cmdline && p.cmdline !== p.name ? ` cmd="${p.cmdline.slice(0, 80)}"` : ''
                return `${p.name}(pid=${p.pid},cpu=${p.cpuPct?.toFixed(1) ?? '?'}%,rss=${Math.round(p.rssBytes / (1024 * 1024))}MB${cmd})`
              })
              .join('; ')
            const rawMonitor = [
              `CPU: ${cpuPct !== null ? `${cpuPct.toFixed(1)}%` : 'N/A'}, RAM: ${memPct}%, Swap: ${swapPct}%, Disk: ${diskPct !== null ? `${diskPct}%` : 'N/A'}`,
              topProcs ? `Top: ${topProcs}` : ''
            ]
              .filter(Boolean)
              .join(' | ')
            signal.monitorSummary = redactSensitiveText(rawMonitor, { mode: 'diagnostic' }).text.slice(0, 800)
          }
        }

        if (!overrides?.logSnippet) {
          try {
            const tailStreams = useTailStreamsStore()
            const tailTab =
              tailStreams.tabs.find((t) => t.tailId === tailStreams.activeTailId && t.sessionId === sessionId) ??
              tailStreams.tabs.find((t) => t.sessionId === sessionId)
            if (tailTab) {
              const basename = tailTab.remotePath.split('/').pop() || tailTab.remotePath
              signal.logBasename = basename.slice(0, 120)
              signal.logPath = redactSensitiveText(tailTab.remotePath, { mode: 'diagnostic' }).text.slice(0, 260)
              const lines = tailStreams.linesMap[tailTab.tailId] ?? []
              if (lines.length > 0) {
                const errorLines = lines.filter((l) => /\b(error|err|fatal|panic|exception|fail(?:ed)?|oom|warn)\b/i.test(l))
                const chosen = (errorLines.length > 0 ? errorLines.slice(-10) : lines.slice(-8)).join('\n')
                if (chosen.trim()) {
                  signal.logSnippet = redactSensitiveText(chosen, { mode: 'diagnostic' }).text.slice(0, 1500)
                }
              }
            }
          } catch {
            // Non-fatal in isolated tests where window.api.on is unavailable.
          }
        }

      }

      const errRec = this.lastTransferErrorRecord
      if (errRec) {
        const prefix = errRec.direction
          ? `[${errRec.direction}] `
          : errRec.category && errRec.category !== 'transfer'
            ? `[${errRec.category}${errRec.operationKind ? `:${errRec.operationKind}` : ''}] `
            : ''
        const pathPart = errRec.remotePath
          ? ` (remote: ${errRec.remotePath})`
          : errRec.label
            ? ` (${errRec.label})`
            : ''
        signal.lastTransferError = redactSensitiveText(`${prefix}${errRec.error}${pathPart}`, {
          mode: 'diagnostic'
        }).text.slice(0, 450)
      }

      if (overrides) {
        for (const [k, v] of Object.entries(overrides)) {
          if (v !== undefined && v !== '') {
            ;(signal as Record<string, unknown>)[k] = v
          }
        }
      }

      return Object.keys(signal).length > 0 ? signal : undefined
    },

    ensureAiStreamSubscription(): void {
      if (this.unsubscribeAiStream) return
      if (typeof window === 'undefined' || typeof window.api?.on !== 'function') return
      this.unsubscribeAiStream = onEvent<CompanionAiStreamEvent>(EVENT_CHANNELS.companionAiStream, (evt) => {
        if (!evt || !evt.requestId || evt.requestId !== this.chatStreamRequestId) return
        if (!evt.summaryText) return
        if (this.streamingMessageId) {
          const existing = this.messages.find((m) => m.id === this.streamingMessageId)
          if (existing) {
            existing.text = evt.summaryText
            return
          }
        }
        const id = this.pushMessage({
          role: 'assistant',
          text: evt.summaryText,
          source: 'ai'
        })
        this.streamingMessageId = id
      })
    },

    async cancelAiRequest(): Promise<void> {
      const reqId = this.activeAiRequestId
      this.aiGeneration += 1
      this.aiBusy = false
      this.activeAiRequestId = null
      this.chatStreamRequestId = null
      this.streamingMessageId = null
      try {
        await companionAiCancel(reqId ?? undefined)
      } catch {
        // Non-fatal in isolated tests or disconnected contexts.
      }
    },

    async requestAiChat(
      prompt: string,
      intent: CompanionAiIntent = 'chat',
      workspaceSignal?: CompanionWorkspaceSignal,
      options?: { streamToChat?: boolean }
    ): Promise<{ result: CompanionAiChatResult | null; errorHint: string | null; cancelled?: boolean }> {
      if (this.aiConfig.provider === 'none') {
        return { result: null, errorHint: null }
      }
      const streamToChat = options?.streamToChat !== false
      if (streamToChat) {
        this.ensureAiStreamSubscription()
      }
      const gen = ++this.aiGeneration
      const requestId = nextId('req')
      this.activeAiRequestId = requestId
      this.chatStreamRequestId = streamToChat ? requestId : null
      if (streamToChat) {
        this.streamingMessageId = null
      }
      this.aiBusy = true
      try {
        const sessions = useSessionsStore()
        const ui = useUiStore()
        const redactedPrompt = redactSensitiveText(prompt, { mode: 'diagnostic' }).text
        const history = this.messages.slice(-9, -1).map((m) => {
          const parts = [m.text]
          if (m.commandCards && m.commandCards.length > 0) {
            const cmdSummary = m.commandCards.map((c) => `${c.command} (${c.risk})`).join('; ')
            parts.push(`[Suggested commands: ${cmdSummary}]`)
          }
          if (m.uiActionCards && m.uiActionCards.length > 0) {
            const actSummary = m.uiActionCards
              .map((a) => (a.kind === 'apply-filter' ? `apply-filter(${a.mode}:${a.pattern})` : `${a.kind}(${a.remotePath})`))
              .join('; ')
            parts.push(`[Suggested actions: ${actSummary}]`)
          }
          return {
            role: m.role,
            text: redactSensitiveText(parts.join('\n'), { mode: 'diagnostic' }).text
          }
        })
        const req: CompanionAiChatRequest = {
          requestId,
          prompt: redactedPrompt,
          history,
          intent,
          workspaceSignal,
          context: {
            appVersion: this.currentVersion || 'unknown',
            isConnected: sessions.status === 'connected',
            theme: ui.theme
          }
        }
        const aiRes = await invoke<CompanionAiChatResult>(INVOKE_CHANNELS.companionAiChat, req)
        if (this.aiGeneration !== gen) {
          return { result: null, errorHint: null, cancelled: true }
        }
        if (aiRes?.ok && (aiRes.structured?.summary || aiRes.text)) {
          return { result: aiRes, errorHint: null }
        }
        return { result: null, errorHint: aiRes?.error || 'connection error' }
      } catch (err) {
        if (this.aiGeneration !== gen) {
          return { result: null, errorHint: null, cancelled: true }
        }
        return { result: null, errorHint: err instanceof Error ? err.message : 'connection error' }
      } finally {
        if (this.aiGeneration === gen) {
          this.aiBusy = false
          this.activeAiRequestId = null
          this.chatStreamRequestId = null
        }
      }
    },

    pushMessage(msg: Omit<CompanionMessage, 'id' | 'createdAt'>): string {
      this.finishReveal()
      const id = nextId('msg')
      this.messages.push({
        ...msg,
        id,
        createdAt: new Date().toISOString()
      })
      if (this.messages.length > MAX_CHAT_MESSAGES) {
        this.messages = this.messages.slice(-MAX_CHAT_MESSAGES)
      }
      return id
    },

    async deliverAiOrLocalReply(opts: {
      aiPrompt?: string
      intent?: CompanionAiIntent
      workspaceSignal?: CompanionWorkspaceSignal
      errorPrefix: string
      buildLocal: () => Omit<CompanionMessage, 'id' | 'createdAt' | 'role' | 'source'>
    }): Promise<void> {
      this.aiErrorLabel = null
      let aiErrorHint: string | null = null
      if (opts.aiPrompt && this.aiConfig.provider !== 'none') {
        const { result: aiRes, errorHint, cancelled } = await this.requestAiChat(
          opts.aiPrompt,
          opts.intent ?? 'chat',
          opts.workspaceSignal
        )
        if (cancelled) {
          return
        }
        if (aiRes) {
          const text = aiRes.structured?.summary ?? aiRes.text ?? ''
          const streamedId = this.streamingMessageId
          this.streamingMessageId = null
          const streamedMsg = streamedId ? this.messages.find((m) => m.id === streamedId) : undefined
          if (streamedMsg) {
            streamedMsg.text = text
            streamedMsg.rootCause = aiRes.structured?.rootCause
            streamedMsg.commandCards = aiRes.structured?.commandCards
            streamedMsg.uiActionCards = aiRes.structured?.uiActionCards
            return
          }
          const id = this.pushMessage({
            role: 'assistant',
            text,
            source: 'ai',
            rootCause: aiRes.structured?.rootCause,
            commandCards: aiRes.structured?.commandCards,
            uiActionCards: aiRes.structured?.uiActionCards
          })
          this.startReveal(id, text)
          return
        }
        this.streamingMessageId = null
        aiErrorHint = errorHint
        if (aiErrorHint) {
          this.aiErrorLabel = `Couldn't reach ${PROVIDER_LABEL[this.aiConfig.provider]}`
        }
      }

      const local = opts.buildLocal()
      const finalActions = local.actions ? [...local.actions] : []
      if (aiErrorHint && !finalActions.some((a) => a.id === 'open-settings')) {
        finalActions.push({ id: 'open-settings', label: 'Check AI Settings' })
      }

      const text = aiErrorHint
        ? `Couldn't reach your configured AI provider (${aiErrorHint}). ${opts.errorPrefix}\n\n${local.text}`
        : local.text
      const id = this.pushMessage({
        role: 'assistant',
        ...local,
        text,
        source: 'local',
        actions: finalActions.length > 0 ? finalActions : undefined
      })
      this.startReveal(id, text)
    },

    async ask(input: string): Promise<void> {
      const text = input.trim()
      if (!text || this.aiBusy) return
      this.activeView = 'chat'
      this.pushMessage({ role: 'user', text })

      if (/\b(what'?s new|whats new|changed since|changelog|release notes|new version|updated)\b/i.test(text)) {
        await this.ensureReleasesLoaded()
      }

      const sessions = useSessionsStore()
      const aiEnabled = this.aiConfig.provider !== 'none'
      const errRec = this.lastTransferErrorRecord
      const reply = answerCompanionQuery(text, {
        currentVersion: this.currentVersion || 'unknown',
        previousVersion: this.previousVersion,
        releases: this.releases.length > 0 ? this.releases : getBundledChangelogReleases(),
        offlineFallback: this.releasesOfflineFallback || this.releases.length === 0,
        isConnected: sessions.status === 'connected',
        lastTransferError: errRec?.error ?? null,
        lastTransferDirection: errRec?.direction ?? null,
        aiEnabled
      })

      const workspaceSignal = reply.isFallback && aiEnabled ? this.collectWorkspaceSignal() : undefined

      await this.deliverAiOrLocalReply({
        aiPrompt: reply.isFallback ? text : undefined,
        intent: reply.commandCards ? 'command' : 'chat',
        workspaceSignal,
        errorPrefix: 'Falling back to local mode:',
        buildLocal: () => ({
          text: reply.text,
          rootCause: reply.rootCause,
          commandCards: reply.commandCards,
          uiActionCards: reply.uiActionCards,
          actions: reply.actions,
          releaseCard: reply.releaseCard
        })
      })

      if (reply.openReportCategory) {
        this.reportCategory = reply.openReportCategory
      }
    },

    async explainLogLine(input: {
      remotePath: string
      lineText: string
      lineNumber?: number
      contextLines?: string[]
    }): Promise<void> {
      if (this.aiBusy) {
        this.open = true
        this.activeView = 'chat'
        this.pushSystemNote('Still finishing the previous AI request — please try Explain Log again in a moment.')
        return
      }
      const rawSnippet =
        input.contextLines && input.contextLines.length > 0
          ? input.contextLines.join('\n')
          : input.lineText
      if (!rawSnippet.trim()) return

      const logBasename = input.remotePath.split('/').pop() || input.remotePath
      const diagnosticPath = redactSensitiveText(input.remotePath, { mode: 'diagnostic' }).text
      const redactedForAi = redactSensitiveText(rawSnippet, { mode: 'diagnostic' })
      const aiLogSnippet = redactedForAi.text.slice(0, 2500)
      const bubbleLine = redactSensitiveText(input.lineText, { mode: 'diagnostic' }).text.slice(0, 400)

      this.openPanel('chat')
      const lineLabel = input.lineNumber ? `line #${input.lineNumber} in ` : ''
      const redactionNote =
        redactedForAi.redactionCount > 0
          ? ` (${redactedForAi.redactionCount} sensitive item${redactedForAi.redactionCount === 1 ? '' : 's'} redacted locally)`
          : ''
      this.pushMessage({
        role: 'user',
        text: `Explain log ${lineLabel}${diagnosticPath || 'active stream'}${redactionNote}:\n${bubbleLine}`
      })

      const workspaceSignal = this.collectWorkspaceSignal({
        logPath: diagnosticPath,
        logBasename,
        logSnippet: aiLogSnippet
      })

      await this.deliverAiOrLocalReply({
        aiPrompt: `Explain this log entry from ${diagnosticPath || logBasename} and suggest safe diagnostic steps.`,
        intent: 'explain-log',
        workspaceSignal,
        errorPrefix: 'Local log analysis:',
        buildLocal: () => {
          // Run offline detectors on the unredacted raw snippet so namespaces like java.lang.OutOfMemoryError match.
          const offline = diagnoseLogSnippetOffline(input.remotePath, rawSnippet, input.remotePath)
          return {
            text: offline.summary,
            rootCause: offline.rootCause,
            commandCards: offline.commandCards,
            uiActionCards: offline.uiActionCards
          }
        }
      })
    },

    async diagnoseMonitorSpike(sample: MonitorSample): Promise<void> {
      if (this.aiBusy) {
        this.open = true
        this.activeView = 'chat'
        this.pushSystemNote('Still finishing the previous AI request — please try Diagnose Spike again in a moment.')
        return
      }
      const cpuPct = sample.cpu ? sample.cpu.aggregatePct : null
      const coreCount = sample.cpu?.coreCount ?? 1
      const memPct = sample.memory.totalBytes > 0 ? Math.round((sample.memory.usedBytes / sample.memory.totalBytes) * 100) : 0
      const swapPct = sample.swap.totalBytes > 0 ? Math.round((sample.swap.usedBytes / sample.swap.totalBytes) * 100) : 0
      const diskPct = sample.disk && sample.disk.totalBytes > 0 ? Math.round((sample.disk.usedBytes / sample.disk.totalBytes) * 100) : null
      const topProcesses = sample.processes.slice(0, 5).map((p) => ({
        pid: p.pid,
        name: p.name,
        cpuPct: p.cpuPct,
        rssMB: Math.round(p.rssBytes / (1024 * 1024))
      }))

      const rawSummary = [
        `CPU: ${cpuPct !== null ? `${cpuPct.toFixed(1)}%` : 'N/A'} (${coreCount} cores), LoadAvg: ${sample.loadAvg.map((n) => n.toFixed(2)).join('/')}`,
        `Memory: ${memPct}%, Swap: ${swapPct}%, Root Disk: ${diskPct !== null ? `${diskPct}%` : 'N/A'}`,
        topProcesses.length > 0
          ? `Top processes: ${topProcesses.map((p) => `${p.name}(pid=${p.pid},cpu=${p.cpuPct?.toFixed(1) ?? '?'}%,rss=${p.rssMB}MB)`).join('; ')}`
          : 'Top processes: none'
      ].join('\n')
      const monitorSummary = redactSensitiveText(rawSummary, { mode: 'diagnostic' }).text

      this.openPanel('chat')
      this.pushMessage({
        role: 'user',
        text: `Diagnose Resource Monitor metrics (CPU ${cpuPct !== null ? `${cpuPct.toFixed(1)}%` : 'N/A'}, RAM ${memPct}%${diskPct !== null ? `, Disk ${diskPct}%` : ''})`
      })

      const workspaceSignal = this.collectWorkspaceSignal({ monitorSummary })

      await this.deliverAiOrLocalReply({
        aiPrompt: 'Triage these remote server resource metrics and propose read-only verification commands.',
        intent: 'diagnose-spike',
        workspaceSignal,
        errorPrefix: 'Local resource triage:',
        buildLocal: () => {
          const offline = diagnoseMonitorSpikeOffline({
            cpuPct,
            memPct,
            swapPct,
            diskPct,
            loadAvg: sample.loadAvg,
            coreCount,
            topProcesses
          })
          return {
            text: offline.summary,
            rootCause: offline.rootCause,
            commandCards: offline.commandCards
          }
        }
      })
    },

    saveCustomSnippet(input: { label: string; command: string; description?: string }): CompanionSnippet | null {
      const label = input.label.trim().slice(0, 80)
      const command = sanitizeCompanionCommand(input.command)
      if (!label || !command) return null
      const entry: CompanionSnippet = {
        id: nextId('snip'),
        label,
        command,
        description: (input.description ?? '').trim().slice(0, 240),
        risk: classifyCommandRisk(command)
      }
      this.customSnippets = [entry, ...this.customSnippets.filter((s) => s.command !== command)].slice(0, MAX_CUSTOM_SNIPPETS)
      writeStored(SNIPPETS_KEY, JSON.stringify(this.customSnippets), this.dirtyPrefKeys)
      return entry
    },

    updateCustomSnippet(
      id: string,
      input: { label: string; command: string; description?: string }
    ): CompanionSnippet | null {
      const label = input.label.trim().slice(0, 80)
      const command = sanitizeCompanionCommand(input.command)
      if (!label || !command) return null
      const idx = this.customSnippets.findIndex((s) => s.id === id)
      if (idx === -1) return null
      const updated: CompanionSnippet = {
        id,
        label,
        command,
        description: (input.description ?? '').trim().slice(0, 240),
        risk: classifyCommandRisk(command)
      }
      const next = [...this.customSnippets]
      next[idx] = updated
      this.customSnippets = next
      writeStored(SNIPPETS_KEY, JSON.stringify(this.customSnippets), this.dirtyPrefKeys)
      return updated
    },

    mergeImportedSnippets(
      incoming: ReadonlyArray<{ label: string; command: string; description?: string }>
    ): number {
      let added = 0
      const existingCommands = new Set(this.customSnippets.map((s) => s.command))
      const created: CompanionSnippet[] = []
      for (const item of incoming) {
        const label = item.label.trim().slice(0, 80)
        const command = sanitizeCompanionCommand(item.command)
        if (!label || !command || existingCommands.has(command)) continue
        existingCommands.add(command)
        created.push({
          id: nextId('snip'),
          label,
          command,
          description: (item.description ?? '').trim().slice(0, 240),
          risk: classifyCommandRisk(command)
        })
        added += 1
      }
      if (created.length > 0) {
        this.customSnippets = [...created, ...this.customSnippets].slice(0, MAX_CUSTOM_SNIPPETS)
        writeStored(SNIPPETS_KEY, JSON.stringify(this.customSnippets), this.dirtyPrefKeys)
      }
      return added
    },

    /** Generates a single risk-badged Command Card for the in-terminal Quick Command Bar or Snippet AI Drafter without mutating Chat. */
    async requestQuickCommand(
      query: string
    ): Promise<{ card: CompanionCommandCard | null; message: string | null }> {
      const trimmed = query.trim()
      if (!trimmed) return { card: null, message: 'Enter a request first.' }

      if (this.aiConfig.provider !== 'none') {
        const signal = this.collectWorkspaceSignal()
        const { result, errorHint } = await this.requestAiChat(
          `Generate one concise, safe shell command for: ${trimmed}`,
          'command',
          signal,
          { streamToChat: false }
        )
        const firstCard = result?.structured?.commandCards?.[0]
        if (firstCard) {
          return { card: firstCard, message: result?.structured?.summary ?? null }
        }
        if (errorHint) {
          const offline = translatePlainEnglishCommandOffline(trimmed)
          if (offline?.commandCards[0]) {
            return { card: offline.commandCards[0], message: `AI unreachable (${errorHint}); showing offline suggestion.` }
          }
          return { card: null, message: `AI error: ${errorHint}` }
        }
      }

      const offline = translatePlainEnglishCommandOffline(trimmed)
      if (offline?.commandCards[0]) {
        return { card: offline.commandCards[0], message: offline.summary }
      }
      return {
        card: null,
        message: 'No offline match found. Configure a free Gemini API key in Settings for natural-language command generation.'
      }
    },

    /** Correlates a Resource Monitor spike with recent error/tail lines from the active session's Live Log Tail. */
    async correlateSpikeAndLogs(sample: MonitorSample): Promise<void> {
      if (this.aiBusy) {
        this.open = true
        this.activeView = 'chat'
        this.pushSystemNote('Still finishing the previous AI request — please try Correlate Spike + Logs again in a moment.')
        return
      }
      const sessions = useSessionsStore()
      const sessionId = sessions.activeSessionId
      const tailStreams = useTailStreamsStore()
      const tailTab = sessionId
        ? tailStreams.tabs.find((t) => t.tailId === tailStreams.activeTailId && t.sessionId === sessionId) ??
          tailStreams.tabs.find((t) => t.sessionId === sessionId)
        : undefined
      const tailLines = tailTab ? (tailStreams.linesMap[tailTab.tailId] ?? []).slice(-15) : []
      const logSnippet = tailLines.length > 0
        ? redactSensitiveText(tailLines.join('\n'), { mode: 'diagnostic' }).text.slice(0, 2000)
        : undefined
      const logBasename = tailTab ? tailTab.remotePath.split('/').pop() || tailTab.remotePath : undefined

      const cpuPct = sample.cpu ? sample.cpu.aggregatePct : null
      const memPct = sample.memory.totalBytes > 0 ? Math.round((sample.memory.usedBytes / sample.memory.totalBytes) * 100) : 0
      const topProcs = sample.processes
        .slice(0, 5)
        .map((p) => `${p.name}(pid=${p.pid},cpu=${p.cpuPct?.toFixed(1) ?? '?'}%,rss=${Math.round(p.rssBytes / (1024 * 1024))}MB${p.cmdline && p.cmdline !== p.name ? ` cmd="${p.cmdline.slice(0, 80)}"` : ''})`)
        .join('; ')
      const monitorSummary = redactSensitiveText(
        `CPU: ${cpuPct !== null ? `${cpuPct.toFixed(1)}%` : 'N/A'}, RAM: ${memPct}%, LoadAvg: ${sample.loadAvg.map((n) => n.toFixed(2)).join('/')} | Top: ${topProcs}`,
        { mode: 'diagnostic' }
      ).text

      this.openPanel('chat')
      this.pushMessage({
        role: 'user',
        text: `Correlate Monitor spike (CPU ${cpuPct !== null ? `${cpuPct.toFixed(1)}%` : 'N/A'}, RAM ${memPct}%) with ${logBasename || 'active log stream'}`
      })

      const workspaceSignal = this.collectWorkspaceSignal({
        monitorSummary,
        ...(logSnippet ? { logSnippet, logBasename } : {})
      })

      await this.deliverAiOrLocalReply({
        aiPrompt: `Correlate the remote Resource Monitor spike with recent entries from ${logBasename || 'the active log tail'} to identify root cause and safe read-only verification commands.`,
        intent: 'diagnose-spike',
        workspaceSignal,
        errorPrefix: 'Local spike triage:',
        buildLocal: () => {
          const offline = diagnoseMonitorSpikeOffline({
            cpuPct,
            memPct,
            swapPct: sample.swap.totalBytes > 0 ? Math.round((sample.swap.usedBytes / sample.swap.totalBytes) * 100) : 0,
            diskPct: sample.disk && sample.disk.totalBytes > 0 ? Math.round((sample.disk.usedBytes / sample.disk.totalBytes) * 100) : null,
            loadAvg: sample.loadAvg,
            coreCount: sample.cpu?.coreCount ?? 1,
            topProcesses: sample.processes.slice(0, 5).map((p) => ({
              pid: p.pid,
              name: p.name,
              cpuPct: p.cpuPct,
              rssMB: Math.round(p.rssBytes / (1024 * 1024))
            }))
          })
          return {
            text: offline.summary,
            rootCause: offline.rootCause,
            commandCards: offline.commandCards
          }
        }
      })
    },

    /** Opens Companion Chat and diagnoses a specific failed transfer or remote operation row. */
    async troubleshootWorkspaceError(input: {
      scopeKey?: string
      category: CompanionErrorCategory
      error: string
      direction?: 'upload' | 'download'
      localPath?: string
      remotePath?: string
      operationKind?: OperationKind
      label?: string
    }): Promise<void> {
      this.notifyWorkspaceError(input)
      this.openPanel('chat')
      const subject =
        input.category === 'transfer'
          ? `failed ${input.direction ?? 'transfer'}${input.remotePath ? ` (${input.remotePath.split('/').pop()})` : ''}`
          : input.label
            ? `failed operation "${input.label}"`
            : `failed ${input.category}`
      await this.ask(`Troubleshoot this ${subject}: ${input.error}`)
    },

    deleteCustomSnippet(id: string): void {
      const next = this.customSnippets.filter((s) => s.id !== id)
      if (next.length === this.customSnippets.length) return
      this.customSnippets = next
      writeStored(SNIPPETS_KEY, JSON.stringify(this.customSnippets), this.dirtyPrefKeys)
    },

    recordCommandHistory(command: string, risk?: CompanionCommandRisk, hostLabel?: string | null): void {
      const sanitized = sanitizeCompanionCommand(command)
      if (!sanitized) return
      const nextHost = hostLabel ? hostLabel.trim().slice(0, 80) : null
      const latest = this.commandHistory[0]
      if (latest && latest.command === sanitized && (latest.hostLabel ?? null) === nextHost) {
        return
      }
      const entry: CompanionCommandHistoryEntry = {
        id: nextId('cmd'),
        command: sanitized,
        risk: risk ?? classifyCommandRisk(sanitized),
        executedAt: new Date().toISOString(),
        hostLabel: nextHost
      }
      this.commandHistory = [entry, ...this.commandHistory].slice(0, MAX_CMD_HISTORY)
      writeStored(CMD_HISTORY_KEY, JSON.stringify(this.commandHistory), this.dirtyPrefKeys)
    },

    clearCommandHistory(): void {
      this.commandHistory = []
      writeStored(CMD_HISTORY_KEY, JSON.stringify([]), this.dirtyPrefKeys)
    },

    async runCommandCard(card: CompanionCommandCard, options?: { skipConfirm?: boolean }): Promise<string> {
      const sessions = useSessionsStore()
      const sessionId = sessions.activeSessionId
      if (sessions.status !== 'connected' || !sessionId) {
        return 'Connect to an SSH session first to run commands in Terminal.'
      }
      const command = sanitizeCompanionCommand(card.command)
      if (!command) {
        return 'Command is empty.'
      }
      const risk = escalateCommandRisk(card.risk, command)
      const targetHost = sessions.activeTab?.label || sessions.activeTab?.hostLabel || 'active server'
      if (!options?.skipConfirm) {
        const riskNote =
          risk === 'destructive'
            ? 'DESTRUCTIVE command — can delete data or interrupt services.'
            : risk === 'mutating'
              ? 'MUTATING command — modifies files or service state.'
              : 'READ-ONLY command — inspects remote state without modifying files.'

        const prodPrefix = this.isProd && risk === 'destructive' ? 'PRODUCTION ENVIRONMENT WARNING — ' : ''
        const confirm = useConfirm()
        const confirmed = await confirm({
          title: `Run command on ${targetHost}?`,
          body: `${prodPrefix}Risk: ${risk.toUpperCase()} — ${riskNote}`,
          items: [command],
          confirmLabel: 'Run in Terminal',
          confirmColor: risk === 'destructive' ? 'error' : risk === 'mutating' ? 'warning' : 'primary',
          destructive: risk === 'destructive'
        })
        if (!confirmed) {
          return 'Command execution cancelled.'
        }
      }

      useDockState().openDock('terminal')
      const terminalStreams = useTerminalStreamsStore()
      let wrote = false
      if (typeof terminalStreams.write === 'function') {
        wrote = await terminalStreams.write(sessionId, `${command}\r`)
      } else {
        const terminalId = await terminalStreams.ensureTerminal(sessionId)
        if (terminalId && typeof window !== 'undefined' && typeof window.api?.send === 'function') {
          window.api.send(SEND_CHANNELS.terminalInput, {
            terminalId,
            data: `${command}\r`
          })
          terminalStreams.focus?.(sessionId)
          wrote = true
        }
      }
      if (!wrote) {
        return 'Could not send command to Terminal — shell is not active.'
      }
      this.recordCommandHistory(command, risk, targetHost)
      return `Sent command to Terminal (${targetHost}).`
    },

    async insertCommandInTerminal(rawCommand: string): Promise<string> {
      const sessions = useSessionsStore()
      const sessionId = sessions.activeSessionId
      if (sessions.status !== 'connected' || !sessionId) {
        return 'Connect to an SSH session first to insert commands into Terminal.'
      }
      const command = sanitizeCompanionCommand(rawCommand)
      if (!command) {
        return 'Command is empty.'
      }
      useDockState().openDock('terminal')
      const terminalStreams = useTerminalStreamsStore()
      let inserted = false
      if (typeof terminalStreams.insertText === 'function') {
        inserted = await terminalStreams.insertText(sessionId, command)
      } else {
        const terminalId = await terminalStreams.ensureTerminal(sessionId)
        if (terminalId && typeof window !== 'undefined' && typeof window.api?.send === 'function') {
          window.api.send(SEND_CHANNELS.terminalInput, { terminalId, data: command })
          terminalStreams.focus?.(sessionId)
          inserted = true
        }
      }
      if (!inserted) {
        return 'Could not insert command into Terminal — shell is not active.'
      }
      const targetHost = sessions.activeTab?.label || sessions.activeTab?.hostLabel || 'active server'
      return `Inserted command into Terminal (${targetHost}) — press Enter to run.`
    },

    async executeUiActionCard(card: CompanionUiActionCard): Promise<string> {
      const sessions = useSessionsStore()
      const sessionId = sessions.activeSessionId
      const isConnected = sessions.status === 'connected' && Boolean(sessionId)

      switch (card.kind) {
        case 'open-editor': {
          if (!isConnected) {
            return 'Connect to a server first to open a remote file in the editor.'
          }
          window.dispatchEvent(new CustomEvent(OPEN_REMOTE_EDITOR_EVENT, { detail: { remotePath: card.remotePath } }))
          return `Opening ${card.remotePath} in editor.`
        }
        case 'tail-log': {
          if (!isConnected || !sessionId) {
            return 'Connect to a server first to tail a remote log file.'
          }
          useDockState().openDock('tail')
          await useTailStreamsStore().open(sessionId, card.remotePath)
          return `Tailing ${card.remotePath}.`
        }
        case 'apply-filter': {
          const key = isConnected ? resolveConnectionFilterKey(sessions.activeTab) : 'local'
          useFileFiltersStore().addPattern(key ?? 'local', card.mode, card.pattern)
          if (isConnected) {
            window.dispatchEvent(new CustomEvent(OPEN_FILE_FILTERS_EVENT, { detail: { pane: 'remote' } }))
          }
          return `Applied ${card.mode} filter "${card.pattern}".`
        }
      }
    },

    async executeAction(action: CompanionActionChip): Promise<string> {
      const sessions = useSessionsStore()
      const isConnected = sessions.status === 'connected'

      switch (action.id) {
        case 'open-whats-new':
          this.activeView = 'whats-new'
          await this.ensureReleasesLoaded()
          return "Opened What's New."
        case 'open-report-bug':
          this.reportCategory = 'bug'
          this.activeView = 'report'
          return 'Opened Bug Report draft.'
        case 'open-report-feature':
          this.reportCategory = 'feature'
          this.activeView = 'report'
          return 'Opened Feature Suggestion draft.'
        case 'open-report-feedback':
          this.reportCategory = 'feedback'
          this.activeView = 'report'
          return 'Opened Feedback draft.'
        case 'open-settings':
          useSettingsDialog().open()
          return 'Opened Settings.'
        case 'open-history':
          useHistoryDialog().open()
          return 'Opened Transfer History.'
        case 'open-shortcuts':
          useShortcutsDialog().open()
          return 'Opened Keyboard Shortcuts.'
        case 'open-command-palette':
          useCommandPalette().open()
          return 'Opened Command Palette.'
        case 'open-file-filters': {
          if (!isConnected) {
            return 'Connect to a site first — File Visibility Filters live in the file pane toolbar.'
          }
          window.dispatchEvent(new CustomEvent(OPEN_FILE_FILTERS_EVENT))
          return 'Opened File Visibility Filters.'
        }
        case 'open-dock-transfers':
        case 'open-dock-terminal':
        case 'open-dock-tail':
        case 'open-dock-monitor':
        case 'open-dock-activity': {
          if (!isConnected) {
            return 'Connect to an SSH/SFTP site first to open dock panels.'
          }
          const tabMap = {
            'open-dock-transfers': 'transfers',
            'open-dock-terminal': 'terminal',
            'open-dock-tail': 'tail',
            'open-dock-monitor': 'monitor',
            'open-dock-activity': 'activity'
          } as const
          useDockState().openDock(tabMap[action.id])
          return `Opened ${action.label}.`
        }
        case 'open-external-releases': {
          const targetUrl = action.url || OFFICIAL_RELEASES_URL
          try {
            await openExternal(targetUrl)
            return 'Opened official release notes in your browser.'
          } catch {
            const msg = 'Could not open your browser automatically. Visit github.com/ThienNg65/ferry-release/releases.'
            this.pushSystemNote(msg)
            return msg
          }
        }
        case 'show-help-topics':
          await this.ask('Help me use Ferry')
          return 'Displayed help topics.'
        case 'start-tour':
          this.startTour()
          return 'Started guided tour.'
      }
    },

    pushSystemNote(text: string): void {
      this.pushMessage({
        role: 'assistant',
        text
      })
    },

    clearConversation(): void {
      if (this.aiBusy || this.activeAiRequestId) {
        void this.cancelAiRequest()
      } else {
        this.aiGeneration += 1
      }
      this.finishReveal()
      this.messages = []
      this.aiErrorLabel = null
    },

    disposeTimers(): void {
      if (this.transferTipTimer) {
        clearTimeout(this.transferTipTimer)
        this.transferTipTimer = null
      }
      this.finishReveal()
    },

    reset(): void {
      this.disposeTimers()
      this.dirtyPrefKeys.clear()
      this.open = false
      this.forceOverlay = false
      this.hasOpenedOnce = false
      this.activeView = 'chat'
      this.reportCategory = 'bug'
      this.aiErrorLabel = null
      this.listening = false
      this.quietMode = false
      this.showInDock = true
      this.showReleaseAnnouncements = true
      this.contextualTips = true
      this.lastSeenVersion = null
      this.previousVersion = null
      this.dismissedVersions = []
      this.onboarded = false
      this.lastGreetingDate = null
      this.notice = null
      this.announcements = []
      this.messages = []
      this.transferErrorsBySession = {}
      this.tourStep = null
      this.aiConfig = { provider: 'none', endpoint: '', model: '', hasApiKey: false }
      this.aiConfigLoaded = false
      this.aiBusy = false
      this.aiGeneration += 1
      this.activeAiRequestId = null
      this.chatStreamRequestId = null
      this.streamingMessageId = null
      this.unsubscribeAiStream?.()
      this.unsubscribeAiStream = null
      this.customSnippets = []
      this.commandHistory = []
      this.lastTransferTipAt = 0
    }
  }
})
