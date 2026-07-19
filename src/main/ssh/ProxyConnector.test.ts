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
