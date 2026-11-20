import { describe, expect, it, vi, beforeEach } from 'vitest'
import { handlers } from './envelope'
import { SshError } from '../ssh/errors'
import type { IpcResult } from '../../shared/contract'

const registered = handlers as unknown as Map<string, (...args: unknown[]) => Promise<unknown>>

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

    it('rejects non-object payloads and missing/empty required fields with VALIDATION', async () => {
      expect(await invoke('tail:start', null)).toMatchObject({ ok: false, code: 'VALIDATION' })
      expect(await invoke('tail:start', [])).toMatchObject({ ok: false, code: 'VALIDATION' })
      expect(await invoke('tail:start', { sessionId: '  ', remotePath: '/var/log/app.log' })).toMatchObject({
        ok: false,
        code: 'VALIDATION'
      })
      expect(await invoke('tail:start', { sessionId: 's1', remotePath: '' })).toMatchObject({
        ok: false,
        code: 'VALIDATION'
      })
      expect(await invoke('tail:start', { sessionId: 's1', remotePath: '/var/log/app.log', historyLines: '100' })).toMatchObject({
        ok: false,
        code: 'VALIDATION'
      })
      expect(await invoke('tail:start', { sessionId: 's1', remotePath: '/var/log/app.log', historyLines: null })).toMatchObject({
        ok: false,
        code: 'VALIDATION'
      })
      expect(tailManagerMock.start).not.toHaveBeenCalled()
    })

    it('preserves SshError codes thrown synchronously by TailManager.start (e.g. disconnected session)', async () => {
      tailManagerMock.start.mockImplementationOnce(() => {
        throw new SshError('NOT_FOUND', 'Session s1 is not connected')
      })
      const result = await invoke('tail:start', { sessionId: 's1', remotePath: '/var/log/app.log' })
      expect(result).toEqual({ ok: false, code: 'NOT_FOUND', message: 'Session s1 is not connected', hostKey: undefined })
    })
  })

  describe('tail:stop', () => {
    it('forwards the tailId to TailManager.stop', async () => {
      const result = await invoke('tail:stop', 'tail-1')
      expect(tailManagerMock.stop).toHaveBeenCalledWith('tail-1')
      expect(result).toEqual({ ok: true, data: undefined })
    })

    it('rejects empty or non-string tailId with VALIDATION', async () => {
      expect(await invoke('tail:stop', '')).toMatchObject({ ok: false, code: 'VALIDATION' })
      expect(await invoke('tail:stop', '   ')).toMatchObject({ ok: false, code: 'VALIDATION' })
      expect(await invoke('tail:stop', null)).toMatchObject({ ok: false, code: 'VALIDATION' })
      expect(tailManagerMock.stop).not.toHaveBeenCalled()
    })
  })
})
