import { defineStore } from 'pinia'
import {
  INVOKE_CHANNELS,
  SEND_CHANNELS,
  type CompanionAiChatRequest,
  type CompanionAiChatResult,
  type CompanionAiConfigInfo,
  type CompanionAiConfigInput,
  type CompanionAiIntent,
  type CompanionCommandCard,
  type CompanionCommandRisk,
  type CompanionReleaseHighlight,
  type CompanionReleasesResult,
  type CompanionUiActionCard,
  type CompanionWorkspaceSignal,
  type MonitorSample
} from '@shared/contract'
import { invoke } from '../api'
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
  type CompanionCommandHistoryEntry,
  type CompanionSnippet
} from '../utils/companionSnippets'
import { COMPANION_TOUR_STEPS } from '../utils/companionTour'
import { evaluateVersionTransition } from '../utils/companionVersion'
import { resolveConnectionFilterKey, useFileFiltersStore } from './fileFilters.store'
import { useSessionsStore } from './sessions.store'
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

let releasesInFlight: Promise<CompanionReleaseHighlight[]> | null = null

export type CompanionAvatarState = 'resting' | 'noticing' | 'talking' | 'helping'
export type CompanionView = 'chat' | 'snippets' | 'whats-new' | 'report' | 'history'

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
      .map((s) => ({
        id: s.id,
        label: s.label.trim(),
        command: s.command.trim(),
        description: typeof s.description === 'string' ? s.description.trim() : '',
        risk: classifyCommandRisk(s.command)
      }))
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
  hasOpenedOnce: boolean
  activeView: CompanionView
  reportCategory: IssueCategory
  avatarState: CompanionAvatarState
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
  lastTransferError: string | null
  tourStep: number | null
  aiConfig: CompanionAiConfigInfo
  aiConfigLoaded: boolean
  aiBusy: boolean
  customSnippets: CompanionSnippet[]
  commandHistory: CompanionCommandHistoryEntry[]
  lifecycleInitialized: boolean
  dirtyPrefKeys: Set<string>
  lastTransferTipAt: number
  transferTipTimer: ReturnType<typeof setTimeout> | null
  talkingTimer: ReturnType<typeof setTimeout> | null
}

export const useCompanionStore = defineStore('companion', {
  state: (): CompanionState => ({
    open: false,
    hasOpenedOnce: false,
    activeView: 'chat',
    reportCategory: 'bug',
    avatarState: 'resting',
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
    lastTransferError: null,
    tourStep: null,
    aiConfig: { provider: 'none', endpoint: '', model: '', hasApiKey: false },
    aiConfigLoaded: false,
    aiBusy: false,
    customSnippets: parseSnippetList(readStored(SNIPPETS_KEY)),
    commandHistory: parseCommandHistory(readStored(CMD_HISTORY_KEY)),
    lifecycleInitialized: false,
    dirtyPrefKeys: new Set<string>(),
    lastTransferTipAt: 0,
    transferTipTimer: null,
    talkingTimer: null
  }),

  getters: {
    hasUnreadNotice: (state): boolean => state.notice !== null,
    unreadAnnouncementCount: (state): number => state.announcements.filter((a) => !a.read).length,
    allSnippets: (state): CompanionSnippet[] => [...state.customSnippets, ...BUILT_IN_SNIPPETS],
    effectiveAvatarState(state): CompanionAvatarState {
      if (state.avatarState === 'helping' || state.avatarState === 'talking') {
        return state.avatarState
      }
      if (state.notice && !state.quietMode) {
        return 'noticing'
      }
      return 'resting'
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

    openPanel(view: CompanionView = 'chat'): void {
      this.hasOpenedOnce = true
      this.open = true
      this.activeView = view
      if (!this.aiConfigLoaded) {
        void this.loadAiConfig()
      }
      if (this.notice) {
        if (this.notice.kind === 'intro') {
          this.markOnboarded()
        }
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

    async testAiConnection(): Promise<CompanionAiChatResult> {
      return invoke<CompanionAiChatResult>(INVOKE_CHANNELS.companionAiTest)
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
      if (this.avatarState !== 'helping') {
        this.avatarState = 'resting'
      }
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
      if (releasesInFlight && !forceRefresh) {
        return releasesInFlight
      }
      const run = async (): Promise<CompanionReleaseHighlight[]> => {
        this.releasesLoading = true
        this.avatarState = 'helping'
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
          if (this.avatarState === 'helping') {
            this.avatarState = 'resting'
          }
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

    notifyTransferFailure(errorMessage: string): void {
      const trimmed = errorMessage.trim()
      if (!trimmed) return
      this.lastTransferError = trimmed

      if (this.quietMode || !this.contextualTips || this.open) return

      const now = Date.now()
      if (now - this.lastTransferTipAt < TRANSFER_TIP_COOLDOWN_MS) return

      if (this.transferTipTimer) clearTimeout(this.transferTipTimer)
      this.transferTipTimer = setTimeout(() => {
        this.transferTipTimer = null
        if (this.quietMode || !this.contextualTips || this.open) return
        this.lastTransferTipAt = Date.now()
        if (this.notice === null) {
          this.notice = {
            id: nextId('notice'),
            kind: 'transfer-error',
            title: 'Transfer ran into an issue',
            body: 'Want help investigating? Your error details stay local.',
            ctaLabel: 'Investigate',
            errorSummary: trimmed
          }
        }
        this.recordAnnouncement({
          kind: 'transfer-error',
          title: 'Transfer issue detected',
          body: trimmed
        })
      }, TRANSFER_TIP_DEBOUNCE_MS)
    },

    pulseTalking(): void {
      this.avatarState = 'talking'
      if (this.talkingTimer) clearTimeout(this.talkingTimer)
      this.talkingTimer = setTimeout(() => {
        this.talkingTimer = null
        if (this.avatarState === 'talking') {
          this.avatarState = 'resting'
        }
      }, 900)
    },

    async requestAiChat(
      prompt: string,
      intent: CompanionAiIntent = 'chat',
      workspaceSignal?: CompanionWorkspaceSignal
    ): Promise<{ result: CompanionAiChatResult | null; errorHint: string | null }> {
      if (this.aiConfig.provider === 'none') {
        return { result: null, errorHint: null }
      }
      this.aiBusy = true
      this.avatarState = 'helping'
      try {
        const sessions = useSessionsStore()
        const ui = useUiStore()
        const redactedPrompt = redactSensitiveText(prompt).text
        const history = this.messages.slice(-6, -1).map((m) => ({
          role: m.role,
          text: redactSensitiveText(m.text).text
        }))
        const req: CompanionAiChatRequest = {
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
        if (aiRes?.ok && (aiRes.structured?.summary || aiRes.text)) {
          return { result: aiRes, errorHint: null }
        }
        return { result: null, errorHint: aiRes?.error || 'connection error' }
      } catch (err) {
        return { result: null, errorHint: err instanceof Error ? err.message : 'connection error' }
      } finally {
        this.aiBusy = false
        if (this.avatarState === 'helping') {
          this.avatarState = 'resting'
        }
      }
    },

    async ask(input: string): Promise<void> {
      const text = input.trim()
      if (!text || this.aiBusy) return
      this.activeView = 'chat'
      this.messages.push({
        id: nextId('msg'),
        role: 'user',
        text,
        createdAt: new Date().toISOString()
      })

      if (/\b(what'?s new|whats new|changed since|changelog|release notes|new version|updated)\b/i.test(text)) {
        await this.ensureReleasesLoaded()
      }

      const sessions = useSessionsStore()
      const reply = answerCompanionQuery(text, {
        currentVersion: this.currentVersion || 'unknown',
        previousVersion: this.previousVersion,
        releases: this.releases.length > 0 ? this.releases : getBundledChangelogReleases(),
        offlineFallback: this.releasesOfflineFallback || this.releases.length === 0,
        isConnected: sessions.status === 'connected',
        lastTransferError: this.lastTransferError
      })

      let aiErrorHint: string | null = null
      if (reply.isFallback && this.aiConfig.provider !== 'none') {
        const intent: CompanionAiIntent = reply.commandCards ? 'command' : 'chat'
        const { result: aiRes, errorHint } = await this.requestAiChat(text, intent)
        if (aiRes) {
          this.messages.push({
            id: nextId('msg'),
            role: 'assistant',
            text: aiRes.structured?.summary ?? aiRes.text ?? '',
            createdAt: new Date().toISOString(),
            source: 'ai',
            rootCause: aiRes.structured?.rootCause,
            commandCards: aiRes.structured?.commandCards,
            uiActionCards: aiRes.structured?.uiActionCards
          })
          this.pulseTalking()
          return
        }
        aiErrorHint = errorHint
      }

      const finalActions = reply.actions ? [...reply.actions] : []
      if (aiErrorHint && !finalActions.some((a) => a.id === 'open-settings')) {
        finalActions.push({ id: 'open-settings', label: 'Check AI Settings' })
      }

      this.messages.push({
        id: nextId('msg'),
        role: 'assistant',
        text: aiErrorHint
          ? `Couldn't reach your configured AI provider (${aiErrorHint}). Falling back to local mode:\n\n${reply.text}`
          : reply.text,
        createdAt: new Date().toISOString(),
        source: 'local',
        rootCause: reply.rootCause,
        commandCards: reply.commandCards,
        uiActionCards: reply.uiActionCards,
        actions: finalActions.length > 0 ? finalActions : undefined,
        releaseCard: reply.releaseCard
      })
      this.pulseTalking()

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
      if (this.aiBusy) return
      const redactedPath = redactSensitiveText(input.remotePath).text
      const rawSnippet =
        input.contextLines && input.contextLines.length > 0
          ? input.contextLines.join('\n')
          : input.lineText
      const redacted = redactSensitiveText(rawSnippet)
      const logSnippet = redacted.text.slice(0, 2500)
      if (!logSnippet.trim()) return

      this.openPanel('chat')
      const lineLabel = input.lineNumber ? `line #${input.lineNumber} in ` : ''
      const redactionNote =
        redacted.redactionCount > 0
          ? ` (${redacted.redactionCount} sensitive item${redacted.redactionCount === 1 ? '' : 's'} redacted locally)`
          : ''
      this.messages.push({
        id: nextId('msg'),
        role: 'user',
        text: `Explain log ${lineLabel}${redactedPath || 'active stream'}${redactionNote}:\n${redactSensitiveText(input.lineText).text.slice(0, 400)}`,
        createdAt: new Date().toISOString()
      })

      let aiErrorHint: string | null = null
      if (this.aiConfig.provider !== 'none') {
        const { result: aiRes, errorHint } = await this.requestAiChat(
          `Explain this log entry from ${redactedPath} and suggest safe diagnostic steps.`,
          'explain-log',
          { logPath: redactedPath, logSnippet }
        )
        if (aiRes) {
          this.messages.push({
            id: nextId('msg'),
            role: 'assistant',
            text: aiRes.structured?.summary ?? aiRes.text ?? '',
            createdAt: new Date().toISOString(),
            source: 'ai',
            rootCause: aiRes.structured?.rootCause,
            commandCards: aiRes.structured?.commandCards,
            uiActionCards: aiRes.structured?.uiActionCards
          })
          this.pulseTalking()
          return
        }
        aiErrorHint = errorHint
      }

      const offline = diagnoseLogSnippetOffline(redactedPath, logSnippet)
      this.messages.push({
        id: nextId('msg'),
        role: 'assistant',
        text: aiErrorHint
          ? `Couldn't reach AI provider (${aiErrorHint}). Local log analysis:\n\n${offline.summary}`
          : offline.summary,
        createdAt: new Date().toISOString(),
        source: 'local',
        rootCause: offline.rootCause,
        commandCards: offline.commandCards,
        uiActionCards: offline.uiActionCards
      })
      this.pulseTalking()
    },

    async diagnoseMonitorSpike(sample: MonitorSample): Promise<void> {
      if (this.aiBusy) return
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
      const monitorSummary = redactSensitiveText(rawSummary).text

      this.openPanel('chat')
      this.messages.push({
        id: nextId('msg'),
        role: 'user',
        text: `Diagnose Resource Monitor metrics (CPU ${cpuPct !== null ? `${cpuPct.toFixed(1)}%` : 'N/A'}, RAM ${memPct}%${diskPct !== null ? `, Disk ${diskPct}%` : ''})`,
        createdAt: new Date().toISOString()
      })

      let aiErrorHint: string | null = null
      if (this.aiConfig.provider !== 'none') {
        const { result: aiRes, errorHint } = await this.requestAiChat(
          'Triage these remote server resource metrics and propose read-only verification commands.',
          'diagnose-spike',
          { monitorSummary }
        )
        if (aiRes) {
          this.messages.push({
            id: nextId('msg'),
            role: 'assistant',
            text: aiRes.structured?.summary ?? aiRes.text ?? '',
            createdAt: new Date().toISOString(),
            source: 'ai',
            rootCause: aiRes.structured?.rootCause,
            commandCards: aiRes.structured?.commandCards,
            uiActionCards: aiRes.structured?.uiActionCards
          })
          this.pulseTalking()
          return
        }
        aiErrorHint = errorHint
      }

      const offline = diagnoseMonitorSpikeOffline({
        cpuPct,
        memPct,
        swapPct,
        diskPct,
        loadAvg: sample.loadAvg,
        coreCount,
        topProcesses
      })
      this.messages.push({
        id: nextId('msg'),
        role: 'assistant',
        text: aiErrorHint
          ? `Couldn't reach AI provider (${aiErrorHint}). Local resource triage:\n\n${offline.summary}`
          : offline.summary,
        createdAt: new Date().toISOString(),
        source: 'local',
        rootCause: offline.rootCause,
        commandCards: offline.commandCards
      })
      this.pulseTalking()
    },

    saveCustomSnippet(input: { label: string; command: string; description?: string }): CompanionSnippet | null {
      const label = input.label.trim().slice(0, 80)
      const command = input.command.trim().slice(0, 500)
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

    deleteCustomSnippet(id: string): void {
      const next = this.customSnippets.filter((s) => s.id !== id)
      if (next.length === this.customSnippets.length) return
      this.customSnippets = next
      writeStored(SNIPPETS_KEY, JSON.stringify(this.customSnippets), this.dirtyPrefKeys)
    },

    recordCommandHistory(command: string, risk?: CompanionCommandRisk, hostLabel?: string | null): void {
      const trimmed = command.trim()
      if (!trimmed) return
      const entry: CompanionCommandHistoryEntry = {
        id: nextId('cmd'),
        command: trimmed,
        risk: risk ?? classifyCommandRisk(trimmed),
        executedAt: new Date().toISOString(),
        hostLabel: hostLabel ?? null
      }
      this.commandHistory = [entry, ...this.commandHistory].slice(0, MAX_CMD_HISTORY)
      writeStored(CMD_HISTORY_KEY, JSON.stringify(this.commandHistory), this.dirtyPrefKeys)
    },

    clearCommandHistory(): void {
      this.commandHistory = []
      writeStored(CMD_HISTORY_KEY, JSON.stringify([]), this.dirtyPrefKeys)
    },

    async runCommandCard(card: CompanionCommandCard): Promise<string> {
      const sessions = useSessionsStore()
      const sessionId = sessions.activeSessionId
      if (sessions.status !== 'connected' || !sessionId) {
        return 'Connect to an SSH session first to run commands in Terminal.'
      }
      const targetHost = sessions.activeTab.label || sessions.activeTab.hostLabel || 'active server'
      const riskNote =
        card.risk === 'destructive'
          ? 'DESTRUCTIVE command — can delete data or interrupt services.'
          : card.risk === 'mutating'
            ? 'MUTATING command — modifies files or service state.'
            : 'READ-ONLY command — inspects remote state without modifying files.'

      const confirm = useConfirm()
      const confirmed = await confirm({
        title: `Run command on ${targetHost}?`,
        body: `Risk: ${card.risk.toUpperCase()} — ${riskNote}`,
        items: [card.command],
        confirmLabel: 'Run in Terminal',
        confirmColor: card.risk === 'destructive' ? 'error' : card.risk === 'mutating' ? 'warning' : 'primary',
        destructive: card.risk === 'destructive'
      })
      if (!confirmed) {
        return 'Command execution cancelled.'
      }

      useDockState().openDock('terminal')
      const terminalId = await useTerminalStreamsStore().ensureTerminal(sessionId)
      if (typeof window !== 'undefined' && window.api?.send) {
        window.api.send(SEND_CHANNELS.terminalInput, {
          terminalId,
          data: `${card.command}\r`
        })
      }
      this.recordCommandHistory(card.command, card.risk, targetHost)
      return `Sent command to Terminal (${targetHost}).`
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
            window.dispatchEvent(new CustomEvent(OPEN_FILE_FILTERS_EVENT))
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
      this.messages.push({
        id: nextId('msg'),
        role: 'assistant',
        text,
        createdAt: new Date().toISOString()
      })
    },

    clearConversation(): void {
      this.messages = []
    },

    disposeTimers(): void {
      if (this.transferTipTimer) {
        clearTimeout(this.transferTipTimer)
        this.transferTipTimer = null
      }
      if (this.talkingTimer) {
        clearTimeout(this.talkingTimer)
        this.talkingTimer = null
      }
    },

    reset(): void {
      this.disposeTimers()
      this.dirtyPrefKeys.clear()
      this.open = false
      this.hasOpenedOnce = false
      this.activeView = 'chat'
      this.reportCategory = 'bug'
      this.avatarState = 'resting'
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
      this.lastTransferError = null
      this.tourStep = null
      this.aiConfig = { provider: 'none', endpoint: '', model: '', hasApiKey: false }
      this.aiConfigLoaded = false
      this.aiBusy = false
      this.customSnippets = []
      this.commandHistory = []
      this.lastTransferTipAt = 0
    }
  }
})
