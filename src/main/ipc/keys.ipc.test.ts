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

vi.mock('../ssh/KeyGenerator', () => ({
  generateEd25519KeyPair: vi.fn()
}))

async function invoke(channel: string, ...args: unknown[]): Promise<IpcResult<unknown>> {
  const cb = registered.get(channel)
  if (!cb) throw new Error(`channel not registered: ${channel}`)
  return (await cb({}, ...args)) as IpcResult<unknown>
}

describe('keys.ipc', () => {
  let generateEd25519KeyPair: typeof import('../ssh/KeyGenerator').generateEd25519KeyPair

  beforeEach(async () => {
    registered.clear()
    vi.clearAllMocks()
    ;({ generateEd25519KeyPair } = await import('../ssh/KeyGenerator'))
    const { registerKeysHandlers } = await import('./keys.ipc')
    registerKeysHandlers()
  })

  it('keys:generate forwards the request and returns the generated key pair', async () => {
    vi.mocked(generateEd25519KeyPair).mockResolvedValueOnce({
      privateKeyPath: '/home/u/.ssh/id_ed25519',
      publicKeyPath: '/home/u/.ssh/id_ed25519.pub',
      publicKey: 'ssh-ed25519 AAAA...',
      method: 'builtin'
    })
    const req = { path: 'id_ed25519', passphrase: undefined }
    const result = await invoke('keys:generate', req)
    expect(generateEd25519KeyPair).toHaveBeenCalledWith(req)
    expect(result).toEqual({
      ok: true,
      data: {
        privateKeyPath: '/home/u/.ssh/id_ed25519',
        publicKeyPath: '/home/u/.ssh/id_ed25519.pub',
        publicKey: 'ssh-ed25519 AAAA...',
        method: 'builtin'
      }
    })
  })

  it('wraps an underlying keygen failure into an error envelope', async () => {
    vi.mocked(generateEd25519KeyPair).mockRejectedValueOnce(new Error('ssh-keygen not found'))
    const result = await invoke('keys:generate', { path: 'id_ed25519' })
    expect(result).toMatchObject({ ok: false, code: 'UNKNOWN', message: 'ssh-keygen not found' })
  })
})
