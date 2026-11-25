// @vitest-environment happy-dom
import { createPinia, setActivePinia } from 'pinia'
import { flushPromises, mount, shallowMount, type VueWrapper } from '@vue/test-utils'
import { EVENT_CHANNELS, INVOKE_CHANNELS, type FileEntry, type OperationEvent, type SyncPlan } from '@shared/contract'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { invoke, onEvent } from '../../../api'
import type { ConfirmOptions } from '../../../composables/useConfirm'
import { useBookmarksStore } from '../../../stores/bookmarks.store'
import { useLocalFsStore } from '../../../stores/localFs.store'
import { useUiStore } from '../../../stores/ui.store'
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
    await wrapper.get('button[aria-label="Open in External Editor"]').trigger('click')
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
  await wrapper.get('button[aria-label="Open in External Editor"]').trigger('click')
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

describe('window keydown fallback visibility guard', () => {
  it('ignores window keydown events on the local pane when sessions.status !== "connected"', async () => {
    const sessions = useSessionsStore()
    const localFs = useLocalFsStore()
    const ui = useUiStore()
    const entry: FileEntry = { name: 'notes.txt', path: '/local/notes.txt', isDir: false, isSymlink: false, size: 12, modifiedAt: null }
    vi.mocked(invoke).mockResolvedValue({ path: '/local', entries: [entry] } as never)
    confirm.mockResolvedValue(false)

    ui.setActivePane('local')
    wrapper = shallowMount(FilePane, { props: { side: 'local' }, global: { stubs } })
    await vi.dynamicImportSettled()
    await flushPromises()
    localFs.entries = [entry]
    localFs.selected = new Set([entry.path])

    expect(sessions.status).not.toBe('connected')
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }))
    await flushPromises()
    expect(confirm).not.toHaveBeenCalled()

    sessions.activeTab.status = 'connected'
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }))
    await flushPromises()
    expect(confirm).toHaveBeenCalledTimes(1)
  })
})
