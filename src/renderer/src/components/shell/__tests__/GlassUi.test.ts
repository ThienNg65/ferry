// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { mount, type VueWrapper } from '@vue/test-utils'
import { nextTick } from 'vue'
import { INVOKE_CHANNELS, LEGAL_POLICY_VERSION } from '@shared/contract'
import App from '../../../App.vue'
import SettingsDialog from '../SettingsDialog.vue'
import FerryLogo from '../FerryLogo.vue'
import { useSettingsStore } from '../../../stores/settings.store'
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
    termsAcceptance: null as { version: string; acceptedAt: string } | null
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
  UApp: { template: '<div><slot /></div>' },
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
    expect(logo.get('[data-ferry-logo]').attributes('data-ferry-logo')).toBe('classic')

    const toggle = panel.get('[aria-label="Modern Glass UI (In Development)"]')
    expect(ui.glassUiEnabled).toBe(false)
    expect(document.documentElement.classList.contains('ferry-glass')).toBe(false)

    await toggle.trigger('click')
    expect(ui.glassUiEnabled).toBe(true)
    expect(ui.glassUiPromoDismissed).toBe(true)
    expect(document.documentElement.classList.contains('ferry-glass')).toBe(true)
    expect(localStorage.getItem('ferry:ui:glassUi')).toBe('true')
    expect(logo.get('[data-ferry-logo]').attributes('data-ferry-logo')).toBe('glass')
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
})
