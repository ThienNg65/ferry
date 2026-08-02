import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { IpcResult } from '../../shared/contract'

/**
 * Captures every channel registered via `handle()`'s `ipcMain.handle(channel, cb)`
 * so the wrapped callback can be invoked directly, without a real Electron runtime.
 */
const registered = new Map<string, (...args: unknown[]) => Promise<unknown>>()

vi.mock('electron', () => ({
  ipcMain: {
    removeHandler: vi.fn(),
    handle: vi.fn((channel: string, cb: (...args: unknown[]) => Promise<unknown>) => {
      registered.set(channel, cb)
    })
  }
}))

const monitorManagerMock = {
  start: vi.fn(),
  stop: vi.fn()
}

vi.mock('../monitor/MonitorManager', () => ({
  MonitorManager: {
    getInstance: () => monitorManagerMock
  }
}))

async function invoke(channel: string, ...args: unknown[]): Promise<IpcResult<unknown>> {
  const cb = registered.get(channel)
  if (!cb) throw new Error(`channel not registered: ${channel}`)
  return (await cb({}, ...args)) as IpcResult<unknown>
}

describe('monitor.ipc', () => {
  beforeEach(async () => {
    registered.clear()
    vi.clearAllMocks()
    const { registerMonitorHandlers } = await import('./monitor.ipc')
    registerMonitorHandlers()
  })

  describe('monitor:start', () => {
    it('forwards sessionId and intervalMs to MonitorManager.start', async () => {
      const result = await invoke('monitor:start', { sessionId: 's1', intervalMs: 5000 })
      expect(monitorManagerMock.start).toHaveBeenCalledWith('s1', 5000)
      expect(result).toEqual({ ok: true, data: undefined })
    })

    it('forwards an undefined intervalMs unchanged rather than substituting a default at the IPC layer — clamping/defaulting is MonitorManager\'s job', async () => {
      const result = await invoke('monitor:start', { sessionId: 's1' })
      expect(monitorManagerMock.start).toHaveBeenCalledWith('s1', undefined)
      expect(result).toEqual({ ok: true, data: undefined })
    })

    it('forwards an out-of-range intervalMs as-is (no IPC-layer clamping) so MonitorManager remains the single source of truth for sanitizing it', async () => {
      await invoke('monitor:start', { sessionId: 's1', intervalMs: 1 })
      expect(monitorManagerMock.start).toHaveBeenCalledWith('s1', 1)
    })

    it('wraps a thrown error from MonitorManager.start into an error envelope', async () => {
      monitorManagerMock.start.mockImplementationOnce(() => {
        throw new Error('boom')
      })
      const result = await invoke('monitor:start', { sessionId: 's1', intervalMs: 1000 })
      expect(result).toMatchObject({ ok: false, code: 'UNKNOWN', message: 'boom' })
    })
  })

  describe('monitor:stop', () => {
    it('forwards the sessionId to MonitorManager.stop', async () => {
      const result = await invoke('monitor:stop', 's1')
      expect(monitorManagerMock.stop).toHaveBeenCalledWith('s1')
      expect(result).toEqual({ ok: true, data: undefined })
    })
  })
})
