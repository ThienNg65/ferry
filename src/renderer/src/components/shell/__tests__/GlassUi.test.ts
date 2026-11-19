// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createPinia, setActivePinia } from 'pinia'
import { mount, type VueWrapper } from '@vue/test-utils'
import { nextTick } from 'vue'
import { INVOKE_CHANNELS, LEGAL_POLICY_VERSION } from '@shared/contract'
import App from '../../../App.vue'
import SettingsDialog from '../SettingsDialog.vue'
import SiteTabBar from '../SiteTabBar.vue'
import FerryLogo from '../FerryLogo.vue'
import { useSettingsStore } from '../../../stores/settings.store'
import { useSessionsStore } from '../../../stores/sessions.store'
import { useUiStore } from '../../../stores/ui.store'

const toastCalls: Array<Record<string, unknown>> = []
const toastMock = {
  add: vi.fn((opts: Record<string, unknown>) => {
    const entry = { id: `toast-${toastCalls.length + 1}`, ...opts }
    toastCalls.push(entry)
    return entry
  }),
  remove: vi.fn()
}

const notifyMock = {
  success: vi.fn(),
  error: vi.fn(),
  prompt: vi.fn()
}

vi.mock('@nuxt/ui/locale', () => ({ en: {} }))
vi.mock('@nuxt/ui/composables', () => ({ extendLocale: (base: unknown) => base }))
vi.mock('@nuxt/ui/components/ColorPicker.vue', () => ({ default: { template: '<div />' } }))
vi.mock('@nuxt/ui/components/Switch.vue', () => ({
  default: {
    props: ['modelValue', 'disabled'],
    template: '<button role="switch" :aria-checked="Boolean(modelValue)" :disabled="disabled" @click="$emit(\'update:modelValue\', !modelValue)" />'
  }
}))
vi.mock('@nuxt/ui/components/ContextMenu.vue', () => ({ default: { template: '<div><slot /></div>' } }))
vi.mock('@nuxt/ui/components/CommandPalette.vue', () => ({ default: { template: '<div />' } }))

const { mockSettingsResponse, invokeMock } = vi.hoisted(() => {
  const settingsResp = {
    bandwidthLimitKBps: null,
    autoCheckUpdates: true,
    historyRetentionDays: 90,
    openTabSiteIds: [] as string[],
    termsAcceptance: null as { version: string; acceptedAt: string } | null,
    uiPrefs: {} as Record<string, string>
  }
  const fn = vi.fn(async (channel: string) => {
    switch (channel) {
      case 'settings:get':
        return { ...settingsResp }
      case 'sites:list':
      case 'edit:list':
      case 'operations:list':
      case 'transfer:list':
        return []
      default:
        if (channel.startsWith('update:')) {
          return { status: 'idle', currentVersion: '0.30.1', availableVersion: null, progress: null, error: null }
        }
        return undefined
    }
  })
  return { mockSettingsResponse: settingsResp, invokeMock: fn }
})

vi.mock('../../../api', () => ({
  invoke: invokeMock,
  onEvent: vi.fn(() => () => {}),
  IpcError: class IpcError extends Error {
    code: string
    constructor(code: string, message: string) {
      super(message)
      this.code = code
    }
  }
}))

vi.mock('../../../bridge/neutralinoApi', () => ({
  openExternal: vi.fn(),
  isNeutralinoRuntime: () => false,
  registerBeforeWindowClose: () => () => {}
}))

vi.mock('../../../composables/useNotify', () => ({
  useNotify: () => notifyMock
}))

vi.mock('../../../composables/useConfirm', () => ({
  useConfirm: () => vi.fn(async () => true)
}))

vi.mock('../../../utils/windowBounds', () => ({
  initWindowBoundsPersistence: () => () => {}
}))

const commonStubs = {
  UApp: {
    props: ['tooltip', 'toaster', 'locale'],
    template:
      '<div :data-tooltip-delay="tooltip?.delayDuration" :data-tooltip-skip-delay="tooltip?.skipDelayDuration"><slot /></div>'
  },
  UModal: {
    props: ['open', 'title'],
    template: '<div v-if="open" role="dialog"><slot name="body" /><slot name="content" /></div>'
  },
  UBadge: { template: '<span><slot /></span>' },
  UButton: {
    props: ['label', 'disabled', 'loading'],
    template: '<button type="button" :disabled="disabled || loading"><slot>{{ label }}</slot></button>'
  },
  UIcon: true,
  UTooltip: { template: '<div><slot /></div>' },
  UInput: { template: '<input />' },
  URadioGroup: { template: '<div />' },
  USelect: { template: '<select />' },
  TerminalAppearanceSettings: { template: '<div />' },
  SiteFormDialog: { template: '<div />' },
  SiteTabBar: { template: '<header />' },
  SessionManagerView: { template: '<div />' },
  SettingsDialog: { template: '<div />' },
  HistoryDialog: { template: '<div />' },
  ShortcutsDialog: { template: '<div />' },
  LegalConsentDialog: { template: '<div />' },
  CommandPalette: { template: '<div />' },
  ConnectionModals: { template: '<div />' },
  FilePane: { template: '<div />' },
  BottomDock: { template: '<div />' }
}

beforeAll(() => {
  if (typeof window.matchMedia !== 'function') {
    window.matchMedia = (() => ({
      matches: true,
      media: '',
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn()
    })) as unknown as typeof window.matchMedia
  }
})

describe('Modern Glass UI rollout', () => {
  const wrappers: VueWrapper[] = []

  function trackMount<T extends VueWrapper>(wrapper: T): T {
    wrappers.push(wrapper)
    return wrapper
  }

  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
    document.documentElement.classList.remove('ferry-glass', 'dark')
    toastCalls.length = 0
    mockSettingsResponse.termsAcceptance = null
    mockSettingsResponse.uiPrefs = {}
    vi.clearAllMocks()
    vi.stubGlobal('useToast', () => toastMock)
  })

  afterEach(async () => {
    await new Promise((r) => setTimeout(r, 10))
    while (wrappers.length > 0) {
      wrappers.pop()?.unmount()
    }
  })

  it('SettingsDialog renders Modern Glass UI switch with In Development badge and updates store + root class', async () => {
    const ui = useUiStore()
    const w = trackMount(
      mount(SettingsDialog, {
        props: { open: true },
        global: { stubs: commonStubs }
      })
    )

    const panel = w.get('#settings-panel-appearance')
    expect(panel.text()).toContain('Modern Glass UI')
    expect(panel.text()).toContain('In Development')

    const logo = trackMount(mount(FerryLogo))
    const image = logo.get('img[data-ferry-logo]')
    expect(image.attributes('data-ferry-logo')).toBe('classic')
    expect(image.attributes('src')).toBe('./ferry-classic.svg')
    expect(image.attributes('alt')).toBe('Ferry')

    const toggle = panel.get('[aria-label="Modern Glass UI (In Development)"]')
    expect(ui.glassUiEnabled).toBe(false)
    expect(document.documentElement.classList.contains('ferry-glass')).toBe(false)

    await toggle.trigger('click')
    expect(ui.glassUiEnabled).toBe(true)
    expect(ui.glassUiPromoDismissed).toBe(true)
    expect(document.documentElement.classList.contains('ferry-glass')).toBe(true)
    expect(localStorage.getItem('ferry:ui:glassUi')).toBe('true')
    expect(image.attributes('data-ferry-logo')).toBe('glass')
    expect(image.attributes('src')).toBe('./ferry-glass.svg')
    await logo.setProps({ decorative: true })
    expect(image.attributes('alt')).toBe('')
  })

  it('App.vue keeps Classic UI untouched by default and mounts .ferry-ambient-canvas only when enabled', async () => {
    const w = trackMount(mount(App, { global: { stubs: commonStubs } }))
    const ui = useUiStore()

    expect(w.find('.ferry-ambient-canvas').exists()).toBe(false)
    expect(w.html()).toContain('bg-default')

    ui.setGlassUiEnabled(true)
    await nextTick()

    expect(w.find('.ferry-ambient-canvas').exists()).toBe(true)
    expect(w.html()).toContain('bg-transparent')
  })

  it('App.vue initializes Glass UI before initTheme so Win11 DWM caption sync receives the glass color on startup', async () => {
    localStorage.setItem('ferry:ui:glassUi', 'true')
    localStorage.setItem('ferry:ui:theme', 'dark')
    ;(window as unknown as { api?: unknown }).api = { invoke: vi.fn() }

    trackMount(mount(App, { global: { stubs: commonStubs } }))
    await nextTick()

    expect(document.documentElement.classList.contains('ferry-glass')).toBe(true)
    expect(invokeMock).toHaveBeenCalledWith(INVOKE_CHANNELS.windowSyncTheme, {
      theme: 'dark',
      captionColor: 0x160d09
    })
  })

  it('App.vue gates discovery toast behind legal consent and supports Try Glass UI & close dismissal', async () => {
    const settings = useSettingsStore()
    settings.loaded = true
    settings.termsAcceptance = null

    trackMount(mount(App, { global: { stubs: commonStubs } }))
    const ui = useUiStore()
    await nextTick()

    // Held while needsLegalConsent is true
    expect(toastMock.add).not.toHaveBeenCalled()

    // Fires once user accepts current legal policy
    settings.termsAcceptance = { version: LEGAL_POLICY_VERSION, acceptedAt: '2026-11-18T00:00:00.000Z' }
    await nextTick()

    expect(toastMock.add).toHaveBeenCalledTimes(1)
    const promo = toastCalls[0]
    expect(promo.title).toBe('Modern Glass UI (In Development)')
    expect(promo.icon).toBe('i-lucide-sparkles')
    expect(promo.duration).toBe(0)

    // Clicking "Try Glass UI" enables Glass UI and dismisses promo
    const actions = promo.actions as Array<{ label: string; onClick: () => void }>
    actions.find((a) => a.label === 'Try Glass UI')!.onClick()
    expect(ui.glassUiEnabled).toBe(true)
    expect(ui.glassUiPromoDismissed).toBe(true)
    expect(toastMock.remove).toHaveBeenCalledWith(promo.id)

    // Reset and test closing via onUpdate:open(false)
    ui.setGlassUiEnabled(false)
    ui.glassUiPromoDismissed = false
    const onUpdateOpen = promo['onUpdate:open'] as (open: boolean) => void
    onUpdateOpen(false)
    expect(ui.glassUiPromoDismissed).toBe(true)
  })

  it('deleteAllLocalData resets glassUiEnabled and removes .ferry-glass from documentElement', async () => {
    const ui = useUiStore()
    const settings = useSettingsStore()
    ui.setGlassUiEnabled(true)
    expect(document.documentElement.classList.contains('ferry-glass')).toBe(true)

    vi.spyOn(settings, 'fetch').mockResolvedValue()
    await settings.deleteAllLocalData()

    expect(ui.glassUiEnabled).toBe(false)
    expect(ui.glassUiPromoDismissed).toBe(false)
    expect(document.documentElement.classList.contains('ferry-glass')).toBe(false)
    expect(localStorage.getItem('ferry:ui:glassUi')).toBeNull()
  })

  it('restores Glass UI from sidecar uiPrefs on restart even when localStorage is empty and suppresses promo toast', async () => {
    mockSettingsResponse.termsAcceptance = { version: LEGAL_POLICY_VERSION, acceptedAt: '2026-11-18T00:00:00.000Z' }
    mockSettingsResponse.uiPrefs = {
      'ferry:ui:glassUi': 'true',
      'ferry:ui:glassUiPromoDismissed': 'true'
    }

    const w = trackMount(mount(App, { global: { stubs: commonStubs } }))
    const ui = useUiStore()
    await nextTick()
    await nextTick()

    expect(ui.glassUiEnabled).toBe(true)
    expect(ui.glassUiPromoDismissed).toBe(true)
    expect(document.documentElement.classList.contains('ferry-glass')).toBe(true)
    expect(w.find('.ferry-ambient-canvas').exists()).toBe(true)
    expect(toastMock.add).not.toHaveBeenCalled()
  })

  it('SiteTabBar uses floating pill tabs with inset indicator and hides FerryLogo in Glass mode (outside fullscreen)', async () => {
    const ui = useUiStore()
    const sessions = useSessionsStore()
    const w = trackMount(mount(SiteTabBar, { global: { stubs: commonStubs } }))

    // Classic mode: folder tab + FerryLogo visible
    expect(w.find('[data-ferry-logo]').exists()).toBe(true)
    const classicTab = w.get('.ferry-site-tab')
    expect(classicTab.classes()).toContain('rounded-t-md')
    expect(classicTab.classes()).toContain('border-t-2')

    // Glass mode: centered floating pill tab, no pinched border-t-2, inset bottom indicator, FerryLogo hidden
    ui.setGlassUiEnabled(true)
    await nextTick()

    expect(w.find('[data-ferry-logo]').exists()).toBe(false)
    const nav = w.get('nav[aria-label="Open connections"]')
    expect(nav.classes()).toContain('ferry-scroll-fade-x')
    expect(nav.classes()).toContain('touch-pan-x')
    const tablist = w.get('[role="tablist"]')
    expect(tablist.classes()).toContain('shrink-0')
    expect(tablist.classes()).not.toContain('min-w-0')
    const glassTab = w.get('.ferry-site-tab')
    expect(glassTab.classes()).toContain('rounded-lg')
    expect(glassTab.classes()).toContain('ferry-glass-active-tab')
    expect(glassTab.classes()).not.toContain('border-t-2')
    const indicator = glassTab.find('span.h-0\\.5.rounded-full.bg-primary')
    expect(indicator.exists()).toBe(true)
    expect(indicator.classes()).toContain('scale-x-100')

    // Opening a second tab keeps both indicators mounted so scale-x transitions cleanly
    sessions.openNewTab()
    await nextTick()
    const tabs = w.findAll('.ferry-site-tab')
    expect(tabs).toHaveLength(2)
    expect(tabs[0].find('span.h-0\\.5.rounded-full.bg-primary').classes()).toContain('scale-x-0')
    expect(tabs[1].find('span.h-0\\.5.rounded-full.bg-primary').classes()).toContain('scale-x-100')
  })

  it('App.vue configures sibling tooltip warmup delay and skipDelayDuration on UApp', () => {
    const w = trackMount(mount(App, { global: { stubs: commonStubs } }))
    const root = w.get('[data-tooltip-delay]')
    expect(root.attributes('data-tooltip-delay')).toBe('250')
    expect(root.attributes('data-tooltip-skip-delay')).toBe('300')
  })

  it('does not re-hydrate or overwrite Glass UI edits on subsequent settings.fetch() after initial load', async () => {
    const ui = useUiStore()
    const settings = useSettingsStore()

    mockSettingsResponse.uiPrefs = { 'ferry:ui:glassUi': 'false' }
    await settings.fetch()
    expect(settings.loaded).toBe(true)
    expect(ui.glassUiEnabled).toBe(false)

    // User enables Glass UI; a subsequent settings.fetch() (e.g. opening SettingsDialog) with stale snapshot must not undo it
    ui.setGlassUiEnabled(true)
    await settings.fetch()
    expect(ui.glassUiEnabled).toBe(true)
    expect(localStorage.getItem('ferry:ui:glassUi')).toBe('true')
  })

  it('main.css separates menu surface tokens and disables nested backdrop-filter over open dialogs', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/renderer/src/assets/main.css'), 'utf8')
    expect(css).toContain('--ferry-glass-menu-bg:')
    expect(css).toContain('--ferry-glass-menu-nested-bg:')
    expect(css).toContain('html.ferry-glass [role="listbox"]')
    expect(css).toContain('html.ferry-glass:has([role="dialog"])')
  })
})
