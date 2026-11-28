import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { FileEntry } from '@shared/contract'

const notify = { error: vi.fn(), success: vi.fn() }
const enqueue = vi.fn().mockResolvedValue(undefined)
const companion = { quietMode: true }
const localFs = { currentPath: 'C:\\Users\\me', entries: [] as FileEntry[] }
const remoteFs = { currentPath: '/srv/app/', entries: [] as FileEntry[] }
const sessions = { activeSessionId: 'sess-1' }

vi.mock('../api', () => ({ invoke: vi.fn().mockResolvedValue(undefined) }))
vi.mock('./useNotify', () => ({ useNotify: () => notify }))
vi.mock('./useConfirm', () => ({ useConfirm: () => vi.fn().mockResolvedValue(true) }))
vi.mock('../stores/companion.store', () => ({ useCompanionStore: () => companion }))
vi.mock('../stores/localFs.store', () => ({ useLocalFsStore: () => localFs }))
vi.mock('../stores/remoteFs.store', () => ({ useRemoteFsStore: () => remoteFs }))
vi.mock('../stores/sessions.store', () => ({ useSessionsStore: () => sessions }))
vi.mock('../stores/monitor.store', () => ({ useMonitorStore: () => ({ latest: null }) }))
vi.mock('../stores/transferQueue.store', () => ({ useTransferQueueStore: () => ({ enqueue }) }))

import { useTransferIntents } from './useTransferIntents'

function file(name: string, path = `/x/${name}`): FileEntry {
  return { name, path, isDir: false, size: 3, modifiedAt: null } as FileEntry
}

describe('useTransferIntents', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localFs.entries = []
    remoteFs.entries = []
  })

  it.each(['../evil', 'a/b', 'a\\b', '..', '.'])('rejects the unsafe file name %s', (name) => {
    const { buildTransferIntent } = useTransferIntents()
    expect(buildTransferIntent('local', file(name), 'sess-1')).toBeNull()
    expect(notify.error).toHaveBeenCalledWith('Security warning', expect.any(String))
  })

  it('builds an upload target under the remote directory without a doubled slash', () => {
    const { buildTransferIntent } = useTransferIntents()
    expect(buildTransferIntent('local', file('a.txt', 'C:\\src\\a.txt'), 'sess-1')).toMatchObject({
      direction: 'upload', localPath: 'C:\\src\\a.txt', remotePath: '/srv/app/a.txt'
    })
  })

  it('builds a download target with the local separator style', () => {
    const { buildTransferIntent } = useTransferIntents()
    expect(buildTransferIntent('remote', file('a.txt', '/srv/a.txt'), 'sess-1')).toMatchObject({
      direction: 'download', localPath: 'C:\\Users\\me\\a.txt', remotePath: '/srv/a.txt'
    })
  })

  it('returns null when the destination pane has no directory yet', () => {
    remoteFs.currentPath = ''
    const { buildTransferIntent } = useTransferIntents()
    expect(buildTransferIntent('local', file('a.txt'), 'sess-1')).toBeNull()
    remoteFs.currentPath = '/srv/app/'
  })

  it('queues straight away when nothing conflicts', async () => {
    const { transferEntry, transferConflict } = useTransferIntents()
    await transferEntry('local', file('a.txt'))
    expect(enqueue).toHaveBeenCalledWith('sess-1', 'upload', '/x/a.txt', '/srv/app/a.txt', false, undefined)
    expect(transferConflict.value).toBeNull()
  })

  it('holds a conflicting transfer for resolution instead of queueing it', async () => {
    remoteFs.entries = [file('a.txt', '/srv/app/a.txt')]
    const { transferEntry, transferConflict } = useTransferIntents()
    await transferEntry('local', file('a.txt'))
    expect(enqueue).not.toHaveBeenCalled()
    expect(transferConflict.value?.conflicts).toHaveLength(1)
  })

  it('matches downloads case-insensitively on a windows destination', async () => {
    localFs.entries = [file('REPORT.TXT', 'C:\\Users\\me\\REPORT.TXT')]
    const { transferEntry, transferConflict } = useTransferIntents()
    await transferEntry('remote', file('report.txt', '/srv/report.txt'))
    expect(transferConflict.value?.conflicts).toHaveLength(1)
  })

  it('does nothing without an active session', async () => {
    sessions.activeSessionId = null as unknown as string
    const { transferEntry } = useTransferIntents()
    await transferEntry('local', file('a.txt'))
    expect(enqueue).not.toHaveBeenCalled()
    sessions.activeSessionId = 'sess-1'
  })
})
