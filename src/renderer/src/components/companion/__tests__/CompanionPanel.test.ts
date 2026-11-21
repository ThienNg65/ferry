// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { useCompanionStore } from '../../../stores/companion.store'

vi.mock('@nuxt/ui/components/Popover.vue', () => ({
  default: { template: '<div><slot /><slot name="content" /></div>' }
}))
vi.mock('@nuxt/ui/components/Switch.vue', () => ({
  default: {
    props: ['modelValue'],
    template: '<input type="checkbox" :checked="modelValue" @change="$emit(\'update:modelValue\', $event.target.checked)" />'
  }
}))

import CompanionPanel from '../CompanionPanel.vue'

const stubs = {
  UIcon: { template: '<span />' },
  UButton: {
    props: ['disabled', 'loading'],
    template: '<button :disabled="disabled" @click="$emit(\'click\', $event)"><slot /></button>'
  },
  UTooltip: { template: '<span><slot /></span>' },
  USwitch: {
    props: ['modelValue'],
    template: '<input type="checkbox" :checked="modelValue" @change="$emit(\'update:modelValue\', $event.target.checked)" />'
  },
  Popover: { template: '<div><slot /><slot name="content" /></div>' }
}

describe('CompanionPanel', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
  })

  it('renders empty state, answers a query, and toggles local-only response feedback', async () => {
    const store = useCompanionStore()
    store.openPanel('chat')

    const wrapper = mount(CompanionPanel, { global: { stubs } })
    expect(wrapper.text()).toContain("Hi! I'm your Ferry Companion.")

    const input = wrapper.find('input[aria-label="Ask Ferry Companion"]')
    await input.setValue('How do I use file filters?')
    await wrapper.find('form').trigger('submit')
    await nextTick()

    expect(store.messages.length).toBe(2)
    expect(wrapper.text()).toContain('File Visibility Filters')

    const helpfulBtn = wrapper.find('button[aria-label="Mark reply helpful"]')
    await helpfulBtn.trigger('click')
    expect(store.messages[1].feedback).toBe('helpful')
    wrapper.unmount()
  })

  it('steps through the guided multi-step tour and closes on Escape', async () => {
    const store = useCompanionStore()
    store.openPanel('chat')
    store.startTour()

    const wrapper = mount(CompanionPanel, { global: { stubs }, attachTo: document.body })
    expect(wrapper.find('[data-companion-tour]').exists()).toBe(true)
    expect(wrapper.text()).toContain('Step 1 of 4')

    store.nextTourStep()
    await nextTick()
    expect(wrapper.text()).toContain('Step 2 of 4')

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await nextTick()
    expect(store.open).toBe(false)
    wrapper.unmount()
  })

  it('surfaces contextual transfer-error starter and supports clearing conversation', async () => {
    const store = useCompanionStore()
    store.lastTransferError = 'EACCES: permission denied'
    store.openPanel('chat')

    const wrapper = mount(CompanionPanel, { global: { stubs } })
    expect(wrapper.text()).toContain('Investigate failed transfer')

    await store.ask('How do I use file filters?')
    await nextTick()
    expect(store.messages.length).toBe(2)

    const clearBtn = wrapper.find('button[aria-label="Clear conversation"]')
    expect(clearBtn.exists()).toBe(true)
    await clearBtn.trigger('click')
    expect(store.messages.length).toBe(0)
    wrapper.unmount()
  })
})
