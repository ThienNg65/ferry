// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, nextTick } from 'vue'
import CompanionAvatar from '../CompanionAvatar.vue'

describe('CompanionAvatar', () => {
  beforeEach(() => {
    // happy-dom reports no focus by default; the gate needs a focused window.
    vi.spyOn(document, 'hasFocus').mockReturnValue(true)
  })

  it.each(['idle', 'listening', 'thinking', 'streaming', 'error'] as const)('renders data-companion-state=%s', (state) => {
    const w = mount(CompanionAvatar, { props: { state, size: 20 } })
    expect(w.attributes('data-companion-state')).toBe(state)
    expect(w.attributes('aria-hidden')).toBe('true')
  })

  it('renders no SVG filters at 16px and filters at 20px and 96px', () => {
    expect(mount(CompanionAvatar, { props: { size: 16 } }).findAll('filter')).toHaveLength(0)
    expect(mount(CompanionAvatar, { props: { size: 20 } }).findAll('filter').length).toBeGreaterThan(0)
    expect(mount(CompanionAvatar, { props: { size: 96 } }).findAll('filter').length).toBeGreaterThan(0)
  })

  it('draws the prod rim arc and the noticing dot only when asked', () => {
    const plain = mount(CompanionAvatar, { props: { size: 20 } })
    expect(plain.find('[data-orb-prod]').exists()).toBe(false)
    expect(plain.find('[data-orb-notice]').exists()).toBe(false)
    const both = mount(CompanionAvatar, { props: { size: 16, prod: true, noticing: true } })
    expect(both.find('[data-orb-prod]').exists()).toBe(true)
    expect(both.find('[data-orb-notice]').exists()).toBe(true)
  })

  it('gives each instance unique defs ids', () => {
    // useId() is unique per app, so both instances must share one app (as in Ferry).
    const host = defineComponent({
      components: { CompanionAvatar },
      template: '<div><CompanionAvatar :size="96" /><CompanionAvatar :size="96" /></div>'
    })
    const ids = mount(host).findAll('[id]').map((n) => n.attributes('id'))
    expect(ids.length).toBeGreaterThan(0)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('is static at rest and animates while thinking or live', async () => {
    expect(mount(CompanionAvatar, { props: { state: 'idle' } }).attributes('data-animate')).toBe('false')
    expect(mount(CompanionAvatar, { props: { state: 'thinking' } }).attributes('data-animate')).toBe('true')
    expect(mount(CompanionAvatar, { props: { state: 'idle', live: true } }).attributes('data-animate')).toBe('true')
  })

  it('stops animating when the window loses focus', async () => {
    const w = mount(CompanionAvatar, { props: { state: 'thinking' } })
    window.dispatchEvent(new Event('blur'))
    await nextTick()
    expect(w.attributes('data-animate')).toBe('false')
    window.dispatchEvent(new Event('focus'))
    await nextTick()
    expect(w.attributes('data-animate')).toBe('true')
  })

  it('lifts once per chunk change', async () => {
    const w = mount(CompanionAvatar, { props: { state: 'streaming', size: 96, chunk: 1 } })
    await w.setProps({ chunk: 2 })
    expect(w.find('[data-orb-lift]').classes()).toContain('is-lifting')
  })
})
