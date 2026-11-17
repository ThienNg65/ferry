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
    props: { site, connected: false, connecting: false, ...props },
    global: { stubs }
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

  it('Connect is disabled while connecting', () => {
    expect(findBtn(mountPanel({ connecting: true }), 'Connect').attributes('disabled')).toBeDefined()
  })

  it('Edit and Quick Connect emit edit / close', async () => {
    const w = mountPanel()
    await findBtn(w, 'Edit').trigger('click')
    await findBtn(w, 'Quick Connect').trigger('click')
    expect(w.emitted('edit')).toHaveLength(1)
    expect(w.emitted('close')).toHaveLength(1)
  })
})
