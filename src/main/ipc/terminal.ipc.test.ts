import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { IpcResult } from '../../shared/contract'

const registered = new Map<string, (...args: unknown[]) => Promise<unknown>>()
const sendHandlers = new Map<string, (...args: unknown[]) => void>()

vi.mock('electron', () => ({
  ipcMain: {
    removeHandler: vi.fn(),
    on: vi.fn((channel: string, cb: (...args: unknown[]) => void) => {
      sendHandlers.set(channel, cb)
    }),
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
  close: vi.fn(),
  ack: vi.fn()
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
    sendHandlers.clear()
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

  describe('terminal:input', () => {
    it('forwards terminalId/data to TerminalManager.write', () => {
      sendHandlers.get('terminal:input')!({}, { terminalId: 't1', data: 'ls -la\n' })
      expect(terminalManagerMock.write).toHaveBeenCalledWith('t1', 'ls -la\n')
    })
  })

  describe('terminal:resize', () => {
    it('forwards terminalId/cols/rows to TerminalManager.resize', () => {
      sendHandlers.get('terminal:resize')!({}, { terminalId: 't1', cols: 100, rows: 40 })
      expect(terminalManagerMock.resize).toHaveBeenCalledWith('t1', 100, 40)
    })
  })

  describe('terminal:ack', () => {
    it('forwards terminalId/bytes to TerminalManager.ack', () => {
      sendHandlers.get('terminal:ack')!({}, { terminalId: 't1', bytes: 1024 })
      expect(terminalManagerMock.ack).toHaveBeenCalledWith('t1', 1024)
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
