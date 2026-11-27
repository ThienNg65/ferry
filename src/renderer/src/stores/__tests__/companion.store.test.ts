// @vitest-environment happy-dom
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SEND_CHANNELS } from '@shared/contract'
import { OPEN_REMOTE_EDITOR_EVENT, useCompanionStore } from '../companion.store'
import { useFileFiltersStore } from '../fileFilters.store'
import { useSessionsStore } from '../sessions.store'
import { useSitesStore } from '../sites.store'

const confirmMock = vi.hoisted(() => vi.fn().mockResolvedValue(true))
vi.mock('../../composables/useConfirm', () => ({
  useConfirm: () => confirmMock
}))

vi.mock('../terminalStreams.store', () => ({
  useTerminalStreamsStore: () => ({
    ensureTerminal: vi.fn().mockResolvedValue('term-1')
  })
}))

describe('companion.store', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('shows optional intro on first run and never a false upgrade banner', () => {
    const store = useCompanionStore()
    store.initLifecycle('1.3.1')
    expect(store.notice?.kind).toBe('intro')
    expect(store.lastSeenVersion).toBe('1.3.1')
  })

  it('shows one upgrade notice on genuine upgrade and does not repeat after dismissal', () => {
    localStorage.setItem('ferry:ui:companionSeenVer', '1.3.0')
    localStorage.setItem('ferry:ui:companionOnboarded', 'true')
    const store = useCompanionStore()

    store.initLifecycle('1.3.1')
    expect(store.notice?.kind).toBe('upgrade')
    expect(store.notice?.title).toContain('better')
    expect(store.previousVersion).toBe('1.3.0')

    store.dismissNotice()
    expect(store.notice).toBeNull()
    expect(store.dismissedVersions).toContain('1.3.1')
  })

  it('suppresses proactive notices in Quiet Mode', () => {
    localStorage.setItem('ferry:ui:companionQuiet', 'true')
    localStorage.setItem('ferry:ui:companionSeenVer', '1.3.0')
    const store = useCompanionStore()

    store.initLifecycle('1.3.1')
    expect(store.notice).toBeNull()

    store.notifyTransferFailure('Permission denied')
    vi.advanceTimersByTime(5000)
    expect(store.notice).toBeNull()
  })

  it('debounces and rate-limits transfer failure assistance notices', () => {
    localStorage.setItem('ferry:ui:companionSeenVer', '1.3.1')
    localStorage.setItem('ferry:ui:companionOnboarded', 'true')
    const store = useCompanionStore()

    store.notifyTransferFailure('Disk full')
    expect(store.notice).toBeNull()

    vi.advanceTimersByTime(1500)
    expect(store.notice?.kind).toBe('transfer-error')

    store.dismissNotice()
    store.notifyTransferFailure('Another error immediately')
    vi.advanceTimersByTime(2000)
    // Rate-limited within 5-minute window
    expect(store.notice).toBeNull()
  })

  it('hydrates preferences from app-settings uiPrefs', () => {
    const store = useCompanionStore()
    store.hydrateFromPrefs({
      'ferry:ui:companionQuiet': 'true',
      'ferry:ui:companionShowDock': 'false',
      'ferry:ui:companionSeenVer': '1.3.1'
    })
    expect(store.quietMode).toBe(true)
    expect(store.showInDock).toBe(false)
    expect(store.lastSeenVersion).toBe('1.3.1')
  })

  it('manages custom snippets, command history, and prefs hydration', () => {
    const store = useCompanionStore()
    const saved = store.saveCustomSnippet({
      label: 'Restart Nginx',
      command: 'systemctl restart nginx',
      description: 'Reload web server'
    })
    expect(saved?.risk).toBe('mutating')
    expect(store.allSnippets.some((s) => s.command === 'systemctl restart nginx')).toBe(true)

    store.recordCommandHistory('df -h', 'read_only', 'prod-web')
    expect(store.commandHistory[0].command).toBe('df -h')
    expect(store.commandHistory[0].hostLabel).toBe('prod-web')

    store.deleteCustomSnippet(saved!.id)
    expect(store.customSnippets).toHaveLength(0)

    store.clearCommandHistory()
    expect(store.commandHistory).toHaveLength(0)
  })

  it('redacts secrets and IPs before Explain This Log and diagnoses monitor spikes offline', async () => {
    const store = useCompanionStore()
    await store.explainLogLine({
      remotePath: '/var/log/app.log',
      lineNumber: 42,
      lineText: '2026-11-21 ERROR upstream 10.20.30.40 failed password=supersecret ENOSPC: no space left on device'
    })

    expect(store.open).toBe(true)
    expect(store.messages[0].text).not.toContain('10.20.30.40')
    expect(store.messages[0].text).not.toContain('supersecret')
    expect(store.messages[0].text).toContain('[REDACTED_IP]')
    expect(store.messages[1].rootCause).toContain('disk space')
    expect(store.messages[1].commandCards?.some((c) => c.command.includes('df -h'))).toBe(true)

    await store.diagnoseMonitorSpike({
      sessionId: 'sess-1',
      timestamp: Date.now(),
      cpu: { aggregatePct: 92.4, perCorePct: [92, 93], coreCount: 2 },
      memory: { totalBytes: 1000, usedBytes: 900, availableBytes: 100, buffersBytes: 10, cachedBytes: 50 },
      swap: { totalBytes: 500, usedBytes: 300 },
      disk: { totalBytes: 1000, usedBytes: 960, availableBytes: 40 },
      processes: [{ pid: 901, name: 'python3', cpuPct: 88, rssBytes: 500 * 1024 * 1024 }],
      processTotalCount: 1,
      loadAvg: [4.2, 3.1, 2.5],
      uptimeSec: 3600
    })

    const last = store.messages[store.messages.length - 1]
    expect(last.text).toContain('high CPU')
    expect(last.commandCards?.some((c) => c.command.includes('ps -p 901'))).toBe(true)
  })

  it('executes confirmed Command Cards in Terminal and dispatches UI Action Cards', async () => {
    const store = useCompanionStore()
    const sessions = useSessionsStore()
    Object.assign(sessions.activeTab, { sessionId: 'sess-1', status: 'connected', hostLabel: 'prod-1' })

    const sendSpy = vi.fn()
    const prevApi = (window as { api?: unknown }).api
    ;(window as { api?: unknown }).api = { send: sendSpy }

    try {
      confirmMock.mockResolvedValueOnce(true)
      const outcome = await store.runCommandCard({
        command: 'df -h',
        description: 'Check disk usage',
        risk: 'read_only'
      })
      expect(outcome).toContain('prod-1')
      expect(sendSpy).toHaveBeenCalledWith(SEND_CHANNELS.terminalInput, {
        terminalId: 'term-1',
        data: 'df -h\r'
      })
      expect(store.commandHistory[0].command).toBe('df -h')

      const editorEvents: string[] = []
      const onEditor = (e: Event) => {
        editorEvents.push((e as CustomEvent<{ remotePath: string }>).detail.remotePath)
      }
      window.addEventListener(OPEN_REMOTE_EDITOR_EVENT, onEditor)
      await store.executeUiActionCard({ kind: 'open-editor', remotePath: '/etc/nginx/nginx.conf', label: 'Open config' })
      window.removeEventListener(OPEN_REMOTE_EDITOR_EVENT, onEditor)
      expect(editorEvents).toEqual(['/etc/nginx/nginx.conf'])

      await store.executeUiActionCard({ kind: 'apply-filter', mode: 'exclude', pattern: '*.tmp', label: 'Hide .tmp' })
      const filters = useFileFiltersStore()
      expect(filters.getFilter('host:prod-1').exclude).toContain('*.tmp')

      // Escalates read_only -> mutating in runCommandCard confirmation
      confirmMock.mockResolvedValueOnce(false)
      await store.runCommandCard({
        command: 'systemctl restart nginx',
        description: 'Restart nginx',
        risk: 'read_only'
      })
      expect(confirmMock).toHaveBeenLastCalledWith(
        expect.objectContaining({
          body: expect.stringContaining('MUTATING')
        })
      )
    } finally {
      ;(window as { api?: unknown }).api = prevApi
    }
  })

  it('keeps local tail-log remotePath unredacted when explainLogLine redacts logPath', async () => {
    const store = useCompanionStore()
    await store.explainLogLine({
      remotePath: '/var/log/nginx/error.log',
      lineText: 'ENOSPC: no space left on device'
    })
    const last = store.messages[store.messages.length - 1]
    expect(last.uiActionCards?.[0]).toEqual({
      kind: 'tail-log',
      remotePath: '/var/log/nginx/error.log',
      label: 'Focus Log Tail'
    })
  })

  it('sanitizes control sequences from snippets/history and caps message list at 100', () => {
    const store = useCompanionStore()
    const snippet = store.saveCustomSnippet({
      label: 'Unsafe input',
      command: '\u001b[31mecho hi\u001b[0m\nrm -rf /tmp/x'
    })
    expect(snippet?.command).toBe('echo hi rm -rf /tmp/x')
    expect(snippet?.risk).toBe('destructive')

    for (let i = 0; i < 120; i++) {
      store.pushSystemNote(`note-${i}`)
    }
    expect(store.messages).toHaveLength(100)
    expect(store.messages[0].text).toBe('note-20')
    expect(store.messages[99].text).toBe('note-119')
  })
})

describe('orb state', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('defaults to idle', () => {
    expect(useCompanionStore().effectiveAvatarState).toBe('idle')
  })

  it('applies precedence thinking > streaming > error > listening > idle', () => {
    const s = useCompanionStore()
    s.$patch({ listening: true })
    expect(s.effectiveAvatarState).toBe('listening')
    s.$patch({ aiErrorLabel: "Couldn't reach Gemini" })
    expect(s.effectiveAvatarState).toBe('error')
    s.$patch({ reveal: { messageId: 'm', chunks: ['a ', 'b'], shown: 1 } })
    expect(s.effectiveAvatarState).toBe('streaming')
    s.$patch({ aiBusy: true })
    expect(s.effectiveAvatarState).toBe('thinking')
    s.$patch({ aiBusy: false, releasesLoading: true })
    expect(s.effectiveAvatarState).toBe('thinking')
  })

  it('keeps noticing as an overlay, hidden in quiet mode', () => {
    const s = useCompanionStore()
    s.$patch({ notice: { id: 'n', kind: 'greeting', title: 'Hi', body: '', ctaLabel: 'Open' } })
    expect(s.hasNotice).toBe(true)
    expect(s.effectiveAvatarState).toBe('idle')
    s.$patch({ quietMode: true })
    expect(s.hasNotice).toBe(false)
  })

  it('reports prod when the active tab site is production', () => {
    const sites = useSitesStore()
    sites.$patch({ sites: [{ id: 'site-1', name: 'prod-db-01', environment: 'prod' } as never] })
    const sessions = useSessionsStore()
    sessions.activeTab.siteId = 'site-1'
    const s = useCompanionStore()
    expect(s.isProd).toBe(true)
    expect(s.prodSiteLabel).toBe('prod-db-01, Production')
    sites.sites[0].environment = 'staging'
    expect(s.isProd).toBe(false)
  })

  it('reveals a local reply in chunks, then returns to idle', async () => {
    const s = useCompanionStore()
    await s.deliverAiOrLocalReply({ errorPrefix: '', buildLocal: () => ({ text: 'one two three four five six seven' }) })
    expect(s.effectiveAvatarState).toBe('streaming')
    expect(s.reveal?.shown).toBe(1)
    vi.advanceTimersByTime(2000)
    expect(s.reveal).toBeNull()
    expect(s.effectiveAvatarState).toBe('idle')
    expect(s.messages.at(-1)?.text).toBe('one two three four five six seven')
  })

  it('a new message completes the running reveal', async () => {
    const s = useCompanionStore()
    await s.deliverAiOrLocalReply({ errorPrefix: '', buildLocal: () => ({ text: 'one two three four five six seven' }) })
    s.pushMessage({ role: 'user', text: 'next' })
    expect(s.reveal).toBeNull()
  })

  it('completes the reveal when the panel closes or the conversation clears', async () => {
    const s = useCompanionStore()
    s.openPanel()
    await s.deliverAiOrLocalReply({ errorPrefix: '', buildLocal: () => ({ text: 'one two three four five six seven' }) })
    s.closePanel()
    expect(s.reveal).toBeNull()
    await s.deliverAiOrLocalReply({ errorPrefix: '', buildLocal: () => ({ text: 'one two three four five six seven' }) })
    s.aiErrorLabel = 'AI error'
    s.clearConversation()
    expect(s.reveal).toBeNull()
    expect(s.aiErrorLabel).toBeNull()
  })

  it('skips the reveal under reduced motion', async () => {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('reduce'), media: q }) as MediaQueryList)
    const s = useCompanionStore()
    await s.deliverAiOrLocalReply({ errorPrefix: '', buildLocal: () => ({ text: 'one two three four five six seven' }) })
    expect(s.reveal).toBeNull()
    vi.unstubAllGlobals()
  })

  it('sets error on AI failure and clears it on the next reply and on close', async () => {
    const prevApi = (window as { api?: unknown }).api
    ;(window as { api?: unknown }).api = { invoke: vi.fn().mockRejectedValue(new Error('boom')) }
    const s = useCompanionStore()
    s.aiConfig = { provider: 'gemini', endpoint: 'x', model: 'm', hasApiKey: true }
    await s.deliverAiOrLocalReply({ aiPrompt: 'hi', errorPrefix: '', buildLocal: () => ({ text: 'local' }) })
    expect(s.aiErrorLabel).toBe("Couldn't reach Gemini")
    s.closePanel()
    expect(s.aiErrorLabel).toBeNull()
    ;(window as { api?: unknown }).api = prevApi
  })

  it('setListening toggles listening and closePanel clears it', () => {
    const s = useCompanionStore()
    s.setListening(true)
    expect(s.effectiveAvatarState).toBe('listening')
    s.closePanel()
    expect(s.listening).toBe(false)
  })
})
