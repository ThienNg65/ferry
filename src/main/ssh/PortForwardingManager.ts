import * as net from 'node:net'
import type { Duplex } from 'node:stream'

export type TunnelType = 'local' | 'remote'

export interface TunnelRule {
  id: string
  name?: string
  type: TunnelType
  /** Bind interface. Defaults to `127.0.0.1` when omitted or blank. */
  bindHost?: string
  bindPort: number
  targetHost: string
  targetPort: number
  autoStart?: boolean
}

export interface NormalizedTunnelRule {
  id: string
  name: string
  type: TunnelType
  bindHost: string
  bindPort: number
  targetHost: string
  targetPort: number
  autoStart: boolean
}

export type TunnelStatus = 'starting' | 'active' | 'error' | 'stopped'

export type TunnelErrorCode =
  | 'VALIDATION_ERROR'
  | 'PORT_IN_USE'
  | 'PERMISSION_DENIED'
  | 'SESSION_NOT_CONNECTED'
  | 'TUNNEL_ALREADY_ACTIVE'
  | 'TUNNEL_NOT_FOUND'
  | 'SSH_FORWARD_FAILED'
  | 'TARGET_UNREACHABLE'
  | 'UNKNOWN'

export interface TunnelError {
  code: TunnelErrorCode
  message: string
  details?: string
}

export type TunnelResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: TunnelError }

export interface ActiveTunnelInfo {
  sessionId: string
  ruleId: string
  name: string
  type: TunnelType
  bindHost: string
  bindPort: number
  targetHost: string
  targetPort: number
  status: TunnelStatus
  activeConnections: number
  bytesIn: number
  bytesOut: number
  startedAt: number
  /** Quick-copy endpoint for local tunnels (e.g. `localhost:5432`). */
  localAddress?: string
  exposedExternally: boolean
  lastError?: string
}

export interface TunnelStatusEvent {
  sessionId: string
  ruleId: string
  status: TunnelStatus
  tunnel?: ActiveTunnelInfo
  error?: TunnelError
}

export interface SshForwardChannel extends Duplex {
  close?: () => void
}

export interface SshTcpConnectionInfo {
  destIP: string
  destPort: number
  srcIP: string
  srcPort: number
}

/**
 * Structural subset of `ssh2.Client` required for `-L` and `-R` port forwarding.
 * Keeps the manager decoupled from concrete `ssh2` instances for unit testing.
 */
export interface PortForwardingSshClient {
  forwardOut(
    srcIP: string,
    srcPort: number,
    dstIP: string,
    dstPort: number,
    callback: (err: Error | undefined, stream: SshForwardChannel) => void
  ): unknown
  forwardIn(
    bindAddr: string,
    bindPort: number,
    callback?: (err?: Error, bindPort?: number) => void
  ): unknown
  unforwardIn(
    bindAddr: string,
    bindPort: number,
    callback?: (err?: Error) => void
  ): unknown
  on(
    event: 'tcp connection',
    listener: (info: SshTcpConnectionInfo, accept: () => SshForwardChannel, reject: () => void) => void
  ): unknown
  on(event: 'close' | 'end', listener: () => void): unknown
  removeListener(
    event: 'tcp connection',
    listener: (info: SshTcpConnectionInfo, accept: () => SshForwardChannel, reject: () => void) => void
  ): unknown
  removeListener(event: 'close' | 'end', listener: () => void): unknown
}

export interface StartTunnelOptions {
  /** Allow `bindPort: 0` so the OS assigns an ephemeral port (primarily for tests). */
  allowEphemeralPort?: boolean
}

const DEFAULT_BIND_HOST = '127.0.0.1'
const UNFORWARD_TIMEOUT_MS = 3_000
const INVALID_HOST_CHARS_RE = /[\s\r\n\0\x01-\x1f\x7f"'`$;\\]/
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1'])
const WILDCARD_HOSTS = new Set(['0.0.0.0', '::', '*'])

function stripIpv6Brackets(host: string): string {
  return host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host
}

function isValidPort(port: number, allowZero = false): boolean {
  if (typeof port !== 'number' || !Number.isInteger(port)) {
    return false
  }
  const min = allowZero ? 0 : 1
  return port >= min && port <= 65535
}

function isValidHostToken(host: string): boolean {
  if (!host || host.length > 255) {
    return false
  }
  return !INVALID_HOST_CHARS_RE.test(host)
}

/**
 * Returns true when a bind host exposes the forwarded port beyond the loopback interface.
 */
export function isExposedBindHost(rawHost: string | undefined): boolean {
  const normalized = stripIpv6Brackets((rawHost ?? DEFAULT_BIND_HOST).trim().toLowerCase())
  if (!normalized) {
    return false
  }
  return !LOOPBACK_HOSTS.has(normalized)
}

/**
 * Formats a user-friendly copyable endpoint such as `localhost:5432` or `[::1]:5432`.
 */
export function formatCopyAddress(bindHost: string, bindPort: number): string {
  const clean = stripIpv6Brackets(bindHost.trim())
  const lower = clean.toLowerCase()
  if (!clean || lower === '127.0.0.1' || lower === '0.0.0.0' || lower === 'localhost' || lower === '::1' || lower === '::') {
    return `localhost:${bindPort}`
  }
  return clean.includes(':') ? `[${clean}]:${bindPort}` : `${clean}:${bindPort}`
}

/**
 * Validates and normalizes a single tunnel rule before persistence or startup.
 */
export function validateTunnelRule(
  rule: TunnelRule,
  options: StartTunnelOptions = {}
): TunnelResult<NormalizedTunnelRule> {
  const id = typeof rule.id === 'string' ? rule.id.trim() : ''
  if (!id) {
    return {
      ok: false,
      error: { code: 'VALIDATION_ERROR', message: 'Tunnel rule id is required.' }
    }
  }

  if (rule.type !== 'local' && rule.type !== 'remote') {
    return {
      ok: false,
      error: { code: 'VALIDATION_ERROR', message: `Unsupported tunnel type "${String(rule.type)}". Expected "local" or "remote".` }
    }
  }

  const rawBindHost = typeof rule.bindHost === 'string' ? rule.bindHost.trim() : ''
  const bindHost = stripIpv6Brackets(rawBindHost || DEFAULT_BIND_HOST)
  if (!isValidHostToken(bindHost)) {
    return {
      ok: false,
      error: { code: 'VALIDATION_ERROR', message: `Invalid bind host "${rule.bindHost ?? ''}".` }
    }
  }

  if (!isValidPort(rule.bindPort, Boolean(options.allowEphemeralPort))) {
    return {
      ok: false,
      error: { code: 'VALIDATION_ERROR', message: `Bind port must be an integer between 1 and 65535 (got ${String(rule.bindPort)}).` }
    }
  }

  const rawTargetHost = typeof rule.targetHost === 'string' ? rule.targetHost.trim() : ''
  const targetHost = stripIpv6Brackets(rawTargetHost)
  if (!isValidHostToken(targetHost)) {
    return {
      ok: false,
      error: { code: 'VALIDATION_ERROR', message: `Invalid target host "${rule.targetHost ?? ''}".` }
    }
  }

  if (!isValidPort(rule.targetPort, false)) {
    return {
      ok: false,
      error: { code: 'VALIDATION_ERROR', message: `Target port must be an integer between 1 and 65535 (got ${String(rule.targetPort)}).` }
    }
  }

  const defaultName =
    rule.type === 'local'
      ? `L ${bindPortLabel(bindHost, rule.bindPort)} -> ${targetHost}:${rule.targetPort}`
      : `R ${bindPortLabel(bindHost, rule.bindPort)} -> ${targetHost}:${rule.targetPort}`
  const name = typeof rule.name === 'string' && rule.name.trim() ? rule.name.trim() : defaultName

  return {
    ok: true,
    data: {
      id,
      name,
      type: rule.type,
      bindHost,
      bindPort: rule.bindPort,
      targetHost,
      targetPort: rule.targetPort,
      autoStart: Boolean(rule.autoStart)
    }
  }
}

function bindPortLabel(bindHost: string, bindPort: number): string {
  return bindHost === DEFAULT_BIND_HOST ? String(bindPort) : `${bindHost}:${bindPort}`
}

function hostsConflict(a: string, b: string): boolean {
  const left = a.toLowerCase()
  const right = b.toLowerCase()
  if (left === right) return true
  if (WILDCARD_HOSTS.has(left) || WILDCARD_HOSTS.has(right)) return true
  if ((left === 'localhost' && right === '127.0.0.1') || (left === '127.0.0.1' && right === 'localhost')) {
    return true
  }
  return false
}

/**
 * Validates a list of per-host tunnel rules, rejecting duplicate IDs and conflicting bindings.
 */
export function validateTunnelRules(rules: ReadonlyArray<TunnelRule>): TunnelResult<NormalizedTunnelRule[]> {
  const normalized: NormalizedTunnelRule[] = []
  const seenIds = new Set<string>()

  for (const rule of rules) {
    const validated = validateTunnelRule(rule)
    if (!validated.ok) {
      return validated
    }
    const current = validated.data
    if (seenIds.has(current.id)) {
      return {
        ok: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: `Duplicate tunnel rule id "${current.id}".`
        }
      }
    }
    seenIds.add(current.id)

    const conflict = normalized.find(
      (existing) =>
        existing.type === current.type &&
        existing.bindPort === current.bindPort &&
        hostsConflict(existing.bindHost, current.bindHost)
    )
    if (conflict) {
      return {
        ok: false,
        error: {
          code: 'PORT_IN_USE',
          message: `Tunnel "${current.name}" conflicts with "${conflict.name}" on ${current.type} port ${current.bindPort}.`
        }
      }
    }

    normalized.push(current)
  }

  return { ok: true, data: normalized }
}

function mapBindError(error: unknown, bindHost: string, bindPort: number): TunnelError {
  const err = error as NodeJS.ErrnoException | undefined
  const code = err?.code
  const message = err?.message ?? String(error)

  if (code === 'EADDRINUSE') {
    return {
      code: 'PORT_IN_USE',
      message: `Port ${bindHost}:${bindPort} is already in use.`,
      details: message
    }
  }
  if (code === 'EACCES' || code === 'EPERM') {
    return {
      code: 'PERMISSION_DENIED',
      message: `Permission denied binding ${bindHost}:${bindPort}.`,
      details: message
    }
  }
  if (code === 'EADDRNOTAVAIL' || code === 'EINVAL') {
    return {
      code: 'VALIDATION_ERROR',
      message: `Cannot bind to address ${bindHost}:${bindPort}.`,
      details: message
    }
  }
  return {
    code: 'UNKNOWN',
    message: `Failed to bind ${bindHost}:${bindPort}: ${message}`,
    details: message
  }
}

function matchesRemoteDestination(tunnel: ManagedTunnel, info: SshTcpConnectionInfo): boolean {
  if (tunnel.rule.type !== 'remote' || tunnel.stopped) {
    return false
  }
  if (tunnel.actualBindPort !== info.destPort) {
    return false
  }
  const bound = tunnel.rule.bindHost.toLowerCase()
  const dest = stripIpv6Brackets((info.destIP || '').trim().toLowerCase())
  if (!dest || WILDCARD_HOSTS.has(bound) || bound === dest) {
    return true
  }
  if (LOOPBACK_HOSTS.has(bound) && LOOPBACK_HOSTS.has(dest)) {
    return true
  }
  return false
}

interface ManagedTunnel {
  sessionId: string
  rule: NormalizedTunnelRule
  actualBindPort: number
  status: TunnelStatus
  activeConnections: number
  bytesIn: number
  bytesOut: number
  startedAt: number
  lastError?: string
  stopped: boolean
  server?: net.Server
  activeSockets: Set<net.Socket>
  activeChannels: Set<SshForwardChannel>
}

interface SessionTunnelState {
  sessionId: string
  client: PortForwardingSshClient
  tunnels: Map<string, ManagedTunnel>
  startingRules: Set<string>
  disposed: boolean
  tcpConnectionListener: (
    info: SshTcpConnectionInfo,
    accept: () => SshForwardChannel,
    reject: () => void
  ) => void
  disconnectListener: () => void
}

/**
 * Manages active `-L` (local) and `-R` (remote) SSH port-forwarding tunnels across sessions.
 * Cleans up TCP listeners, remote bindings, and active sockets on stop or session disconnect.
 */
export class PortForwardingManager {
  private static instance: PortForwardingManager | null = null

  private readonly sessions = new Map<string, SessionTunnelState>()
  private readonly listeners = new Set<(event: TunnelStatusEvent) => void>()

  static getInstance(): PortForwardingManager {
    if (!PortForwardingManager.instance) {
      PortForwardingManager.instance = new PortForwardingManager()
    }
    return PortForwardingManager.instance
  }

  /** Subscribes to live tunnel status transitions. Returns an unsubscribe function. */
  onChange(listener: (event: TunnelStatusEvent) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /** Lists active tunnels, optionally filtered to a single session. */
  getActiveTunnels(sessionId?: string): ActiveTunnelInfo[] {
    const result: ActiveTunnelInfo[] = []
    if (sessionId !== undefined) {
      const state = this.sessions.get(sessionId)
      if (!state) return result
      for (const tunnel of state.tunnels.values()) {
        if (!tunnel.stopped) {
          result.push(this.toPublicInfo(tunnel))
        }
      }
      return result
    }

    for (const state of this.sessions.values()) {
      for (const tunnel of state.tunnels.values()) {
        if (!tunnel.stopped) {
          result.push(this.toPublicInfo(tunnel))
        }
      }
    }
    return result
  }

  /**
   * Starts a local (`-L`) or remote (`-R`) port-forwarding tunnel over an active SSH client.
   */
  async startTunnel(
    sessionId: string,
    sshClient: PortForwardingSshClient | null | undefined,
    rule: TunnelRule,
    options: StartTunnelOptions = {}
  ): Promise<TunnelResult<ActiveTunnelInfo>> {
    if (!sessionId || !sshClient) {
      return {
        ok: false,
        error: {
          code: 'SESSION_NOT_CONNECTED',
          message: 'SSH session is not connected.'
        }
      }
    }

    const validated = validateTunnelRule(rule, options)
    if (!validated.ok) {
      return validated
    }
    const normalized = validated.data

    const state = this.ensureSessionState(sessionId, sshClient)
    if (state.tunnels.has(normalized.id) || state.startingRules.has(normalized.id)) {
      return {
        ok: false,
        error: {
          code: 'TUNNEL_ALREADY_ACTIVE',
          message: `Tunnel "${normalized.name}" is already active.`
        }
      }
    }

    // Reject duplicate local port bindings across all sessions before touching the OS socket.
    if (normalized.type === 'local' && normalized.bindPort !== 0) {
      for (const otherState of this.sessions.values()) {
        for (const existing of otherState.tunnels.values()) {
          if (
            !existing.stopped &&
            existing.rule.type === 'local' &&
            existing.actualBindPort === normalized.bindPort &&
            hostsConflict(existing.rule.bindHost, normalized.bindHost)
          ) {
            return {
              ok: false,
              error: {
                code: 'PORT_IN_USE',
                message: `Local port ${normalized.bindHost}:${normalized.bindPort} is already used by tunnel "${existing.rule.name}".`
              }
            }
          }
        }
      }
    }

    state.startingRules.add(normalized.id)
    this.emit({ sessionId, ruleId: normalized.id, status: 'starting' })

    try {
      const started =
        normalized.type === 'local'
          ? await this.startLocalTunnel(state, normalized)
          : await this.startRemoteTunnel(state, normalized)

      if (!started.ok) {
        this.emit({ sessionId, ruleId: normalized.id, status: 'error', error: started.error })
        this.cleanupEmptySession(sessionId)
        return started
      }

      // Guard against a session disconnect that happened while listen/forwardIn was pending.
      if (state.disposed || this.sessions.get(sessionId) !== state) {
        await this.teardownTunnel(state.client, started.data, false)
        return {
          ok: false,
          error: {
            code: 'SESSION_NOT_CONNECTED',
            message: 'SSH session disconnected while starting the tunnel.'
          }
        }
      }

      state.tunnels.set(normalized.id, started.data)
      const info = this.toPublicInfo(started.data)
      this.emit({ sessionId, ruleId: normalized.id, status: 'active', tunnel: info })
      return { ok: true, data: info }
    } finally {
      state.startingRules.delete(normalized.id)
      this.cleanupEmptySession(sessionId)
    }
  }

  /** Stops a single active tunnel and releases its port and active sockets. */
  async stopTunnel(sessionId: string, ruleId: string): Promise<TunnelResult<void>> {
    const state = this.sessions.get(sessionId)
    const tunnel = state?.tunnels.get(ruleId)
    if (!state || !tunnel) {
      return {
        ok: false,
        error: {
          code: 'TUNNEL_NOT_FOUND',
          message: `Active tunnel "${ruleId}" was not found for session "${sessionId}".`
        }
      }
    }

    state.tunnels.delete(ruleId)
    await this.teardownTunnel(state.client, tunnel, true)
    this.emit({ sessionId, ruleId, status: 'stopped' })
    this.cleanupEmptySession(sessionId)
    return { ok: true, data: undefined }
  }

  /** Stops and cleans up all tunnels bound to a session (called on disconnect/tab close). */
  async stopAllForSession(sessionId: string): Promise<void> {
    const state = this.sessions.get(sessionId)
    if (!state) return

    state.disposed = true
    this.sessions.delete(sessionId)
    this.detachSessionListeners(state)

    const tunnels = Array.from(state.tunnels.values())
    state.tunnels.clear()

    await Promise.all(
      tunnels.map(async (tunnel) => {
        await this.teardownTunnel(state.client, tunnel, false)
        this.emit({ sessionId, ruleId: tunnel.rule.id, status: 'stopped' })
      })
    )
  }

  /** Stops all tunnels across every session (called on application exit). */
  async stopAll(): Promise<void> {
    const sessionIds = Array.from(this.sessions.keys())
    await Promise.all(sessionIds.map((id) => this.stopAllForSession(id)))
  }

  private ensureSessionState(sessionId: string, client: PortForwardingSshClient): SessionTunnelState {
    const existing = this.sessions.get(sessionId)
    if (existing && existing.client === client && !existing.disposed) {
      return existing
    }
    if (existing) {
      void this.stopAllForSession(sessionId)
    }

    const state: SessionTunnelState = {
      sessionId,
      client,
      tunnels: new Map(),
      startingRules: new Set(),
      disposed: false,
      tcpConnectionListener: (info, accept, reject) => {
        this.handleRemoteTcpConnection(state, info, accept, reject)
      },
      disconnectListener: () => {
        void this.stopAllForSession(sessionId)
      }
    }

    client.on('tcp connection', state.tcpConnectionListener)
    client.on('close', state.disconnectListener)
    client.on('end', state.disconnectListener)

    this.sessions.set(sessionId, state)
    return state
  }

  private detachSessionListeners(state: SessionTunnelState): void {
    state.client.removeListener('tcp connection', state.tcpConnectionListener)
    state.client.removeListener('close', state.disconnectListener)
    state.client.removeListener('end', state.disconnectListener)
  }

  private cleanupEmptySession(sessionId: string): void {
    const state = this.sessions.get(sessionId)
    if (!state) return
    if (state.tunnels.size === 0 && state.startingRules.size === 0) {
      state.disposed = true
      this.sessions.delete(sessionId)
      this.detachSessionListeners(state)
    }
  }

  private startLocalTunnel(
    state: SessionTunnelState,
    rule: NormalizedTunnelRule
  ): Promise<TunnelResult<ManagedTunnel>> {
    return new Promise((resolve) => {
      const tunnel: ManagedTunnel = {
        sessionId: state.sessionId,
        rule,
        actualBindPort: rule.bindPort,
        status: 'starting',
        activeConnections: 0,
        bytesIn: 0,
        bytesOut: 0,
        startedAt: Date.now(),
        stopped: false,
        activeSockets: new Set(),
        activeChannels: new Set()
      }

      const server = net.createServer((localSocket) => {
        if (tunnel.stopped || state.disposed) {
          localSocket.destroy()
          return
        }

        // Pause until the SSH forwardOut channel is ready so early client bytes are not lost.
        localSocket.pause()
        tunnel.activeSockets.add(localSocket)

        const removeSocket = (): void => {
          tunnel.activeSockets.delete(localSocket)
        }
        localSocket.once('close', removeSocket)
        localSocket.on('error', () => {
          // Handled cleanly via close/teardown; never crash the sidecar on client reset.
        })

        const srcIp = localSocket.remoteAddress || '127.0.0.1'
        const srcPort = localSocket.remotePort || 0

        try {
          state.client.forwardOut(
            srcIp,
            srcPort,
            rule.targetHost,
            rule.targetPort,
            (forwardErr, channel) => {
              if (forwardErr || !channel) {
                tunnel.lastError = forwardErr?.message ?? 'SSH forwardOut failed'
                localSocket.destroy()
                this.emit({
                  sessionId: state.sessionId,
                  ruleId: rule.id,
                  status: tunnel.status,
                  tunnel: this.toPublicInfo(tunnel)
                })
                return
              }

              if (tunnel.stopped || state.disposed || localSocket.destroyed) {
                channel.destroy()
                localSocket.destroy()
                return
              }

              this.bridgeBidirectional(tunnel, localSocket, channel)
              localSocket.resume()
            }
          )
        } catch (err) {
          tunnel.lastError = err instanceof Error ? err.message : String(err)
          localSocket.destroy()
        }
      })

      tunnel.server = server

      const onInitialError = (error: Error): void => {
        tunnel.stopped = true
        server.close()
        resolve({
          ok: false,
          error: mapBindError(error, rule.bindHost, rule.bindPort)
        })
      }

      server.once('error', onInitialError)
      server.listen({ host: rule.bindHost, port: rule.bindPort, exclusive: true }, () => {
        server.removeListener('error', onInitialError)
        server.on('error', (runtimeErr) => {
          tunnel.lastError = runtimeErr.message
          this.emit({
            sessionId: state.sessionId,
            ruleId: rule.id,
            status: 'error',
            tunnel: this.toPublicInfo(tunnel),
            error: mapBindError(runtimeErr, rule.bindHost, tunnel.actualBindPort)
          })
        })

        const addr = server.address()
        if (addr && typeof addr === 'object') {
          tunnel.actualBindPort = addr.port
        }
        tunnel.status = 'active'
        resolve({ ok: true, data: tunnel })
      })
    })
  }

  private startRemoteTunnel(
    state: SessionTunnelState,
    rule: NormalizedTunnelRule
  ): Promise<TunnelResult<ManagedTunnel>> {
    return new Promise((resolve) => {
      try {
        state.client.forwardIn(rule.bindHost, rule.bindPort, (err, boundPort) => {
          if (err) {
            const lower = err.message.toLowerCase()
            const code: TunnelErrorCode =
              lower.includes('in use') || lower.includes('eaddrinuse')
                ? 'PORT_IN_USE'
                : 'SSH_FORWARD_FAILED'
            resolve({
              ok: false,
              error: {
                code,
                message: `Remote port forwarding failed on ${rule.bindHost}:${rule.bindPort}: ${err.message}`,
                details: err.message
              }
            })
            return
          }

          const actualPort = typeof boundPort === 'number' && boundPort > 0 ? boundPort : rule.bindPort
          const tunnel: ManagedTunnel = {
            sessionId: state.sessionId,
            rule,
            actualBindPort: actualPort,
            status: 'active',
            activeConnections: 0,
            bytesIn: 0,
            bytesOut: 0,
            startedAt: Date.now(),
            stopped: false,
            activeSockets: new Set(),
            activeChannels: new Set()
          }
          resolve({ ok: true, data: tunnel })
        })
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        resolve({
          ok: false,
          error: {
            code: 'SSH_FORWARD_FAILED',
            message: `Remote port forwarding failed on ${rule.bindHost}:${rule.bindPort}: ${message}`,
            details: message
          }
        })
      }
    })
  }

  private handleRemoteTcpConnection(
    state: SessionTunnelState,
    info: SshTcpConnectionInfo,
    accept: () => SshForwardChannel,
    reject: () => void
  ): void {
    if (state.disposed) {
      reject()
      return
    }

    let matched: ManagedTunnel | undefined
    for (const tunnel of state.tunnels.values()) {
      if (matchesRemoteDestination(tunnel, info)) {
        matched = tunnel
        break
      }
    }

    if (!matched) {
      reject()
      return
    }

    const channel = accept()
    channel.pause()

    const localSocket = net.createConnection({
      host: matched.rule.targetHost,
      port: matched.rule.targetPort
    })

    matched.activeSockets.add(localSocket)
    localSocket.once('close', () => {
      matched.activeSockets.delete(localSocket)
    })

    let connected = false
    localSocket.once('connect', () => {
      connected = true
      if (matched.stopped || state.disposed || channel.destroyed) {
        localSocket.destroy()
        channel.destroy()
        return
      }
      this.bridgeBidirectional(matched, localSocket, channel)
      channel.resume()
    })

    localSocket.on('error', (err) => {
      if (!connected) {
        matched.lastError = `Target ${matched.rule.targetHost}:${matched.rule.targetPort} unreachable: ${err.message}`
        channel.destroy()
        localSocket.destroy()
        this.emit({
          sessionId: state.sessionId,
          ruleId: matched.rule.id,
          status: matched.status,
          tunnel: this.toPublicInfo(matched)
        })
      }
    })

    channel.on('error', () => {
      localSocket.destroy()
    })
  }

  private bridgeBidirectional(
    tunnel: ManagedTunnel,
    localSocket: net.Socket,
    channel: SshForwardChannel
  ): void {
    tunnel.activeChannels.add(channel)
    tunnel.activeConnections += 1

    let closed = false
    const onFinished = (): void => {
      if (closed) return
      closed = true
      tunnel.activeChannels.delete(channel)
      tunnel.activeSockets.delete(localSocket)
      tunnel.activeConnections = Math.max(0, tunnel.activeConnections - 1)
    }

    localSocket.on('data', (chunk: Buffer) => {
      tunnel.bytesOut += chunk.length
    })
    channel.on('data', (chunk: Buffer) => {
      tunnel.bytesIn += chunk.length
    })

    localSocket.on('error', () => {
      channel.destroy()
      onFinished()
    })
    channel.on('error', () => {
      localSocket.destroy()
      onFinished()
    })

    localSocket.once('close', () => {
      if (!channel.destroyed) channel.destroy()
      onFinished()
    })
    channel.once('close', () => {
      if (!localSocket.destroyed) localSocket.destroy()
      onFinished()
    })

    localSocket.pipe(channel)
    channel.pipe(localSocket)
  }

  private async teardownTunnel(
    client: PortForwardingSshClient,
    tunnel: ManagedTunnel,
    requestUnforwardIn: boolean
  ): Promise<void> {
    if (tunnel.stopped) return
    tunnel.stopped = true
    tunnel.status = 'stopped'

    for (const socket of tunnel.activeSockets) {
      socket.destroy()
    }
    tunnel.activeSockets.clear()

    for (const channel of tunnel.activeChannels) {
      channel.destroy()
    }
    tunnel.activeChannels.clear()
    tunnel.activeConnections = 0

    if (tunnel.server) {
      const server = tunnel.server
      tunnel.server = undefined
      await new Promise<void>((resolve) => {
        server.close(() => resolve())
      })
    }

    if (tunnel.rule.type === 'remote' && requestUnforwardIn) {
      await new Promise<void>((resolve) => {
        let settled = false
        const done = (): void => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          resolve()
        }
        const timer = setTimeout(done, UNFORWARD_TIMEOUT_MS)
        timer.unref?.()
        try {
          client.unforwardIn(tunnel.rule.bindHost, tunnel.actualBindPort, () => done())
        } catch {
          done()
        }
      })
    }
  }

  private toPublicInfo(tunnel: ManagedTunnel): ActiveTunnelInfo {
    return {
      sessionId: tunnel.sessionId,
      ruleId: tunnel.rule.id,
      name: tunnel.rule.name,
      type: tunnel.rule.type,
      bindHost: tunnel.rule.bindHost,
      bindPort: tunnel.actualBindPort,
      targetHost: tunnel.rule.targetHost,
      targetPort: tunnel.rule.targetPort,
      status: tunnel.status,
      activeConnections: tunnel.activeConnections,
      bytesIn: tunnel.bytesIn,
      bytesOut: tunnel.bytesOut,
      startedAt: tunnel.startedAt,
      localAddress:
        tunnel.rule.type === 'local'
          ? formatCopyAddress(tunnel.rule.bindHost, tunnel.actualBindPort)
          : undefined,
      exposedExternally: isExposedBindHost(tunnel.rule.bindHost),
      lastError: tunnel.lastError
    }
  }

  private emit(event: TunnelStatusEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event)
      } catch {
        // Status observers must not disrupt tunnel lifecycle operations.
      }
    }
  }
}
