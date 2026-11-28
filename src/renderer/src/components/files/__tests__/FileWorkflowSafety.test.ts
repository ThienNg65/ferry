// @vitest-environment happy-dom
import { createPinia, setActivePinia } from 'pinia'
import { flushPromises, mount, shallowMount, type VueWrapper } from '@vue/test-utils'
import { EVENT_CHANNELS, INVOKE_CHANNELS, type FileEntry, type OperationEvent, type SyncPlan } from '@shared/contract'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { invoke, IpcError, onEvent } from '../../../api'
import type { ConfirmOptions } from '../../../composables/useConfirm'
import { useBookmarksStore } from '../../../stores/bookmarks.store'
import { useFileClipboardStore } from '../../../stores/fileClipboard.store'
import { useLocalFsStore } from '../../../stores/localFs.store'
import { useRemoteFsStore } from '../../../stores/remoteFs.store'
import { useSessionsStore } from '../../../stores/sessions.store'
import CompareDialog from '../CompareDialog.vue'
import EditorDialog from '../EditorDialog.vue'
import FileList from '../FileList.vue'
import FilePane from '../FilePane.vue'
import SyncDialog from '../SyncDialog.vue'

const confirm = vi.hoisted(() => vi.fn<(options: ConfirmOptions) => Promise<boolean>>())
const notifyError = vi.hoisted(() => vi.fn())
vi.mock('../../../composables/useConfirm', () => ({ useConfirm: () => confirm }))
vi.mock('../../../composables/useNotify', () => ({
  useNotify: () => ({ success: vi.fn(), error: notifyError, prompt: vi.fn() })
}))
vi.mock('../../../api', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../../api')>(),
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
    props: ['open'],
    emits: ['update:open'],
    template: '<section v-if="open"><slot name="actions" /><slot name="body" /><slot name="footer" /></section>'
  },
  UButton: {
    props: ['disabled', 'loading'],
    template: '<button :disabled="disabled || loading"><slot /></button>'
  },
  UFormField: { template: '<label><slot /></label>' },
  UInput: {
    props: ['modelValue'],
    template: '<input :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)">'
  },
  URadioGroup: {
    props: ['modelValue'],
    template: '<select :value="modelValue" @change="$emit(\'update:modelValue\', $event.target.value)"><option value="push">Push</option><option value="pull">Pull</option></select>'
  },
  UAlert: { props: ['title'], template: '<p>{{ title }}</p>' },
  UBadge: { template: '<span><slot /></span>' },
  UTooltip: { template: '<div><slot /></div>' },
  UIcon: true,
  USkeleton: true
}

const dialogProps = { open: true, sessionId: 'server-a', initialLocalPath: '/local', initialRemotePath: '/remote' }
let wrapper: VueWrapper
const originalWindowApi = Object.getOwnPropertyDescriptor(window, 'api')

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

function button(label: string) {
  return wrapper.findAll('button').find((item) => item.text() === label)!
}

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
  vi.unstubAllGlobals()
  if (originalWindowApi) Object.defineProperty(window, 'api', originalWindowApi)
  else Reflect.deleteProperty(window, 'api')
})

describe('sync and compare snapshots', () => {
  it.each(['local folder', 'remote folder', 'direction', 'mirror', 'session'])(
    'discards a pending sync preview if the %s changes',
    async (field) => {
      const request = deferred<SyncPlan>()
      vi.mocked(invoke).mockReturnValueOnce(request.promise)
      wrapper = mount(SyncDialog, { props: dialogProps, global: { stubs } })
      await button('Preview').trigger('click')
      if (field === 'session') await wrapper.setProps({ sessionId: 'server-b' })
      else if (field === 'direction') await wrapper.get('select').setValue('pull')
      else if (field === 'mirror') await wrapper.get('input[type="checkbox"]').setValue(true)
      else await wrapper.findAll('input')[field === 'local folder' ? 0 : 1].setValue('/changed')

      request.resolve({ toTransfer: [], toDelete: [], totalBytes: 0 })
      await flushPromises()
      expect(button('Run sync').attributes('disabled')).toBeDefined()
      expect(invoke).toHaveBeenCalledTimes(1)
    }
  )

  it('shows the reviewed deletion paths and reports partial cancellation', async () => {
    const result = deferred<void>()
    const plan: SyncPlan = { toTransfer: [], toDelete: ['extras/report.txt'], totalBytes: 0 }
    vi.mocked(invoke).mockResolvedValueOnce(plan).mockReturnValueOnce(result.promise)
    vi.mocked(onEvent).mockReturnValue(() => {})
    wrapper = mount(SyncDialog, { props: dialogProps, global: { stubs } })
    await wrapper.get('input[type="checkbox"]').setValue(true)
    await button('Preview').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('/remote/extras/report.txt')

    await button('Approve deletions and run').trigger('click')
    const request = vi.mocked(invoke).mock.calls.find(([channel]) => channel === INVOKE_CHANNELS.syncRun)?.[1]
    expect(request).toMatchObject({ approvedPlan: plan, options: { sessionId: 'server-a', deleteExtras: true } })
    expect(button('Continue in background')).toBeDefined()

    const [, listener] = vi.mocked(onEvent).mock.calls.find(([channel]) => channel === EVENT_CHANNELS.operationEvent)!
    const started: OperationEvent = {
      operationId: 'running-sync',
      kind: 'sync',
      state: 'started',
      label: 'Syncing',
      startedAt: 0,
      cancellable: true,
      requestId: (request as { requestId: string }).requestId
    }
    listener(started)
    await button('Cancel sync').trigger('click')
    expect(invoke).toHaveBeenCalledWith(INVOKE_CHANNELS.operationCancel, 'running-sync')
    listener({ ...started, state: 'cancelled', error: '1 destination item deleted. 0 transfers queued.' })
    await flushPromises()
    expect(wrapper.text()).toContain('Sync cancelled. 1 destination item deleted. 0 transfers queued.')
    expect(button('Run sync').attributes('disabled')).toBeDefined()
    result.resolve(undefined)
  })

  it('removes compare results on a folder edit and keeps them cleared after a failed scan', async () => {
    const row = { relPath: 'data.txt', status: 'localOnly', localSize: 12 }
    vi.mocked(invoke).mockResolvedValueOnce([row]).mockRejectedValueOnce(new Error('Denied'))
    wrapper = mount(CompareDialog, { props: dialogProps, global: { stubs } })
    await flushPromises()
    expect(wrapper.find('button[aria-label="Copy local to remote"]').exists()).toBe(true)
    await wrapper.findAll('input')[0].setValue('/another-local-folder')
    expect(wrapper.find('button[aria-label="Copy local to remote"]').exists()).toBe(false)
    await button('Compare').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('Denied')
    expect(wrapper.find('button[aria-label="Copy local to remote"]').exists()).toBe(false)
  })

  it('checks a nested destination and invalidates the overwrite prompt if the session changes', async () => {
    vi.mocked(invoke)
      .mockResolvedValueOnce([{ relPath: 'nested/data.txt', status: 'localOnly', localSize: 12 }])
      .mockResolvedValueOnce({ path: '/remote/nested', entries: [
        { path: '/remote/nested/data.txt', name: 'data.txt', isDir: false, size: 4, modifiedAt: null }
      ] })
    wrapper = mount(CompareDialog, { props: dialogProps, global: { stubs } })
    await flushPromises()
    await wrapper.get('button[aria-label="Copy local to remote"]').trigger('click')
    await flushPromises()
    expect(invoke).toHaveBeenCalledWith(INVOKE_CHANNELS.fsRemoteList, 'server-a', '/remote/nested', true)
    expect(button('Overwrite all')).toBeDefined()
    await wrapper.setProps({ sessionId: 'server-b' })
    expect(button('Overwrite all')).toBeUndefined()
    expect(invoke).not.toHaveBeenCalledWith(INVOKE_CHANNELS.transferEnqueue, expect.anything())
  })
})

it('keeps text typed during an editor save dirty and asks before closing', async () => {
  const write = deferred<void>()
  vi.mocked(invoke).mockResolvedValueOnce({ content: 'original', truncated: false })
    .mockReturnValueOnce(write.promise)
    .mockResolvedValueOnce(undefined)
  confirm.mockResolvedValue(false)
  wrapper = mount(EditorDialog, {
    props: { open: true, editId: 'edit', localTempPath: '/tmp/edit.txt', remotePath: '/file' },
    global: { stubs }
  })
  await flushPromises()
  await wrapper.get('textarea').setValue('first edit')
  await button('Save').trigger('click')
  expect(invoke).toHaveBeenCalledWith(INVOKE_CHANNELS.fsLocalWriteFile, { path: '/tmp/edit.txt', content: 'first edit' })
  await wrapper.get('textarea').setValue('second edit')
  write.resolve(undefined)
  await flushPromises()
  expect(wrapper.text()).toContain('Unsaved')
  expect(button('Save').attributes('disabled')).toBeUndefined()
  wrapper.getComponent({ name: 'UModal' }).vm.$emit('update:open', false)
  await flushPromises()
  expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ title: 'Discard unsaved changes?' }))
  expect(wrapper.emitted('update:open')).toBeUndefined()
  await button('Save').trigger('click')
  await flushPromises()
  expect(invoke).toHaveBeenCalledWith(INVOKE_CHANNELS.fsLocalWriteFile, { path: '/tmp/edit.txt', content: 'second edit' })
  expect(wrapper.text()).not.toContain('Unsaved')
})

it.each(['close', 'external editor'])('does not discard newer text with a stale %s approval', async (action) => {
  const approval = deferred<boolean>()
  vi.mocked(invoke).mockResolvedValueOnce({ content: 'original', truncated: false })
  confirm.mockReturnValueOnce(approval.promise)
  wrapper = mount(EditorDialog, {
    props: { open: true, editId: 'edit', localTempPath: '/tmp/edit.txt', remotePath: '/file' },
    global: { stubs }
  })
  await flushPromises()
  await wrapper.get('textarea').setValue('first edit')
  if (action === 'close') {
    wrapper.getComponent({ name: 'UModal' }).vm.$emit('update:open', false)
  } else {
    await wrapper.get('button[aria-label="Open in external editor"]').trigger('click')
  }
  await wrapper.get('textarea').setValue('newer edit')
  approval.resolve(true)
  await flushPromises()
  expect(wrapper.emitted('update:open')).toBeUndefined()
  expect(wrapper.text()).toContain('Unsaved')
  expect(invoke).not.toHaveBeenCalledWith(INVOKE_CHANNELS.editOpenExternal, expect.anything())
})

it('keeps the built-in editor open when text changes during external handoff', async () => {
  const opened = deferred<void>()
  vi.mocked(invoke).mockResolvedValueOnce({ content: 'original', truncated: false }).mockReturnValueOnce(opened.promise)
  wrapper = mount(EditorDialog, {
    props: { open: true, editId: 'edit', localTempPath: '/tmp/edit.txt', remotePath: '/file' },
    global: { stubs }
  })
  await flushPromises()
  await wrapper.get('button[aria-label="Open in external editor"]').trigger('click')
  expect(invoke).toHaveBeenCalledWith(INVOKE_CHANNELS.editOpenExternal, { editId: 'edit' })
  await wrapper.get('textarea').setValue('edit during handoff')
  opened.resolve()
  await flushPromises()
  expect(wrapper.emitted('update:open')).toBeUndefined()
  expect(wrapper.text()).toContain('Unsaved')
})

describe('remote deletion', () => {
  const entry: FileEntry = { name: 'data.txt', path: '/shared/data.txt', isDir: false, isSymlink: false, size: 1, modifiedAt: null }
  const second: FileEntry = { ...entry, name: 'more.txt', path: '/shared/more.txt' }

  it.each(['single', 'batch', 'stale'])('confirms %s deletes against the original connection', async (kind) => {
    const sessions = useSessionsStore()
    const firstTab = sessions.activeTab
    Object.assign(firstTab, { sessionId: 'server-a', status: 'connected', hostLabel: 'a.example' })
    sessions.openNewTab()
    const secondTab = sessions.activeTab
    Object.assign(secondTab, { sessionId: 'server-b', status: 'connected', hostLabel: 'b.example' })
    sessions.activeTabId = firstTab.tabId

    const remote = useRemoteFsStore()
    Object.assign(remote.ensureBucket('server-a'), {
      currentPath: '/shared',
      entries: [entry, second],
      selected: new Set(kind === 'batch' ? [entry.path, second.path] : [entry.path])
    })
    Object.assign(remote.ensureBucket('server-b'), { currentPath: '/shared', entries: [entry, second] })
    vi.mocked(invoke).mockImplementation(async (channel) =>
      channel === INVOKE_CHANNELS.fsRemoteDeleteMany ? { deletedPaths: [entry.path, second.path], failures: [] } : []
    )
    confirm.mockResolvedValue(false)
    wrapper = shallowMount(FilePane, { props: { side: 'remote' }, global: { stubs } })
    // Shallow mounting still starts async child imports when Vue Test Utils creates their stubs.
    await vi.dynamicImportSettled()
    wrapper.getComponent(FileList).vm.$emit('remove', entry)

    const options = confirm.mock.calls[0][0]
    expect(options.body).toContain('a.example')
    expect(options.items).toEqual(kind === 'batch' ? [entry.path, second.path] : [entry.path])
    sessions.activeTabId = secondTab.tabId
    if (kind === 'stale') {
      firstTab.sessionId = 'server-a-reconnected'
      await expect(options.action!()).rejects.toThrow('original server connection ended')
      expect(invoke).not.toHaveBeenCalledWith(INVOKE_CHANNELS.fsRemoteDelete, expect.anything(), expect.anything())
    } else if (kind === 'batch') {
      await options.action!()
      expect(invoke).toHaveBeenCalledWith(INVOKE_CHANNELS.fsRemoteDeleteMany, {
        sessionId: 'server-a', paths: [entry.path, second.path]
      })
    } else {
      await options.action!()
      expect(invoke).toHaveBeenCalledWith(INVOKE_CHANNELS.fsRemoteDelete, 'server-a', entry.path)
    }
    expect(remote.entries).toEqual([entry, second])
  })

  it('closes the sole connected tab cleanly while CompareDialog and SyncDialog sync watchers are mounted', async () => {
    const sessions = useSessionsStore()
    const tab = sessions.activeTab
    Object.assign(tab, { sessionId: 'sole-session', status: 'connected', hostLabel: 'sole.example' })
    const closedTabId = tab.tabId
    vi.mocked(invoke).mockResolvedValue(undefined)

    const compare = mount(CompareDialog, {
      props: { open: false, sessionId: 'sole-session', initialLocalPath: '/local', initialRemotePath: '/remote' },
      global: { stubs }
    })
    const sync = mount(SyncDialog, {
      props: { open: false, sessionId: 'sole-session', initialLocalPath: '/local', initialRemotePath: '/remote' },
      global: { stubs }
    })
    try {
      await sessions.closeTab(closedTabId)
      expect(sessions.tabs).toHaveLength(1)
      expect(sessions.activeTabId).not.toBe(closedTabId)
      expect(sessions.status).toBeNull()
      expect(sessions.activeSessionId).toBeNull()
      expect(invoke).toHaveBeenCalledWith(INVOKE_CHANNELS.sessionClose, 'sole-session')
    } finally {
      compare.unmount()
      sync.unmount()
    }
  })
})


function setDropBridge(getPathForFile: (file: File) => string): void {
  window.api = {
    invoke: async () => undefined,
    on: () => () => {},
    off: () => {},
    send: () => {},
    getPathForFile,
    getPreloadTime: () => ({ start: 0, timeOrigin: 0 })
  }
}

function osDropEvent(...files: File[]): DragEvent {
  return {
    dataTransfer: {
      types: ['Files'],
      items: files.map((file) => ({ kind: 'file', getAsFile: () => file, webkitGetAsEntry: () => null }))
    }
  } as unknown as DragEvent
}

describe('local OS drops into folders', () => {
  const folder: FileEntry = {
    name: 'target',
    path: '/local/target',
    isDir: true,
    isSymlink: false,
    size: 0,
    modifiedAt: null
  }

  it('cleans a staged entry after its local move succeeds', async () => {
    const staged: FileEntry = {
      name: 'report.txt',
      path: '/tmp/ferry-drop-session/report.txt',
      isDir: false,
      isSymlink: false,
      size: 7,
      modifiedAt: null
    }
    setDropBridge(() => '')
    vi.mocked(invoke).mockImplementation(async (channel) => {
      if (channel === INVOKE_CHANNELS.fsLocalStageDrop) return [staged] as never
      if (channel === INVOKE_CHANNELS.fsLocalList) return { path: '/local', entries: [] } as never
      return undefined as never
    })

    wrapper = shallowMount(FilePane, { props: { side: 'local' }, global: { stubs } })
    await vi.dynamicImportSettled()
    wrapper.getComponent(FileList).vm.$emit('drop-on', folder, osDropEvent(new File(['payload'], 'report.txt')))
    await flushPromises()

    const calls = vi.mocked(invoke).mock.calls
    const renameIndex = calls.findIndex(([channel]) => channel === INVOKE_CHANNELS.fsLocalRename)
    const cleanupIndex = calls.findIndex(([channel]) => channel === INVOKE_CHANNELS.fsLocalCleanupStagedDrop)
    expect(renameIndex).toBeGreaterThanOrEqual(0)
    expect(cleanupIndex).toBeGreaterThan(renameIndex)
    expect(calls[cleanupIndex]).toEqual([
      INVOKE_CHANNELS.fsLocalCleanupStagedDrop,
      { paths: [staged.path] }
    ])
  })

  it('does not clean a direct OS path under a similarly named temporary directory', async () => {
    const directPath = 'C:\\Temp\\ferry-drop-user-data\\keep.txt'
    setDropBridge(() => directPath)
    vi.mocked(invoke).mockImplementation(async (channel) => {
      if (channel === INVOKE_CHANNELS.fsLocalList) return { path: '/local', entries: [] } as never
      return undefined as never
    })

    wrapper = shallowMount(FilePane, { props: { side: 'local' }, global: { stubs } })
    await vi.dynamicImportSettled()
    wrapper.getComponent(FileList).vm.$emit('drop-on', folder, osDropEvent(new File(['payload'], 'keep.txt')))
    await flushPromises()

    expect(invoke).toHaveBeenCalledWith(
      INVOKE_CHANNELS.fsLocalRename,
      directPath,
      '/local/target/keep.txt'
    )
    expect(invoke).not.toHaveBeenCalledWith(INVOKE_CHANNELS.fsLocalCleanupStagedDrop, expect.anything())
  })

  it('refreshes the pane and preserves remaining staged items on partial multi-item move failure', async () => {
    const first: FileEntry = { name: 'first.txt', path: '/tmp/ferry-drop-session/first.txt', isDir: false, isSymlink: false, size: 1, modifiedAt: null }
    const second: FileEntry = { name: 'second.txt', path: '/tmp/ferry-drop-session/second.txt', isDir: false, isSymlink: false, size: 1, modifiedAt: null }
    setDropBridge(() => '')
    let listCalls = 0
    vi.mocked(invoke).mockImplementation(async (channel, fromPath) => {
      if (channel === INVOKE_CHANNELS.fsLocalStageDrop) return [first, second] as never
      if (channel === INVOKE_CHANNELS.fsLocalList) {
        listCalls += 1
        return { path: '/local', entries: [] } as never
      }
      if (channel === INVOKE_CHANNELS.fsLocalRename && fromPath === second.path) {
        throw new Error('destination denied')
      }
      return undefined as never
    })

    wrapper = shallowMount(FilePane, { props: { side: 'local' }, global: { stubs } })
    await vi.dynamicImportSettled()
    const baselineListCalls = listCalls
    wrapper.getComponent(FileList).vm.$emit(
      'drop-on',
      folder,
      osDropEvent(new File(['1'], 'first.txt'), new File(['2'], 'second.txt'))
    )
    await flushPromises()

    expect(invoke).toHaveBeenCalledWith(INVOKE_CHANNELS.fsLocalCleanupStagedDrop, { paths: [first.path] })
    expect(invoke).not.toHaveBeenCalledWith(INVOKE_CHANNELS.fsLocalCleanupStagedDrop, { paths: [second.path] })
    expect(listCalls).toBeGreaterThan(baselineListCalls)
    expect(notifyError).toHaveBeenCalledWith('Move failed', 'destination denied')
  })

  it('reports cleanup failure without treating the completed local move as failed', async () => {
    const staged: FileEntry = { name: 'report.txt', path: '/tmp/ferry-drop-session/report.txt', isDir: false, isSymlink: false, size: 7, modifiedAt: null }
    setDropBridge(() => '')
    vi.mocked(invoke).mockImplementation(async (channel) => {
      if (channel === INVOKE_CHANNELS.fsLocalStageDrop) return [staged] as never
      if (channel === INVOKE_CHANNELS.fsLocalList) return { path: '/local', entries: [] } as never
      if (channel === INVOKE_CHANNELS.fsLocalCleanupStagedDrop) throw new Error('cleanup transport failed')
      return undefined as never
    })

    wrapper = shallowMount(FilePane, { props: { side: 'local' }, global: { stubs } })
    await vi.dynamicImportSettled()
    wrapper.getComponent(FileList).vm.$emit('drop-on', folder, osDropEvent(new File(['payload'], 'report.txt')))
    await flushPromises()

    expect(invoke).toHaveBeenCalledWith(INVOKE_CHANNELS.fsLocalRename, staged.path, '/local/target/report.txt')
    expect(notifyError).toHaveBeenCalledWith(
      'Temporary drop cleanup failed',
      'The item was moved, but its temporary staging folder could not be removed.'
    )
    expect(notifyError).not.toHaveBeenCalledWith('Move failed', expect.anything())
  })
})

describe('local file editing', () => {
  it('opens EditorDialog for local text files up to 5 MB and external editor for non-text files', async () => {
    const textFile: FileEntry = { name: 'notes.txt', path: '/local/notes.txt', isDir: false, isSymlink: false, size: 128, modifiedAt: null }
    const imageFile: FileEntry = { name: 'photo.png', path: '/local/photo.png', isDir: false, isSymlink: false, size: 128, modifiedAt: null }
    vi.mocked(invoke).mockImplementation(async (channel) => {
      if (channel === INVOKE_CHANNELS.fsLocalList) return { path: '/local', entries: [textFile, imageFile] } as never
      if (channel === INVOKE_CHANNELS.fsLocalReadFile) {
        return { path: textFile.path, content: 'notes', truncated: false } as never
      }
      return undefined as never
    })

    wrapper = shallowMount(FilePane, {
      props: { side: 'local' },
      global: { stubs: { ...stubs, EditorDialog: false } }
    })
    await vi.dynamicImportSettled()

    wrapper.getComponent(FileList).vm.$emit('edit', textFile)
    await flushPromises()

    const editor = wrapper.findComponent(EditorDialog)
    expect(editor.exists()).toBe(true)
    expect(editor.props()).toMatchObject({
      open: true,
      editId: null,
      localTempPath: '/local/notes.txt',
      remotePath: null
    })

    wrapper.getComponent(FileList).vm.$emit('edit', imageFile)
    await flushPromises()
    expect(invoke).toHaveBeenCalledWith(INVOKE_CHANNELS.editOpenLocal, '/local/photo.png')
  })

  it('refreshes localFs when saving a local file in EditorDialog', async () => {
    const localFs = useLocalFsStore()
    localFs.currentPath = '/local'
    vi.mocked(invoke)
      .mockResolvedValueOnce({ content: 'before', truncated: false } as never)
      .mockResolvedValueOnce(undefined as never)
      .mockResolvedValueOnce({ path: '/local', entries: [] } as never)

    wrapper = mount(EditorDialog, {
      props: { open: true, editId: null, localTempPath: '/local/notes.txt', remotePath: null },
      global: { stubs }
    })
    await flushPromises()
    await wrapper.get('textarea').setValue('after')
    await button('Save').trigger('click')
    await flushPromises()

    expect(invoke).toHaveBeenCalledWith(INVOKE_CHANNELS.fsLocalWriteFile, { path: '/local/notes.txt', content: 'after' })
    expect(invoke).toHaveBeenCalledWith(INVOKE_CHANNELS.fsLocalList, '/local')
  })
})

describe('archive operation refresh targets', () => {
  it('does not reload a newly selected local directory when compression finishes', async () => {
    const local = useLocalFsStore()
    const entry: FileEntry = {
      name: 'report.txt',
      path: 'C:\\Users\\me\\files\\report.txt',
      isDir: false,
      isSymlink: false,
      size: 12,
      modifiedAt: null
    }
    Object.assign(local, { currentPath: 'C:\\Users\\me\\files', entries: [entry] })
    const compression = deferred<void>()
    vi.mocked(invoke).mockImplementation(async (channel) => {
      if (channel === INVOKE_CHANNELS.archiveCompressLocal) return compression.promise as never
      return undefined as never
    })

    wrapper = shallowMount(FilePane, { props: { side: 'local' }, global: { stubs } })
    await vi.dynamicImportSettled()
    wrapper.getComponent(FileList).vm.$emit('compress', entry)
    await flushPromises()

    expect(invoke).toHaveBeenCalledWith(INVOKE_CHANNELS.archiveCompressLocal, {
      sourcePath: entry.path,
      destPath: 'C:\\Users\\me\\files\\report.txt.zip'
    })

    local.currentPath = 'C:\\Users\\me\\other'
    compression.resolve()
    await flushPromises()

    expect(invoke).not.toHaveBeenCalledWith(INVOKE_CHANNELS.fsLocalList, 'C:\\Users\\me\\other')
  })

  it('refreshes the originating remote directory after compression when the active tab changes', async () => {
    const sessions = useSessionsStore()
    const firstTab = sessions.activeTab
    Object.assign(firstTab, { sessionId: 'server-a', status: 'connected', hostLabel: 'a.example' })
    sessions.openNewTab()
    const secondTab = sessions.activeTab
    Object.assign(secondTab, { sessionId: 'server-b', status: 'connected', hostLabel: 'b.example' })
    sessions.activeTabId = firstTab.tabId

    const entry: FileEntry = {
      name: 'report.txt',
      path: '/tab-a/report.txt',
      isDir: false,
      isSymlink: false,
      size: 12,
      modifiedAt: null
    }
    const zip: FileEntry = { ...entry, name: 'report.txt.zip', path: '/tab-a/report.txt.zip' }
    const remote = useRemoteFsStore()
    Object.assign(remote.ensureBucket('server-a'), { currentPath: '/tab-a', entries: [entry] })
    Object.assign(remote.ensureBucket('server-b'), { currentPath: '/tab-b', entries: [] })

    const compression = deferred<void>()
    vi.mocked(invoke).mockClear()
    vi.mocked(invoke).mockImplementation(async (channel) => {
      if (channel === INVOKE_CHANNELS.archiveCompressRemote) return compression.promise as never
      if (channel === INVOKE_CHANNELS.fsRemoteList) return { path: '/tab-a', entries: [entry, zip] } as never
      return undefined as never
    })

    wrapper = shallowMount(FilePane, { props: { side: 'remote' }, global: { stubs } })
    await vi.dynamicImportSettled()
    wrapper.getComponent(FileList).vm.$emit('compress', entry)
    await flushPromises()

    expect(invoke).toHaveBeenCalledWith(INVOKE_CHANNELS.archiveCompressRemote, {
      sessionId: 'server-a',
      sourcePath: entry.path,
      destPath: '/tab-a/report.txt.zip'
    })

    sessions.activeTabId = secondTab.tabId
    compression.resolve()
    await flushPromises()

    expect(invoke).toHaveBeenCalledWith(INVOKE_CHANNELS.fsRemoteList, 'server-a', '/tab-a', true)
    expect(invoke).not.toHaveBeenCalledWith(INVOKE_CHANNELS.fsRemoteList, 'server-b', '/tab-b', false)
    expect(remote.bySession['server-a'].entries.map((item) => item.name)).toContain('report.txt.zip')
    expect(remote.bySession['server-b'].entries).toEqual([])
  })

  it('invalidates the original remote cache without refreshing a newly opened directory', async () => {
    const sessions = useSessionsStore()
    const tab = sessions.activeTab
    Object.assign(tab, { sessionId: 'server-a', status: 'connected', hostLabel: 'a.example' })

    const entry: FileEntry = {
      name: 'report.txt',
      path: '/tab-a/report.txt',
      isDir: false,
      isSymlink: false,
      size: 12,
      modifiedAt: null
    }
    const remote = useRemoteFsStore()
    const bucket = remote.ensureBucket('server-a')
    Object.assign(bucket, { currentPath: '/tab-a', entries: [entry] })
    bucket.dirCache.set('/tab-a', { path: '/tab-a', entries: [entry], timestamp: Date.now() })

    const compression = deferred<void>()
    vi.mocked(invoke).mockClear()
    vi.mocked(invoke).mockImplementation(async (channel) => {
      if (channel === INVOKE_CHANNELS.archiveCompressRemote) return compression.promise as never
      return undefined as never
    })

    wrapper = shallowMount(FilePane, { props: { side: 'remote' }, global: { stubs } })
    await vi.dynamicImportSettled()
    wrapper.getComponent(FileList).vm.$emit('compress', entry)
    await flushPromises()

    bucket.currentPath = '/tab-a/other'
    compression.resolve()
    await flushPromises()

    expect(bucket.dirCache.has('/tab-a')).toBe(false)
    expect(invoke).not.toHaveBeenCalledWith(INVOKE_CHANNELS.fsRemoteList, 'server-a', '/tab-a/other', false)
  })

  it('keeps extraction bound to its original session while the folder-conflict dialog is open', async () => {
    const sessions = useSessionsStore()
    const firstTab = sessions.activeTab
    Object.assign(firstTab, { sessionId: 'server-a', status: 'connected', hostLabel: 'a.example' })
    sessions.openNewTab()
    const secondTab = sessions.activeTab
    Object.assign(secondTab, { sessionId: 'server-b', status: 'connected', hostLabel: 'b.example' })
    sessions.activeTabId = firstTab.tabId

    const archive: FileEntry = {
      name: 'logs.zip',
      path: '/tab-a/logs.zip',
      isDir: false,
      isSymlink: false,
      size: 20,
      modifiedAt: null
    }
    const folder: FileEntry = {
      name: 'logs',
      path: '/tab-a/logs',
      isDir: true,
      isSymlink: false,
      size: 0,
      modifiedAt: null
    }
    const extracted: FileEntry = {
      name: 'access.log',
      path: '/tab-a/logs/access.log',
      isDir: false,
      isSymlink: false,
      size: 10,
      modifiedAt: null
    }
    const remote = useRemoteFsStore()
    Object.assign(remote.ensureBucket('server-a'), { currentPath: '/tab-a', entries: [archive, folder] })
    Object.assign(remote.ensureBucket('server-b'), { currentPath: '/tab-b', entries: [] })

    const extraction = deferred<void>()
    vi.mocked(invoke).mockClear()
    vi.mocked(invoke).mockImplementation(async (channel) => {
      if (channel === INVOKE_CHANNELS.unzipRun) return extraction.promise as never
      if (channel === INVOKE_CHANNELS.fsRemoteList) return { path: '/tab-a', entries: [archive, folder, extracted] } as never
      return undefined as never
    })

    wrapper = shallowMount(FilePane, { props: { side: 'remote' }, global: { stubs } })
    await vi.dynamicImportSettled()
    wrapper.getComponent(FileList).vm.$emit('extract', archive)
    await flushPromises()
    expect(wrapper.text()).toContain('already exists here')

    sessions.activeTabId = secondTab.tabId
    const extractButton = wrapper.findAll('button').find((item) => item.text() === 'Extract Here')
    expect(extractButton).toBeDefined()
    await extractButton!.trigger('click')
    await flushPromises()

    expect(invoke).toHaveBeenCalledWith(INVOKE_CHANNELS.unzipRun, {
      sessionId: 'server-a',
      archivePath: archive.path,
      targetDir: '/tab-a/logs'
    })

    extraction.resolve()
    await flushPromises()

    expect(invoke).toHaveBeenCalledWith(INVOKE_CHANNELS.fsRemoteList, 'server-a', '/tab-a', true)
    expect(invoke).not.toHaveBeenCalledWith(INVOKE_CHANNELS.fsRemoteList, 'server-b', '/tab-b', false)
    expect(remote.bySession['server-a'].entries).toEqual([folder, extracted, archive])
  })
})

describe('file clipboard copy and paste routing', () => {
  it('routes cross-pane local -> remote paste through transfer queue', async () => {
    const sessions = useSessionsStore()
    sessions.activeTab.sessionId = 'server-a'
    sessions.activeTab.status = 'connected'
    const localFs = useLocalFsStore()
    localFs.currentPath = '/local'
    const remoteFs = useRemoteFsStore()
    remoteFs.ensureBucket('server-a').currentPath = '/remote'

    const localEntry: FileEntry = { name: 'app.tar.gz', path: '/local/app.tar.gz', isDir: false, isSymlink: false, size: 512, modifiedAt: null }
    const clipboard = useFileClipboardStore()
    clipboard.copy('local', [localEntry], null)

    vi.mocked(invoke).mockImplementation(async (channel) => {
      if (channel === INVOKE_CHANNELS.fsRemoteList) return { path: '/remote', entries: [] } as never
      if (channel === INVOKE_CHANNELS.transferEnqueue) return { transferId: 't-1' } as never
      return undefined as never
    })

    wrapper = shallowMount(FilePane, { props: { side: 'remote' }, global: { stubs } })
    await flushPromises()

    wrapper.getComponent(FileList).vm.$emit('paste')
    await flushPromises()

    expect(invoke).toHaveBeenCalledWith(INVOKE_CHANNELS.transferEnqueue, {
      sessionId: 'server-a',
      kind: 'upload',
      localPath: '/local/app.tar.gz',
      remotePath: '/remote/app.tar.gz',
      isDir: false
    })
    expect(notifyError).not.toHaveBeenCalled()
  })

  it('refreshes target directory via refreshIfViewing on local paste and suppresses error toast on cancel', async () => {
    const localFs = useLocalFsStore()
    localFs.currentPath = '/local'
    const entry: FileEntry = { name: 'notes.txt', path: '/local/notes.txt', isDir: false, isSymlink: false, size: 10, modifiedAt: null }
    const clipboard = useFileClipboardStore()
    clipboard.copy('local', [entry], null)

    vi.mocked(invoke).mockImplementation(async (channel) => {
      if (channel === INVOKE_CHANNELS.fsLocalCopy) {
        return { copied: [{ sourcePath: '/local/notes.txt', targetPath: '/local/notes (1).txt' }], failures: [] } as never
      }
      if (channel === INVOKE_CHANNELS.fsLocalList) {
        return { path: '/local', entries: [entry] } as never
      }
      return undefined as never
    })

    wrapper = shallowMount(FilePane, { props: { side: 'local' }, global: { stubs } })
    await flushPromises()

    wrapper.getComponent(FileList).vm.$emit('paste')
    await flushPromises()

    expect(invoke).toHaveBeenCalledWith(INVOKE_CHANNELS.fsLocalCopy, {
      sourcePaths: ['/local/notes.txt'],
      targetDir: '/local'
    })
    expect(invoke).toHaveBeenCalledWith(INVOKE_CHANNELS.fsLocalList, '/local')
    expect(notifyError).not.toHaveBeenCalled()

    vi.mocked(invoke).mockImplementation(async (channel) => {
      if (channel === INVOKE_CHANNELS.fsLocalCopy) {
        throw new IpcError('CANCELLED', 'Copy cancelled')
      }
      if (channel === INVOKE_CHANNELS.fsLocalList) {
        return { path: '/local', entries: [entry] } as never
      }
      return undefined as never
    })
    wrapper.getComponent(FileList).vm.$emit('paste')
    await flushPromises()
    expect(notifyError).not.toHaveBeenCalled()
  })

  it('invalidates original remote SWR cache without error when disconnecting mid-paste', async () => {
    const sessions = useSessionsStore()
    sessions.activeTab.sessionId = 'server-a'
    sessions.activeTab.status = 'connected'
    const remoteFs = useRemoteFsStore()
    const bucket = remoteFs.ensureBucket('server-a')
    bucket.currentPath = '/srv/a'
    bucket.dirCache.set('/srv/a', { path: '/srv/a', entries: [], timestamp: Date.now() })

    const entry: FileEntry = { name: 'conf.yml', path: '/srv/a/conf.yml', isDir: false, isSymlink: false, size: 20, modifiedAt: null }
    const pastedEntry: FileEntry = { name: 'conf (1).yml', path: '/srv/a/conf (1).yml', isDir: false, isSymlink: false, size: 20, modifiedAt: null }
    useFileClipboardStore().copy('remote', [entry], 'server-a')

    const copyReq = deferred<{ copied: Array<{ sourcePath: string; targetPath: string }>; failures: [] }>()
    vi.mocked(invoke).mockImplementation(async (channel) => {
      if (channel === INVOKE_CHANNELS.fsRemoteCopy) return copyReq.promise as never
      if (channel === INVOKE_CHANNELS.fsRemoteList) return { path: '/srv/a', entries: [entry, pastedEntry] } as never
      return undefined as never
    })

    wrapper = shallowMount(FilePane, { props: { side: 'remote' }, global: { stubs } })
    await flushPromises()

    wrapper.getComponent(FileList).vm.$emit('paste')
    await flushPromises()

    sessions.activeTab.sessionId = null
    sessions.activeTab.status = 'disconnected'
    copyReq.resolve({ copied: [{ sourcePath: '/srv/a/conf.yml', targetPath: '/srv/a/conf (1).yml' }], failures: [] })
    await flushPromises()

    expect(invoke).toHaveBeenCalledWith(INVOKE_CHANNELS.fsRemoteList, 'server-a', '/srv/a', true)
    expect(bucket.entries.map((e) => e.name)).toContain('conf (1).yml')
    expect(notifyError).not.toHaveBeenCalled()
  })
})
