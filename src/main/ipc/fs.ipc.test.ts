import { describe, expect, it, vi, beforeEach } from 'vitest'
import { handlers } from './envelope'
import { MAX_TEXT_EDITOR_BYTES, type IpcResult } from '../../shared/contract'

const registered = handlers as unknown as Map<string, (...args: unknown[]) => Promise<unknown>>

vi.mock('../fs/LocalFsService', () => ({
  list: vi.fn(),
  mkdir: vi.fn(),
  touch: vi.fn(),
  rename: vi.fn(),
  remove: vi.fn(),
  readFileText: vi.fn(),
  writeFileText: vi.fn(),
  stageDroppedEntries: vi.fn(),
  beginStageDrop: vi.fn(),
  finishStageDrop: vi.fn(),
  abortStageDrop: vi.fn(),
  cleanupStagedDropPaths: vi.fn()
}))

vi.mock('../fs/RemoteFsService', () => ({
  listRemote: vi.fn(),
  mkdirRemote: vi.fn(),
  renameRemote: vi.fn(),
  chmodRemote: vi.fn(),
  readFile: vi.fn(),
  removeRemote: vi.fn()
}))

const operationRegistryMock = {
  run: vi.fn(async (_meta: unknown, fn: (ctx: { signal: AbortSignal; reportProgress: () => void }) => Promise<unknown>) =>
    fn({ signal: new AbortController().signal, reportProgress: vi.fn() })
  )
}

vi.mock('../operations/OperationRegistry', () => ({
  OperationRegistry: { getInstance: () => operationRegistryMock }
}))

async function invoke(channel: string, ...args: unknown[]): Promise<IpcResult<unknown>> {
  const cb = registered.get(channel)
  if (!cb) throw new Error(`channel not registered: ${channel}`)
  return (await cb({}, ...args)) as IpcResult<unknown>
}

describe('fs.ipc', () => {
  let LocalFs: typeof import('../fs/LocalFsService')
  let RemoteFs: typeof import('../fs/RemoteFsService')

  beforeEach(async () => {
    registered.clear()
    vi.clearAllMocks()
    operationRegistryMock.run.mockImplementation(async (_meta, fn) =>
      fn({ signal: new AbortController().signal, reportProgress: vi.fn() })
    )
    LocalFs = await import('../fs/LocalFsService')
    RemoteFs = await import('../fs/RemoteFsService')
    const { registerFsHandlers } = await import('./fs.ipc')
    registerFsHandlers()
  })

  it('fs:local:list forwards the directory path', async () => {
    vi.mocked(LocalFs.list).mockResolvedValueOnce({ entries: [], path: '/tmp' })
    const result = await invoke('fs:local:list', '/tmp')
    expect(LocalFs.list).toHaveBeenCalledWith('/tmp')
    expect(result).toEqual({ ok: true, data: { entries: [], path: '/tmp' } })
  })

  it('fs:local:mkdir forwards the path', async () => {
    const result = await invoke('fs:local:mkdir', '/tmp/new')
    expect(LocalFs.mkdir).toHaveBeenCalledWith('/tmp/new')
    expect(result).toEqual({ ok: true, data: undefined })
  })

  it('fs:local:rename forwards from/to paths', async () => {
    await invoke('fs:local:rename', '/tmp/a', '/tmp/b')
    expect(LocalFs.rename).toHaveBeenCalledWith('/tmp/a', '/tmp/b')
  })

  it('fs:local:delete forwards path and isDir as a boolean', async () => {
    await invoke('fs:local:delete', '/tmp/a', 1)
    expect(LocalFs.remove).toHaveBeenCalledWith('/tmp/a', true)
  })

  it('fs:local:readFile forwards the path', async () => {
    vi.mocked(LocalFs.readFileText).mockResolvedValueOnce({
      path: '/tmp/a.txt',
      content: 'hi',
      truncated: false,
      size: 2
    })
    const result = await invoke('fs:local:readFile', '/tmp/a.txt')
    expect(result).toEqual({ ok: true, data: { path: '/tmp/a.txt', content: 'hi', truncated: false, size: 2 } })
  })

  it('fs:local:readFile forwards an optional byte limit', async () => {
    await invoke('fs:local:readFile', '/tmp/a.txt', MAX_TEXT_EDITOR_BYTES)
    expect(LocalFs.readFileText).toHaveBeenCalledWith('/tmp/a.txt', MAX_TEXT_EDITOR_BYTES)
  })

  it('fs:local:writeFile forwards the request object', async () => {
    await invoke('fs:local:writeFile', { path: '/tmp/a.txt', content: 'hello' })
    expect(LocalFs.writeFileText).toHaveBeenCalledWith('/tmp/a.txt', 'hello')
  })

  it('fs:local:stage-drop forwards staged entries to LocalFsService', async () => {
    const req = { entries: [{ relativePath: 'notes.txt', isDir: false, data: new Uint8Array([104, 105]) }] }
    const staged = [{ name: 'notes.txt', path: '/tmp/ferry-drop-1/notes.txt', isDir: false, size: 2, modifiedAt: null, isSymlink: false }]
    vi.mocked(LocalFs.stageDroppedEntries).mockResolvedValueOnce(staged)
    const result = await invoke('fs:local:stage-drop', req)
    expect(LocalFs.stageDroppedEntries).toHaveBeenCalledWith(req)
    expect(result).toEqual({ ok: true, data: staged })
  })

  it('forwards streaming stage-drop lifecycle and cleanup channels to LocalFsService', async () => {
    vi.mocked(LocalFs.beginStageDrop).mockResolvedValueOnce({ stageId: 'st-1' })
    expect(await invoke('fs:local:stage-drop-begin', { dirs: ['sub'] })).toEqual({ ok: true, data: { stageId: 'st-1' } })
    expect(LocalFs.beginStageDrop).toHaveBeenCalledWith({ dirs: ['sub'] })

    vi.mocked(LocalFs.finishStageDrop).mockResolvedValueOnce([])
    expect(await invoke('fs:local:stage-drop-finish', { stageId: 'st-1' })).toEqual({ ok: true, data: [] })
    expect(LocalFs.finishStageDrop).toHaveBeenCalledWith('st-1')

    expect(await invoke('fs:local:stage-drop-abort', { stageId: 'st-1' })).toEqual({ ok: true, data: undefined })
    expect(LocalFs.abortStageDrop).toHaveBeenCalledWith('st-1')

    expect(await invoke('fs:local:cleanup-staged-drop', { paths: ['/tmp/ferry-drop-1/a.txt'] })).toEqual({
      ok: true,
      data: undefined
    })
    expect(LocalFs.cleanupStagedDropPaths).toHaveBeenCalledWith(['/tmp/ferry-drop-1/a.txt'])
  })

  it('fs:remote:list forwards sessionId, path, and isPrefetch flag', async () => {
    vi.mocked(RemoteFs.listRemote).mockResolvedValueOnce({ entries: [], path: '/root' })
    const result = await invoke('fs:remote:list', 'sess-1', '/root', true)
    expect(RemoteFs.listRemote).toHaveBeenCalledWith('sess-1', '/root', true)
    expect(result).toEqual({ ok: true, data: { entries: [], path: '/root' } })
  })

  it('fs:remote:mkdir forwards sessionId and path', async () => {
    await invoke('fs:remote:mkdir', 'sess-1', '/root/new')
    expect(RemoteFs.mkdirRemote).toHaveBeenCalledWith('sess-1', '/root/new')
  })

  it('fs:remote:rename forwards sessionId and from/to paths', async () => {
    await invoke('fs:remote:rename', 'sess-1', '/root/a', '/root/b')
    expect(RemoteFs.renameRemote).toHaveBeenCalledWith('sess-1', '/root/a', '/root/b')
  })

  it('fs:remote:delete runs through OperationRegistry and calls removeRemote', async () => {
    const result = await invoke('fs:remote:delete', 'sess-1', '/root/a')
    expect(operationRegistryMock.run).toHaveBeenCalled()
    expect(RemoteFs.removeRemote).toHaveBeenCalledWith('sess-1', '/root/a')
    expect(result).toEqual({ ok: true, data: undefined })
  })

  it('fs:remote:chmod forwards sessionId, path and mode', async () => {
    await invoke('fs:remote:chmod', 'sess-1', '/root/a', '755')
    expect(RemoteFs.chmodRemote).toHaveBeenCalledWith('sess-1', '/root/a', '755')
  })

  it('fs:remote:readFile forwards sessionId and path', async () => {
    vi.mocked(RemoteFs.readFile).mockResolvedValueOnce({ path: '/root/a', content: 'x', truncated: false, size: 1 })
    const result = await invoke('fs:remote:readFile', 'sess-1', '/root/a')
    expect(result).toEqual({ ok: true, data: { path: '/root/a', content: 'x', truncated: false, size: 1 } })
  })

  describe('fs:remote:deleteMany', () => {
    it('deletes every path that succeeds and collects failures for the rest', async () => {
      vi.mocked(RemoteFs.removeRemote).mockImplementation(async (_s, p: string) => {
        if (p === '/root/bad') throw new Error('permission denied')
      })
      const result = await invoke('fs:remote:deleteMany', { sessionId: 'sess-1', paths: ['/root/good', '/root/bad'] })
      expect(result).toMatchObject({
        ok: true,
        data: {
          deletedPaths: ['/root/good'],
          failures: [{ path: '/root/bad', error: 'permission denied' }]
        }
      })
    })

    it('reports an error result when every path fails', async () => {
      vi.mocked(RemoteFs.removeRemote).mockRejectedValue(new Error('nope'))
      const result = await invoke('fs:remote:deleteMany', { sessionId: 'sess-1', paths: ['/root/a'] })
      expect(result).toMatchObject({ ok: false })
    })
  })

  it('wraps an underlying LocalFsService throw into an error envelope', async () => {
    vi.mocked(LocalFs.list).mockRejectedValueOnce(new Error('ENOENT'))
    const result = await invoke('fs:local:list', '/missing')
    expect(result).toMatchObject({ ok: false, code: 'UNKNOWN', message: 'ENOENT' })
  })
})
