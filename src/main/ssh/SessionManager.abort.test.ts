import net from 'node:net'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('conf', () => ({
  default: class {
    get(): unknown {
      return undefined
    }
    set(): void {}
    has(): boolean {
      return false
    }
    delete(): void {}
  }
}))

describe('SessionManager.close() during connect', () => {
  let server: net.Server
  let port: number
  const sockets: net.Socket[] = []

  beforeAll(async () => {
    server = net.createServer((s) => {
      s.resume()
      sockets.push(s)
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    port = (server.address() as net.AddressInfo).port
  })

  afterAll(() => {
    sockets.forEach((s) => s.destroy())
    server.close()
  })

  it('rejects a hung handshake with CANCELLED and destroys the socket', async () => {
    const { SessionManager } = await import('./SessionManager')
    const manager = SessionManager.getInstance()
    const pending = manager.openQuickConnect(
      { host: '127.0.0.1', port, username: 'u', authMethod: 'password', password: 'p' } as never,
      'abort-test'
    )
    await vi.waitFor(() => expect(sockets.length).toBe(1), { timeout: 2000 })
    const closed = new Promise<void>((resolve) => sockets[0].once('close', () => resolve()))
    manager.close('abort-test')
    await expect(pending).rejects.toMatchObject({ code: 'CANCELLED' })
    await closed
  })

  it('releases target and jump sockets even when an earlier teardown step throws', async () => {
    const { SessionManager } = await import('./SessionManager')
    const { TailManager } = await import('../tail/TailManager')
    const manager = SessionManager.getInstance()
    const sessions = (manager as unknown as { sessions: Map<string, unknown> }).sessions
    const target = {
      end: vi.fn(() => { throw new Error('end failed') }),
      destroy: vi.fn()
    }
    const jump = { end: vi.fn(), destroy: vi.fn() }
    const tailStop = vi.spyOn(TailManager.getInstance(), 'stopAllForSession')
      .mockImplementation(() => { throw new Error('tail cleanup failed') })
    sessions.set('teardown-failure', {
      sessionId: 'teardown-failure', siteId: null, status: 'connected',
      client: target, jumpClients: [jump], abort: vi.fn()
    })
    try {
      expect(() => manager.close('teardown-failure')).toThrow(AggregateError)
      expect(target.end).toHaveBeenCalledTimes(1)
      expect(target.destroy).toHaveBeenCalledTimes(1)
      expect(jump.end).toHaveBeenCalledTimes(1)
      expect(jump.destroy).not.toHaveBeenCalled()
      expect(sessions.has('teardown-failure')).toBe(false)
      expect(() => manager.close('teardown-failure')).not.toThrow()
    } finally {
      tailStop.mockRestore()
      sessions.delete('teardown-failure')
    }
  })

  it('cancels a connect closed before the ssh2 module finishes loading', async () => {
    const { SessionManager } = await import('./SessionManager')
    const manager = SessionManager.getInstance()
    const pending = manager.openQuickConnect(
      { host: '127.0.0.1', port, username: 'u', authMethod: 'password', password: 'p' } as never,
      'early-abort'
    )
    manager.close('early-abort')
    await expect(pending).rejects.toMatchObject({ code: 'CANCELLED' })
  })
})
