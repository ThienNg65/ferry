import * as net from 'node:net'
import type { Duplex } from 'node:stream'

export type TunnelType = 'local' | 'remote'

export interface TunnelRule {
  id: string
  name?: string
  type: TunnelType
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

export interface AutoStartTunnelsResult {
  started: ActiveTunnelInfo[]
  failed: Array<{ ruleId: string; error: TunnelError }>
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
  allowEphemeralPort?: boolean
}

export interface StopSessionOptions {
  requestUnforwardIn?: boolean
}

export interface PortForwardingManagerOptions {
  unforwardTimeoutMs?: number
}

const DEFAULT_BIND_HOST = '127.0.0.1'
const DEFAULT_UNFORWARD_TIMEOUT_MS = 3_000
const INVALID_HOST_PUNCTUATION_RE = /[\s"'`$;\\[\]]/
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1'])
const WILDCARD_HOSTS = new Set(['0.0.0.0', '::', '*'])

function hasControlChar(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i)
    if (code <= 0x1f || code === 0x7f) {
      return true
    }
  }
  return false
}

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

function isValidHostToken(host: string, allowWildcard = true): boolean {
  if (!host || host.length > 255 || host.startsWith('-')) {
    return false
  }
  if (!allowWildcard && host === '*') {
    return false
  }
  return !hasControlChar(host) && !INVALID_HOST_PUNCTUATION_RE.test(host)
}

function formatHostForEndpoint(host: string): string {
  const clean = stripIpv6Brackets(host.trim())
  return clean.includes(':') ? `[${clean}]` : clean
}

export function isExposedBindHost(rawHost: string | undefined): boolean {
  const normalized = stripIpv6Brackets((rawHost ?? DEFAULT_BIND_HOST).trim().toLowerCase())
  if (!normalized) {
    return false
  }
  return !LOOPBACK_HOSTS.has(normalized)
}

export function formatCopyAddress(bindHost: string, bindPort: number): string {
  const clean = stripIpv6Brackets(bindHost.trim())
  const lower = clean.toLowerCase()
  if (!clean || lower === '127.0.0.1' || lower === '0.0.0.0' || lower === 'localhost' || lower === '::1' || lower === '::') {
    return `localhost:${bindPort}`
  }
  return `${formatHostForEndpoint(clean)}:${bindPort}`
}

export function formatTunnelSpec(
  rule: Pick<NormalizedTunnelRule, 'type' | 'bindHost' | 'bindPort' | 'targetHost' | 'targetPort'>
): string {
  const flag = rule.type === 'local' ? '-L' : '-R'
  const bind = `${formatHostForEndpoint(rule.bindHost)}:${rule.bindPort}`
  const target = `${formatHostForEndpoint(rule.targetHost)}:${rule.targetPort}`
  return `${flag} ${bind}:${target}`
}

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
      error: {
        code: 'VALIDATION_ERROR',
        message: `Unsupported tunnel type "${String(rule.type)}". Expected "local" or "remote".`
      }
    }
  }

  const rawBindHost = typeof rule.bindHost === 'string' ? rule.bindHost.trim() : ''
  const bindHost = stripIpv6Brackets(rawBindHost || DEFAULT_BIND_HOST)
  if (!isValidHostToken(bindHost, true)) {
    return {
      ok: false,
      error: { code: 'VALIDATION_ERROR', message: `Invalid bind host "${rule.bindHost ?? ''}".` }
    }
  }

  if (!isValidPort(rule.bindPort, Boolean(options.allowEphemeralPort))) {
    return {
      ok: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: `Bind port must be an integer between 1 and 65535 (got ${String(rule.bindPort)}).`
      }
    }
  }

  const rawTargetHost = typeof rule.targetHost === 'string' ? rule.targetHost.trim() : ''
  const targetHost = stripIpv6Brackets(rawTargetHost)
  if (!isValidHostToken(targetHost, false)) {
    return {
      ok: false,
      error: { code: 'VALIDATION_ERROR', message: `Invalid target host "${rule.targetHost ?? ''}".` }
    }
  }

  if (!isValidPort(rule.targetPort, false)) {
    return {
      ok: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: `Target port must be an integer between 1 and 65535 (got ${String(rule.targetPort)}).`
      }
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

function chunkByteLength(chunk: Buffer | string): number {
  return typeof chunk === 'string' ? Buffer.byteLength(chunk) : chunk.length
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
  startingRules: Map<string, NormalizedTunnelRule>
  cancelledStartingRules: Set<string>
  disposed: boolean
  tcpConnectionListener: (
    info: SshTcpConnectionInfo,
    accept: () => SshForwardChannel,
    reject: () => void
  ) => void
  disconnectListener: () => void
}

export class PortForwardingManager {
  private static instance: PortForwardingManager | null = null

  private readonly sessions = new Map<string, SessionTunnelState>()
  private readonly listeners = new Set<(event: TunnelStatusEvent) => void>()
  private readonly unforwardTimeoutMs: number

  constructor(options: PortForwardingManagerOptions = {}) {
    this.unforwardTimeoutMs = options.unforwardTimeoutMs ?? DEFAULT_UNFORWARD_TIMEOUT_MS
  }

  static getInstance(): PortForwardingManager {
    if (!PortForwardingManager.instance) {
      PortForwardingManager.instance = new PortForwardingManager()
    }
    return PortForwardingManager.instance
  }

  onChange(listener: (event: TunnelStatusEvent) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

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

    const state = await this.ensureSessionState(sessionId, sshClient)
    if (state.tunnels.has(normalized.id) || state.startingRules.has(normalized.id)) {
      return {
        ok: false,
        error: {
          code: 'TUNNEL_ALREADY_ACTIVE',
          message: `Tunnel "${normalized.name}" is already active.`
        }
      }
    }

    const conflictError = this.findBindingConflict(state, normalized)
    if (conflictError) {
      this.cleanupEmptySession(sessionId)
      return { ok: false, error: conflictError }
    }

    state.startingRules.set(normalized.id, normalized)
    state.cancelledStartingRules.delete(normalized.id)
    this.emit({ sessionId, ruleId: normalized.id, status: 'starting' })

    try {
      const started =
        normalized.type === 'local'
          ? await this.startLocalTunnel(state, normalized)
          : await this.startRemoteTunnel(state, normalized)

      if (!started.ok) {
        if (state.cancelledStartingRules.has(normalized.id)) {
          this.emit({ sessionId, ruleId: normalized.id, status: 'stopped' })
        } else {
          this.emit({ sessionId, ruleId: normalized.id, status: 'error', error: started.error })
        }
        return started
      }

      if (state.cancelledStartingRules.has(normalized.id)) {
        state.tunnels.delete(normalized.id)
        await this.teardownTunnel(state.client, started.data, !state.disposed)
        this.emit({ sessionId, ruleId: normalized.id, status: 'stopped' })
        return {
          ok: false,
          error: {
            code: 'TUNNEL_NOT_FOUND',
            message: `Tunnel "${normalized.name}" was stopped before startup completed.`
          }
        }
      }

      if (state.disposed || this.sessions.get(sessionId) !== state) {
        state.tunnels.delete(normalized.id)
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
      state.cancelledStartingRules.delete(normalized.id)
      this.cleanupEmptySession(sessionId)
    }
  }

  async startAutoTunnels(
    sessionId: string,
    sshClient: PortForwardingSshClient | null | undefined,
    rules: ReadonlyArray<TunnelRule>,
    options: StartTunnelOptions = {}
  ): Promise<AutoStartTunnelsResult> {
    const started: ActiveTunnelInfo[] = []
    const failed: Array<{ ruleId: string; error: TunnelError }> = []

    for (const rule of rules) {
      if (!rule.autoStart) continue
      const result = await this.startTunnel(sessionId, sshClient, rule, options)
      if (result.ok) {
        started.push(result.data)
      } else {
        failed.push({ ruleId: rule.id, error: result.error })
      }
    }

    return { started, failed }
  }

  async stopTunnel(sessionId: string, ruleId: string): Promise<TunnelResult<void>> {
    const state = this.sessions.get(sessionId)
    if (!state) {
      return {
        ok: false,
        error: {
          code: 'TUNNEL_NOT_FOUND',
          message: `Active tunnel "${ruleId}" was not found for session "${sessionId}".`
        }
      }
    }

    if (state.startingRules.has(ruleId)) {
      state.cancelledStartingRules.add(ruleId)
      return { ok: true, data: undefined }
    }

    const tunnel = state.tunnels.get(ruleId)
    if (!tunnel) {
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

  async stopAllForSession(sessionId: string, options: StopSessionOptions = {}): Promise<void> {
    const state = this.sessions.get(sessionId)
    if (!state) return

    const requestUnforwardIn = options.requestUnforwardIn ?? true

    state.disposed = true
    this.sessions.delete(sessionId)
    this.detachSessionListeners(state)

    const tunnels = Array.from(state.tunnels.values())
    state.tunnels.clear()

    await Promise.all(
      tunnels.map(async (tunnel) => {
        await this.teardownTunnel(state.client, tunnel, requestUnforwardIn)
        this.emit({ sessionId, ruleId: tunnel.rule.id, status: 'stopped' })
      })
    )
  }

  async stopAll(options: StopSessionOptions = {}): Promise<void> {
    const sessionIds = Array.from(this.sessions.keys())
    await Promise.all(sessionIds.map((id) => this.stopAllForSession(id, options)))
  }

  private findBindingConflict(state: SessionTunnelState, normalized: NormalizedTunnelRule): TunnelError | null {
    if (normalized.bindPort === 0) {
      return null
    }

    if (normalized.type === 'local') {
      for (const otherState of this.sessions.values()) {
        for (const existing of otherState.tunnels.values()) {
          if (
            !existing.stopped &&
            existing.rule.type === 'local' &&
            existing.actualBindPort === normalized.bindPort &&
            hostsConflict(existing.rule.bindHost, normalized.bindHost)
          ) {
            return {
              code: 'PORT_IN_USE',
              message: `Local port ${normalized.bindHost}:${normalized.bindPort} is already used by tunnel "${existing.rule.name}".`
            }
          }
        }
        for (const pending of otherState.startingRules.values()) {
          if (
            pending.type === 'local' &&
            pending.bindPort === normalized.bindPort &&
            hostsConflict(pending.bindHost, normalized.bindHost)
          ) {
            return {
              code: 'PORT_IN_USE',
              message: `Local port ${normalized.bindHost}:${normalized.bindPort} is already being bound by tunnel "${pending.name}".`
            }
          }
        }
      }
      return null
    }

    for (const existing of state.tunnels.values()) {
      if (
        !existing.stopped &&
        existing.rule.type === 'remote' &&
        existing.actualBindPort === normalized.bindPort &&
        hostsConflict(existing.rule.bindHost, normalized.bindHost)
      ) {
        return {
          code: 'PORT_IN_USE',
          message: `Remote port ${normalized.bindHost}:${normalized.bindPort} is already used by tunnel "${existing.rule.name}".`
        }
      }
    }
    for (const pending of state.startingRules.values()) {
      if (
        pending.type === 'remote' &&
        pending.bindPort === normalized.bindPort &&
        hostsConflict(pending.bindHost, normalized.bindHost)
      ) {
        return {
          code: 'PORT_IN_USE',
          message: `Remote port ${normalized.bindHost}:${normalized.bindPort} is already being bound by tunnel "${pending.name}".`
        }
      }
    }
    return null
  }

  private async ensureSessionState(
    sessionId: string,
    client: PortForwardingSshClient
  ): Promise<SessionTunnelState> {
    const existing = this.sessions.get(sessionId)
    if (existing && existing.client === client && !existing.disposed) {
      return existing
    }
    if (existing) {
      await this.stopAllForSession(sessionId, { requestUnforwardIn: true })
    }

    const state: SessionTunnelState = {
      sessionId,
      client,
      tunnels: new Map(),
      startingRules: new Map(),
      cancelledStartingRules: new Set(),
      disposed: false,
      tcpConnectionListener: (info, accept, reject) => {
        this.handleRemoteTcpConnection(state, info, accept, reject)
      },
      disconnectListener: () => {
        void this.stopAllForSession(sessionId, { requestUnforwardIn: false })
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

      const server = net.createServer({ allowHalfOpen: true }, (localSocket) => {
        if (tunnel.stopped || state.disposed) {
          localSocket.destroy()
          return
        }

        localSocket.pause()
        tunnel.activeSockets.add(localSocket)

        localSocket.once('close', () => {
          tunnel.activeSockets.delete(localSocket)
        })
        localSocket.on('error', () => {
          tunnel.activeSockets.delete(localSocket)
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

              if (tunnel.stopped || state.disposed || localSocket.destroyed || localSocket.closed) {
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
          tunnel.status = 'error'
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
          if (actualPort <= 0) {
            resolve({
              ok: false,
              error: {
                code: 'SSH_FORWARD_FAILED',
                message: `Remote server did not return a valid bound port for ${rule.bindHost}:${rule.bindPort}.`
              }
            })
            return
          }

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

          if (!state.disposed && !state.cancelledStartingRules.has(rule.id)) {
            state.tunnels.set(rule.id, tunnel)
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

    const matched = Array.from(state.tunnels.values()).find((tunnel) =>
      matchesRemoteDestination(tunnel, info)
    )
    if (!matched) {
      reject()
      return
    }

    const channel = accept()
    channel.pause()
    matched.activeChannels.add(channel)

    const localSocket = net.createConnection({
      host: matched.rule.targetHost,
      port: matched.rule.targetPort
    })
    matched.activeSockets.add(localSocket)

    let connected = false
    const onPreConnectChannelClose = (): void => {
      matched.activeChannels.delete(channel)
      if (!connected && !localSocket.destroyed) {
        localSocket.destroy()
      }
    }
    const onPreConnectSocketClose = (): void => {
      matched.activeSockets.delete(localSocket)
      if (!connected && !channel.destroyed) {
        channel.destroy()
      }
    }

    channel.once('close', onPreConnectChannelClose)
    channel.on('error', onPreConnectChannelClose)
    localSocket.once('close', onPreConnectSocketClose)

    localSocket.once('connect', () => {
      connected = true
      channel.removeListener('close', onPreConnectChannelClose)
      channel.removeListener('error', onPreConnectChannelClose)
      localSocket.removeListener('close', onPreConnectSocketClose)

      if (matched.stopped || state.disposed || channel.destroyed) {
        localSocket.destroy()
        channel.destroy()
        matched.activeSockets.delete(localSocket)
        matched.activeChannels.delete(channel)
        return
      }

      this.bridgeBidirectional(matched, localSocket, channel)
      channel.resume()
    })

    localSocket.on('error', (err) => {
      if (!connected) {
        channel.removeListener('close', onPreConnectChannelClose)
        channel.removeListener('error', onPreConnectChannelClose)
        localSocket.removeListener('close', onPreConnectSocketClose)
        matched.activeSockets.delete(localSocket)
        matched.activeChannels.delete(channel)
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
  }

  private bridgeBidirectional(
    tunnel: ManagedTunnel,
    localSocket: net.Socket,
    channel: SshForwardChannel
  ): void {
    tunnel.activeChannels.add(channel)
    tunnel.activeSockets.add(localSocket)
    tunnel.activeConnections += 1

    let closed = false
    const onFinished = (): void => {
      if (closed) return
      closed = true
      tunnel.activeChannels.delete(channel)
      tunnel.activeSockets.delete(localSocket)
      tunnel.activeConnections = Math.max(0, tunnel.activeConnections - 1)
    }

    localSocket.on('data', (chunk: Buffer | string) => {
      tunnel.bytesOut += chunkByteLength(chunk)
    })
    channel.on('data', (chunk: Buffer | string) => {
      tunnel.bytesIn += chunkByteLength(chunk)
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
        const timer = setTimeout(done, this.unforwardTimeoutMs)
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
        // Ignore observer errors so tunnel lifecycle cannot be interrupted.
      }
    }
  }
}
