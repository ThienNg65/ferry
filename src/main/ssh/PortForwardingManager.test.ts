import { EventEmitter } from 'node:events'
import * as net from 'node:net'
import { Duplex, PassThrough } from 'node:stream'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  PortForwardingManager,
  formatCopyAddress,
  isExposedBindHost,
  validateTunnelRule,
  validateTunnelRules,
  type PortForwardingSshClient,
  type SshForwardChannel,
  type SshTcpConnectionInfo,
  type TunnelStatusEvent
} from './PortForwardingManager'

interface MockSshClient extends EventEmitter, PortForwardingSshClient {
  forwardOut: ReturnType<typeof vi.fn>
  forwardIn: ReturnType<typeof vi.fn>
  unforwardIn: ReturnType<typeof vi.fn>
}

function createMockSshClient(): MockSshClient {
  const emitter = new EventEmitter()
  const client = Object.assign(emitter, {
    forwardOut: vi.fn(
      (
        _srcIP: string,
        _srcPort: number,
        _dstIP: string,
        _dstPort: number,
        cb: (err: Error | undefined, stream: SshForwardChannel) => void
      ) => {
        const channel = new PassThrough() as unknown as SshForwardChannel
        cb(undefined, channel)
      }
    ),
    forwardIn: vi.fn(
      (_bindAddr: string, bindPort: number, cb?: (err?: Error, port?: number) => void) => {
        cb?.(undefined, bindPort)
      }
    ),
    unforwardIn: vi.fn((_bindAddr: string, _bindPort: number, cb?: (err?: Error) => void) => {
      cb?.(undefined)
    })
  })
  return client as unknown as MockSshClient
}

function sendTcpMessage(port: number, payload: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: '127.0.0.1', port }, () => {
      socket.write(payload)
    })
    const chunks: Buffer[] = []
    socket.on('data', (chunk) => {
      chunks.push(chunk)
      socket.end()
    })
    socket.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    socket.on('error', reject)
  })
}

function startLocalEchoServer(): Promise<{ server: net.Server; port: number }> {
  return new Promise((resolve, reject) => {
    const server = net.createServer((socket) => {
      socket.on('data', (chunk) => {
        socket.write(`echo:${chunk.toString('utf8')}`)
      })
    })
    server.once('error', reject)
    server.listen({ host: '127.0.0.1', port: 0 }, () => {
      const addr = server.address() as net.AddressInfo
      resolve({ server, port: addr.port })
    })
  })
}

function getUnusedPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = net.createServer()
    probe.once('error', reject)
    probe.listen({ host: '127.0.0.1', port: 0 }, () => {
      const port = (probe.address() as net.AddressInfo).port
      probe.close(() => resolve(port))
    })
  })
}

const managers: PortForwardingManager[] = []
const serversToClose: net.Server[] = []

function createManager(): PortForwardingManager {
  const manager = new PortForwardingManager()
  managers.push(manager)
  return manager
}

afterEach(async () => {
  while (managers.length > 0) {
    const manager = managers.pop()
    if (manager) {
      await manager.stopAll()
    }
  }
  while (serversToClose.length > 0) {
    const server = serversToClose.pop()
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  }
})

describe('Tunnel rule validation and helpers', () => {
  it('validates and normalizes valid local and remote tunnel rules', () => {
    const local = validateTunnelRule({
      id: 'pg-tunnel',
      type: 'local',
      bindPort: 5432,
      targetHost: '127.0.0.1',
      targetPort: 5432
    })
    expect(local.ok).toBe(true)
    if (local.ok) {
      expect(local.data).toMatchObject({
        id: 'pg-tunnel',
        bindHost: '127.0.0.1',
        bindPort: 5432,
        targetHost: '127.0.0.1',
        targetPort: 5432,
        autoStart: false
      })
    }

    const remote = validateTunnelRule({
      id: 'webhook',
      name: 'Local Webhook',
      type: 'remote',
      bindHost: '[::1]',
      bindPort: 8080,
      targetHost: 'localhost',
      targetPort: 3000,
      autoStart: true
    })
    expect(remote.ok).toBe(true)
    if (remote.ok) {
      expect(remote.data.bindHost).toBe('::1')
      expect(remote.data.name).toBe('Local Webhook')
      expect(remote.data.autoStart).toBe(true)
    }
  })

  it('rejects invalid rule fields, ports, and unsafe host characters', () => {
    expect(
      validateTunnelRule({
        id: '   ',
        type: 'local',
        bindPort: 5432,
        targetHost: '127.0.0.1',
        targetPort: 5432
      })
    ).toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } })

    expect(
      validateTunnelRule({
        id: 'bad-port-zero',
        type: 'local',
        bindPort: 0,
        targetHost: '127.0.0.1',
        targetPort: 5432
      })
    ).toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } })

    expect(
      validateTunnelRule({
        id: 'bad-port-high',
        type: 'local',
        bindPort: 5432,
        targetHost: '127.0.0.1',
        targetPort: 70000
      })
    ).toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } })

    expect(
      validateTunnelRule({
        id: 'bad-host',
        type: 'local',
        bindHost: '127.0.0.1; rm -rf /',
        bindPort: 5432,
        targetHost: '127.0.0.1',
        targetPort: 5432
      })
    ).toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } })
  })

  it('detects duplicate IDs and conflicting bindings including wildcard interfaces', () => {
    const duplicateId = validateTunnelRules([
      { id: 'r1', type: 'local', bindPort: 5432, targetHost: 'db', targetPort: 5432 },
      { id: 'r1', type: 'local', bindPort: 6379, targetHost: 'redis', targetPort: 6379 }
    ])
    expect(duplicateId).toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } })

    const wildcardConflict = validateTunnelRules([
      { id: 'r1', type: 'local', bindHost: '0.0.0.0', bindPort: 5432, targetHost: 'db', targetPort: 5432 },
      { id: 'r2', type: 'local', bindHost: '127.0.0.1', bindPort: 5432, targetHost: 'db2', targetPort: 5432 }
    ])
    expect(wildcardConflict).toMatchObject({ ok: false, error: { code: 'PORT_IN_USE' } })

    const mixedDirections = validateTunnelRules([
      { id: 'r1', type: 'local', bindPort: 8080, targetHost: 'app', targetPort: 8080 },
      { id: 'r2', type: 'remote', bindPort: 8080, targetHost: '127.0.0.1', targetPort: 3000 }
    ])
    expect(mixedDirections.ok).toBe(true)
  })

  it('flags exposed bind hosts and formats copyable addresses accurately', () => {
    expect(isExposedBindHost('127.0.0.1')).toBe(false)
    expect(isExposedBindHost('localhost')).toBe(false)
    expect(isExposedBindHost('::1')).toBe(false)
    expect(isExposedBindHost('0.0.0.0')).toBe(true)
    expect(isExposedBindHost('::')).toBe(true)
    expect(isExposedBindHost('192.168.1.20')).toBe(true)

    expect(formatCopyAddress('127.0.0.1', 5432)).toBe('localhost:5432')
    expect(formatCopyAddress('0.0.0.0', 6379)).toBe('localhost:6379')
    expect(formatCopyAddress('::1', 8080)).toBe('localhost:8080')
    expect(formatCopyAddress('2001:db8::1', 9000)).toBe('[2001:db8::1]:9000')
    expect(formatCopyAddress('192.168.1.20', 5432)).toBe('192.168.1.20:5432')
  })
})

describe('PortForwardingManager local (-L) tunnels', () => {
  it('starts a local tunnel, forwards bidirectional TCP traffic, and cleans up on stop', async () => {
    const manager = createManager()
    const client = createMockSshClient()
    const events: TunnelStatusEvent[] = []
    manager.onChange((event) => events.push(event))

    const started = await manager.startTunnel(
      'sess-1',
      client,
      {
        id: 'pg',
        name: 'Postgres',
        type: 'local',
        bindHost: '127.0.0.1',
        bindPort: 0,
        targetHost: '10.0.0.5',
        targetPort: 5432
      },
      { allowEphemeralPort: true }
    )

    expect(started.ok).toBe(true)
    if (!started.ok) return

    const boundPort = started.data.bindPort
    expect(boundPort).toBeGreaterThan(0)
    expect(started.data.localAddress).toBe(`localhost:${boundPort}`)
    expect(started.data.exposedExternally).toBe(false)

    const reply = await sendTcpMessage(boundPort, 'SELECT 1')
    expect(reply).toBe('SELECT 1')
    expect(client.forwardOut).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Number),
      '10.0.0.5',
      5432,
      expect.any(Function)
    )

    const active = manager.getActiveTunnels('sess-1')
    expect(active).toHaveLength(1)
    expect(active[0].bytesOut).toBe(Buffer.byteLength('SELECT 1'))
    expect(active[0].bytesIn).toBe(Buffer.byteLength('SELECT 1'))

    const stopped = await manager.stopTunnel('sess-1', 'pg')
    expect(stopped).toEqual({ ok: true, data: undefined })
    expect(manager.getActiveTunnels('sess-1')).toHaveLength(0)
    expect(events.map((e) => e.status)).toEqual(['starting', 'active', 'stopped'])
  })

  it('returns a typed PORT_IN_USE error when the local port is already occupied without crashing the session', async () => {
    const manager = createManager()
    const client = createMockSshClient()

    const blocker = net.createServer()
    serversToClose.push(blocker)
    await new Promise<void>((resolve) => blocker.listen({ host: '127.0.0.1', port: 0 }, () => resolve()))
    const occupiedPort = (blocker.address() as net.AddressInfo).port

    const result = await manager.startTunnel('sess-1', client, {
      id: 'conflict',
      type: 'local',
      bindHost: '127.0.0.1',
      bindPort: occupiedPort,
      targetHost: '127.0.0.1',
      targetPort: 5432
    })

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'PORT_IN_USE' }
    })
    expect(manager.getActiveTunnels('sess-1')).toHaveLength(0)
  })

  it('destroys active client sockets immediately when stopTunnel is called', async () => {
    const manager = createManager()
    const client = createMockSshClient()

    const started = await manager.startTunnel(
      'sess-active-close',
      client,
      {
        id: 'keepopen',
        type: 'local',
        bindPort: 0,
        targetHost: '127.0.0.1',
        targetPort: 5432
      },
      { allowEphemeralPort: true }
    )
    expect(started.ok).toBe(true)
    if (!started.ok) return

    const openSocket = net.createConnection({ host: '127.0.0.1', port: started.data.bindPort })
    await new Promise<void>((resolve) => openSocket.once('connect', () => resolve()))
    const closedPromise = new Promise<void>((resolve) => openSocket.once('close', () => resolve()))

    await manager.stopTunnel('sess-active-close', 'keepopen')
    await closedPromise
    expect(manager.getActiveTunnels('sess-active-close')).toHaveLength(0)
  })

  it('handles forwardOut rejection cleanly without closing the local listener or session', async () => {
    const manager = createManager()
    const client = createMockSshClient()
    client.forwardOut.mockImplementationOnce(
      (_srcIP: string, _srcPort: number, _dstIP: string, _dstPort: number, cb: (err?: Error) => void) => {
        cb(new Error('Administratively prohibited'))
      }
    )

    const started = await manager.startTunnel(
      'sess-1',
      client,
      {
        id: 'blocked',
        type: 'local',
        bindPort: 0,
        targetHost: '10.0.0.5',
        targetPort: 5432
      },
      { allowEphemeralPort: true }
    )
    expect(started.ok).toBe(true)
    if (!started.ok) return

    await new Promise<void>((resolve) => {
      const sock = net.createConnection({ host: '127.0.0.1', port: started.data.bindPort })
      sock.once('close', () => resolve())
      sock.on('error', () => resolve())
    })

    const active = manager.getActiveTunnels('sess-1')
    expect(active).toHaveLength(1)
    expect(active[0].lastError).toContain('Administratively prohibited')

    const reply = await sendTcpMessage(started.data.bindPort, 'ping')
    expect(reply).toBe('ping')
  })
})

describe('PortForwardingManager remote (-R) tunnels', () => {
  it('routes incoming SSH tcp connections to the local target and calls unforwardIn on stop', async () => {
    const manager = createManager()
    const client = createMockSshClient()
    const { server: echoServer, port: localTargetPort } = await startLocalEchoServer()
    serversToClose.push(echoServer)

    const started = await manager.startTunnel('sess-r1', client, {
      id: 'remote-dev',
      type: 'remote',
      bindHost: '127.0.0.1',
      bindPort: 9090,
      targetHost: '127.0.0.1',
      targetPort: localTargetPort
    })

    expect(started.ok).toBe(true)
    expect(client.forwardIn).toHaveBeenCalledWith('127.0.0.1', 9090, expect.any(Function))

    const rejectFn = vi.fn()
    const info: SshTcpConnectionInfo = {
      destIP: '127.0.0.1',
      destPort: 9090,
      srcIP: '10.0.0.1',
      srcPort: 51234
    }

    const received = await new Promise<string>((resolve) => {
      const outbound = new PassThrough()
      outbound.once('data', (buf: Buffer) => {
        duplexChannel.destroy()
        resolve(buf.toString('utf8'))
      })
      const duplexChannel = new Duplex({
        read() {
          // Data is pushed manually below.
        },
        write(chunk: Buffer, _enc: BufferEncoding, cb: () => void) {
          outbound.write(chunk)
          cb()
        }
      }) as unknown as SshForwardChannel

      client.emit('tcp connection', info, () => duplexChannel, rejectFn)
      duplexChannel.push('hello')
    })

    expect(rejectFn).not.toHaveBeenCalled()
    expect(received).toBe('echo:hello')

    // Unmatched port must be rejected cleanly.
    const unmatchedReject = vi.fn()
    client.emit(
      'tcp connection',
      { destIP: '127.0.0.1', destPort: 9999, srcIP: '10.0.0.1', srcPort: 51235 },
      () => new PassThrough() as unknown as SshForwardChannel,
      unmatchedReject
    )
    expect(unmatchedReject).toHaveBeenCalledTimes(1)

    await manager.stopTunnel('sess-r1', 'remote-dev')
    expect(client.unforwardIn).toHaveBeenCalledWith('127.0.0.1', 9090, expect.any(Function))
    expect(manager.getActiveTunnels('sess-r1')).toHaveLength(0)
  })

  it('destroys the incoming channel and records lastError when the local target is unreachable', async () => {
    const manager = createManager()
    const client = createMockSshClient()
    const closedPort = await getUnusedPort()

    const started = await manager.startTunnel('sess-r-unreachable', client, {
      id: 'remote-dead-target',
      type: 'remote',
      bindHost: '127.0.0.1',
      bindPort: 9095,
      targetHost: '127.0.0.1',
      targetPort: closedPort
    })
    expect(started.ok).toBe(true)

    const channel = new PassThrough() as unknown as SshForwardChannel
    const channelClosed = new Promise<void>((resolve) => channel.once('close', () => resolve()))
    client.emit(
      'tcp connection',
      { destIP: '127.0.0.1', destPort: 9095, srcIP: '10.0.0.1', srcPort: 51240 },
      () => channel,
      vi.fn()
    )

    await channelClosed
    const active = manager.getActiveTunnels('sess-r-unreachable')
    expect(active).toHaveLength(1)
    expect(active[0].lastError).toContain('unreachable')
  })

  it('returns SSH_FORWARD_FAILED when the remote server rejects forwardIn', async () => {
    const manager = createManager()
    const client = createMockSshClient()
    client.forwardIn.mockImplementationOnce((_host: string, _port: number, cb?: (err?: Error) => void) => {
      cb?.(new Error('Unable to bind remote port'))
    })

    const result = await manager.startTunnel('sess-r2', client, {
      id: 'remote-fail',
      type: 'remote',
      bindPort: 8080,
      targetHost: '127.0.0.1',
      targetPort: 3000
    })

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'SSH_FORWARD_FAILED' }
    })
  })
})

describe('PortForwardingManager lifecycle, concurrency, and disconnect cleanup', () => {
  it('cleans up all tunnels and detaches SSH listeners when the session disconnects', async () => {
    const manager = createManager()
    const client = createMockSshClient()
    const events: TunnelStatusEvent[] = []
    manager.onChange((event) => events.push(event))

    const local = await manager.startTunnel(
      'sess-disc',
      client,
      {
        id: 't-local',
        type: 'local',
        bindPort: 0,
        targetHost: '127.0.0.1',
        targetPort: 5432
      },
      { allowEphemeralPort: true }
    )
    const remote = await manager.startTunnel('sess-disc', client, {
      id: 't-remote',
      type: 'remote',
      bindPort: 8081,
      targetHost: '127.0.0.1',
      targetPort: 3000
    })

    expect(local.ok).toBe(true)
    expect(remote.ok).toBe(true)
    expect(manager.getActiveTunnels('sess-disc')).toHaveLength(2)
    expect(client.listenerCount('tcp connection')).toBe(1)

    client.emit('close')

    await vi.waitFor(() => {
      expect(manager.getActiveTunnels('sess-disc')).toHaveLength(0)
    })
    expect(client.listenerCount('tcp connection')).toBe(0)
    expect(client.listenerCount('close')).toBe(0)
    expect(events.filter((e) => e.status === 'stopped')).toHaveLength(2)
  })

  it('prevents duplicate concurrent startTunnel calls for the same rule id', async () => {
    const manager = createManager()
    const client = createMockSshClient()

    let completeForwardIn: (() => void) | undefined
    client.forwardIn.mockImplementationOnce((_host: string, port: number, cb?: (err?: Error, p?: number) => void) => {
      completeForwardIn = () => cb?.(undefined, port)
    })

    const first = manager.startTunnel('sess-race', client, {
      id: 'same-rule',
      type: 'remote',
      bindPort: 9100,
      targetHost: '127.0.0.1',
      targetPort: 3000
    })

    const second = await manager.startTunnel('sess-race', client, {
      id: 'same-rule',
      type: 'remote',
      bindPort: 9100,
      targetHost: '127.0.0.1',
      targetPort: 3000
    })

    expect(second).toMatchObject({
      ok: false,
      error: { code: 'TUNNEL_ALREADY_ACTIVE' }
    })

    completeForwardIn?.()
    const firstResult = await first
    expect(firstResult.ok).toBe(true)
    expect(manager.getActiveTunnels('sess-race')).toHaveLength(1)
  })

  it('rejects startTunnel when session is not connected and supports stopAll across sessions', async () => {
    const manager = createManager()
    const missing = await manager.startTunnel('sess-missing', null, {
      id: 'r1',
      type: 'local',
      bindPort: 5432,
      targetHost: '127.0.0.1',
      targetPort: 5432
    })
    expect(missing).toMatchObject({
      ok: false,
      error: { code: 'SESSION_NOT_CONNECTED' }
    })

    const c1 = createMockSshClient()
    const c2 = createMockSshClient()
    await manager.startTunnel(
      's1',
      c1,
      { id: 'l1', type: 'local', bindPort: 0, targetHost: '127.0.0.1', targetPort: 5432 },
      { allowEphemeralPort: true }
    )
    await manager.startTunnel('s2', c2, {
      id: 'r2',
      type: 'remote',
      bindPort: 9200,
      targetHost: '127.0.0.1',
      targetPort: 3000
    })
    expect(manager.getActiveTunnels()).toHaveLength(2)

    await manager.stopAll()
    expect(manager.getActiveTunnels()).toHaveLength(0)
  })
})
