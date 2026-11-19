// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import type { Site } from '@shared/contract'
import SiteRow from '../SiteRow.vue'

vi.mock('@nuxt/ui/components/Checkbox.vue', () => ({ default: { template: '<input type="checkbox" />' } }))

const site: Site = {
  id: 's1',
  name: 'Prod',
  host: 'h.example.com',
  port: 22,
  username: 'root',
  authMethod: 'agent',
  hasPassword: false,
  hasPassphrase: false,
  createdAt: '',
  updatedAt: ''
}

function mountRow(props: Record<string, unknown> = {}) {
  return mount(SiteRow, {
    props: {
      site,
      icon: 'i-lucide-server',
      selected: false,
      selectMode: false,
      checked: false,
      connected: false,
      connecting: false,
      active: false,
      busy: false,
      menuItems: [],
      ...props
    },
    global: { stubs: { UIcon: true, UButton: true, UDropdownMenu: true } }
  })
}

describe('SiteRow', () => {
  it('click selects without connecting', async () => {
    const w = mountRow()
    await w.get('[data-site-row]').trigger('click')
    expect(w.emitted('select')).toHaveLength(1)
    expect(w.emitted('connect')).toBeUndefined()
  })

  it('two rapid clicks select twice and never connect', async () => {
    const w = mountRow()
    await w.get('[data-site-row]').trigger('click')
    await w.get('[data-site-row]').trigger('click')
    expect(w.emitted('select')).toHaveLength(2)
    expect(w.emitted('connect')).toBeUndefined()
  })

  it('double-click (click, click, dblclick) connects exactly once', async () => {
    const w = mountRow()
    const btn = w.get('[data-site-row]')
    await btn.trigger('click')
    await btn.trigger('click')
    await btn.trigger('dblclick')
    expect(w.emitted('connect')).toHaveLength(1)
  })

  it('Enter connects once; Space (native click) only selects', async () => {
    const w = mountRow()
    const btn = w.get('[data-site-row]')
    await btn.trigger('keydown', { key: 'Enter' })
    expect(w.emitted('connect')).toHaveLength(1)
    await btn.trigger('click') // what the browser fires for Space
    expect(w.emitted('connect')).toHaveLength(1)
    expect(w.emitted('select')).toHaveLength(1)
  })

  it('select mode: click toggles, dblclick and Enter do nothing', async () => {
    const w = mountRow({ selectMode: true })
    const btn = w.get('[data-site-row]')
    await btn.trigger('click')
    await btn.trigger('dblclick')
    await btn.trigger('keydown', { key: 'Enter' })
    expect(w.emitted('toggle')).toEqual([[true]])
    expect(w.emitted('select')).toBeUndefined()
    expect(w.emitted('connect')).toBeUndefined()
  })

  it('selected row has aria-current and an sr-only hint', () => {
    const w = mountRow({ selected: true })
    const btn = w.get('[data-site-row]')
    expect(btn.attributes('aria-current')).toBe('true')
    const hintId = btn.attributes('aria-describedby')!
    expect(w.get(`#${hintId}`).text()).toContain('double-click')
    expect(mountRow().get('[data-site-row]').attributes('aria-current')).toBeUndefined()
  })

  it('shows a Connecting… badge', () => {
    expect(mountRow({ connecting: true }).text()).toContain('Connecting…')
  })

  it('exposes checkbox role in selectMode, sr-only environment label, and emits delete on Delete key', async () => {
    const wSelect = mountRow({ selectMode: true, checked: true })
    const btnSelect = wSelect.get('[data-site-row]')
    expect(btnSelect.attributes('role')).toBe('checkbox')
    expect(btnSelect.attributes('aria-checked')).toBe('true')

    const wEnv = mountRow({ site: { ...site, environment: 'prod' } })
    expect(wEnv.text()).toContain('Production')
    await wEnv.get('[data-site-row]').trigger('keydown', { key: 'Delete' })
    expect(wEnv.emitted('delete')).toHaveLength(1)
  })

  it('middle-click emits connectNewTab outside selectMode and ignores selectMode', async () => {
    const w = mountRow()
    const btn = w.get('[data-site-row]')
    const mousedown = new MouseEvent('mousedown', { button: 1, bubbles: true, cancelable: true })
    btn.element.dispatchEvent(mousedown)
    expect(mousedown.defaultPrevented).toBe(true)

    await btn.trigger('auxclick', { button: 1 })
    expect(w.emitted('connectNewTab')).toHaveLength(1)

    const wSelect = mountRow({ selectMode: true })
    await wSelect.get('[data-site-row]').trigger('auxclick', { button: 1 })
    expect(wSelect.emitted('connectNewTab')).toBeUndefined()
  })
})
