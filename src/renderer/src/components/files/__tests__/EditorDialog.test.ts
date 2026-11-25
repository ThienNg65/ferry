// @vitest-environment happy-dom
import { createPinia, setActivePinia } from 'pinia'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { MAX_TEXT_EDITOR_BYTES, INVOKE_CHANNELS, type FileReadResult } from '@shared/contract'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { invoke } from '../../../api'
import EditorDialog from '../EditorDialog.vue'

const confirm = vi.hoisted(() => vi.fn())
const notifyError = vi.hoisted(() => vi.fn())
const notifySuccess = vi.hoisted(() => vi.fn())

vi.mock('../../../composables/useConfirm', () => ({ useConfirm: () => confirm }))
vi.mock('../../../composables/useNotify', () => ({
  useNotify: () => ({ success: notifySuccess, error: notifyError, prompt: vi.fn() })
}))
vi.mock('../../../api', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../../api')>(),
  invoke: vi.fn()
}))
vi.mock('vue-codemirror', () => ({
  Codemirror: {
    name: 'Codemirror',
    props: ['modelValue'],
    template: '<div data-editor-content-length>{{ (modelValue ?? \'\').length }}</div>'
  }
}))

const stubs = {
  UModal: {
    props: ['open'],
    emits: ['update:open'],
    template: '<section v-if="open"><slot name="actions" /><slot name="body" /></section>'
  },
  UButton: {
    props: ['disabled', 'loading'],
    template: '<button :disabled="disabled || loading" v-bind="$attrs"><slot /></button>'
  },
  UBadge: { template: '<span><slot /></span>' },
  USkeleton: true
}

let wrapper: VueWrapper | undefined

beforeEach(() => {
  setActivePinia(createPinia())
  vi.resetAllMocks()
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = undefined
})

describe('EditorDialog file-size handling', () => {
  it.each([
    { kind: 'local', editId: null, remotePath: null },
    { kind: 'remote', editId: 'edit-1', remotePath: '/remote/sample.txt' }
  ])('loads two-megabyte $kind files without external-editor fallback', async ({ editId, remotePath }) => {
    const localTempPath = '/tmp/sample.txt'
    const content = 'x'.repeat(2 * 1024 * 1024)
    const result: FileReadResult = { path: localTempPath, content, truncated: false, size: content.length }
    vi.mocked(invoke).mockResolvedValueOnce(result)

    wrapper = mount(EditorDialog, {
      props: { open: true, editId, localTempPath, remotePath },
      global: { stubs }
    })
    await flushPromises()

    expect(invoke).toHaveBeenCalledWith(INVOKE_CHANNELS.fsLocalReadFile, localTempPath, MAX_TEXT_EDITOR_BYTES)
    expect(wrapper.get('[data-editor-content-length]').text()).toBe(String(content.length))
    expect(invoke).not.toHaveBeenCalledWith(INVOKE_CHANNELS.editOpenLocal, localTempPath)
    if (editId) {
      expect(invoke).not.toHaveBeenCalledWith(INVOKE_CHANNELS.editOpenExternal, { editId })
    }
    expect(notifyError).not.toHaveBeenCalled()
  })

  it('opens the external editor when the requested editor read is truncated', async () => {
    const localTempPath = '/tmp/oversized.txt'
    const result: FileReadResult = {
      path: localTempPath,
      content: 'partial content',
      truncated: true,
      size: MAX_TEXT_EDITOR_BYTES + 1
    }
    vi.mocked(invoke).mockResolvedValueOnce(result).mockResolvedValueOnce(undefined)

    wrapper = mount(EditorDialog, {
      props: { open: true, editId: null, localTempPath, remotePath: null },
      global: { stubs }
    })
    await flushPromises()

    expect(notifyError).toHaveBeenCalledWith('File too large', expect.any(String))
    expect(invoke).toHaveBeenNthCalledWith(2, INVOKE_CHANNELS.editOpenLocal, localTempPath)
    expect(wrapper.emitted('update:open')).toEqual([[false]])
  })
})
