/**
 * Integration tests for SessionManager's host-key verification against a
 * REAL SFTP/SSH server. See RemoteShell.integration.test.ts's file header
 * for the docker command that starts the required test container.
 *
 * `electron`'s BrowserWindow (status broadcast) is mocked since these tests
 * run outside a real Electron process; SessionManager/KnownHostsStore
 * themselves are real and unmocked — KnownHostsStore's `known_hosts.json`
 * is real on-disk state (electron-store falls back to a plain OS config dir
 * outside Electron), so every test explicitly resets the entry for our test
 * host:port rather than relying on ambient state.
 */
import { Client } from 'ssh2'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ BrowserWindow: { getAllWindows: () => [] } }))

const HOST = '127.0.0.1'
const PORT = 2299
const USERNAME = 'ferrytest'
const PASSWORD = 'ferrytest123'

function probeServer(): Promise<boolean> {
  return new Promise((resolve) => {
    const client = new Client()
    client.on('ready', () => {
      client.end()
      resolve(true)
    })
    client.on('error', () => resolve(false))
    client.on('keyboard-interactive', (_n, _i, _l, _p, finish) => finish([PASSWORD]))
    client.connect({ host: HOST, port: PORT, username: USERNAME, password: PASSWORD, tryKeyboard: true, readyTimeout: 10_000 })
  })
}

const serverAvailable = await probeServer()
if (!serverAvailable) {
  // eslint-disable-next-line no-console
  console.warn(
    `[SessionManager.integration.test] Skipping — no test SFTP server reachable at ${HOST}:${PORT}. See RemoteShell.integration.test.ts for the docker run command.`
  )
}

describe.skipIf(!serverAvailable)('SessionManager host-key verification against a real SSH server', () => {
  let SessionManager: typeof import('./SessionManager').SessionManager
  let KnownHostsStore: typeof import('./KnownHostsStore').KnownHostsStore

  beforeAll(async () => {
    ;({ SessionManager } = await import('./SessionManager'))
    ;({ KnownHostsStore } = await import('./KnownHostsStore'))
  })

  // 127.0.0.1:2299 is also touched by TransferQueue.integration.test.ts and
  // SessionManager.jumphost.integration.test.ts (both legitimately TOFU-trust
  // it as a side effect) — force a clean slate before EVERY test here rather
  // than trying to snapshot/restore "prior" state, which would just preserve
  // whatever contamination a sibling file happened to leave behind.
  beforeEach(() => {
    KnownHostsStore.getInstance().forget(HOST, PORT)
  })

  afterAll(() => {
    KnownHostsStore.getInstance().forget(HOST, PORT)
  })

  afterEach(() => {
    KnownHostsStore.getInstance().forget(HOST, PORT)
  })

  function quickConnectInput(): { name: string; host: string; port: number; username: string; authMethod: 'password'; password: string } {
    return { name: 'ferry-test', host: HOST, port: PORT, username: USERNAME, authMethod: 'password', password: PASSWORD }
  }

  it('trusts an unknown host on first connect (TOFU) and remembers its fingerprint', async () => {
    expect(KnownHostsStore.getInstance().get(HOST, PORT)).toBeUndefined()
    const result = await SessionManager.getInstance().openQuickConnect(quickConnectInput())
    expect(result.status).toBe('connected')
    const stored = KnownHostsStore.getInstance().get(HOST, PORT)
    expect(stored).toBeDefined()
    expect(stored?.startsWith('SHA256:')).toBe(true)
    SessionManager.getInstance().close(result.sessionId)
  })

  it('reconnecting after a trusted first connect succeeds silently with the same fingerprint', async () => {
    const first = await SessionManager.getInstance().openQuickConnect(quickConnectInput())
    const trustedAfterFirst = KnownHostsStore.getInstance().get(HOST, PORT)
    SessionManager.getInstance().close(first.sessionId)

    const second = await SessionManager.getInstance().openQuickConnect(quickConnectInput())
    expect(second.status).toBe('connected')
    expect(KnownHostsStore.getInstance().get(HOST, PORT)).toBe(trustedAfterFirst)
    SessionManager.getInstance().close(second.sessionId)
  })

  it('rejects with HOST_KEY_MISMATCH when the stored fingerprint no longer matches the server', async () => {
    KnownHostsStore.getInstance().trust(HOST, PORT, 'SHA256:this-is-definitely-not-the-real-key')
    await expect(SessionManager.getInstance().openQuickConnect(quickConnectInput())).rejects.toMatchObject({
      code: 'HOST_KEY_MISMATCH'
    })
  })

  it('trustHostKeyChange=true overwrites a stale fingerprint and connects anyway', async () => {
    KnownHostsStore.getInstance().trust(HOST, PORT, 'SHA256:this-is-definitely-not-the-real-key')
    const result = await SessionManager.getInstance().openQuickConnect(quickConnectInput(), true)
    expect(result.status).toBe('connected')
    const stored = KnownHostsStore.getInstance().get(HOST, PORT)
    expect(stored).not.toBe('SHA256:this-is-definitely-not-the-real-key')
    SessionManager.getInstance().close(result.sessionId)
  })
})
