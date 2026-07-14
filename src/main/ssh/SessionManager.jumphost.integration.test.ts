/**
 * Integration test for SessionManager's jump-host (bastion) tunneling against
 * a REAL SSH server. Uses the SAME test container as both hops: our process
 * connects to it directly as the "jump host" (port 2299, Docker-mapped), then
 * asks it to `forwardOut` to its OWN internal sshd port (2222, only reachable
 * from inside the container's network namespace) as the "target". This is a
 * legitimate way to exercise the full tunnel mechanics (connect jump -> forwardOut
 * -> second SSH handshake over the tunneled stream) without provisioning a
 * second server — see RemoteShell.integration.test.ts's file header for the
 * docker command that starts the container this test needs.
 */
import { Client } from 'ssh2'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ BrowserWindow: { getAllWindows: () => [] } }))

const JUMP_HOST = '127.0.0.1'
const JUMP_PORT = 2299 // Docker-mapped — reachable from this test process.
const TARGET_HOST = '127.0.0.1'
const TARGET_PORT = 2222 // The container's own internal sshd port — only reachable from inside it.
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
    client.connect({
      host: JUMP_HOST,
      port: JUMP_PORT,
      username: USERNAME,
      password: PASSWORD,
      tryKeyboard: true,
      readyTimeout: 10_000
    })
  })
}

const serverAvailable = await probeServer()
if (!serverAvailable) {
  // eslint-disable-next-line no-console
  console.warn(
    `[SessionManager.jumphost.integration.test] Skipping — no test SFTP server reachable at ${JUMP_HOST}:${JUMP_PORT}. See RemoteShell.integration.test.ts for the docker run command.`
  )
}

describe.skipIf(!serverAvailable)('SessionManager jump-host tunneling against a real SSH server', () => {
  let SessionManager: typeof import('./SessionManager').SessionManager
  let KnownHostsStore: typeof import('./KnownHostsStore').KnownHostsStore

  beforeAll(async () => {
    ;({ SessionManager } = await import('./SessionManager'))
    ;({ KnownHostsStore } = await import('./KnownHostsStore'))
  })

  afterEach(() => {
    KnownHostsStore.getInstance().forget(JUMP_HOST, JUMP_PORT)
    KnownHostsStore.getInstance().forget(TARGET_HOST, TARGET_PORT)
  })

  afterAll(() => {
    KnownHostsStore.getInstance().forget(JUMP_HOST, JUMP_PORT)
    KnownHostsStore.getInstance().forget(TARGET_HOST, TARGET_PORT)
  })

  it('tunnels through a jump host and completes a real SSH handshake with the target over it', async () => {
    const result = await SessionManager.getInstance().openQuickConnect({
      name: 'ferry-test-via-jump',
      host: TARGET_HOST,
      port: TARGET_PORT,
      username: USERNAME,
      authMethod: 'password',
      password: PASSWORD,
      jumpHost: {
        host: JUMP_HOST,
        port: JUMP_PORT,
        username: USERNAME,
        authMethod: 'password',
        password: PASSWORD
      }
    })
    expect(result.status).toBe('connected')

    // Prove the resulting session is genuinely live — not just "connected"
    // status with a dead channel — by running a real command over it.
    const shell = SessionManager.getInstance().shell(result.sessionId)
    const exec = await shell.exec('echo tunneled-ok')
    expect(exec.stdout.trim()).toBe('tunneled-ok')

    // Both hops get their own KnownHostsStore entry, keyed by their own host:port.
    expect(KnownHostsStore.getInstance().get(JUMP_HOST, JUMP_PORT)).toBeDefined()
    expect(KnownHostsStore.getInstance().get(TARGET_HOST, TARGET_PORT)).toBeDefined()

    SessionManager.getInstance().close(result.sessionId)
  })

  it('rejects with a clear error when the jump host itself fails to authenticate', async () => {
    await expect(
      SessionManager.getInstance().openQuickConnect({
        name: 'ferry-test-bad-jump',
        host: TARGET_HOST,
        port: TARGET_PORT,
        username: USERNAME,
        authMethod: 'password',
        password: PASSWORD,
        jumpHost: {
          host: JUMP_HOST,
          port: JUMP_PORT,
          username: USERNAME,
          authMethod: 'password',
          password: 'definitely-the-wrong-password'
        }
      })
    ).rejects.toThrow()
  })
})
