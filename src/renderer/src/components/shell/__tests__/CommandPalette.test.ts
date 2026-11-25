// @vitest-environment happy-dom
import { createPinia, setActivePinia } from 'pinia'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useCommandPalette } from '../../../composables/useCommandPalette'
import { registerPaneActions } from '../../../composables/usePaneActions'
import { useSessionsStore } from '../../../stores/sessions.store'
import { useUiStore } from '../../../stores/ui.store'
import CommandPalette from '../CommandPalette.vue'

vi.mock('../../../api', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../../api')>(),
  invoke: vi.fn(),
  onEvent: vi.fn(() => () => {})
}))

vi.mock('../../../composables/useNotify', () => ({
  useNotify: () => ({ success: vi.fn(), error: vi.fn(), prompt: vi.fn() })
}))

const stubs = {
  UModal: {
    props: ['open'],
    template: '<div v-if="open"><slot name="content" /></div>'
  },
  UInput: {
    props: ['modelValue'],
    template: '<input :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />'
  },
  UIcon: true
}

let wrapper: VueWrapper | null = null
let unregisterLocal: (() => void) | null = null

describe('CommandPalette selected file actions', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
    const { isOpen } = useCommandPalette()
    isOpen.value = true
  })

  afterEach(() => {
    unregisterLocal?.()
    unregisterLocal = null
    wrapper?.unmount()
    wrapper = null
  })

  it('omits Selected files actions when sessions.status !== "connected" and shows them when connected', async () => {
    const sessions = useSessionsStore()
    const ui = useUiStore()
    ui.activePane = 'local'

    let count = 1
    unregisterLocal = registerPaneActions('local', {
      selectedCount: () => count,
      rename: vi.fn(),
      remove: vi.fn(),
      transfer: vi.fn(),
      edit: vi.fn()
    })

    wrapper = mount(CommandPalette, { global: { stubs } })
    await flushPromises()

    expect(sessions.status).not.toBe('connected')
    expect(wrapper.text()).not.toContain('Selected files')
    expect(wrapper.text()).not.toContain('Delete 1 selected')
    expect(wrapper.text()).not.toContain('Upload 1 selected')

    sessions.activeTab.status = 'connected'
    await flushPromises()

    expect(wrapper.text()).toContain('Selected files')
    expect(wrapper.text()).toContain('Rename selected')
    expect(wrapper.text()).toContain('Edit selected')
    expect(wrapper.text()).toContain('Upload 1 selected')
    expect(wrapper.text()).toContain('Delete 1 selected')
  })
})
