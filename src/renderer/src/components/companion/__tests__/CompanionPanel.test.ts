// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { useCompanionStore } from '../../../stores/companion.store'
import { useSessionsStore } from '../../../stores/sessions.store'

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
    emits: ['click'],
    template: '<button :disabled="disabled" @click="$emit(\'click\', $event)"><slot /></button>'
  },
  UTooltip: { template: '<span><slot /></span>' },
  USwitch: {
    props: ['modelValue'],
    template: '<input type="checkbox" :checked="modelValue" @change="$emit(\'update:modelValue\', $event.target.checked)" />'
  },
  Popover: { template: '<div><slot /><slot name="content" /></div>' },
  Teleport: true,
  UModal: {
    props: ['open', 'title'],
    emits: ['update:open'],
    template: '<div v-if="open" data-stub-modal :data-title="title"><slot name="body" /><slot name="footer" /></div>'
  }
}

describe('CompanionPanel', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
  })

  afterEach(() => {
    vi.useRealTimers()
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
    store.finishReveal()
    await nextTick()
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
    store.notifyTransferFailure('EACCES: permission denied')
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

  it('renders risk-badged Command Cards and manages custom snippets in the Snippets tab', async () => {
    const store = useCompanionStore()
    store.openPanel('chat')

    const wrapper = mount(CompanionPanel, { global: { stubs } })
    await store.ask('Command to check disk usage')
    store.finishReveal()
    await nextTick()

    expect(wrapper.find('[data-companion-command-cards]').exists()).toBe(true)
    expect(wrapper.text()).toContain('df -h')
    expect(wrapper.text()).toContain('Read-only')

    await wrapper.find('#companion-tab-snippets').trigger('click')
    await nextTick()
    expect(wrapper.find('[data-companion-snippets]').exists()).toBe(true)

    const newBtn = wrapper.find('[data-companion-snippets]').findAll('button').find((b) => b.text().trim() === 'New')!
    await newBtn.trigger('click')
    await nextTick()
    await wrapper.find('input[aria-label="Snippet label"]').setValue('Flush cache')
    await wrapper.find('input[aria-label="Snippet command"]').setValue('rm -rf /tmp/app-cache')
    expect(wrapper.text()).toContain('Destructive')
    await wrapper.find('[data-companion-snippets] form').trigger('submit')
    await nextTick()

    expect(store.customSnippets[0].label).toBe('Flush cache')
    expect(store.customSnippets[0].risk).toBe('destructive')
    wrapper.unmount()
  })

  it('renders the empty-state hero orb at 96px', () => {
    const s = useCompanionStore(); s.open = true
    const w = mount(CompanionPanel, { global: { stubs } })
    expect(w.find('[data-companion-hero] [data-companion-state]').attributes('style')).toContain('width: 96px')
  })

  it('reveals the reply progressively and shows cards only afterwards', async () => {
    vi.useFakeTimers()
    const s = useCompanionStore(); s.openPanel()
    const w = mount(CompanionPanel, { global: { stubs } })
    await s.deliverAiOrLocalReply({ errorPrefix: '', buildLocal: () => ({ text: 'one two three four five six seven', actions: [{ id: 'open-settings', label: 'Check AI Settings' }] }) })
    await nextTick()
    expect(w.find('[role="log"]').attributes('aria-busy')).toBe('true')
    expect(w.find('[role="log"] [aria-hidden="true"]').text()).not.toContain('seven')
    expect(w.text()).not.toContain('Check AI Settings')
    vi.advanceTimersByTime(2000); await nextTick()
    expect(w.find('[role="log"]').attributes('aria-busy')).toBe('false')
    expect(w.text()).toContain('one two three four five six seven')
    expect(w.text()).toContain('Check AI Settings')
  })

  it('announces the full reply to screen readers while revealing', async () => {
    vi.useFakeTimers()
    const s = useCompanionStore(); s.openPanel()
    const w = mount(CompanionPanel, { global: { stubs } })
    await s.deliverAiOrLocalReply({ errorPrefix: '', buildLocal: () => ({ text: 'one two three four five six seven' }) })
    await nextTick()
    expect(w.find('[role="log"] .sr-only').text()).toBe('one two three four five six seven')
    expect(w.find('[role="log"] [aria-hidden="true"]').exists()).toBe(true)
  })

  it('scrolls again as the reveal progresses and when it ends', async () => {
    vi.useFakeTimers()
    const s = useCompanionStore(); s.openPanel()
    const w = mount(CompanionPanel, { global: { stubs } })
    const log = w.find('[role="tabpanel"]').element as HTMLElement
    Object.defineProperty(log, 'scrollHeight', { value: 999, configurable: true })
    await s.deliverAiOrLocalReply({ errorPrefix: '', buildLocal: () => ({ text: 'one two three four five six seven' }) })
    await nextTick()
    log.scrollTop = 0
    vi.advanceTimersByTime(2000); await nextTick(); await nextTick()
    expect(log.scrollTop).toBe(999)
  })

  it('sets listening while the focused input has text', async () => {
    const s = useCompanionStore(); s.openPanel()
    const w = mount(CompanionPanel, { global: { stubs } })
    const input = w.find('input[aria-label="Ask Ferry Companion"]')
    await input.trigger('focus'); await input.setValue('hel')
    expect(s.listening).toBe(true)
    await input.trigger('blur')
    expect(s.listening).toBe(false)
  })

  it('completes the reveal when leaving the chat view', async () => {
    vi.useFakeTimers()
    const s = useCompanionStore(); s.openPanel()
    mount(CompanionPanel, { global: { stubs } })
    await s.deliverAiOrLocalReply({ errorPrefix: '', buildLocal: () => ({ text: 'one two three four five six seven' }) })
    s.activeView = 'snippets'; await nextTick()
    expect(s.reveal).toBeNull()
  })

  it('clears listening when the chat input goes away or the panel closes', async () => {
    const s = useCompanionStore(); s.openPanel()
    const w = mount(CompanionPanel, { global: { stubs } })
    const input = w.find('input[aria-label="Ask Ferry Companion"]')
    await input.trigger('focus'); await input.setValue('hel')
    expect(s.listening).toBe(true)
    s.activeView = 'snippets'; await nextTick()
    expect(s.listening).toBe(false)
    s.activeView = 'chat'; await nextTick()
    expect(s.listening).toBe(false)
    const input2 = w.find('input[aria-label="Ask Ferry Companion"]')
    await input2.trigger('focus')
    expect(s.listening).toBe(true)
    s.closePanel(); await nextTick()
    expect(s.listening).toBe(false)
  })

  it('does not close CompanionPanel when Escape is pressed inside .xterm', async () => {
    const s = useCompanionStore()
    s.openPanel('chat')
    const wrapper = mount(CompanionPanel, { global: { stubs }, attachTo: document.body })

    const xterm = document.createElement('div')
    xterm.className = 'xterm'
    const inner = document.createElement('textarea')
    xterm.appendChild(inner)
    document.body.appendChild(xterm)

    inner.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await nextTick()
    expect(s.open).toBe(true)

    xterm.remove()
    wrapper.unmount()
  })

  it('renders safe inline markdown (bold, code, bullet list) and escapes raw HTML', async () => {
    const s = useCompanionStore()
    s.openPanel('chat')
    s.messages.push({
      id: 'md-1',
      role: 'assistant',
      createdAt: new Date().toISOString(),
      text: 'Check **nginx** config in `/etc/nginx/nginx.conf`:\n- Run `nginx -t`\n- Ignore <script>alert(1)</script> and <img src=x onerror=alert(1)>'
    })

    const wrapper = mount(CompanionPanel, { global: { stubs } })
    const md = wrapper.find('[data-companion-md]')
    expect(md.exists()).toBe(true)
    expect(md.html()).toContain('<strong>nginx</strong>')
    expect(md.html()).toContain('<code')
    expect(md.html()).toContain('/etc/nginx/nginx.conf')
    expect(md.html()).toContain('<ul')
    expect(md.html()).toContain('<li>')
    expect(md.html()).not.toContain('<script>')
    expect(md.html()).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(md.find('img').exists()).toBe(false)
    // Persistent sr-only node stays present even when not revealing
    expect(wrapper.find('[role="log"] .sr-only').exists()).toBe(true)
    wrapper.unmount()
  })

  it('previews remotePath and pattern on UiActionCard chips', () => {
    const s = useCompanionStore()
    s.openPanel('chat')
    s.messages.push({
      id: 'ui-1',
      role: 'assistant',
      createdAt: new Date().toISOString(),
      text: 'Suggested actions:',
      uiActionCards: [
        { kind: 'tail-log', label: 'Tail Log', remotePath: '/var/log/nginx/error.log' },
        { kind: 'apply-filter', label: 'Filter Logs', mode: 'include', pattern: '*.log' }
      ]
    })

    const wrapper = mount(CompanionPanel, { global: { stubs } })
    const targets = wrapper.findAll('[data-ui-action-target]').map((n) => n.text())
    expect(targets).toContain('/var/log/nginx/error.log')
    expect(targets).toContain('include: *.log')
    wrapper.unmount()
  })

  it('keeps action feedback status visible in the Snippets tab and shows Insert button', async () => {
    const s = useCompanionStore()
    s.openPanel('snippets')
    const wrapper = mount(CompanionPanel, { global: { stubs } })

    expect(wrapper.find('[data-insert-command]').exists()).toBe(true)
    expect(wrapper.find('p[role="status"]').exists()).toBe(true)
    wrapper.unmount()
  })

  it('shows Stop button when aiBusy is true, calls cancelAiRequest, and elevates z-index above modals', async () => {
    const s = useCompanionStore()
    const cancelSpy = vi.spyOn(s, 'cancelAiRequest').mockResolvedValue()
    s.openPanel('chat')
    s.aiBusy = true
    const wrapper = mount(CompanionPanel, { global: { stubs } })

    expect(wrapper.find('[data-companion-panel]').classes()).toContain('z-[60]')
    expect(wrapper.find('[data-stop-ai]').exists()).toBe(true)
    expect(wrapper.find('[data-stop-ai-footer]').exists()).toBe(true)
    await wrapper.find('[data-stop-ai]').trigger('click')
    expect(cancelSpy).toHaveBeenCalledTimes(1)
    wrapper.unmount()
  })

  it('calls insertCommandInTerminal from Insert button and shows red Production banner in Run modal', async () => {
    const s = useCompanionStore()
    const sessions = useSessionsStore()
    const activeTab = sessions.activeTab
    activeTab.status = 'connected'
    activeTab.sessionId = 'sess-prod-1'
    activeTab.label = 'prod-web-01'

    const insertSpy = vi.spyOn(s, 'insertCommandInTerminal').mockResolvedValue('Inserted into Terminal.')
    const runSpy = vi.spyOn(s, 'runCommandCard').mockResolvedValue('Sent command to Terminal (prod-web-01).')
    vi.spyOn(s, 'isProd', 'get').mockReturnValue(true)
    vi.spyOn(s, 'prodSiteLabel', 'get').mockReturnValue('prod-web-01')

    s.openPanel('chat')
    s.messages.push({
      id: 'cmd-1',
      role: 'assistant',
      createdAt: new Date().toISOString(),
      text: 'Restart nginx:',
      commandCards: [{ command: 'systemctl restart nginx', description: 'Restart nginx', risk: 'mutating' }]
    })

    const wrapper = mount(CompanionPanel, { global: { stubs } })
    await wrapper.find('[data-insert-command]').trigger('click')
    expect(insertSpy).toHaveBeenCalledWith('systemctl restart nginx')

    await wrapper.find('[data-run-command]').trigger('click')
    await nextTick()
    expect(wrapper.find('[data-prod-warning-banner]').exists()).toBe(true)
    expect(wrapper.find('[data-prod-warning-banner]').text()).toContain('Production Environment')

    await wrapper.find('[data-confirm-run-command]').trigger('click')
    expect(runSpy).toHaveBeenCalledWith(
      { command: 'systemctl restart nginx', description: 'Restart nginx', risk: 'mutating' },
      { skipConfirm: true }
    )
    wrapper.unmount()
  })
})
