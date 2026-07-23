import type { Client, ClientChannel, ConnectConfig, HostVerifier } from 'ssh2'
import type { Duplex } from 'stream'
import { randomUUID } from 'crypto'
import { readFile } from 'fs/promises'
import { BrowserWindow } from 'electron'
import { RemoteShell } from './RemoteShell'
import { SshError } from './errors'
import { probeAgent, rewriteAgentAuthError } from './agentDiagnostics'
import { connectViaProxy } from './ProxyConnector'
import { evaluateHostKey, fingerprintHostKey, KnownHostsStore } from './KnownHostsStore'
import { mergeAnswers, partitionPrompts } from './keyboardInteractive'
import { SiteStore } from '../sites/SiteStore'
import { AppSettingsStore } from '../app/AppSettingsStore'
import { TailManager } from '../tail/TailManager'
import { TerminalManager } from '../terminal/TerminalManager'
import { OperationRegistry } from '../operations/OperationRegistry'
import { MonitorManager } from '../monitor/MonitorManager'
import { EditSessionManager } from '../edit/EditSessionManager'
import {
  EVENT_CHANNELS,
  type AuthMethod,
  type JumpHostConfig,
  type KeyboardInteractiveRequestEvent,
  type ProxyConfig,
  type QuickConnectInput,
  type SessionStatus,
  type SessionStatusEvent
} from '../../shared/contract'

interface SessionEntry {
  sessionId: string
  siteId: string | null
  client: Client
  /** Bastion hop clients, in connect order (jumpClients[0] connected first) — closed in reverse order alongside `client`. */
  jumpClients: Client[]
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
  /** Decrypted jump-host chain, ordered hop 0 first, if this connect tunnels through one or more bastions. */
  jumpHosts?: JumpHostConfig[]
  /** Resolved proxy (custom or app-wide default — see `resolveEffectiveProxy`), applied to hop 0's transport only. */
  proxy?: ProxyConfig
}

/**
 * Resolves a site's (or quick-connect input's) effective proxy: `'none'`
 * forces a direct connection even if an app-wide default is set; `'custom'`
 * uses the site's own proxy; `'inherit'` (or `proxyMode` absent, for sites
 * saved before this feature existed) falls back to the app-wide default.
 *
 * Exported (only) so SessionManager.proxyResolution.test.ts can exercise it
 * directly without needing a real connection.
 */
export function resolveEffectiveProxy(
  proxyMode: 'inherit' | 'none' | 'custom' | undefined,
  customProxy: ProxyConfig | undefined
): ProxyConfig | undefined {
  if (proxyMode === 'none') {
    return undefined
  }
  if (proxyMode === 'custom') {
    return customProxy
  }
  return AppSettingsStore.getInstance().getDecryptedDefaultProxy()
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
  value: { expected: string; presented: string; host: string; port: number } | null
}

/** Identifies one specific hop or the target — the only host:port a user-confirmed retry force-trusts, so an unrelated concurrent mismatch elsewhere in the same connection still surfaces its own warning instead of being silently trusted. */
export interface TrustedHostKey {
  host: string
  port: number
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

  /** Best-effort saved-site id for a session (null for quick-connect, or an already-closed/unknown session) — for denormalizing history entries, not a connect-time API, so it never throws. */
  siteIdForSession(sessionId: string): string | null {
    return this.sessions.get(sessionId)?.siteId ?? null
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
   * @param trustedHostKey - set only on a user-confirmed retry after they've seen a mismatch
   *   warning for this exact host:port — silently overwrites that hop/target's previously-trusted
   *   key instead of rejecting with `HOST_KEY_MISMATCH`. Every other hop/target in the same
   *   connect attempt still verifies normally, even on retry.
   */
  async openFromSite(
    siteId: string,
    trustedHostKey?: TrustedHostKey
  ): Promise<{ sessionId: string; status: SessionStatus }> {
    const site = SiteStore.getInstance().getRaw(siteId)
    if (!site) {
      throw new SshError('NOT_FOUND', `Site ${siteId} not found`)
    }
    const secrets = SiteStore.getInstance().getDecryptedSecrets(siteId)
    const jumpHosts = SiteStore.getInstance().getDecryptedJumpHosts(siteId)
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
        jumpHosts: jumpHosts.length > 0 ? jumpHosts : undefined,
        proxy: resolveEffectiveProxy(site.proxyMode, SiteStore.getInstance().getDecryptedProxy(siteId))
      },
      site.remoteInitialPath ?? '.',
      trustedHostKey
    )
  }

  /** Opens an ad-hoc session that isn't saved as a site. See {@link openFromSite} for `trustedHostKey`. */
  async openQuickConnect(
    input: QuickConnectInput,
    trustedHostKey?: TrustedHostKey
  ): Promise<{ sessionId: string; status: SessionStatus }> {
    return this.connect(
      null,
      { ...input, proxy: resolveEffectiveProxy(input.proxyMode, input.proxy) },
      input.remoteInitialPath ?? '.',
      trustedHostKey
    )
  }

  /** Builds a `hostVerifier`-equipped `ConnectConfig` for one hop (the target host, or a jump host), keyed by its own host:port in `KnownHostsStore`. */
  private async buildConnectConfig(
    host: string,
    port: number,
    username: string,
    auth: HopAuth,
    trustedHostKey: TrustedHostKey | undefined
  ): Promise<{ config: ConnectConfig; hostKeyMismatch: HostKeyMismatchHolder; agentIdentityCount?: number }> {
    // A plain `let` reassigned only inside the hostVerifier closure below would
    // get incorrectly narrowed to `null` at the read site in the catch block
    // (TypeScript's control-flow analysis doesn't track closure reassignments) —
    // a mutable holder object sidesteps that.
    const hostKeyMismatch: HostKeyMismatchHolder = { value: null }
    // Only force-trust a mismatch for the exact host:port the user was warned about and
    // confirmed — every other hop/target in this same connect attempt still verifies normally.
    const forceTrustThisHop = trustedHostKey?.host === host && trustedHostKey?.port === port
    const hostVerifier: HostVerifier = (key, verify) => {
      const presented = fingerprintHostKey(key)
      const known = KnownHostsStore.getInstance().get(host, port)
      const decision = evaluateHostKey(known, presented, forceTrustThisHop)
      if (decision === 'trust-new') {
        KnownHostsStore.getInstance().trust(host, port, presented)
        verify(true)
        return
      }
      if (decision === 'match') {
        verify(true)
        return
      }
      hostKeyMismatch.value = { expected: known as string, presented, host, port }
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
    let agentIdentityCount: number | undefined
    if (auth.authMethod === 'password') {
      config.password = auth.password
    } else if (auth.authMethod === 'agent') {
      const agentPath = auth.agentPath || defaultAgentPath()
      // Pre-flight: ssh2 delegates all agent-protocol failures to its own opaque
      // internal agent classes, so without this check "agent not running" and
      // "wrong key" both surface as the same generic handshake failure below.
      try {
        agentIdentityCount = (await probeAgent(agentPath)).identityCount
      } catch (e) {
        throw new SshError(
          'VALIDATION',
          `SSH agent not reachable at "${agentPath}" — is it running? (${e instanceof Error ? e.message : String(e)})`
        )
      }
      if (agentIdentityCount === 0) {
        throw new SshError(
          'VALIDATION',
          'SSH agent has no keys loaded — run `ssh-add`, or load a key into Pageant, then retry.'
        )
      }
      config.agent = agentPath
    } else {
      if (!auth.privateKeyPath) {
        throw new SshError('VALIDATION', 'Private key path is required for private-key auth')
      }
      config.privateKey = await readFile(auth.privateKeyPath)
      if (auth.passphrase) {
        config.passphrase = auth.passphrase
      }
    }
    return { config, hostKeyMismatch, agentIdentityCount }
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

  /** Opens a tunnel through an already-connected jump client to the next hop's (or the final target's) host:port, for use as that connection's `sock`. */
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
    trustedHostKey?: TrustedHostKey
  ): Promise<{ sessionId: string; status: SessionStatus }> {
    const sessionId = randomUUID()
    // Lazy-load ssh2 (a heavy module with a native optional dep) only when the
    // user actually connects, keeping it off the app-startup critical path.
    // Aliased so the runtime binding doesn't collide with the file-wide `Client`
    // type-only import.
    const { Client: SshClient } = await import('ssh2')
    const client = new SshClient()
    const hops = input.jumpHosts ?? []
    const jumpClients: Client[] = hops.map(() => new SshClient())
    
    // Prevent unhandled exception crashes if a socket drops unexpectedly
    // and emits an 'error' event after the connection-time listeners are removed.
    // The subsequent 'close' event handles the actual cleanup/status broadcast.
    client.on('error', () => {})
    for (const jc of jumpClients) {
      jc.on('error', () => {})
    }

    const entry: SessionEntry = {
      sessionId,
      siteId,
      client,
      jumpClients,
      shell: new RemoteShell(client),
      status: 'connecting',
      cwdRemote: initialCwd
    }
    this.sessions.set(sessionId, entry)

    // `sock` carries the transport for the NEXT connection attempt — undefined for hop 0 (a
    // plain direct TCP connect), then re-set after each hop to a fresh tunnel opened through
    // that hop, so it's ready for hop i+1 (or, once the loop ends, for the final target connect
    // below). Hoisted above the try so the catch block can destroy whatever transport was last
    // established if a later step throws — otherwise a proxy socket (or an intermediate jump
    // tunnel) that connected successfully just before a subsequent auth/host-key failure would
    // never be closed.
    let sock: ClientChannel | Duplex | undefined
    try {
      if (input.proxy) {
        // Only ever supplies hop 0's transport — reaching hop 1+ (or the
        // target, once the loop below ends) still goes through the SSH-level
        // forwardOut tunnel exactly as without a proxy. This is the
        // minimal-blast-radius integration point: the proxy only solves "how
        // do I reach the first machine."
        const first = hops.length > 0 ? hops[0] : input
        sock = await connectViaProxy(input.proxy, first.host, first.port)
      }
      for (let i = 0; i < hops.length; i++) {
        const hop = hops[i]
        const hopClient = jumpClients[i]
        const { config: hopConfig, hostKeyMismatch: hopMismatch } = await this.buildConnectConfig(
          hop.host,
          hop.port,
          hop.username,
          { authMethod: hop.authMethod, privateKeyPath: hop.privateKeyPath, password: hop.password, passphrase: hop.passphrase },
          trustedHostKey
        )
        if (sock) {
          hopConfig.sock = sock
        }
        try {
          await this.connectClient(sessionId, hopClient, hopConfig, hop.password)
        } catch (e) {
          throw hopMismatch.value
            ? new SshError(
                'HOST_KEY_MISMATCH',
                `Jump host key for ${hop.host}:${hop.port} (hop ${i + 1} of ${hops.length}) has changed! Expected ${hopMismatch.value.expected} but the server presented ${hopMismatch.value.presented}. This could mean a man-in-the-middle attack, or that the server was legitimately reinstalled/rekeyed — only continue if you're certain.`,
                false,
                { host: hopMismatch.value.host, port: hopMismatch.value.port }
              )
            : e
        }
        const next = i + 1 < hops.length ? hops[i + 1] : input
        sock = await this.forwardThroughJump(hopClient, next.host, next.port)
      }

      const { config: targetConfig, hostKeyMismatch, agentIdentityCount } = await this.buildConnectConfig(
        input.host,
        input.port,
        input.username,
        { authMethod: input.authMethod, privateKeyPath: input.privateKeyPath, agentPath: input.agentPath, password: input.password, passphrase: input.passphrase },
        trustedHostKey
      )
      if (sock) {
        targetConfig.sock = sock
      }

      try {
        await this.connectClient(sessionId, client, targetConfig, input.password)
      } catch (e) {
        if (hostKeyMismatch.value) {
          throw new SshError(
            'HOST_KEY_MISMATCH',
            `Host key for ${input.host}:${input.port} has changed! Expected ${hostKeyMismatch.value.expected} but the server presented ${hostKeyMismatch.value.presented}. This could mean a man-in-the-middle attack, or that the server was legitimately reinstalled/rekeyed — only continue if you're certain.`,
            false,
            { host: hostKeyMismatch.value.host, port: hostKeyMismatch.value.port }
          )
        }
        if (agentIdentityCount !== undefined && e instanceof SshError) {
          throw new SshError(e.code, rewriteAgentAuthError(e.message, agentIdentityCount))
        }
        throw e
      }
    } catch (e) {
      entry.status = 'error'
      const message = e instanceof Error ? e.message : String(e)
      this.broadcastStatus(sessionId, 'error', message)
      this.sessions.delete(sessionId)
      for (let i = jumpClients.length - 1; i >= 0; i--) {
        jumpClients[i].end()
      }
      sock?.destroy()
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
    OperationRegistry.getInstance().cancelAllForSession(sessionId)
    MonitorManager.getInstance().stopAllForSession(sessionId)
    EditSessionManager.getInstance().closeAllForSession(sessionId)
    entry.client.end()
    for (let i = entry.jumpClients.length - 1; i >= 0; i--) {
      entry.jumpClients[i].end()
    }
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
