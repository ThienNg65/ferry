// @vitest-environment happy-dom
import { computed } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { INVOKE_CHANNELS } from '@shared/contract'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { invoke } from '../../../api'
import { useSettingsStore } from '../../../stores/settings.store'
import TransferQueue from '../TransferQueue.vue'

vi.mock('../../../api', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../../api')>(),
  invoke: vi.fn(),
  onEvent: vi.fn(() => () => {})
}))

vi.mock('../../../composables/useNotify', () => ({
  useNotify: () => ({ success: vi.fn(), error: vi.fn(), prompt: vi.fn() })
}))

vi.mock('@tanstack/vue-virtual', () => ({
  useVirtualizer: (opts: { value: { count: number; getItemKey: (i: number) => string | number } }) =>
    computed(() => ({
      getVirtualItems: () =>
        Array.from({ length: opts.value.count }, (_, index) => ({
          index,
          key: opts.value.getItemKey(index),
          start: index * 68
        })),
      getTotalSize: () => opts.value.count * 68,
      measureElement: () => {}
    }))
}))

const stubs = {
  UDropdownMenu: {
    name: 'UDropdownMenu',
    props: ['items'],
    template: `
      <div>
        <slot />
        <div data-testid="speed-menu">
          <button
            v-for="item in (items?.[0] ?? [])"
            :key="item.label"
            type="button"
            :data-checked="String(Boolean(item.checked))"
            @click="item.onSelect && item.onSelect()"
          >
            {{ item.label }}
          </button>
        </div>
      </div>
    `
  },
  UButton: {
    props: ['label', 'color', 'variant'],
    template: '<button type="button" :data-color="color">{{ label }}<slot /></button>'
  },
  UIcon: true,
  TransferItem: true
}

let wrapper: VueWrapper | null = null

describe('TransferQueue bandwidth speed limit selector', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.resetAllMocks()
    vi.mocked(invoke).mockResolvedValue(undefined)
  })

  afterEach(() => {
    wrapper?.unmount()
    wrapper = null
  })

  it('displays Unlimited by default and applies selected preset live via IPC', async () => {
    const settings = useSettingsStore()
    settings.loaded = true
    settings.bandwidthLimitKBps = null

    wrapper = mount(TransferQueue, { global: { stubs } })
    await flushPromises()

    expect(wrapper.text()).toContain('Speed: Unlimited')

    const fiveMbBtn = wrapper
      .findAll('[data-testid="speed-menu"] button')
      .find((b) => b.text() === '5 MB/s')
    expect(fiveMbBtn).toBeDefined()
    await fiveMbBtn!.trigger('click')
    await flushPromises()

    expect(invoke).toHaveBeenCalledWith(INVOKE_CHANNELS.settingsSetBandwidthLimit, 5120)
    expect(settings.bandwidthLimitKBps).toBe(5120)
    expect(wrapper.text()).toContain('Speed: 5 MB/s')

    const unlimitedBtn = wrapper
      .findAll('[data-testid="speed-menu"] button')
      .find((b) => b.text() === 'Unlimited')
    await unlimitedBtn!.trigger('click')
    await flushPromises()

    expect(invoke).toHaveBeenCalledWith(INVOKE_CHANNELS.settingsSetBandwidthLimit, null)
    expect(settings.bandwidthLimitKBps).toBeNull()
    expect(wrapper.text()).toContain('Speed: Unlimited')
  })

  it('shows a Custom entry when a non-preset bandwidth limit is active', async () => {
    const settings = useSettingsStore()
    settings.loaded = true
    settings.bandwidthLimitKBps = 750

    wrapper = mount(TransferQueue, { global: { stubs } })
    await flushPromises()

    expect(wrapper.text()).toContain('Speed: 750 KB/s')
    expect(wrapper.find('[data-testid="speed-menu"]').text()).toContain('Custom (750 KB/s)')
  })
})
