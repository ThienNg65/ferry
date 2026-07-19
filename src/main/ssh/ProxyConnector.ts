import { connect as netConnect, type Socket } from 'net'
import type { Duplex } from 'stream'
import { SocksClient } from 'socks'
import { SshError } from './errors'
import type { ProxyConfig } from '../../shared/contract'

/**
 * Independent of ssh2's own `readyTimeout` — a hung proxy shouldn't silently
 * consume the whole SSH connect budget without a distinguishable error.
 */
const DEFAULT_PROXY_TIMEOUT_MS = 15_000

async function connectSocks5(
  proxy: ProxyConfig,
  targetHost: string,
  targetPort: number,
  timeoutMs: number
): Promise<Duplex> {
  try {
    const { socket } = await SocksClient.createConnection({
      command: 'connect',
      destination: { host: targetHost, port: targetPort },
      proxy: {
        host: proxy.host,
        port: proxy.port,
        type: 5,
        userId: proxy.username,
        password: proxy.password
      },
      timeout: timeoutMs
    })
    return socket
  } catch (e) {
    throw new SshError(
      'PROXY_CONNECT',
      `SOCKS5 proxy ${proxy.host}:${proxy.port} failed to reach ${targetHost}:${targetPort}: ${e instanceof Error ? e.message : String(e)}`
    )
  }
}

/**
 * Minimal hand-rolled HTTP CONNECT tunnel — no small, well-maintained library
 * exists for "just issue a CONNECT and hand back the raw socket," and the
 * protocol itself (RFC 9110 §9.3.6) is simple enough to implement directly:
 * a plain-text request line + headers, then a status line + headers response,
 * after which the socket is a raw byte pipe to the target.
 */
function connectHttp(proxy: ProxyConfig, targetHost: string, targetPort: number, timeoutMs: number): Promise<Duplex> {
  return new Promise((resolve, reject) => {
    const socket: Socket = netConnect({ host: proxy.host, port: proxy.port })
    let settled = false

    const timer = setTimeout(() => {
      fail(`HTTP proxy ${proxy.host}:${proxy.port} timed out connecting to ${targetHost}:${targetPort}`)
    }, timeoutMs)

    function fail(message: string): void {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(timer)
      socket.destroy()
      reject(new SshError('PROXY_CONNECT', message))
    }

    socket.on('error', (e) => fail(`HTTP proxy ${proxy.host}:${proxy.port} connection failed: ${e.message}`))

    socket.once('connect', () => {
      const authHeader = proxy.username
        ? `Proxy-Authorization: Basic ${Buffer.from(`${proxy.username}:${proxy.password ?? ''}`).toString('base64')}\r\n`
        : ''
      socket.write(
        `CONNECT ${targetHost}:${targetPort} HTTP/1.1\r\nHost: ${targetHost}:${targetPort}\r\n${authHeader}\r\n`
      )

      let buffered = Buffer.alloc(0)
      const onData = (chunk: Buffer): void => {
        buffered = Buffer.concat([buffered, chunk])
        const headerEnd = buffered.indexOf('\r\n\r\n')
        if (headerEnd === -1) {
          return // wait for the rest of the header block
        }
        socket.removeListener('data', onData)
        const statusLine = buffered.subarray(0, buffered.indexOf('\r\n')).toString('utf-8')
        const match = /^HTTP\/1\.[01] (\d{3})/.exec(statusLine)
        if (!match || match[1] !== '200') {
          fail(`HTTP proxy ${proxy.host}:${proxy.port} refused CONNECT to ${targetHost}:${targetPort}: ${statusLine}`)
          return
        }
        if (settled) {
          return
        }
        settled = true
        clearTimeout(timer)
        // Any bytes the proxy sent after the header block already belong to
        // the tunneled connection — push them back onto the read queue before
        // handing the socket over, so nothing is silently dropped.
        const leftover = buffered.subarray(headerEnd + 4)
        if (leftover.length > 0) {
          socket.unshift(leftover)
        }
        resolve(socket)
      }
      socket.on('data', onData)
    })
  })
}

/** Establishes the transport for hop 0 of an SSH connection (the first jump host, or the target if there's no chain) via a SOCKS5 or HTTP CONNECT proxy. */
export async function connectViaProxy(
  proxy: ProxyConfig,
  targetHost: string,
  targetPort: number,
  timeoutMs = DEFAULT_PROXY_TIMEOUT_MS
): Promise<Duplex> {
  if (proxy.type === 'socks5') {
    return connectSocks5(proxy, targetHost, targetPort, timeoutMs)
  }
  return connectHttp(proxy, targetHost, targetPort, timeoutMs)
}
