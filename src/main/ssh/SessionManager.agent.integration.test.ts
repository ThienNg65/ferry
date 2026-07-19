/**
 * Integration test for SSH-agent authentication against a REAL SSH server and
 * a REAL running SSH agent — the one code path in the app that was
 * previously shipped without ever being verified end-to-end (see
 * agentDiagnostics.ts and SessionManager.ts's `authMethod === 'agent'`
 * branch).
 *
 * Requires the same test container as RemoteShell.integration.test.ts (see
 * that file's header for the `docker run` command), PLUS a real SSH agent
 * already running with at least one identity loaded and reachable at
 * `SSH_AUTH_SOCK`. This is scriptable on Linux/macOS CI:
 *
 *   ssh-keygen -t ed25519 -N '' -f /tmp/ferry-agent-test-key
 *   eval "$(ssh-agent -s)"
 *   ssh-add /tmp/ferry-agent-test-key
 *   npm test -- SessionManager.agent.integration
 *
 * The test reads whichever identity is already loaded (via the same
 * `createAgent`/`getIdentities` ssh2 uses internally), appends its public key
 * to the test container's `authorized_keys` for the duration of the test
 * (via the existing password-authenticated path), then removes it again in
 * `afterAll` — the container's auth state is left as it found it either way.
 *
 * Skips itself (with a console warning) if the container isn't reachable, if
 * `SSH_AUTH_SOCK` isn't set, or if the agent has zero identities loaded —
 * exactly the same self-skip philosophy as the other integration tests here.
 *
 * NOT exercised by this file, and NOT scriptable in CI — verify these
 * manually before considering agent-auth hardening done:
 *   1. Windows OpenSSH Agent service: `Set-Service ssh-agent -StartupType
 *      Automatic; Start-Service ssh-agent`, `ssh-add <test-key>`, verify
 *      `ssh-add -l` lists it, add its public half to the test container's
 *      authorized_keys, connect from Ferry with authMethod: 'agent' and the
 *      default agentPath (the named pipe) — confirm success. Then
 *      `Stop-Service ssh-agent` and confirm the "not reachable" error message.
 *   2. Pageant: install PuTTY, start Pageant, load a `.ppk` test key (convert
 *      with `puttygen`), set the site's Agent path to the literal `pageant`,
 *      connect — confirm success. Close Pageant, confirm the "not reachable"
 *      error message.
 *   3. No identities loaded: start either agent with zero keys added, connect
 *      — confirm the "no keys loaded" error message (not a generic timeout).
 *   4. Wrong key: load a key into the agent whose public half is NOT in the
 *      container's authorized_keys, connect — confirm the "server rejected
 *      all of them" message from `rewriteAgentAuthError`.
 */
import { Client, createAgent } from 'ssh2'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ BrowserWindow: { getAllWindows: () => [] } }))

const HOST = '127.0.0.1'
const PORT = 2299
const USERNAME = 'ferrytest'
const PASSWORD = 'ferrytest123'
const AUTHORIZED_KEYS_PATH = '~/.ssh/authorized_keys'

function connectWithPassword(): Promise<Client> {
  return new Promise((resolve, reject) => {
    const client = new Client()
    client.on('ready', () => resolve(client))
    client.on('error', reject)
    client.on('keyboard-interactive', (_n, _i, _l, _p, finish) => finish([PASSWORD]))
    client.connect({ host: HOST, port: PORT, username: USERNAME, password: PASSWORD, tryKeyboard: true, readyTimeout: 10_000 })
  })
}

function exec(client: Client, command: string): Promise<string> {
  return new Promise((resolve, reject) => {
    client.exec(command, (err, stream) => {
      if (err) {
        reject(err)
        return
      }
      let stdout = ''
      stream.on('data', (chunk: Buffer) => {
        stdout += chunk.toString('utf-8')
      })
      stream.on('close', () => resolve(stdout))
      stream.stderr.on('data', () => {})
    })
  })
}

async function probeServer(): Promise<boolean> {
  try {
    const client = await connectWithPassword()
    client.end()
    return true
  } catch {
    return false
  }
}

const agentSockPath = process.env.SSH_AUTH_SOCK
let agentPublicKeyLine: string | null = null
let agentAvailable = false

function isParsedKey(k: unknown): k is { type: string; getPublicSSH(): Buffer } {
  return typeof k === 'object' && k !== null && typeof (k as { getPublicSSH?: unknown }).getPublicSSH === 'function'
}

if (agentSockPath) {
  try {
    const agent = createAgent(agentSockPath)
    const identities = await new Promise<unknown[]>((resolve, reject) => {
      agent.getIdentities((err, keys) => (err ? reject(err) : resolve(keys ?? [])))
    })
    const key = identities.find(isParsedKey)
    if (key) {
      agentPublicKeyLine = `${key.type} ${key.getPublicSSH().toString('base64')} ferry-agent-integration-test`
      agentAvailable = true
    }
  } catch {
    agentAvailable = false
  }
}

const serverAvailable = await probeServer()
const canRun = serverAvailable && agentAvailable

if (!canRun) {
  // eslint-disable-next-line no-console
  console.warn(
    `[SessionManager.agent.integration.test] Skipping — needs both a reachable test SFTP server at ${HOST}:${PORT} ` +
      'and a real SSH agent (SSH_AUTH_SOCK set, with >=1 identity loaded). See this file\'s header for setup.'
  )
}

describe.skipIf(!canRun)('SessionManager agent authentication against a real SSH server and agent', () => {
  let SessionManager: typeof import('./SessionManager').SessionManager
  let KnownHostsStore: typeof import('./KnownHostsStore').KnownHostsStore
  let setupClient: Client

  beforeAll(async () => {
    ;({ SessionManager } = await import('./SessionManager'))
    ;({ KnownHostsStore } = await import('./KnownHostsStore'))
    setupClient = await connectWithPassword()
    await exec(setupClient, `mkdir -p ~/.ssh && echo '${agentPublicKeyLine}' >> ${AUTHORIZED_KEYS_PATH}`)
  })

  afterAll(async () => {
    // Best-effort: strip the line we added rather than truncating the whole
    // file, so this test never destroys pre-existing authorized_keys state.
    await exec(setupClient, `sed -i '\\|${agentPublicKeyLine}|d' ${AUTHORIZED_KEYS_PATH}`).catch(() => {})
    setupClient.end()
    KnownHostsStore.getInstance().forget(HOST, PORT)
  })

  it('authenticates via the SSH agent and completes a real command', async () => {
    const result = await SessionManager.getInstance().openQuickConnect({
      name: 'ferry-test-agent',
      host: HOST,
      port: PORT,
      username: USERNAME,
      authMethod: 'agent',
      agentPath: agentSockPath
    })
    expect(result.status).toBe('connected')

    const shell = SessionManager.getInstance().shell(result.sessionId)
    const execResult = await shell.exec('echo agent-auth-ok')
    expect(execResult.stdout.trim()).toBe('agent-auth-ok')

    SessionManager.getInstance().close(result.sessionId)
  })

  it('surfaces a clear error when the agent path does not resolve to a reachable agent', async () => {
    await expect(
      SessionManager.getInstance().openQuickConnect({
        name: 'ferry-test-agent-unreachable',
        host: HOST,
        port: PORT,
        username: USERNAME,
        authMethod: 'agent',
        agentPath: '/tmp/definitely-not-a-real-agent-socket'
      })
    ).rejects.toThrow(/not reachable/i)
  })
})
