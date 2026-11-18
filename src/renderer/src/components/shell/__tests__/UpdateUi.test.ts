// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { mount, type VueWrapper } from '@vue/test-utils'
import { nextTick } from 'vue'
import SettingsDialog from '../SettingsDialog.vue'
import SiteTabBar from '../SiteTabBar.vue'
import CommandPalette from '../CommandPalette.vue'
import { useUpdateStore } from '../../../stores/update.store'
import { useCommandPalette } from '../../../composables/useCommandPalette'

const notifyMock = {
  success: vi.fn(),
  error: vi.fn(),
  prompt: vi.fn()
}

vi.mock('@nuxt/ui/components/ColorPicker.vue', () => ({ default: { template: '<div />' } }))
vi.mock('@nuxt/ui/components/Switch.vue', () => ({
  default: {
    props: ['modelValue', 'disabled'],
    template: '<button role="switch" :disabled="disabled" @click="$emit(\'update:modelValue\', !modelValue)" />'
  }
}))
vi.mock('@nuxt/ui/components/ContextMenu.vue', () => ({ default: { template: '<div><slot /></div>' } }))
vi.mock('@nuxt/ui/components/CommandPalette.vue', () => ({
  default: {
    props: ['groups'],
    template: `
      <div data-command-palette>
        <div v-for="g in groups" :key="g.id">
          <button
            v-for="item in g.items"
            :key="item.label"
            type="button"
            :disabled="item.disabled"
            @click="!item.disabled && item.onSelect?.()"
          >
            {{ item.label }}
          </button>
        </div>
      </div>
    `
  }
}))

vi.mock('../../../api', () => ({
  invoke: vi.fn(async () => undefined),
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

const commonStubs = {
  UModal: {
    props: ['open', 'title'],
    template: '<div v-if="open" role="dialog"><slot name="body" /><slot name="content" /></div>'
  },
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
  SiteFormDialog: { template: '<div />' }
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

describe('Auto-update renderer UI', () => {
  const wrappers: VueWrapper[] = []

  function trackMount<T extends VueWrapper>(wrapper: T): T {
    wrappers.push(wrapper)
    return wrapper
  }

  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    useCommandPalette().close()
  })

  afterEach(() => {
    while (wrappers.length > 0) {
      wrappers.pop()?.unmount()
    }
  })

  it('SettingsDialog displays inline error banner + Retry, accessible progress bar, available, and downloaded states', async () => {
    const update = useUpdateStore()
    update.currentVersion = '0.29.1'
    update.status = 'error'
    update.error = 'GitHub API rate limit exceeded'
    const checkSpy = vi.spyOn(update, 'checkNow').mockResolvedValue({ status: 'not-available' })
    const installSpy = vi.spyOn(update, 'installNow').mockResolvedValue()

    const w = trackMount(
      mount(SettingsDialog, {
        props: { open: true },
        global: { stubs: commonStubs }
      })
    )
    await w.get('#settings-tab-updates').trigger('click')
    await nextTick()

    const alert = w.get('#settings-panel-updates [role="alert"]')
    expect(alert.text()).toContain('Update failed')
    expect(alert.text()).toContain('GitHub API rate limit exceeded')

    const retryBtn = alert.findAll('button').find((b) => b.text().includes('Retry'))!
    await retryBtn.trigger('click')
    expect(checkSpy).toHaveBeenCalledOnce()

    update.status = 'available'
    update.availableVersion = '0.30.0'
    update.error = null
    await nextTick()
    expect(w.get('#settings-panel-updates').text()).toContain('Ferry v0.30.0 is available')

    update.status = 'downloading'
    update.progress = {
      percent: 42.6,
      bytesPerSecond: 1024 * 1024,
      transferred: 5 * 1024 * 1024,
      total: 12 * 1024 * 1024
    }
    await nextTick()

    const progressbar = w.get('#settings-panel-updates [role="progressbar"]')
    expect(progressbar.attributes('aria-valuenow')).toBe('43')
    expect(progressbar.attributes('aria-valuemin')).toBe('0')
    expect(progressbar.attributes('aria-valuemax')).toBe('100')
    expect(w.get('#settings-panel-updates').text()).toContain('43% · 5.0 MB / 12.0 MB')

    update.status = 'downloaded'
    await nextTick()
    const installBtn = w
      .get('#settings-panel-updates')
      .findAll('button')
      .find((b) => b.text().includes('Restart & Install'))!
    await installBtn.trigger('click')
    expect(installSpy).toHaveBeenCalledOnce()

    update.installing = true
    await nextTick()
    expect(installBtn.attributes('disabled')).toBeDefined()
  })

  it('SiteTabBar shows Update ready pill when downloaded, invokes installNow, and disables while installing', async () => {
    const update = useUpdateStore()
    const installSpy = vi.spyOn(update, 'installNow').mockResolvedValue()

    const w = trackMount(mount(SiteTabBar, { global: { stubs: commonStubs } }))
    expect(w.find('[aria-label="Update ready — restart to update"]').exists()).toBe(false)

    update.status = 'downloaded'
    update.availableVersion = '0.30.0'
    await nextTick()

    const pill = w.get('[aria-label="Update ready — restart to update"]')
    expect(pill.text()).toContain('Update ready')
    await pill.trigger('click')
    expect(installSpy).toHaveBeenCalledOnce()

    update.installing = true
    await nextTick()
    const restartingPill = w.get('[aria-label="Installing update…"]')
    expect(restartingPill.attributes('disabled')).toBeDefined()
    expect(restartingPill.text()).toContain('Restarting…')
  })

  it('CommandPalette guards Check for updates and adds Restart & install update when downloaded', async () => {
    const update = useUpdateStore()
    const installSpy = vi.spyOn(update, 'installNow').mockResolvedValue()
    useCommandPalette().open()

    const w = trackMount(mount(CommandPalette, { global: { stubs: commonStubs } }))
    const findItem = (prefix: string) =>
      w.findAll('[data-command-palette] button').find((b) => b.text().startsWith(prefix))

    expect(findItem('Check for updates…')?.attributes('disabled')).toBeUndefined()
    expect(findItem('Restart & install update')).toBeUndefined()

    update.status = 'downloading'
    await nextTick()
    expect(findItem('Check for updates…')?.attributes('disabled')).toBeDefined()

    update.status = 'downloaded'
    update.availableVersion = '0.30.0'
    await nextTick()
    expect(findItem('Check for updates…')?.attributes('disabled')).toBeDefined()
    const restartItem = findItem('Restart & install update (v0.30.0)')
    expect(restartItem).toBeDefined()
    await restartItem!.trigger('click')
    expect(installSpy).toHaveBeenCalledOnce()
  })
})
