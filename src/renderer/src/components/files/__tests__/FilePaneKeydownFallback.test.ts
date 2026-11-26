// @vitest-environment happy-dom
import { createPinia, setActivePinia } from 'pinia'
import { flushPromises, shallowMount, type VueWrapper } from '@vue/test-utils'
import { INVOKE_CHANNELS, type FileEntry } from '@shared/contract'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { invoke } from '../../../api'
import type { ConfirmOptions } from '../../../composables/useConfirm'
import { useBookmarksStore } from '../../../stores/bookmarks.store'
import { useLocalFsStore } from '../../../stores/localFs.store'
import { useSessionsStore } from '../../../stores/sessions.store'
import { useUiStore } from '../../../stores/ui.store'
import FilePane from '../FilePane.vue'

const confirm = vi.hoisted(() => vi.fn<(options: ConfirmOptions) => Promise<boolean>>())
vi.mock('../../../composables/useConfirm', () => ({ useConfirm: () => confirm }))
vi.mock('../../../composables/useNotify', () => ({
  useNotify: () => ({ success: vi.fn(), error: vi.fn(), prompt: vi.fn() })
}))
vi.mock('../../../api', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../../api')>(),
  invoke: vi.fn(),
  onEvent: vi.fn(() => () => {})
}))
vi.mock('../FileList.vue', () => ({ default: { name: 'FileList', props: ['renamingPath'], template: '<div />' } }))
vi.mock('../FileToolbar.vue', () => ({ default: { template: '<div />' } }))
vi.mock('../PathBreadcrumb.vue', () => ({ default: { template: '<div />' } }))
vi.mock('@nuxt/ui/components/Checkbox.vue', () => ({
  default: {
    props: ['modelValue', 'label'],
    template: '<input type="checkbox" :aria-label="label" :checked="modelValue" @change="$emit(\'update:modelValue\', $event.target.checked)">'
  }
}))

const stubs = {
  UModal: true,
  UButton: true,
  UFormField: true,
  UInput: true,
  URadioGroup: true,
  UAlert: true,
  UBadge: true,
  UTooltip: true,
  UIcon: true,
  USkeleton: true
}

let wrapper: VueWrapper | undefined

beforeEach(() => {
  setActivePinia(createPinia())
  const bookmarks = useBookmarksStore()
  bookmarks.bookmarks = []
  bookmarks.loaded = true
  vi.resetAllMocks()
  vi.mocked(invoke).mockResolvedValue(undefined)
  vi.stubGlobal('useToast', () => ({ add: vi.fn() }))
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = undefined
  vi.unstubAllGlobals()
})

describe('window keydown fallback visibility guard', () => {
  it('ignores file-pane shortcuts for picker, disconnected, and errored sessions', async () => {
    const sessions = useSessionsStore()
    const localFs = useLocalFsStore()
    const ui = useUiStore()
    const entry: FileEntry = {
      name: 'notes.txt',
      path: '/local/notes.txt',
      isDir: false,
      isSymlink: false,
      size: 12,
      modifiedAt: null
    }
    vi.mocked(invoke).mockResolvedValue({ path: '/local', entries: [entry] } as never)
    confirm.mockResolvedValue(false)

    ui.activePane = 'local'
    wrapper = shallowMount(FilePane, { props: { side: 'local' }, global: { stubs } })
    await vi.dynamicImportSettled()
    await flushPromises()
    localFs.entries = [entry]
    localFs.selected = new Set([entry.path])

    const goUp = vi.spyOn(localFs, 'goUp').mockResolvedValue()
    const selectAll = vi.spyOn(localFs, 'selectAll')
    const fileList = wrapper.findComponent({ name: 'FileList' })
    const dispatchKeydown = (key: string, options: KeyboardEventInit = {}) => {
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...options }))
    }

    for (const status of [null, 'disconnected', 'error'] as const) {
      sessions.activeTab.status = status
      dispatchKeydown('Delete')
      dispatchKeydown('Backspace')
      dispatchKeydown('a', { ctrlKey: true })
      dispatchKeydown('F2')
      await flushPromises()

      expect(confirm).not.toHaveBeenCalled()
      expect(goUp).not.toHaveBeenCalled()
      expect(selectAll).not.toHaveBeenCalled()
      expect(fileList.props('renamingPath')).toBeNull()
    }

    sessions.activeTab.status = 'connected'
    dispatchKeydown('Delete')
    await flushPromises()
    expect(confirm).toHaveBeenCalledTimes(1)

    dispatchKeydown('Backspace')
    await flushPromises()
    expect(goUp).toHaveBeenCalledTimes(1)

    dispatchKeydown('a', { ctrlKey: true })
    await flushPromises()
    expect(selectAll).toHaveBeenCalledTimes(1)

    dispatchKeydown('F2')
    await flushPromises()
    expect(fileList.props('renamingPath')).toBe(entry.path)
  })
})
