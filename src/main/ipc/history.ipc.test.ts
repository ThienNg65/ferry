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

const historyStoreMock = {
  list: vi.fn(),
  clear: vi.fn()
}

vi.mock('../history/HistoryStore', () => ({
  HistoryStore: { getInstance: () => historyStoreMock }
}))

async function invoke(channel: string, ...args: unknown[]): Promise<IpcResult<unknown>> {
  const cb = registered.get(channel)
  if (!cb) throw new Error(`channel not registered: ${channel}`)
  return (await cb({}, ...args)) as IpcResult<unknown>
}

describe('history.ipc', () => {
  beforeEach(async () => {
    registered.clear()
    vi.clearAllMocks()
    const { registerHistoryHandlers } = await import('./history.ipc')
    registerHistoryHandlers()
  })

  it('history:list forwards the query when provided', async () => {
    historyStoreMock.list.mockReturnValueOnce([{ id: '1', kind: 'transfer' }])
    const query = { kind: 'transfer' as const }
    const result = await invoke('history:list', query)
    expect(historyStoreMock.list).toHaveBeenCalledWith(query)
    expect(result).toEqual({ ok: true, data: [{ id: '1', kind: 'transfer' }] })
  })

  it('history:list works with no query argument', async () => {
    historyStoreMock.list.mockReturnValueOnce([])
    const result = await invoke('history:list')
    expect(historyStoreMock.list).toHaveBeenCalledWith(undefined)
    expect(result).toEqual({ ok: true, data: [] })
  })

  it('history:clear clears the store', async () => {
    const result = await invoke('history:clear')
    expect(historyStoreMock.clear).toHaveBeenCalledOnce()
    expect(result).toEqual({ ok: true, data: undefined })
  })

  it('wraps an underlying HistoryStore throw into an error envelope', async () => {
    historyStoreMock.list.mockImplementationOnce(() => {
      throw new Error('disk read failed')
    })
    const result = await invoke('history:list')
    expect(result).toMatchObject({ ok: false, code: 'UNKNOWN', message: 'disk read failed' })
  })
})
