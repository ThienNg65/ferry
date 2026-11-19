// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import EditorDialog from './EditorDialog.vue'
import { invoke } from '../../api'
import { useConfirm } from '../../composables/useConfirm'

vi.mock('../../api', () => ({ invoke: vi.fn() }))
vi.mock('../../composables/useConfirm', () => ({ useConfirm: vi.fn() }))
vi.mock('../../composables/useNotify', () => ({
  useNotify: () => ({ success: vi.fn(), error: vi.fn() })
}))
vi.mock('../../stores/ui.store', () => ({
  useUiStore: () => ({ theme: 'light' })
}))
vi.mock('vue-codemirror', () => ({
  Codemirror: defineComponent({
    props: ['modelValue'],
    emits: ['update:modelValue'],
    setup(props, { emit }) {
      return () => h('textarea', {
        value: props.modelValue,
        onInput: (event: Event) => emit('update:modelValue', (event.target as HTMLTextAreaElement).value)
      })
    }
  })
}))

const Modal = defineComponent({
  emits: ['update:open'],
  setup(_, { slots, emit }) {
    return () => h('div', [
      h('button', { 'data-test': 'close', onClick: () => emit('update:open', false) }, 'Close'),
      slots.actions?.(),
      slots.body?.()
    ])
  }
})
const Badge = defineComponent({
  setup(_, { slots }) { return () => h('span', slots.default?.()) }
})
const Button = defineComponent({
  props: ['disabled'],
  emits: ['click'],
  setup(props, { slots, emit }) {
    return () => h('button', { disabled: props.disabled, onClick: () => emit('click') }, slots.default?.())
  }
})

const confirmDiscard = vi.fn()

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

async function openEditor() {
  const wrapper = mount(EditorDialog, {
    props: { open: true, editId: 'edit-1', localTempPath: '/tmp/file.txt', remotePath: '/file.txt' },
    global: {
      stubs: { UModal: Modal, UButton: Button, UBadge: Badge, USkeleton: true }
    }
  })
  await vi.waitFor(() => expect(wrapper.find('textarea').exists()).toBe(true))
  return wrapper
}

describe('EditorDialog asynchronous save', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    confirmDiscard.mockReset().mockResolvedValue(false)
    vi.mocked(useConfirm).mockReturnValue(confirmDiscard as ReturnType<typeof useConfirm>)
    vi.mocked(invoke).mockResolvedValue({ content: 'original', truncated: false })
  })

  it('keeps edits typed during a pending save unsaved and prompts on close', async () => {
    const write = deferred<void>()
    vi.mocked(invoke).mockImplementation(async (channel) => {
      if (channel === 'fs:local:readFile') return { content: 'original', truncated: false } as never
      return write.promise as never
    })
    const wrapper = await openEditor()
    await wrapper.find('textarea').setValue('first edit')
    await wrapper.findAll('button').find((button) => button.text().includes('Save'))!.trigger('click')
    await nextTick()
    expect(invoke).toHaveBeenCalledWith('fs:local:writeFile', {
      path: '/tmp/file.txt', content: 'first edit'
    })
    await wrapper.find('textarea').setValue('second edit')
    write.resolve()
    await vi.waitFor(() => expect(wrapper.text()).toContain('Unsaved'))
    const save = wrapper.findAll('button').find((button) => button.text().includes('Save'))!
    expect(save.attributes('disabled')).toBeUndefined()
    // A close attempt must ask whether to discard the second edit.
    await wrapper.find('[data-test="close"]').trigger('click')
    await nextTick()
    expect(confirmDiscard).toHaveBeenCalled()
    expect(wrapper.emitted('update:open')).toBeUndefined()
    expect(wrapper.text()).toContain('Unsaved')
    wrapper.unmount()
  })

  it('does not discard edits typed while confirmation is pending', async () => {
    const decision = deferred<boolean>()
    confirmDiscard.mockReturnValue(decision.promise)
    const wrapper = await openEditor()
    await wrapper.find('textarea').setValue('first draft')
    await wrapper.find('[data-test="close"]').trigger('click')
    expect(confirmDiscard).toHaveBeenCalledTimes(1)

    await wrapper.find('textarea').setValue('new text during confirmation')
    decision.resolve(true)
    await vi.waitFor(() => expect(wrapper.text()).toContain('Unsaved'))
    await nextTick()
    expect(wrapper.emitted('update:open')).toBeUndefined()
    expect(wrapper.find('textarea').element.value).toBe('new text during confirmation')
    wrapper.unmount()
  })

  it('does not close while a write is in flight', async () => {
    const write = deferred<void>()
    vi.mocked(invoke).mockImplementation(async (channel) => {
      if (channel === 'fs:local:readFile') return { content: 'original', truncated: false } as never
      return write.promise as never
    })
    const wrapper = await openEditor()
    await wrapper.find('textarea').setValue('first edit')
    await wrapper.findAll('button').find((button) => button.text().includes('Save'))!.trigger('click')
    await nextTick()
    await wrapper.find('[data-test="close"]').trigger('click')
    await nextTick()
    expect(wrapper.emitted('update:open')).toBeUndefined()
    expect(confirmDiscard).not.toHaveBeenCalled()
    write.resolve()
    await vi.waitFor(() => expect(wrapper.text()).not.toContain('Unsaved'))
    wrapper.unmount()
  })
})
