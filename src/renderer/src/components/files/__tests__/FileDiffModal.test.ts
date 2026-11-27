// @vitest-environment happy-dom
import { createPinia, setActivePinia } from 'pinia'
import { flushPromises, mount, shallowMount, type VueWrapper } from '@vue/test-utils'
import { INVOKE_CHANNELS, type FileDiffResult, type FileEntry, type SyncPlan } from '@shared/contract'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { invoke } from '../../../api'
import { useBookmarksStore } from '../../../stores/bookmarks.store'
import { useEditSessionsStore } from '../../../stores/editSessions.store'
import { useLocalFsStore } from '../../../stores/localFs.store'
import { useRemoteFsStore } from '../../../stores/remoteFs.store'
import { useSessionsStore } from '../../../stores/sessions.store'
import EditorDialog from '../EditorDialog.vue'
import FileDiffModal from '../FileDiffModal.vue'
import FileList from '../FileList.vue'
import FilePane from '../FilePane.vue'
import SyncDialog from '../SyncDialog.vue'

const notifyError = vi.hoisted(() => vi.fn())
const notifySuccess = vi.hoisted(() => vi.fn())
vi.mock('../../../composables/useConfirm', () => ({ useConfirm: () => vi.fn(async () => true) }))
vi.mock('../../../composables/useNotify', () => ({
  useNotify: () => ({ success: notifySuccess, error: notifyError, prompt: vi.fn() })
}))
vi.mock('../../../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../api')>()),
  invoke: vi.fn(),
  onEvent: vi.fn(() => () => {})
}))
vi.mock('../FileList.vue', () => ({ default: { name: 'FileList', template: '<div />' } }))
vi.mock('../FileToolbar.vue', () => ({ default: { template: '<div />' } }))
vi.mock('../PathBreadcrumb.vue', () => ({ default: { template: '<div />' } }))
vi.mock('vue-codemirror', () => ({
  Codemirror: {
    name: 'Codemirror',
    props: ['modelValue'],
    template: '<textarea :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />'
  }
}))
vi.mock('@nuxt/ui/components/Checkbox.vue', () => ({
  default: {
    props: ['modelValue', 'label'],
    template: '<input type="checkbox" :aria-label="label" :checked="modelValue" @change="$emit(\'update:modelValue\', $event.target.checked)">'
  }
}))

const stubs = {
  UModal: {
    name: 'UModal',
    props: ['open', 'title'],
    emits: ['update:open'],
    template: '<section v-if="open" :data-modal-title="title"><slot name="actions" /><slot name="body" /><slot name="footer" /></section>'
  },
  UButton: {
    props: ['disabled', 'loading', 'ariaLabel'],
    template: '<button :disabled="disabled || loading" :aria-label="ariaLabel"><slot /></button>'
  },
  UFormField: { template: '<label><slot /></label>' },
  UInput: {
    props: ['modelValue'],
    template: '<input :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)">'
  },
  URadioGroup: {
    props: ['modelValue'],
    template: '<select :value="modelValue" @change="$emit(\'update:modelValue\', $event.target.value)"><option value="push">Push</option></select>'
  },
  UAlert: { props: ['title', 'description'], template: '<div role="alert"><strong>{{ title }}</strong><span>{{ description }}</span></div>' },
  UBadge: { template: '<span><slot /></span>' },
  UTooltip: { template: '<div><slot /></div>' },
  UIcon: true,
  USkeleton: true
}

let wrapper: VueWrapper | null = null

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

const sampleDiff: FileDiffResult = {
  localPath: 'C:\\local\\app.ts',
  remotePath: '/srv/app.ts',
  localSize: 24,
  remoteSize: 28,
  maxBytes: 1_048_576,
  identical: false,
  additions: 1,
  deletions: 1,
  hunks: [
    {
      localStart: 1,
      localCount: 3,
      remoteStart: 1,
      remoteCount: 3,
      lines: [
        { kind: 'context', text: 'const a = 1', localLine: 1, remoteLine: 1 },
        { kind: 'remove', text: 'const b = 2', localLine: 2, remoteLine: null },
        { kind: 'add', text: 'const b = 3', localLine: null, remoteLine: 2 },
        { kind: 'context', text: 'export { a, b }', localLine: 3, remoteLine: 3 }
      ]
    }
  ]
}

describe('FileDiffModal & entry-point integrations', () => {
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
    wrapper = null
  })

  it('renders unified diff and toggles to side-by-side view', async () => {
    vi.mocked(invoke).mockResolvedValueOnce(sampleDiff)
    wrapper = mount(FileDiffModal, {
      props: {
        open: true,
        sessionId: 's1',
        localPath: 'C:\\local\\app.ts',
        remotePath: '/srv/app.ts'
      },
      global: { stubs }
    })
    await flushPromises()

    expect(invoke).toHaveBeenCalledWith(INVOKE_CHANNELS.syncDiffFiles, {
      sessionId: 's1',
      localPath: 'C:\\local\\app.ts',
      remotePath: '/srv/app.ts'
    })
    expect(wrapper.text()).toContain('+1')
    expect(wrapper.text()).toContain('-1')
    expect(wrapper.text()).toContain('const b = 2')
    expect(wrapper.text()).toContain('const b = 3')

    const splitBtn = wrapper.findAll('button').find((b) => b.text().trim() === 'Side-by-side')!
    await splitBtn.trigger('click')
    expect(splitBtn.attributes('aria-pressed')).toBe('true')
    expect(wrapper.text()).toContain('const b = 2')
    expect(wrapper.text()).toContain('const b = 3')
  })

  it('renders non-crashing notice for binary or oversized files and ignores stale responses', async () => {
    const first = deferred<FileDiffResult>()
    const second = deferred<FileDiffResult>()
    vi.mocked(invoke).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)

    wrapper = mount(FileDiffModal, {
      props: {
        open: true,
        sessionId: 's1',
        localPath: '/local/a.bin',
        remotePath: '/srv/a.bin'
      },
      global: { stubs }
    })
    await wrapper.setProps({ localPath: '/local/b.bin', remotePath: '/srv/b.bin' })

    second.resolve({
      localPath: '/local/b.bin',
      remotePath: '/srv/b.bin',
      localSize: 512,
      remoteSize: 512,
      maxBytes: 1_048_576,
      skipped: {
        reason: 'binary',
        side: 'both',
        message: 'Both local and remote files appear to be binary and cannot be diffed as text.'
      },
      identical: false,
      additions: 0,
      deletions: 0,
      hunks: []
    })
    await flushPromises()

    first.resolve(sampleDiff)
    await flushPromises()

    expect(wrapper.text()).toContain('Binary file cannot be diffed')
    expect(wrapper.text()).not.toContain('const b = 2')
  })

  it('renders omitted-lines summary when a large diff is simplified', async () => {
    vi.mocked(invoke).mockResolvedValueOnce({
      ...sampleDiff,
      additions: 900,
      deletions: 900,
      simplified: true,
      omittedLines: 1300
    })

    wrapper = mount(FileDiffModal, {
      props: {
        open: true,
        sessionId: 's1',
        localPath: '/local/big.txt',
        remotePath: '/srv/big.txt'
      },
      global: { stubs }
    })
    await flushPromises()

    expect(wrapper.text()).toContain('Large diff simplified')
    expect(wrapper.text()).toContain('1300 lines omitted')
  })

  it('offers View Diff on SyncDialog overwrite rows and opens FileDiffModal', async () => {
    const plan: SyncPlan = {
      toTransfer: [
        { relPath: 'src/app.ts', size: 100, action: 'overwrite' },
        { relPath: 'src/new.ts', size: 50, action: 'new' }
      ],
      toDelete: [],
      totalBytes: 150
    }
    vi.mocked(invoke).mockResolvedValueOnce(plan).mockResolvedValueOnce(sampleDiff)

    wrapper = mount(SyncDialog, {
      props: {
        open: true,
        sessionId: 's1',
        initialLocalPath: '/local',
        initialRemotePath: '/remote'
      },
      global: { stubs }
    })

    const previewBtn = wrapper.findAll('button').find((b) => b.text().trim() === 'Preview')!
    await previewBtn.trigger('click')
    await flushPromises()

    const diffButtons = wrapper.findAll('button').filter((b) => b.text().trim() === 'View Diff')
    expect(diffButtons).toHaveLength(1)

    await diffButtons[0].trigger('click')
    await flushPromises()

    expect(invoke).toHaveBeenCalledWith(INVOKE_CHANNELS.syncDiffFiles, {
      sessionId: 's1',
      localPath: '/local/src/app.ts',
      remotePath: '/remote/src/app.ts'
    })
  })

  it('shows conflict banner in EditorDialog, opens diff with live localContent, and overwrites server', async () => {
    const editSessions = useEditSessionsStore()
    editSessions.edits = [
      {
        editId: 'edit-1',
        sessionId: 's1',
        remotePath: '/srv/conf.yml',
        localTempPath: '/tmp/conf.yml',
        dirty: true,
        sessionClosed: false,
        conflict: true,
        viaSudo: true
      }
    ]
    vi.mocked(invoke)
      .mockResolvedValueOnce({ path: '/tmp/conf.yml', content: 'old local', truncated: false, size: 9 } as never)
      .mockResolvedValueOnce(sampleDiff as never)
      .mockResolvedValue(undefined as never)

    wrapper = mount(EditorDialog, {
      props: {
        open: true,
        editId: 'edit-1',
        localTempPath: '/tmp/conf.yml',
        remotePath: '/srv/conf.yml'
      },
      global: { stubs }
    })
    await flushPromises()

    expect(wrapper.text()).toContain('This file changed on the server since you opened it.')
    await wrapper.get('textarea').setValue('edited local')

    const viewDiffBtn = wrapper.findAll('button').find((b) => b.text().trim() === 'View Diff')!
    await viewDiffBtn.trigger('click')
    await flushPromises()

    expect(invoke).toHaveBeenCalledWith(INVOKE_CHANNELS.syncDiffFiles, {
      sessionId: 's1',
      localPath: '/tmp/conf.yml',
      remotePath: '/srv/conf.yml',
      localContent: 'edited local',
      viaSudo: true
    })

    const overwriteBtn = wrapper.findAll('button').find((b) => b.text().trim() === 'Overwrite server')!
    await overwriteBtn.trigger('click')
    await flushPromises()

    expect(invoke).toHaveBeenCalledWith(INVOKE_CHANNELS.fsLocalWriteFile, {
      path: '/tmp/conf.yml',
      content: 'edited local'
    })
    expect(invoke).toHaveBeenCalledWith(INVOKE_CHANNELS.editForceReupload, 'edit-1')
  })

  it('pairs FilePane Compare with opposite pane by matching filename or warns when missing', async () => {
    const sessions = useSessionsStore()
    Object.assign(sessions.activeTab, { sessionId: 's1', status: 'connected', hostLabel: 'srv' })
    const localFs = useLocalFsStore()
    const remoteFs = useRemoteFsStore()

    const localEntry: FileEntry = {
      name: 'config.yml',
      path: '/local/config.yml',
      isDir: false,
      isSymlink: false,
      size: 10,
      modifiedAt: null
    }
    const remoteEntry: FileEntry = {
      name: 'config.yml',
      path: '/remote/config.yml',
      isDir: false,
      isSymlink: false,
      size: 12,
      modifiedAt: null
    }
    localFs.currentPath = '/local'
    localFs.entries = [localEntry]

    vi.mocked(invoke).mockImplementation(async (channel) => {
      if (channel === INVOKE_CHANNELS.fsRemoteList) {
        return { path: '/remote', entries: [remoteEntry] } as never
      }
      if (channel === INVOKE_CHANNELS.syncDiffFiles) {
        return sampleDiff as never
      }
      return undefined as never
    })
    await remoteFs.loadForSession('s1', '/remote')

    wrapper = shallowMount(FilePane, {
      props: { side: 'local' },
      global: { stubs: { ...stubs, FileDiffModal: false } }
    })
    await vi.dynamicImportSettled()

    wrapper.getComponent(FileList).vm.$emit('diff', localEntry)
    await flushPromises()

    expect(invoke).toHaveBeenCalledWith(INVOKE_CHANNELS.syncDiffFiles, {
      sessionId: 's1',
      localPath: '/local/config.yml',
      remotePath: '/remote/config.yml'
    })

    remoteFs.bySession['s1'].entries = []
    wrapper.getComponent(FileList).vm.$emit('diff', localEntry)
    await flushPromises()

    expect(notifyError).toHaveBeenCalledWith(
      'No matching file in opposite pane',
      expect.stringContaining('config.yml')
    )
  })
})
