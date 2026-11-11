import net from 'node:net'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ BrowserWindow: { getAllWindows: () => [] }, app: { getPath: () => '.' } }))
vi.mock('electron-store', () => ({
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
})
