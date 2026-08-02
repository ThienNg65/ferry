import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { IpcResult } from '../../shared/contract'

const registered = new Map<string, (...args: unknown[]) => Promise<unknown>>()

vi.mock('electron', () => ({
  ipcMain: {
    removeHandler: vi.fn(),
    handle: vi.fn((channel: string, cb: (...args: unknown[]) => Promise<unknown>) => {
      registered.set(channel, cb)
    })
  }
}))

const editSessionManagerMock = {
  openLocal: vi.fn(),
  openRemote: vi.fn(),
  openExternal: vi.fn(),
  closeEdit: vi.fn(),
  listEdits: vi.fn()
}

vi.mock('../edit/EditSessionManager', () => ({
  EditSessionManager: { getInstance: () => editSessionManagerMock }
}))

async function invoke(channel: string, ...args: unknown[]): Promise<IpcResult<unknown>> {
  const cb = registered.get(channel)
  if (!cb) throw new Error(`channel not registered: ${channel}`)
  return (await cb({}, ...args)) as IpcResult<unknown>
}

describe('edit.ipc', () => {
  beforeEach(async () => {
    registered.clear()
    vi.clearAllMocks()
    const { registerEditHandlers } = await import('./edit.ipc')
    registerEditHandlers()
  })

  describe('edit:openLocal', () => {
    it('opens a non-empty local path', async () => {
      const result = await invoke('edit:openLocal', '/tmp/file.txt')
      expect(editSessionManagerMock.openLocal).toHaveBeenCalledWith('/tmp/file.txt')
      expect(result).toEqual({ ok: true, data: undefined })
    })

    it('rejects an empty string path', async () => {
      const result = await invoke('edit:openLocal', '')
      expect(result).toMatchObject({ ok: false, code: 'VALIDATION' })
      expect(editSessionManagerMock.openLocal).not.toHaveBeenCalled()
    })

    it('rejects a non-string path', async () => {
      const result = await invoke('edit:openLocal', 42)
      expect(result).toMatchObject({ ok: false, code: 'VALIDATION' })
      expect(editSessionManagerMock.openLocal).not.toHaveBeenCalled()
    })
  })

  it('edit:openRemote forwards sessionId, path and builtin', async () => {
    editSessionManagerMock.openRemote.mockResolvedValueOnce({ editId: 'e1', localPath: '/tmp/e1' })
    const result = await invoke('edit:openRemote', { sessionId: 'sess-1', path: '/remote/a.txt', builtin: true })
    expect(editSessionManagerMock.openRemote).toHaveBeenCalledWith('sess-1', '/remote/a.txt', true)
    expect(result).toEqual({ ok: true, data: { editId: 'e1', localPath: '/tmp/e1' } })
  })

  it('edit:openExternal forwards editId', async () => {
    const result = await invoke('edit:openExternal', { editId: 'e1' })
    expect(editSessionManagerMock.openExternal).toHaveBeenCalledWith('e1')
    expect(result).toEqual({ ok: true, data: undefined })
  })

  it('edit:close forwards editId', async () => {
    const result = await invoke('edit:close', 'e1')
    expect(editSessionManagerMock.closeEdit).toHaveBeenCalledWith('e1')
    expect(result).toEqual({ ok: true, data: undefined })
  })

  it('edit:list returns the current snapshot list', async () => {
    editSessionManagerMock.listEdits.mockResolvedValueOnce([{ editId: 'e1' }])
    const result = await invoke('edit:list')
    expect(result).toEqual({ ok: true, data: [{ editId: 'e1' }] })
  })

  it('wraps an underlying openLocal throw into an error envelope', async () => {
    editSessionManagerMock.openLocal.mockRejectedValueOnce(new Error('cannot read file'))
    const result = await invoke('edit:openLocal', '/tmp/missing.txt')
    expect(result).toMatchObject({ ok: false, code: 'UNKNOWN', message: 'cannot read file' })
  })
})
