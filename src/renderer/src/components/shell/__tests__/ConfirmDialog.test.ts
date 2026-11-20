// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { nextTick } from 'vue'
import ConfirmDialog from '../ConfirmDialog.vue'

const stubs = {
  UModal: {
    props: ['open', 'title', 'dismissible', 'close'],
    emits: ['enter', 'update:open'],
    template: '<div role="dialog"><slot name="body" /><slot name="footer" /></div>'
  },
  UAlert: {
    props: ['title'],
    template: '<div role="alert">{{ title }}</div>'
  },
  UButton: {
    props: ['color', 'variant', 'loading', 'disabled', 'autofocus'],
    emits: ['click'],
    template:
      '<button type="button" :disabled="disabled || loading" @click="$emit(\'click\', $event)"><slot /></button>'
  }
}

describe('ConfirmDialog', () => {
  const wrappers: VueWrapper[] = []
  let now = 10_000

  function trackMount<T extends VueWrapper>(wrapper: T): T {
    wrappers.push(wrapper)
    return wrapper
  }

  beforeEach(() => {
    now = 10_000
    vi.spyOn(performance, 'now').mockImplementation(() => now)
  })

  afterEach(() => {
    while (wrappers.length > 0) {
      wrappers.pop()?.unmount()
    }
    vi.restoreAllMocks()
  })

  it('ignores pointer clicks within 280ms of mount when destructive is true, then confirms after 280ms', async () => {
    const action = vi.fn(async () => undefined)
    const w = trackMount(
      mount(ConfirmDialog, {
        props: {
          title: 'Delete',
          confirmLabel: 'Delete',
          destructive: true,
          action
        },
        global: { stubs }
      })
    )

    const confirmBtn = w.findAll('button').find((b) => b.text() === 'Delete')!
    confirmBtn.element.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }))
    await nextTick()
    expect(action).not.toHaveBeenCalled()
    expect(w.emitted('close')).toBeUndefined()

    now += 280
    confirmBtn.element.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }))
    await nextTick()
    expect(action).toHaveBeenCalledOnce()
    expect(w.emitted('close')).toEqual([[true]])
  })

  it('re-arms the 280ms destructive pointer guard when UModal emits enter', async () => {
    const action = vi.fn(async () => undefined)
    const w = trackMount(
      mount(ConfirmDialog, {
        props: {
          title: 'Delete',
          confirmLabel: 'Delete',
          destructive: true,
          action
        },
        global: { stubs }
      })
    )

    // Advance well past initial mount, then simulate modal entering later
    now += 1_000
    w.findComponent(stubs.UModal).vm.$emit('enter')
    await nextTick()

    const confirmBtn = w.findAll('button').find((b) => b.text() === 'Delete')!
    now += 100
    confirmBtn.element.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }))
    await nextTick()
    expect(action).not.toHaveBeenCalled()

    now += 200
    confirmBtn.element.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }))
    await nextTick()
    expect(action).toHaveBeenCalledOnce()
  })

  it('allows immediate keyboard activation (detail === 0) on destructive confirmations', async () => {
    const action = vi.fn(async () => undefined)
    const w = trackMount(
      mount(ConfirmDialog, {
        props: {
          title: 'Delete',
          confirmLabel: 'Delete',
          destructive: true,
          action
        },
        global: { stubs }
      })
    )

    const confirmBtn = w.findAll('button').find((b) => b.text() === 'Delete')!
    confirmBtn.element.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 }))
    await nextTick()
    expect(action).toHaveBeenCalledOnce()
    expect(w.emitted('close')).toEqual([[true]])
  })

  it('executes non-destructive confirmations immediately, omits aria-busy when idle, and resets aria-busy after completion', async () => {
    let resolveAction!: () => void
    const action = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveAction = resolve
        })
    )
    const w = trackMount(
      mount(ConfirmDialog, {
        props: {
          title: 'Proceed',
          confirmLabel: 'Confirm',
          destructive: false,
          action
        },
        global: { stubs }
      })
    )

    const confirmBtn = w.findAll('button').find((b) => b.text() === 'Confirm')!
    expect(confirmBtn.attributes('aria-busy')).toBeUndefined()
    expect(confirmBtn.attributes('aria-disabled')).toBeUndefined()

    confirmBtn.element.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }))
    await nextTick()

    expect(action).toHaveBeenCalledOnce()
    expect(confirmBtn.attributes('aria-busy')).toBe('true')
    expect(confirmBtn.attributes('aria-disabled')).toBe('true')

    resolveAction()
    await nextTick()
    await nextTick()
    expect(confirmBtn.attributes('aria-busy')).toBeUndefined()
    expect(confirmBtn.attributes('aria-disabled')).toBeUndefined()
    expect(w.emitted('close')).toEqual([[true]])
  })
})
