import { describe, expect, it, vi, beforeEach } from 'vitest'
import { handlers } from './envelope'
import type { IpcResult } from '../../shared/contract'

const registered = handlers as unknown as Map<string, (...args: unknown[]) => Promise<unknown>>

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

  it('history:list rejects malformed query fields with VALIDATION code', async () => {
    const nonObject = await invoke('history:list', 'bad-query')
    expect(nonObject).toMatchObject({ ok: false, code: 'VALIDATION' })

    const badStatus = await invoke('history:list', { status: 'unknown' })
    expect(badStatus).toMatchObject({ ok: false, code: 'VALIDATION' })

    const badSearch = await invoke('history:list', { search: 123 })
    expect(badSearch).toMatchObject({ ok: false, code: 'VALIDATION' })

    const negativeLimit = await invoke('history:list', { limit: -5 })
    expect(negativeLimit).toMatchObject({ ok: false, code: 'VALIDATION' })

    expect(historyStoreMock.list).not.toHaveBeenCalled()
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
