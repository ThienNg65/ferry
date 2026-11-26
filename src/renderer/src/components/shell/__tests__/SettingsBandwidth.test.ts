// @vitest-environment happy-dom
import { createPinia, setActivePinia } from 'pinia'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { INVOKE_CHANNELS } from '@shared/contract'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { invoke } from '../../../api'
import { useSettingsStore } from '../../../stores/settings.store'
import SettingsDialog from '../SettingsDialog.vue'

vi.mock('../../../api', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../../api')>(),
  invoke: vi.fn(),
  onEvent: vi.fn(() => () => {})
}))

vi.mock('../../../composables/useNotify', () => ({
  useNotify: () => ({ success: vi.fn(), error: vi.fn(), prompt: vi.fn() })
}))

vi.mock('../../../composables/useConfirm', () => ({
  useConfirm: () => vi.fn().mockResolvedValue(true)
}))

vi.mock('@nuxt/ui/components/ColorPicker.vue', () => ({
  default: { template: '<div />' }
}))

vi.mock('@nuxt/ui/components/Switch.vue', () => ({
  default: {
    props: ['modelValue', 'ariaLabel'],
    emits: ['update:modelValue'],
    template:
      '<input type="checkbox" :aria-label="ariaLabel" :checked="modelValue" @change="$emit(\'update:modelValue\', $event.target.checked)" />'
  }
}))

const stubs = {
  UModal: {
    props: ['open'],
    template: '<div v-if="open"><slot name="header" /><slot name="body" /><slot name="footer" /></div>'
  },
  UButton: {
    props: ['label', 'disabled', 'loading'],
    template: '<button type="button" :disabled="disabled || loading">{{ label }}<slot /></button>'
  },
  UInput: {
    props: ['modelValue', 'id', 'type'],
    emits: ['update:modelValue'],
    template:
      '<input :id="id" :type="type || \'text\'" :value="modelValue" @input="$emit(\'update:modelValue\', type === \'number\' ? Number($event.target.value) : $event.target.value)" />'
  },
  USelect: {
    props: ['modelValue', 'items', 'ariaLabel'],
    emits: ['update:modelValue'],
    template: `
      <select :aria-label="ariaLabel" :value="modelValue" @change="$emit('update:modelValue', $event.target.value)">
        <option v-for="item in items" :key="item.value" :value="item.value">{{ item.label }}</option>
      </select>
    `
  },
  URadioGroup: true,
  UBadge: true,
  UAlert: true,
  UIcon: true,
  UTooltip: { template: '<div><slot /></div>' },
  TerminalAppearanceSettings: true,
  PasswordInput: true
}

let wrapper: VueWrapper | null = null

describe('SettingsDialog bandwidth speed limit units', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.resetAllMocks()
    vi.mocked(invoke).mockImplementation(async (channel) => {
      if (channel === INVOKE_CHANNELS.settingsGet) {
        return {
          openTabSiteIds: [],
          bandwidthLimitKBps: 5120,
          defaultProxy: null,
          autoCheckUpdates: true,
          historyRetentionDays: 90
        } as never
      }
      if (channel === INVOKE_CHANNELS.knownHostsList) return [] as never
      return undefined as never
    })
    vi.stubGlobal('matchMedia', () => ({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn()
    }))
  })

  afterEach(() => {
    wrapper?.unmount()
    wrapper = null
    vi.unstubAllGlobals()
  })

  it('seeds MB/s for >= 1 MB/s caps, saves MB/s as KB/s, and maps 0 to Unlimited (null)', async () => {
    const settings = useSettingsStore()
    settings.bandwidthLimitKBps = 5120

    wrapper = mount(SettingsDialog, { props: { open: true }, global: { stubs } })
    await flushPromises()

    const networkTab = wrapper.findAll('button').find((b) => b.text().includes('Network'))
    await networkTab!.trigger('click')
    await flushPromises()

    const limitInput = wrapper.get('#settings-limit')
    const unitSelect = wrapper.get('select[aria-label="Bandwidth limit unit"]')
    expect((limitInput.element as HTMLInputElement).value).toBe('5')
    expect((unitSelect.element as HTMLSelectElement).value).toBe('MB/s')

    // Change to 2.5 MB/s and save -> should persist 2560 KB/s
    await limitInput.setValue('2.5')
    await flushPromises()
    const saveBtn = wrapper.findAll('button').find((b) => b.text().trim() === 'Save')
    await saveBtn!.trigger('click')
    await flushPromises()

    expect(invoke).toHaveBeenCalledWith(INVOKE_CHANNELS.settingsSetBandwidthLimit, 2560)

    // Setting limit to 0 clears throttling completely (null / Unlimited)
    await limitInput.setValue('0')
    await flushPromises()
    const saveZeroBtn = wrapper.findAll('button').find((b) => b.text().trim() === 'Save')
    expect(saveZeroBtn).toBeDefined()
    await saveZeroBtn!.trigger('click')
    await flushPromises()

    expect(invoke).toHaveBeenCalledWith(INVOKE_CHANNELS.settingsSetBandwidthLimit, null)
    expect(settings.bandwidthLimitKBps).toBeNull()
  })
})
