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

const tailManagerMock = {
  start: vi.fn(),
  stop: vi.fn()
}

vi.mock('../tail/TailManager', () => ({
  TailManager: {
    getInstance: () => tailManagerMock
  }
}))

async function invoke(channel: string, ...args: unknown[]): Promise<IpcResult<unknown>> {
  const cb = registered.get(channel)
  if (!cb) throw new Error(`channel not registered: ${channel}`)
  return (await cb({}, ...args)) as IpcResult<unknown>
}

describe('tail.ipc', () => {
  beforeEach(async () => {
    registered.clear()
    vi.clearAllMocks()
    const { registerTailHandlers } = await import('./tail.ipc')
    registerTailHandlers()
  })

  describe('tail:start', () => {
    it('generates a tailId and forwards sessionId/remotePath/historyLines to TailManager.start', async () => {
      const result = await invoke('tail:start', {
        sessionId: 's1',
        remotePath: '/var/log/app.log',
        historyLines: 500
      })
      expect(tailManagerMock.start).toHaveBeenCalledWith('fixed-uuid', 's1', '/var/log/app.log', 500)
      expect(result).toEqual({ ok: true, data: { tailId: 'fixed-uuid' } })
    })

    it('forwards an undefined historyLines unchanged — clamping/defaulting is TailManager\'s job, not the IPC layer\'s', async () => {
      await invoke('tail:start', { sessionId: 's1', remotePath: '/var/log/app.log' })
      expect(tailManagerMock.start).toHaveBeenCalledWith('fixed-uuid', 's1', '/var/log/app.log', undefined)
    })

    it('forwards an out-of-range historyLines as-is without clamping at the IPC layer', async () => {
      await invoke('tail:start', { sessionId: 's1', remotePath: '/var/log/app.log', historyLines: 999999 })
      expect(tailManagerMock.start).toHaveBeenCalledWith('fixed-uuid', 's1', '/var/log/app.log', 999999)
    })

    it('wraps a thrown error from TailManager.start into an error envelope', async () => {
      tailManagerMock.start.mockImplementationOnce(() => {
        throw new Error('no such file')
      })
      const result = await invoke('tail:start', { sessionId: 's1', remotePath: '/missing' })
      expect(result).toMatchObject({ ok: false, code: 'UNKNOWN', message: 'no such file' })
    })
  })

  describe('tail:stop', () => {
    it('forwards the tailId to TailManager.stop', async () => {
      const result = await invoke('tail:stop', 'tail-1')
      expect(tailManagerMock.stop).toHaveBeenCalledWith('tail-1')
      expect(result).toEqual({ ok: true, data: undefined })
    })
  })
})
