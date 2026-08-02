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

vi.mock('crypto', () => ({
  randomUUID: vi.fn(() => 'fixed-uuid')
}))

const terminalManagerMock = {
  open: vi.fn(),
  write: vi.fn(),
  resize: vi.fn(),
  close: vi.fn()
}

vi.mock('../terminal/TerminalManager', () => ({
  TerminalManager: {
    getInstance: () => terminalManagerMock
  }
}))

async function invoke(channel: string, ...args: unknown[]): Promise<IpcResult<unknown>> {
  const cb = registered.get(channel)
  if (!cb) throw new Error(`channel not registered: ${channel}`)
  return (await cb({}, ...args)) as IpcResult<unknown>
}

describe('terminal.ipc', () => {
  beforeEach(async () => {
    registered.clear()
    vi.clearAllMocks()
    const { registerTerminalHandlers } = await import('./terminal.ipc')
    registerTerminalHandlers()
  })

  describe('terminal:open', () => {
    it('generates a terminalId and forwards sessionId/cols/rows to TerminalManager.open', async () => {
      terminalManagerMock.open.mockResolvedValueOnce(undefined)
      const result = await invoke('terminal:open', { sessionId: 's1', cols: 80, rows: 24 })
      expect(terminalManagerMock.open).toHaveBeenCalledWith('fixed-uuid', 's1', 80, 24)
      expect(result).toEqual({ ok: true, data: { terminalId: 'fixed-uuid' } })
    })

    it('wraps a rejected TerminalManager.open into an error envelope', async () => {
      terminalManagerMock.open.mockRejectedValueOnce(new Error('connect failed'))
      const result = await invoke('terminal:open', { sessionId: 's1', cols: 80, rows: 24 })
      expect(result).toMatchObject({ ok: false, code: 'UNKNOWN', message: 'connect failed' })
    })
  })

  describe('terminal:write', () => {
    it('forwards terminalId/data to TerminalManager.write', async () => {
      const result = await invoke('terminal:write', { terminalId: 't1', data: 'ls -la\n' })
      expect(terminalManagerMock.write).toHaveBeenCalledWith('t1', 'ls -la\n')
      expect(result).toEqual({ ok: true, data: undefined })
    })

    it('wraps a thrown error (e.g. unknown terminalId) into an error envelope', async () => {
      terminalManagerMock.write.mockImplementationOnce(() => {
        throw new Error('unknown terminal')
      })
      const result = await invoke('terminal:write', { terminalId: 'nope', data: 'x' })
      expect(result).toMatchObject({ ok: false, code: 'UNKNOWN', message: 'unknown terminal' })
    })
  })

  describe('terminal:resize', () => {
    it('forwards terminalId/cols/rows to TerminalManager.resize', async () => {
      const result = await invoke('terminal:resize', { terminalId: 't1', cols: 100, rows: 40 })
      expect(terminalManagerMock.resize).toHaveBeenCalledWith('t1', 100, 40)
      expect(result).toEqual({ ok: true, data: undefined })
    })
  })

  describe('terminal:close', () => {
    it('forwards the terminalId to TerminalManager.close', async () => {
      const result = await invoke('terminal:close', 't1')
      expect(terminalManagerMock.close).toHaveBeenCalledWith('t1')
      expect(result).toEqual({ ok: true, data: undefined })
    })
  })
})
