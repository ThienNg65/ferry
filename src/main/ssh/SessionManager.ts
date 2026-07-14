import { Client, type ClientChannel, type ConnectConfig, type HostVerifier } from 'ssh2'
import { randomUUID } from 'crypto'
import { readFileSync } from 'fs'
import { BrowserWindow } from 'electron'
import { RemoteShell } from './RemoteShell'
import { SshError } from './errors'
import { evaluateHostKey, fingerprintHostKey, KnownHostsStore } from './KnownHostsStore'
import { mergeAnswers, partitionPrompts } from './keyboardInteractive'
import { SiteStore } from '../sites/SiteStore'
import { TailManager } from '../tail/TailManager'
import { TerminalManager } from '../terminal/TerminalManager'
import {
  EVENT_CHANNELS,
  type AuthMethod,
  type JumpHostConfig,
  type KeyboardInteractiveRequestEvent,
  type QuickConnectInput,
  type SessionStatus,
  type SessionStatusEvent
} from '../../shared/contract'

interface SessionEntry {
  sessionId: string
  siteId: string | null
  client: Client
  /** The bastion hop's own client, if this session connects through a jump host — closed alongside `client`. */
  jumpClient: Client | null
  shell: RemoteShell
  status: SessionStatus
  cwdRemote: string
}

interface ConnectInput {
  host: string
  port: number
  username: string
  authMethod: AuthMethod
  privateKeyPath?: string
  /** Overrides the platform-default ssh-agent socket/pipe path (agent auth only). */
  agentPath?: string
  password?: string
  passphrase?: string
  /** Decrypted jump-host secrets, if this connect tunnels through a bastion. */
  jumpHost?: JumpHostConfig
}

const DEFAULT_CONNECT_TIMEOUT_MS = 20_000

/** The auth-relevant subset of {@link ConnectInput}, shared by both the target host and a jump host. */
interface HopAuth {
  authMethod: AuthMethod
  privateKeyPath?: string
  agentPath?: string
  password?: string
  passphrase?: string
}

/** Mutable holder for a hop's host-key mismatch, if its `hostVerifier` rejects — see the comment at its construction site for why this isn't a plain `let`. */
interface HostKeyMismatchHolder {
  value: { expected: string; presented: string } | null
}

/** Resolves the platform-default ssh-agent socket/pipe when a site doesn't override it. */
function defaultAgentPath(): string {
  if (process.platform === 'win32') {
    // The modern Windows 10+ built-in OpenSSH Agent service's named pipe.
    // Users on Pageant (PuTTY) instead should set the site's "Agent path"
    // override to the literal string `pageant`.
    return '\\\\.\\pipe\\openssh-ssh-agent'
  }
  if (!process.env.SSH_AUTH_SOCK) {
    throw new SshError('VALIDATION', 'No SSH agent detected (SSH_AUTH_SOCK is not set) — start one, or set an explicit agent path on this site')
  }
  return process.env.SSH_AUTH_SOCK
}

/**
 * SessionManager — pool of concurrent SSH/SFTP connections, keyed by a
 * renderer-issued `sessionId` (UUID) rather than a fixed saved-site id, so the
 * same site can be connected more than once (e.g. one session for browsing,
 * another for a log tail).
 *
 * Deliberately does NOT auto-reconnect a dropped browsing session — stale
 * directory listings and in-flight transfers make silent reconnect unsafe.
 * On unexpected close the session is marked `error` and the user must
 * explicitly reconnect. Auto-reconnect is reserved for the tail subsystem.
 */
export class SessionManager {
  private static instance: SessionManager | null = null
  private readonly sessions = new Map<string, SessionEntry>()
  /** Resolvers for keyboard-interactive prompts currently awaiting a renderer response, keyed by requestId. */
  private readonly pendingKeyboardInteractive = new Map<string, (responses: string[]) => void>()

  static getInstance(): SessionManager {
    if (SessionManager.instance === null) {
      SessionManager.instance = new SessionManager()
    }
    return SessionManager.instance
  }

  /** Returns the RemoteShell for a connected session, or throws NOT_FOUND. */
  shell(sessionId: string): RemoteShell {
    const entry = this.get(sessionId)
    if (entry.status !== 'connected') {
      throw new SshError('NOT_FOUND', `Session ${sessionId} is not connected`)
    }
    return entry.shell
  }

  cwd(sessionId: string): string {
    return this.get(sessionId).cwdRemote
  }

  setCwd(sessionId: string, path: string): void {
    this.get(sessionId).cwdRemote = path
  }

  private get(sessionId: string): SessionEntry {
    const entry = this.sessions.get(sessionId)
    if (!entry) {
      throw new SshError('NOT_FOUND', `Session ${sessionId} not found`)
    }
    return entry
  }

  /** Delivers the renderer's answers for a pending keyboard-interactive prompt. Safe to call with a stale/unknown requestId (e.g. a duplicate submit) — it's just ignored. */
  respondKeyboardInteractive(requestId: string, responses: string[]): void {
    const resolve = this.pendingKeyboardInteractive.get(requestId)
    if (!resolve) {
      return
    }
    this.pendingKeyboardInteractive.delete(requestId)
    resolve(responses)
  }

  /** Broadcasts a keyboard-interactive challenge to the renderer and waits for its answer. */
  private promptKeyboardInteractive(
    sessionId: string,
    name: string,
    instructions: string,
    prompts: { prompt: string; echo: boolean }[]
  ): Promise<string[]> {
    return new Promise((resolve) => {
      const requestId = randomUUID()
      this.pendingKeyboardInteractive.set(requestId, resolve)
      const payload: KeyboardInteractiveRequestEvent = { requestId, sessionId, name, instructions, prompts }
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) {
          win.webContents.send(EVENT_CHANNELS.keyboardInteractivePrompt, payload)
        }
      }
    })
  }

  /**
   * Opens a session from a saved site, decrypting its secrets for this connect only.
   *
   * @param trustHostKeyChange - when true, silently overwrite a previously-trusted host
   *   key that no longer matches instead of rejecting with `HOST_KEY_MISMATCH` — only
   *   set this on a user-confirmed retry after they've seen the mismatch warning.
   */
  async openFromSite(
    siteId: string,
    trustHostKeyChange = false
  ): Promise<{ sessionId: string; status: SessionStatus }> {
    const site = SiteStore.getInstance().getRaw(siteId)
    if (!site) {
      throw new SshError('NOT_FOUND', `Site ${siteId} not found`)
    }
    const secrets = SiteStore.getInstance().getDecryptedSecrets(siteId)
    const jumpSecrets = SiteStore.getInstance().getDecryptedJumpHostSecrets(siteId)
    return this.connect(
      siteId,
      {
        host: site.host,
        port: site.port,
        username: site.username,
        authMethod: site.authMethod,
        privateKeyPath: site.privateKeyPath,
        agentPath: site.agentPath,
        // Gated on the site's own authMethod, not just "is a password stored" —
        // otherwise a site switched to privateKey/agent auth would still hand a
        // leftover stored password to any keyboard-interactive prompt matching
        // /password/i (see keyboardInteractive.ts's partitionPrompts).
        password: site.authMethod === 'password' ? secrets.password : undefined,
        passphrase: site.authMethod === 'privateKey' ? secrets.passphrase : undefined,
        jumpHost: site.jumpHost
          ? {
              host: site.jumpHost.host,
              port: site.jumpHost.port,
              username: site.jumpHost.username,
              authMethod: site.jumpHost.authMethod,
              privateKeyPath: site.jumpHost.privateKeyPath,
              password: site.jumpHost.authMethod === 'password' ? jumpSecrets?.password : undefined,
              passphrase: site.jumpHost.authMethod === 'privateKey' ? jumpSecrets?.passphrase : undefined
            }
          : undefined
      },
      site.remoteInitialPath ?? '.',
      trustHostKeyChange
    )
  }

  /** Opens an ad-hoc session that isn't saved as a site. See {@link openFromSite} for `trustHostKeyChange`. */
  async openQuickConnect(
    input: QuickConnectInput,
    trustHostKeyChange = false
  ): Promise<{ sessionId: string; status: SessionStatus }> {
    return this.connect(null, input, input.remoteInitialPath ?? '.', trustHostKeyChange)
  }

  /** Builds a `hostVerifier`-equipped `ConnectConfig` for one hop (the target host, or a jump host), keyed by its own host:port in `KnownHostsStore`. */
  private buildConnectConfig(
    host: string,
    port: number,
    username: string,
    auth: HopAuth,
    trustHostKeyChange: boolean
  ): { config: ConnectConfig; hostKeyMismatch: HostKeyMismatchHolder } {
    // A plain `let` reassigned only inside the hostVerifier closure below would
    // get incorrectly narrowed to `null` at the read site in the catch block
    // (TypeScript's control-flow analysis doesn't track closure reassignments) —
    // a mutable holder object sidesteps that.
    const hostKeyMismatch: HostKeyMismatchHolder = { value: null }
    const hostVerifier: HostVerifier = (key, verify) => {
      const presented = fingerprintHostKey(key)
      const known = KnownHostsStore.getInstance().get(host, port)
      const decision = evaluateHostKey(known, presented, trustHostKeyChange)
      if (decision === 'trust-new') {
        KnownHostsStore.getInstance().trust(host, port, presented)
        verify(true)
        return
      }
      if (decision === 'match') {
        verify(true)
        return
      }
      hostKeyMismatch.value = { expected: known as string, presented }
      verify(false)
    }
    const config: ConnectConfig = {
      host,
      port,
      username,
      readyTimeout: DEFAULT_CONNECT_TIMEOUT_MS,
      tryKeyboard: true,
      hostVerifier
    }
    if (auth.authMethod === 'password') {
      config.password = auth.password
    } else if (auth.authMethod === 'agent') {
      config.agent = auth.agentPath || defaultAgentPath()
    } else {
      if (!auth.privateKeyPath) {
        throw new SshError('VALIDATION', 'Private key path is required for private-key auth')
      }
      config.privateKey = readFileSync(auth.privateKeyPath)
      if (auth.passphrase) {
        config.passphrase = auth.passphrase
      }
    }
    return { config, hostKeyMismatch }
  }

  /** Connects one `ssh2.Client` (either the target host or a jump host), resolving on `ready`. Real keyboard-interactive prompts route through {@link promptKeyboardInteractive} under the given `sessionId`. */
  private connectClient(sessionId: string, client: Client, config: ConnectConfig, password: string | undefined): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const cleanup = (): void => {
        client.removeListener('ready', onReady)
        client.removeListener('error', onError)
        client.removeListener('timeout', onTimeout)
      }
      const onReady = (): void => {
        cleanup()
        resolve()
      }
      const onError = (e: Error): void => {
        cleanup()
        reject(new SshError('SSH_CONNECT', e.message))
      }
      const onTimeout = (): void => {
        cleanup()
        reject(new SshError('SSH_TIMEOUT', `Connection to ${config.host} timed out`))
      }
      client.on('ready', onReady)
      client.on('error', onError)
      client.on('timeout', onTimeout)
      client.on('keyboard-interactive', (name, instructions, _lang, prompts, finish) => {
        const { autoAnswered, needsUser } = partitionPrompts(prompts, password)
        if (needsUser.length === 0) {
          finish(mergeAnswers(prompts.length, autoAnswered, needsUser, []))
          return
        }
        // Forward only the prompts we couldn't answer ourselves (a real
        // 2FA/OTP challenge) to the renderer instead of silently replaying
        // the password into it, which would just fail.
        void this.promptKeyboardInteractive(
          sessionId,
          name,
          instructions,
          needsUser.map((p) => ({ prompt: p.prompt, echo: p.echo }))
        ).then((answers) => {
          finish(mergeAnswers(prompts.length, autoAnswered, needsUser, answers))
        })
      })
      client.connect(config)
    })
  }

  /** Opens a tunnel through an already-connected jump client to the real target's host:port, for use as the target connection's `sock`. */
  private forwardThroughJump(jumpClient: Client, targetHost: string, targetPort: number): Promise<ClientChannel> {
    return new Promise((resolve, reject) => {
      jumpClient.forwardOut('127.0.0.1', 0, targetHost, targetPort, (err, stream) => {
        if (err) {
          reject(new SshError('SSH_CONNECT', `Jump host tunnel to ${targetHost}:${targetPort} failed: ${err.message}`))
          return
        }
        resolve(stream)
      })
    })
  }

  private async connect(
    siteId: string | null,
    input: ConnectInput,
    initialCwd: string,
    trustHostKeyChange = false
  ): Promise<{ sessionId: string; status: SessionStatus }> {
    const sessionId = randomUUID()
    const client = new Client()
    const jumpClient = input.jumpHost ? new Client() : null
    const entry: SessionEntry = {
      sessionId,
      siteId,
      client,
      jumpClient,
      shell: new RemoteShell(client),
      status: 'connecting',
      cwdRemote: initialCwd
    }
    this.sessions.set(sessionId, entry)

    try {
      let sock: ClientChannel | undefined
      if (jumpClient && input.jumpHost) {
        const jump = input.jumpHost
        const { config: jumpConfig, hostKeyMismatch: jumpMismatch } = this.buildConnectConfig(
          jump.host,
          jump.port,
          jump.username,
          { authMethod: jump.authMethod, privateKeyPath: jump.privateKeyPath, password: jump.password, passphrase: jump.passphrase },
          trustHostKeyChange
        )
        try {
          await this.connectClient(sessionId, jumpClient, jumpConfig, jump.password)
        } catch (e) {
          throw jumpMismatch.value
            ? new SshError(
                'HOST_KEY_MISMATCH',
                `Jump host key for ${jump.host}:${jump.port} has changed! Expected ${jumpMismatch.value.expected} but the server presented ${jumpMismatch.value.presented}. This could mean a man-in-the-middle attack, or that the server was legitimately reinstalled/rekeyed — only continue if you're certain.`
              )
            : e
        }
        sock = await this.forwardThroughJump(jumpClient, input.host, input.port)
      }

      const { config: targetConfig, hostKeyMismatch } = this.buildConnectConfig(
        input.host,
        input.port,
        input.username,
        { authMethod: input.authMethod, privateKeyPath: input.privateKeyPath, agentPath: input.agentPath, password: input.password, passphrase: input.passphrase },
        trustHostKeyChange
      )
      if (sock) {
        targetConfig.sock = sock
      }

      try {
        await this.connectClient(sessionId, client, targetConfig, input.password)
      } catch (e) {
        throw hostKeyMismatch.value
          ? new SshError(
              'HOST_KEY_MISMATCH',
              `Host key for ${input.host}:${input.port} has changed! Expected ${hostKeyMismatch.value.expected} but the server presented ${hostKeyMismatch.value.presented}. This could mean a man-in-the-middle attack, or that the server was legitimately reinstalled/rekeyed — only continue if you're certain.`
            )
          : e
      }
    } catch (e) {
      entry.status = 'error'
      const message = e instanceof Error ? e.message : String(e)
      this.broadcastStatus(sessionId, 'error', message)
      this.sessions.delete(sessionId)
      jumpClient?.end()
      throw e
    }

    entry.status = 'connected'
    client.on('close', () => {
      const current = this.sessions.get(sessionId)
      if (current && current.status === 'connected') {
        current.status = 'error'
        this.broadcastStatus(sessionId, 'error', 'Connection closed unexpectedly')
      }
    })
    this.broadcastStatus(sessionId, 'connected')
    return { sessionId, status: 'connected' }
  }

  /** Closes and forgets a session. Safe to call on an already-closed session. */
  close(sessionId: string): void {
    const entry = this.sessions.get(sessionId)
    if (!entry) {
      return
    }
    entry.status = 'disconnected'
    TailManager.getInstance().stopAllForSession(sessionId)
    TerminalManager.getInstance().closeAllForSession(sessionId)
    entry.client.end()
    entry.jumpClient?.end()
    this.sessions.delete(sessionId)
    this.broadcastStatus(sessionId, 'disconnected')
  }

  private broadcastStatus(sessionId: string, status: SessionStatus, message?: string): void {
    const payload: SessionStatusEvent = { sessionId, status, message }
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send(EVENT_CHANNELS.sessionStatus, payload)
      }
    }
  }
}
