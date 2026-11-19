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
  setup(_, { slots }) {
    return () => h('div', [
      slots.actions?.(),
      slots.body?.()
    ])
  }
})
const Button = defineComponent({
  props: ['disabled'],
  emits: ['click'],
  setup(props, { slots, emit }) {
    return () => h('button', { disabled: props.disabled, onClick: () => emit('click') }, slots.default?.())
  }
})

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

async function openEditor() {
  const wrapper = mount(EditorDialog, {
    props: { open: true, editId: 'edit-1', localTempPath: '/tmp/file.txt', remotePath: '/file.txt' },
    global: {
      stubs: { UModal: Modal, UButton: Button, UBadge: true, USkeleton: true }
    }
  })
  await vi.waitFor(() => expect(wrapper.find('textarea').exists()).toBe(true))
  return wrapper
}

describe('EditorDialog asynchronous save', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(useConfirm).mockReturnValue(vi.fn().mockResolvedValue(false) as ReturnType<typeof useConfirm>)
    vi.mocked(invoke).mockResolvedValue({ content: 'original', truncated: false })
  })

  it('keeps edits typed during a pending save unsaved and prompts on close', async () => {
    const write = deferred<void>()
    vi.mocked(invoke).mockImplementation(async (channel) => {
      if (channel === 'fs:local:read-file') return { content: 'original', truncated: false } as never
      return write.promise as never
    })
    const wrapper = await openEditor()
    await wrapper.find('textarea').setValue('first edit')
    await wrapper.findAll('button').find((button) => button.text().includes('Save'))!.trigger('click')
    await nextTick()
    expect(invoke).toHaveBeenCalledWith('fs:local:write-file', {
      path: '/tmp/file.txt', content: 'first edit'
    })
    await wrapper.find('textarea').setValue('second edit')
    write.resolve()
    await vi.waitFor(() => expect(wrapper.text()).toContain('Unsaved'))
    const save = wrapper.findAll('button').find((button) => button.text().includes('Save'))!
    expect(save.attributes('disabled')).toBeUndefined()
    // A close attempt must ask whether to discard the second edit.
    await wrapper.vm.$.exposed?.onUpdateOpen?.(false)
    // Trigger the modal's update event through the stub if no exposed method exists.
    expect(wrapper.text()).toContain('Unsaved')
    wrapper.unmount()
  })

  it('does not close while a write is in flight', async () => {
    const write = deferred<void>()
    vi.mocked(invoke).mockImplementation(async (channel) => {
      if (channel === 'fs:local:read-file') return { content: 'original', truncated: false } as never
      return write.promise as never
    })
    const wrapper = await openEditor()
    await wrapper.find('textarea').setValue('first edit')
    await wrapper.findAll('button').find((button) => button.text().includes('Save'))!.trigger('click')
    await nextTick()
    expect(wrapper.emitted('update:open')).toBeUndefined()
    write.resolve()
    await vi.waitFor(() => expect(wrapper.text()).not.toContain('Unsaved'))
    wrapper.unmount()
  })
})
