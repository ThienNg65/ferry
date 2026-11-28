// @vitest-environment happy-dom
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import TerminalCommandBar from '../TerminalCommandBar.vue'
import { useCompanionStore } from '../../../stores/companion.store'
import { useSessionsStore } from '../../../stores/sessions.store'
import { useTerminalStreamsStore } from '../../../stores/terminalStreams.store'

const stubs = {
  UIcon: true,
  UButton: {
    props: ['disabled', 'loading'],
    template: '<button :disabled="disabled" @click="$emit(\'click\', $event)"><slot /></button>'
  }
}

describe('TerminalCommandBar', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('disables Insert and Run when the active terminal is in alternate screen (vim/htop)', async () => {
    const sessions = useSessionsStore()
    sessions.tabs[0].sessionId = 'sess-1'
    sessions.tabs[0].status = 'connected'

    const terminalStreams = useTerminalStreamsStore()
    terminalStreams.setAlternateScreen('sess-1', true)

    const companion = useCompanionStore()
    vi.spyOn(companion, 'requestQuickCommand').mockResolvedValue({
      card: { command: 'df -h', description: 'Check disk', risk: 'read_only' },
      message: null
    })

    const wrapper = mount(TerminalCommandBar, {
      props: { open: true },
      global: { stubs }
    })

    expect(wrapper.find('[data-alt-screen-guard]').exists()).toBe(true)
    await wrapper.find('input').setValue('check disk')
    await wrapper.find('input').trigger('keydown', { key: 'Enter' })
    await Promise.resolve()
    await wrapper.vm.$nextTick()

    expect(wrapper.find('[data-quick-insert]').attributes('disabled')).toBeDefined()
    expect(wrapper.find('[data-quick-run]').attributes('disabled')).toBeDefined()
    wrapper.unmount()
  })

  it('generates a command card and inserts without \\r on normal screen', async () => {
    const sessions = useSessionsStore()
    sessions.tabs[0].sessionId = 'sess-1'
    sessions.tabs[0].status = 'connected'

    const companion = useCompanionStore()
    vi.spyOn(companion, 'requestQuickCommand').mockResolvedValue({
      card: { command: 'df -h', description: 'Check disk', risk: 'read_only' },
      message: null
    })
    const insertSpy = vi.spyOn(companion, 'insertCommandInTerminal').mockResolvedValue('Inserted')

    const wrapper = mount(TerminalCommandBar, {
      props: { open: true },
      global: { stubs }
    })

    expect(wrapper.find('[data-alt-screen-guard]').exists()).toBe(false)
    await wrapper.find('input').setValue('check disk')
    await wrapper.find('input').trigger('keydown', { key: 'Enter' })
    await Promise.resolve()
    await wrapper.vm.$nextTick()

    await wrapper.find('[data-quick-insert]').trigger('click')
    expect(insertSpy).toHaveBeenCalledWith('df -h')
    expect(wrapper.emitted('close')).toBeTruthy()
    wrapper.unmount()
  })
})
