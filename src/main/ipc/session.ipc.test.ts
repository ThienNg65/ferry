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

const sessionManagerMock = {
  openFromSite: vi.fn(),
  openQuickConnect: vi.fn(),
  close: vi.fn(),
  respondKeyboardInteractive: vi.fn()
}

vi.mock('../ssh/SessionManager', () => ({
  SessionManager: {
    getInstance: () => sessionManagerMock
  }
}))

async function invoke(channel: string, ...args: unknown[]): Promise<IpcResult<unknown>> {
  const cb = registered.get(channel)
  if (!cb) throw new Error(`channel not registered: ${channel}`)
  return (await cb({}, ...args)) as IpcResult<unknown>
}

describe('session.ipc', () => {
  beforeEach(async () => {
    registered.clear()
    vi.clearAllMocks()
    const { registerSessionHandlers } = await import('./session.ipc')
    registerSessionHandlers()
  })

  describe('session:open', () => {
    it('opens from a saved site when siteId is present', async () => {
      sessionManagerMock.openFromSite.mockResolvedValueOnce({ sessionId: 's1' })
      const result = await invoke('session:open', { siteId: 'site-1', sessionId: 's1', trustedHostKey: undefined })
      expect(sessionManagerMock.openFromSite).toHaveBeenCalledWith('site-1', 's1', undefined)
      expect(result).toEqual({ ok: true, data: { sessionId: 's1' } })
    })

    it('opens a quick-connect session when quickConnect is present', async () => {
      sessionManagerMock.openQuickConnect.mockResolvedValueOnce({ sessionId: 's2' })
      const quickConnect = { host: 'h', port: 22, username: 'u' }
      const result = await invoke('session:open', { quickConnect, sessionId: 's2' })
      expect(sessionManagerMock.openQuickConnect).toHaveBeenCalledWith(quickConnect, 's2', undefined)
      expect(result).toEqual({ ok: true, data: { sessionId: 's2' } })
    })

    it('rejects a request with neither siteId nor quickConnect', async () => {
      const result = await invoke('session:open', { sessionId: 's3' })
      expect(result).toMatchObject({ ok: false, code: 'VALIDATION' })
      expect(sessionManagerMock.openFromSite).not.toHaveBeenCalled()
      expect(sessionManagerMock.openQuickConnect).not.toHaveBeenCalled()
    })

    it('wraps a thrown SshError from the underlying manager into an error envelope', async () => {
      const { SshError } = await import('../ssh/errors')
      sessionManagerMock.openFromSite.mockRejectedValueOnce(new SshError('SSH_CONNECT', 'boom'))
      const result = await invoke('session:open', { siteId: 'site-1', sessionId: 's1' })
      expect(result).toMatchObject({ ok: false, code: 'SSH_CONNECT', message: 'boom' })
    })
  })

  describe('session:close', () => {
    it('closes the given session id', async () => {
      const result = await invoke('session:close', 'sess-1')
      expect(sessionManagerMock.close).toHaveBeenCalledWith('sess-1')
      expect(result).toEqual({ ok: true, data: undefined })
    })
  })

  describe('session:keyboard-interactive-respond', () => {
    it('forwards an array of responses to the manager', async () => {
      const result = await invoke('session:keyboard-interactive-respond', {
        requestId: 'req-1',
        responses: ['pw1']
      })
      expect(sessionManagerMock.respondKeyboardInteractive).toHaveBeenCalledWith('req-1', ['pw1'])
      expect(result).toEqual({ ok: true, data: undefined })
    })

    it('rejects a non-array responses payload', async () => {
      const result = await invoke('session:keyboard-interactive-respond', {
        requestId: 'req-1',
        responses: 'not-an-array'
      })
      expect(result).toMatchObject({ ok: false, code: 'VALIDATION' })
      expect(sessionManagerMock.respondKeyboardInteractive).not.toHaveBeenCalled()
    })
  })
})
