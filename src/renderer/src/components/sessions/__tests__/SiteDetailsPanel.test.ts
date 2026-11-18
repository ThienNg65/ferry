// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import type { Site } from '@shared/contract'
import SiteDetailsPanel from '../SiteDetailsPanel.vue'

const site: Site = {
  id: 's1',
  name: 'Prod',
  host: 'h.example.com',
  port: 2222,
  username: 'root',
  authMethod: 'privateKey',
  group: 'Work',
  hasPassword: false,
  hasPassphrase: false,
  createdAt: '',
  updatedAt: ''
}

// Minimal UCard/UButton stand-ins so clicks, disabled and slots behave like the real ones.
const stubs = {
  UCard: { template: '<div><slot name="header" /><slot /><slot name="footer" /></div>' },
  UButton: {
    props: ['label', 'disabled'],
    template: '<button :disabled="disabled"><slot>{{ label }}</slot></button>'
  }
}

function mountPanel(props: Record<string, unknown> = {}) {
  return mount(SiteDetailsPanel, {
    props: { site, icon: 'i-lucide-key-round', connected: false, connecting: false, busy: false, ...props },
    global: { stubs: { ...stubs, UIcon: true, UTooltip: { template: '<div><slot /></div>' } } }
  })
}

const findBtn = (w: ReturnType<typeof mountPanel>, text: string) =>
  w.findAll('button').find((b) => b.text() === text)!

describe('SiteDetailsPanel', () => {
  it('renders host, auth and group', () => {
    const t = mountPanel().text()
    expect(t).toContain('root@h.example.com:2222')
    expect(t).toContain('Private key')
    expect(t).toContain('Work')
  })

  it('Connect emits connect once', async () => {
    const w = mountPanel()
    await findBtn(w, 'Connect').trigger('click')
    expect(w.emitted('connect')).toHaveLength(1)
  })

  it('reads "Switch to tab" when connected', () => {
    expect(findBtn(mountPanel({ connected: true }), 'Switch to tab')).toBeTruthy()
  })

  it('Connect is disabled while any connection is opening', () => {
    expect(findBtn(mountPanel({ busy: true }), 'Connect').attributes('disabled')).toBeDefined()
  })

  it('Edit and the close button emit edit / close', async () => {
    const w = mountPanel()
    await findBtn(w, 'Edit').trigger('click')
    await w.get('[aria-label="Back to Quick Connect"]').trigger('click')
    expect(w.emitted('edit')).toHaveLength(1)
    expect(w.emitted('close')).toHaveLength(1)
  })

  it('shows credential status and emits disconnect / duplicate / delete', async () => {
    const w = mountPanel({ connected: true })
    expect(w.text()).toContain('Not set')
    await findBtn(w, 'Disconnect').trigger('click')
    await w.get('[aria-label="Duplicate site"]').trigger('click')
    await w.get('[aria-label="Delete site"]').trigger('click')
    expect(w.emitted('disconnect')).toHaveLength(1)
    expect(w.emitted('duplicate')).toHaveLength(1)
    expect(w.emitted('delete')).toHaveLength(1)
  })
})
