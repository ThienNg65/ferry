import { Client, type ConnectConfig } from 'ssh2'
import { randomUUID } from 'crypto'
import { readFileSync } from 'fs'
import { BrowserWindow } from 'electron'
import { RemoteShell } from './RemoteShell'
import { SshError } from './errors'
import { SiteStore } from '../sites/SiteStore'
import { TailManager } from '../tail/TailManager'
import { TerminalManager } from '../terminal/TerminalManager'
import {
  EVENT_CHANNELS,
  type QuickConnectInput,
  type SessionStatus,
  type SessionStatusEvent
} from '../../shared/contract'

interface SessionEntry {
  sessionId: string
  siteId: string | null
  client: Client
  shell: RemoteShell
  status: SessionStatus
  cwdRemote: string
}

interface ConnectInput {
  host: string
  port: number
  username: string
  authMethod: 'password' | 'privateKey'
  privateKeyPath?: string
  password?: string
  passphrase?: string
}

const DEFAULT_CONNECT_TIMEOUT_MS = 20_000

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

  /** Opens a session from a saved site, decrypting its secrets for this connect only. */
  async openFromSite(siteId: string): Promise<{ sessionId: string; status: SessionStatus }> {
    const site = SiteStore.getInstance().getRaw(siteId)
    if (!site) {
      throw new SshError('NOT_FOUND', `Site ${siteId} not found`)
    }
    const secrets = SiteStore.getInstance().getDecryptedSecrets(siteId)
    return this.connect(
      siteId,
      {
        host: site.host,
        port: site.port,
        username: site.username,
        authMethod: site.authMethod,
        privateKeyPath: site.privateKeyPath,
        password: secrets.password,
        passphrase: secrets.passphrase
      },
      site.remoteInitialPath ?? '.'
    )
  }

  /** Opens an ad-hoc session that isn't saved as a site. */
  async openQuickConnect(input: QuickConnectInput): Promise<{ sessionId: string; status: SessionStatus }> {
    return this.connect(null, input, input.remoteInitialPath ?? '.')
  }

  private async connect(
    siteId: string | null,
    input: ConnectInput,
    initialCwd: string
  ): Promise<{ sessionId: string; status: SessionStatus }> {
    const sessionId = randomUUID()
    const client = new Client()
    const entry: SessionEntry = {
      sessionId,
      siteId,
      client,
      shell: new RemoteShell(client),
      status: 'connecting',
      cwdRemote: initialCwd
    }
    this.sessions.set(sessionId, entry)

    const connectConfig: ConnectConfig = {
      host: input.host,
      port: input.port,
      username: input.username,
      readyTimeout: DEFAULT_CONNECT_TIMEOUT_MS,
      tryKeyboard: true
    }
    if (input.authMethod === 'password') {
      connectConfig.password = input.password
    } else {
      if (!input.privateKeyPath) {
        this.sessions.delete(sessionId)
        throw new SshError('VALIDATION', 'Private key path is required for private-key auth')
      }
      connectConfig.privateKey = readFileSync(input.privateKeyPath)
      if (input.passphrase) {
        connectConfig.passphrase = input.passphrase
      }
    }

    try {
      await new Promise<void>((resolve, reject) => {
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
          reject(new SshError('SSH_TIMEOUT', `Connection to ${input.host} timed out`))
        }
        client.on('ready', onReady)
        client.on('error', onError)
        client.on('timeout', onTimeout)
        client.on('keyboard-interactive', (_name, _instructions, _lang, _prompts, finish) => {
          finish([input.password ?? ''])
        })
        client.connect(connectConfig)
      })
    } catch (e) {
      entry.status = 'error'
      const message = e instanceof Error ? e.message : String(e)
      this.broadcastStatus(sessionId, 'error', message)
      this.sessions.delete(sessionId)
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
