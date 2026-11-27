import { EventEmitter } from 'node:events'
import * as net from 'node:net'
import { Duplex, PassThrough } from 'node:stream'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  PortForwardingManager,
  formatCopyAddress,
  formatTunnelSpec,
  isExposedBindHost,
  validateTunnelRule,
  validateTunnelRules,
  type PortForwardingSshClient,
  type SshForwardChannel,
  type SshTcpConnectionInfo,
  type TunnelStatusEvent
} from './PortForwardingManager'

type MockSshClient = EventEmitter & {
  forwardOut: ReturnType<typeof vi.fn>
  forwardIn: ReturnType<typeof vi.fn>
  unforwardIn: ReturnType<typeof vi.fn>
}

function createMockSshClient(): MockSshClient {
  const emitter = new EventEmitter()
  const client: MockSshClient = Object.assign(emitter, {
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
  const _typeCheck: PortForwardingSshClient = client
  void _typeCheck
  return client
}

function sendTcpMessage(port: number, payload: string, halfClose = false): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: '127.0.0.1', port }, () => {
      if (halfClose) {
        socket.end(payload)
      } else {
        socket.write(payload)
      }
    })
    const chunks: Buffer[] = []
    socket.on('data', (chunk) => {
      chunks.push(chunk)
      if (!halfClose) {
        socket.end()
      }
    })
    socket.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    socket.on('error', reject)
  })
}

function startLocalEchoServer(prefix = 'echo:'): Promise<{ server: net.Server; port: number }> {
  return new Promise((resolve, reject) => {
    const server = net.createServer((socket) => {
      socket.on('data', (chunk) => {
        socket.write(`${prefix}${chunk.toString('utf8')}`)
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

function createManager(options?: { unforwardTimeoutMs?: number }): PortForwardingManager {
  const manager = new PortForwardingManager(options)
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

  it('rejects invalid rule fields, ports, wildcard targets, and unsafe host tokens', () => {
    const invalidCases = [
      { id: '   ', type: 'local' as const, bindPort: 5432, targetHost: '127.0.0.1', targetPort: 5432 },
      { id: 'bad-type', type: 'dynamic' as unknown as 'local', bindPort: 1080, targetHost: '127.0.0.1', targetPort: 80 },
      { id: 'port-zero', type: 'local' as const, bindPort: 0, targetHost: '127.0.0.1', targetPort: 5432 },
      { id: 'port-float', type: 'local' as const, bindPort: 54.5, targetHost: '127.0.0.1', targetPort: 5432 },
      { id: 'port-high', type: 'local' as const, bindPort: 5432, targetHost: '127.0.0.1', targetPort: 70000 },
      { id: 'host-shell', type: 'local' as const, bindHost: '127.0.0.1; rm -rf /', bindPort: 5432, targetHost: '127.0.0.1', targetPort: 5432 },
      { id: 'host-dash', type: 'local' as const, bindHost: '-oProxyCommand=evil', bindPort: 5432, targetHost: '127.0.0.1', targetPort: 5432 },
      { id: 'host-bracket', type: 'local' as const, bindHost: '[::1', bindPort: 5432, targetHost: '127.0.0.1', targetPort: 5432 },
      { id: 'target-wildcard', type: 'local' as const, bindPort: 5432, targetHost: '*', targetPort: 5432 }
    ]

    for (const rule of invalidCases) {
      expect(validateTunnelRule(rule)).toMatchObject({
        ok: false,
        error: { code: 'VALIDATION_ERROR' }
      })
    }
  })

  it('detects duplicate IDs, localhost aliases, and wildcard conflicts while allowing disjoint bindings', () => {
    expect(
      validateTunnelRules([
        { id: 'r1', type: 'local', bindPort: 5432, targetHost: 'db', targetPort: 5432 },
        { id: 'r1', type: 'local', bindPort: 6379, targetHost: 'redis', targetPort: 6379 }
      ])
    ).toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } })

    expect(
      validateTunnelRules([
        { id: 'r1', type: 'local', bindHost: '0.0.0.0', bindPort: 5432, targetHost: 'db', targetPort: 5432 },
        { id: 'r2', type: 'local', bindHost: '127.0.0.1', bindPort: 5432, targetHost: 'db2', targetPort: 5432 }
      ])
    ).toMatchObject({ ok: false, error: { code: 'PORT_IN_USE' } })

    expect(
      validateTunnelRules([
        { id: 'r1', type: 'local', bindHost: 'localhost', bindPort: 5432, targetHost: 'db', targetPort: 5432 },
        { id: 'r2', type: 'local', bindHost: '127.0.0.1', bindPort: 5432, targetHost: 'db2', targetPort: 5432 }
      ])
    ).toMatchObject({ ok: false, error: { code: 'PORT_IN_USE' } })

    expect(
      validateTunnelRules([
        { id: 'r1', type: 'local', bindHost: '127.0.0.1', bindPort: 8080, targetHost: 'app1', targetPort: 8080 },
        { id: 'r2', type: 'local', bindHost: '127.0.0.2', bindPort: 8080, targetHost: 'app2', targetPort: 8080 },
        { id: 'r3', type: 'remote', bindHost: '127.0.0.1', bindPort: 8080, targetHost: '127.0.0.1', targetPort: 3000 }
      ]).ok
    ).toBe(true)
  })

  it('flags exposed bind hosts and formats copy addresses and OpenSSH tunnel specs', () => {
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

    expect(
      formatTunnelSpec({
        type: 'local',
        bindHost: '127.0.0.1',
        bindPort: 5432,
        targetHost: '10.0.0.5',
        targetPort: 5432
      })
    ).toBe('-L 127.0.0.1:5432:10.0.0.5:5432')
    expect(
      formatTunnelSpec({
        type: 'remote',
        bindHost: '::1',
        bindPort: 8080,
        targetHost: '2001:db8::2',
        targetPort: 3000
      })
    ).toBe('-R [::1]:8080:[2001:db8::2]:3000')
  })
})

describe('PortForwardingManager local (-L) tunnels', () => {
  it('starts a local tunnel, forwards bidirectional and half-closed TCP traffic, and cleans up on stop', async () => {
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

    const [reply1, reply2] = await Promise.all([
      sendTcpMessage(boundPort, 'SELECT 1', true),
      sendTcpMessage(boundPort, 'SELECT 2', false)
    ])
    expect(reply1).toBe('SELECT 1')
    expect(reply2).toBe('SELECT 2')
    expect(client.forwardOut).toHaveBeenCalledTimes(2)

    const active = manager.getActiveTunnels('sess-1')
    expect(active).toHaveLength(1)
    expect(active[0].bytesOut).toBe(Buffer.byteLength('SELECT 1') + Buffer.byteLength('SELECT 2'))
    expect(active[0].bytesIn).toBe(Buffer.byteLength('SELECT 1') + Buffer.byteLength('SELECT 2'))

    const stopped = await manager.stopTunnel('sess-1', 'pg')
    expect(stopped).toEqual({ ok: true, data: undefined })
    expect(manager.getActiveTunnels('sess-1')).toHaveLength(0)
    expect(events.map((e) => e.status)).toEqual(['starting', 'active', 'stopped'])
  })

  it('returns typed PORT_IN_USE when the local port is occupied by OS or another session tunnel', async () => {
    const manager = createManager()
    const clientA = createMockSshClient()
    const clientB = createMockSshClient()

    const blocker = net.createServer()
    serversToClose.push(blocker)
    await new Promise<void>((resolve) => blocker.listen({ host: '127.0.0.1', port: 0 }, () => resolve()))
    const occupiedPort = (blocker.address() as net.AddressInfo).port

    const osConflict = await manager.startTunnel('sess-a', clientA, {
      id: 'conflict-os',
      type: 'local',
      bindHost: '127.0.0.1',
      bindPort: occupiedPort,
      targetHost: '127.0.0.1',
      targetPort: 5432
    })
    expect(osConflict).toMatchObject({ ok: false, error: { code: 'PORT_IN_USE' } })

    const first = await manager.startTunnel(
      'sess-a',
      clientA,
      { id: 'a-pg', type: 'local', bindPort: 0, targetHost: '10.0.0.5', targetPort: 5432 },
      { allowEphemeralPort: true }
    )
    expect(first.ok).toBe(true)
    if (!first.ok) return

    const crossSessionConflict = await manager.startTunnel('sess-b', clientB, {
      id: 'b-pg',
      type: 'local',
      bindHost: 'localhost',
      bindPort: first.data.bindPort,
      targetHost: '10.0.0.6',
      targetPort: 5432
    })
    expect(crossSessionConflict).toMatchObject({ ok: false, error: { code: 'PORT_IN_USE' } })
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
    openSocket.on('error', () => undefined)
    await new Promise<void>((resolve) => openSocket.once('connect', () => resolve()))
    await vi.waitFor(() => {
      expect(manager.getActiveTunnels('sess-active-close')[0]?.activeConnections).toBe(1)
    })

    const closedPromise = new Promise<void>((resolve) => openSocket.once('close', () => resolve()))
    await manager.stopTunnel('sess-active-close', 'keepopen')
    await closedPromise
    expect(manager.getActiveTunnels('sess-active-close')).toHaveLength(0)
  })

  it('destroys the late SSH channel if local client disconnects while forwardOut is pending', async () => {
    const manager = createManager()
    const client = createMockSshClient()
    let resolveForwardOut: ((err: Error | undefined, ch: SshForwardChannel) => void) | undefined
    client.forwardOut.mockImplementationOnce(
      (
        _srcIP: string,
        _srcPort: number,
        _dstIP: string,
        _dstPort: number,
        cb: (err: Error | undefined, ch: SshForwardChannel) => void
      ) => {
        resolveForwardOut = cb
      }
    )

    const started = await manager.startTunnel(
      'sess-early-drop',
      client,
      { id: 'slow-fwd', type: 'local', bindPort: 0, targetHost: '10.0.0.5', targetPort: 5432 },
      { allowEphemeralPort: true }
    )
    expect(started.ok).toBe(true)
    if (!started.ok) return

    const sock = net.createConnection({ host: '127.0.0.1', port: started.data.bindPort })
    sock.on('error', () => undefined)
    await vi.waitFor(() => expect(resolveForwardOut).toBeDefined())
    sock.destroy()
    await new Promise<void>((resolve) => sock.once('close', () => resolve()))
    await new Promise((resolve) => setTimeout(resolve, 15))

    const lateChannel = new PassThrough() as unknown as SshForwardChannel
    resolveForwardOut?.(undefined, lateChannel)
    expect(lateChannel.destroyed).toBe(true)
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
      { id: 'blocked', type: 'local', bindPort: 0, targetHost: '10.0.0.5', targetPort: 5432 },
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
  it('routes multiple -R tunnels on the same session through one listener and calls unforwardIn on stop', async () => {
    const manager = createManager()
    const client = createMockSshClient()
    const { server: echoA, port: portA } = await startLocalEchoServer('A:')
    const { server: echoB, port: portB } = await startLocalEchoServer('B:')
    serversToClose.push(echoA, echoB)

    const startedA = await manager.startTunnel('sess-r1', client, {
      id: 'remote-a',
      type: 'remote',
      bindHost: '127.0.0.1',
      bindPort: 9091,
      targetHost: '127.0.0.1',
      targetPort: portA
    })
    const startedB = await manager.startTunnel('sess-r1', client, {
      id: 'remote-b',
      type: 'remote',
      bindHost: '127.0.0.1',
      bindPort: 9092,
      targetHost: '127.0.0.1',
      targetPort: portB
    })

    expect(startedA.ok).toBe(true)
    expect(startedB.ok).toBe(true)
    expect(client.listenerCount('tcp connection')).toBe(1)

    const sendThroughRemote = (destPort: number, msg: string): Promise<string> =>
      new Promise((resolve) => {
        const outbound = new PassThrough()
        const duplexChannel = new Duplex({
          read() {
            // Driven by manual push below.
          },
          write(chunk: Buffer, _enc: BufferEncoding, cb: () => void) {
            outbound.write(chunk)
            cb()
          }
        }) as unknown as SshForwardChannel

        outbound.once('data', (buf: Buffer) => {
          duplexChannel.destroy()
          resolve(buf.toString('utf8'))
        })

        const info: SshTcpConnectionInfo = {
          destIP: '127.0.0.1',
          destPort,
          srcIP: '10.0.0.1',
          srcPort: 51234
        }
        client.emit('tcp connection', info, () => duplexChannel, vi.fn())
        duplexChannel.push(msg)
      })

    expect(await sendThroughRemote(9091, 'one')).toBe('A:one')
    expect(await sendThroughRemote(9092, 'two')).toBe('B:two')

    const unmatchedReject = vi.fn()
    client.emit(
      'tcp connection',
      { destIP: '127.0.0.1', destPort: 9999, srcIP: '10.0.0.1', srcPort: 51235 },
      () => new PassThrough() as unknown as SshForwardChannel,
      unmatchedReject
    )
    expect(unmatchedReject).toHaveBeenCalledTimes(1)

    await manager.stopTunnel('sess-r1', 'remote-a')
    expect(client.unforwardIn).toHaveBeenCalledWith('127.0.0.1', 9091, expect.any(Function))
    expect(manager.getActiveTunnels('sess-r1')).toHaveLength(1)
  })

  it('destroys incoming channel and records lastError when local target is unreachable', async () => {
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

  it('maps remote forwardIn errors and validates server-assigned ephemeral ports', async () => {
    const manager = createManager()
    const client = createMockSshClient()

    client.forwardIn.mockImplementationOnce((_host: string, _port: number, cb?: (err?: Error) => void) => {
      cb?.(new Error('Address already in use'))
    })
    const inUse = await manager.startTunnel('sess-r2', client, {
      id: 'remote-inuse',
      type: 'remote',
      bindPort: 8080,
      targetHost: '127.0.0.1',
      targetPort: 3000
    })
    expect(inUse).toMatchObject({ ok: false, error: { code: 'PORT_IN_USE' } })

    client.forwardIn.mockImplementationOnce((_host: string, _port: number, cb?: (err?: Error, p?: number) => void) => {
      cb?.(undefined, 0)
    })
    const badEphemeral = await manager.startTunnel(
      'sess-r2',
      client,
      { id: 'remote-zero', type: 'remote', bindPort: 0, targetHost: '127.0.0.1', targetPort: 3000 },
      { allowEphemeralPort: true }
    )
    expect(badEphemeral).toMatchObject({ ok: false, error: { code: 'SSH_FORWARD_FAILED' } })
  })

  it('does not hang on stopTunnel if remote unforwardIn callback never fires', async () => {
    const manager = createManager({ unforwardTimeoutMs: 30 })
    const client = createMockSshClient()
    client.unforwardIn.mockImplementationOnce(() => {
      // Intentionally never invokes callback.
    })

    const started = await manager.startTunnel('sess-r-hang', client, {
      id: 'remote-hang',
      type: 'remote',
      bindPort: 9098,
      targetHost: '127.0.0.1',
      targetPort: 3000
    })
    expect(started.ok).toBe(true)

    const stopped = await manager.stopTunnel('sess-r-hang', 'remote-hang')
    expect(stopped).toEqual({ ok: true, data: undefined })
    expect(manager.getActiveTunnels('sess-r-hang')).toHaveLength(0)
  })
})

describe('PortForwardingManager lifecycle, concurrency, cancellation, and autoStart', () => {
  it('cleans up all tunnels and detaches SSH listeners on session close', async () => {
    const manager = createManager()
    const client = createMockSshClient()
    const events: TunnelStatusEvent[] = []
    manager.onChange((event) => events.push(event))

    await manager.startTunnel(
      'sess-disc',
      client,
      { id: 't-local', type: 'local', bindPort: 0, targetHost: '127.0.0.1', targetPort: 5432 },
      { allowEphemeralPort: true }
    )
    await manager.startTunnel('sess-disc', client, {
      id: 't-remote',
      type: 'remote',
      bindPort: 8081,
      targetHost: '127.0.0.1',
      targetPort: 3000
    })

    expect(manager.getActiveTunnels('sess-disc')).toHaveLength(2)
    client.emit('close')

    await vi.waitFor(() => {
      expect(manager.getActiveTunnels('sess-disc')).toHaveLength(0)
    })
    expect(client.listenerCount('tcp connection')).toBe(0)
    expect(client.listenerCount('close')).toBe(0)
    expect(events.filter((e) => e.status === 'stopped')).toHaveLength(2)
  })

  it('cancels a pending tunnel cleanly when stopTunnel is called mid-startup', async () => {
    const manager = createManager()
    const client = createMockSshClient()

    let completeForwardIn: (() => void) | undefined
    client.forwardIn.mockImplementationOnce((_host: string, port: number, cb?: (err?: Error, p?: number) => void) => {
      completeForwardIn = () => cb?.(undefined, port)
    })

    const startPromise = manager.startTunnel('sess-cancel', client, {
      id: 'slow-remote',
      type: 'remote',
      bindPort: 9101,
      targetHost: '127.0.0.1',
      targetPort: 3000
    })

    const stopResult = await manager.stopTunnel('sess-cancel', 'slow-remote')
    expect(stopResult).toEqual({ ok: true, data: undefined })

    completeForwardIn?.()
    const startResult = await startPromise
    expect(startResult.ok).toBe(false)
    expect(client.unforwardIn).toHaveBeenCalledWith('127.0.0.1', 9101, expect.any(Function))
    expect(manager.getActiveTunnels('sess-cancel')).toHaveLength(0)
  })

  it('prevents duplicate concurrent startTunnel calls and competing pending port binds', async () => {
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

    const sameId = await manager.startTunnel('sess-race', client, {
      id: 'same-rule',
      type: 'remote',
      bindPort: 9100,
      targetHost: '127.0.0.1',
      targetPort: 3000
    })
    expect(sameId).toMatchObject({ ok: false, error: { code: 'TUNNEL_ALREADY_ACTIVE' } })

    const samePort = await manager.startTunnel('sess-race', client, {
      id: 'different-rule',
      type: 'remote',
      bindPort: 9100,
      targetHost: '127.0.0.1',
      targetPort: 3001
    })
    expect(samePort).toMatchObject({ ok: false, error: { code: 'PORT_IN_USE' } })

    completeForwardIn?.()
    expect((await first).ok).toBe(true)
  })

  it('starts autoStart rules independently via startAutoTunnels without aborting on partial failure', async () => {
    const manager = createManager()
    const client = createMockSshClient()

    const blocker = net.createServer()
    serversToClose.push(blocker)
    await new Promise<void>((resolve) => blocker.listen({ host: '127.0.0.1', port: 0 }, () => resolve()))
    const occupiedPort = (blocker.address() as net.AddressInfo).port

    const summary = await manager.startAutoTunnels(
      'sess-auto',
      client,
      [
        { id: 'manual-only', type: 'local', bindPort: 0, targetHost: '10.0.0.1', targetPort: 5432, autoStart: false },
        { id: 'broken-auto', type: 'local', bindPort: occupiedPort, targetHost: '10.0.0.2', targetPort: 5432, autoStart: true },
        { id: 'good-auto', type: 'local', bindPort: 0, targetHost: '10.0.0.3', targetPort: 6379, autoStart: true }
      ],
      { allowEphemeralPort: true }
    )

    expect(summary.started).toHaveLength(1)
    expect(summary.started[0].ruleId).toBe('good-auto')
    expect(summary.failed).toHaveLength(1)
    expect(summary.failed[0]).toMatchObject({
      ruleId: 'broken-auto',
      error: { code: 'PORT_IN_USE' }
    })
  })

  it('isolates throwing status listeners and handles missing sessions/rules cleanly', async () => {
    const manager = createManager()
    const goodListener = vi.fn()
    manager.onChange(() => {
      throw new Error('UI subscriber crashed')
    })
    manager.onChange(goodListener)

    expect(
      await manager.startTunnel('sess-missing', null, {
        id: 'r1',
        type: 'local',
        bindPort: 5432,
        targetHost: '127.0.0.1',
        targetPort: 5432
      })
    ).toMatchObject({ ok: false, error: { code: 'SESSION_NOT_CONNECTED' } })

    expect(await manager.stopTunnel('sess-missing', 'nope')).toMatchObject({
      ok: false,
      error: { code: 'TUNNEL_NOT_FOUND' }
    })

    const client = createMockSshClient()
    const started = await manager.startTunnel(
      'sess-ok',
      client,
      { id: 'l1', type: 'local', bindPort: 0, targetHost: '127.0.0.1', targetPort: 5432 },
      { allowEphemeralPort: true }
    )
    expect(started.ok).toBe(true)
    expect(goodListener).toHaveBeenCalled()

    await manager.stopAll()
    expect(manager.getActiveTunnels()).toHaveLength(0)
  })
})
