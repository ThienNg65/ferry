import { createServer, type Server, type Socket } from 'net'
import { afterEach, describe, expect, it } from 'vitest'
import { connectViaProxy } from './ProxyConnector'
import type { ProxyConfig } from '../../shared/contract'

/** A fake HTTP CONNECT proxy — inspects the CONNECT request and replies however the test wants, then (on success) echoes anything received afterward, standing in for "the real target". */
function fakeHttpProxy(
  respond: (req: string) => { status: string; trailingBytes?: Buffer }
): Promise<{ server: Server; port: number }> {
  return new Promise((resolve) => {
    const server = createServer((socket: Socket) => {
      let buffered = Buffer.alloc(0)
      const onConnectData = (chunk: Buffer): void => {
        buffered = Buffer.concat([buffered, chunk])
        const headerEnd = buffered.indexOf('\r\n\r\n')
        if (headerEnd === -1) {
          return
        }
        // Stop parsing as a CONNECT request the moment we've handled one —
        // otherwise this same listener would misinterpret post-tunnel data
        // (e.g. the client's first message) as a second CONNECT request.
        socket.removeListener('data', onConnectData)
        const request = buffered.subarray(0, headerEnd).toString('utf-8')
        const { status, trailingBytes } = respond(request)
        socket.write(`${status}\r\n\r\n${trailingBytes ? trailingBytes.toString('binary') : ''}`, 'binary')
        if (!status.includes('200')) {
          socket.end()
          return
        }
        // Post-CONNECT: echo anything the client sends, simulating the real target.
        socket.on('data', (echoChunk: Buffer) => socket.write(echoChunk))
      }
      socket.on('data', onConnectData)
    })
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      resolve({ server, port })
    })
  })
}

/**
 * A fake SOCKS5 proxy — implements just enough of RFC 1928 (method
 * negotiation + CONNECT request/reply) and RFC 1929 (username/password auth)
 * to drive the real `socks` client library through each handshake stage.
 * `onAuth` and `onConnectRequest` let a test override the reply for a given
 * stage; both default to "succeed".
 */
function fakeSocks5Proxy(opts?: {
  onAuth?: (username: string, password: string) => boolean
  onConnectReply?: () => number
}): Promise<{ server: Server; port: number }> {
  return new Promise((resolve) => {
    const server = createServer((socket: Socket) => {
      let stage: 'greeting' | 'auth' | 'connect' = 'greeting'
      let buffered = Buffer.alloc(0)

      const onHandshakeData = (chunk: Buffer): void => {
        buffered = Buffer.concat([buffered, chunk])

        if (stage === 'greeting') {
          if (buffered.length < 2) {
            return
          }
          const nMethods = buffered[1]
          if (buffered.length < 2 + nMethods) {
            return
          }
          const methods = Array.from(buffered.subarray(2, 2 + nMethods))
          buffered = buffered.subarray(2 + nMethods)
          const wantsUserPass = methods.includes(0x02)
          if (wantsUserPass) {
            socket.write(Buffer.from([0x05, 0x02]))
            stage = 'auth'
          } else {
            socket.write(Buffer.from([0x05, 0x00]))
            stage = 'connect'
          }
          return
        }

        if (stage === 'auth') {
          if (buffered.length < 2) {
            return
          }
          const ulen = buffered[1]
          if (buffered.length < 2 + ulen + 1) {
            return
          }
          const plen = buffered[2 + ulen]
          if (buffered.length < 2 + ulen + 1 + plen) {
            return
          }
          const username = buffered.subarray(2, 2 + ulen).toString('utf-8')
          const password = buffered.subarray(2 + ulen + 1, 2 + ulen + 1 + plen).toString('utf-8')
          buffered = buffered.subarray(2 + ulen + 1 + plen)
          const ok = opts?.onAuth ? opts.onAuth(username, password) : true
          socket.write(Buffer.from([0x01, ok ? 0x00 : 0x01]))
          if (!ok) {
            socket.end()
            return
          }
          stage = 'connect'
          return
        }

        if (stage === 'connect') {
          if (buffered.length < 4) {
            return
          }
          const atyp = buffered[3]
          let addrLen: number
          if (atyp === 0x01) {
            addrLen = 4
          } else if (atyp === 0x03) {
            addrLen = 1 + buffered[4]
          } else {
            addrLen = 16
          }
          const total = 4 + addrLen + 2
          if (buffered.length < total) {
            return
          }
          buffered = buffered.subarray(total)
          const replyCode = opts?.onConnectReply ? opts.onConnectReply() : 0x00
          // Minimal reply: ver, rep, rsv, atyp=IPv4, 4-byte addr, 2-byte port.
          socket.write(Buffer.from([0x05, replyCode, 0x00, 0x01, 0, 0, 0, 0, 0, 0]))
          // Stop parsing as handshake data the moment we've replied to the CONNECT
          // request — otherwise this same listener would misinterpret post-tunnel
          // data (e.g. the client's first message) as a new handshake.
          socket.removeListener('data', onHandshakeData)
          if (replyCode !== 0x00) {
            socket.end()
            return
          }
          // Post-CONNECT: echo anything the client sends, simulating the real target.
          socket.on('data', (echoChunk: Buffer) => socket.write(echoChunk))
        }
      }
      socket.on('data', onHandshakeData)
    })
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      resolve({ server, port })
    })
  })
}

let server: Server | undefined

afterEach(async () => {
  if (server) {
    await new Promise<void>((resolve) => server?.close(() => resolve()))
    server = undefined
  }
})

describe('connectViaProxy (HTTP CONNECT)', () => {
  it('establishes a tunnel on a 200 response and can send/receive data over it', async () => {
    const started = await fakeHttpProxy((req) => {
      expect(req).toContain('CONNECT target.example.com:443 HTTP/1.1')
      return { status: 'HTTP/1.1 200 Connection Established' }
    })
    server = started.server

    const proxy: ProxyConfig = { type: 'http', host: '127.0.0.1', port: started.port }
    const socket = await connectViaProxy(proxy, 'target.example.com', 443, 2000)

    const echoed = await new Promise<Buffer>((resolve) => {
      socket.once('data', (chunk: Buffer) => resolve(chunk))
      socket.write('hello-through-tunnel')
    })
    expect(echoed.toString('utf-8')).toBe('hello-through-tunnel')
    socket.destroy()
  })

  it('rejects with PROXY_CONNECT when the proxy refuses the CONNECT', async () => {
    const started = await fakeHttpProxy(() => ({ status: 'HTTP/1.1 407 Proxy Authentication Required' }))
    server = started.server

    const proxy: ProxyConfig = { type: 'http', host: '127.0.0.1', port: started.port }
    await expect(connectViaProxy(proxy, 'target.example.com', 443, 2000)).rejects.toMatchObject({
      code: 'PROXY_CONNECT'
    })
  })

  it('includes a Proxy-Authorization header when credentials are provided', async () => {
    let seenAuthHeader: string | undefined
    const started = await fakeHttpProxy((req) => {
      seenAuthHeader = req.split('\r\n').find((line) => line.startsWith('Proxy-Authorization:'))
      return { status: 'HTTP/1.1 200 Connection Established' }
    })
    server = started.server

    const proxy: ProxyConfig = { type: 'http', host: '127.0.0.1', port: started.port, username: 'alice', password: 'hunter2' }
    const socket = await connectViaProxy(proxy, 'target.example.com', 443, 2000)

    expect(seenAuthHeader).toBe(`Proxy-Authorization: Basic ${Buffer.from('alice:hunter2').toString('base64')}`)
    socket.destroy()
  })

  it('rejects with PROXY_CONNECT when the proxy is unreachable', async () => {
    const proxy: ProxyConfig = { type: 'http', host: '127.0.0.1', port: 1 } // port 1 refuses immediately
    await expect(connectViaProxy(proxy, 'target.example.com', 443, 2000)).rejects.toMatchObject({
      code: 'PROXY_CONNECT'
    })
  })
})

describe('connectViaProxy (SOCKS5)', () => {
  it('establishes a tunnel with no auth and can send/receive data over it', async () => {
    const started = await fakeSocks5Proxy()
    server = started.server

    const proxy: ProxyConfig = { type: 'socks5', host: '127.0.0.1', port: started.port }
    const socket = await connectViaProxy(proxy, 'target.example.com', 443, 2000)

    const echoed = await new Promise<Buffer>((resolve) => {
      socket.once('data', (chunk: Buffer) => resolve(chunk))
      socket.write('hello-through-tunnel')
    })
    expect(echoed.toString('utf-8')).toBe('hello-through-tunnel')
    socket.destroy()
  })

  it('establishes a tunnel using username/password credentials', async () => {
    let seenUsername: string | undefined
    let seenPassword: string | undefined
    const started = await fakeSocks5Proxy({
      onAuth: (username, password) => {
        seenUsername = username
        seenPassword = password
        return true
      }
    })
    server = started.server

    const proxy: ProxyConfig = { type: 'socks5', host: '127.0.0.1', port: started.port, username: 'alice', password: 'hunter2' }
    const socket = await connectViaProxy(proxy, 'target.example.com', 443, 2000)

    expect(seenUsername).toBe('alice')
    expect(seenPassword).toBe('hunter2')
    socket.destroy()
  })

  it('rejects with PROXY_CONNECT when the proxy rejects the auth credentials', async () => {
    const started = await fakeSocks5Proxy({ onAuth: () => false })
    server = started.server

    const proxy: ProxyConfig = { type: 'socks5', host: '127.0.0.1', port: started.port, username: 'alice', password: 'wrong' }
    await expect(connectViaProxy(proxy, 'target.example.com', 443, 2000)).rejects.toMatchObject({
      code: 'PROXY_CONNECT'
    })
  })

  it('rejects with PROXY_CONNECT when the connect request fails', async () => {
    // 0x05 = "Connection refused" per RFC 1928's SOCKS5 reply codes.
    const started = await fakeSocks5Proxy({ onConnectReply: () => 0x05 })
    server = started.server

    const proxy: ProxyConfig = { type: 'socks5', host: '127.0.0.1', port: started.port }
    await expect(connectViaProxy(proxy, 'target.example.com', 443, 2000)).rejects.toMatchObject({
      code: 'PROXY_CONNECT'
    })
  })
})
