import { randomBytes, randomUUID, timingSafeEqual } from 'crypto'
import { unlink } from 'fs/promises'
import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from 'http'
import * as os from 'os'
import * as path from 'path'
import { Transform } from 'stream'
import { pipeline } from 'stream/promises'
import WebSocket, { WebSocketServer } from 'ws'
import { EVENT_CHANNELS } from '../shared/contract'
import { openStageDropWriteStream, touchStageDropSession } from '../main/fs/LocalFsService'
import { setHost } from '../main/host/host'
import { unwrapOrCreateMasterKey } from '../main/host/dpapiKey'
import { registerSidecarHandlers } from '../main/ipc/registerSidecar'
import { SshError } from '../main/ssh/errors'
import { createNodeHost } from './nodeHost'
import { dispatchWebSocketMessage, encodeLine } from './protocol'
import { initSidecarServices, registerShutdownHandler, shutdownSidecarServices } from './sidecar'

export interface NeutralinoExtensionOptions {
  nlPort: string
  nlToken: string
  nlConnectToken?: string
  extensionId?: string
  dataDir?: string
}

const LOOPBACK_ADDRS = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1'])

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  if (res.headersSent || res.writableEnded) {
    return
  }
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(body))
}

/**
 * Builds the authenticated localhost HTTP handler for streaming external dropped
 * files directly to `%TEMP%/ferry-drop-*` without buffering in JS memory or Base64.
 */
export function createStageDropHttpHandler(expectedTokenBuf: Buffer, nlPort: string) {
  const allowedOrigins = new Set([`http://localhost:${nlPort}`, `http://127.0.0.1:${nlPort}`])

  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const remoteAddr = req.socket.remoteAddress ?? ''
    if (remoteAddr && !LOOPBACK_ADDRS.has(remoteAddr)) {
      sendJson(res, 403, { error: 'Forbidden' })
      return
    }

    const origin = req.headers.origin
    if (origin !== undefined) {
      if (!allowedOrigins.has(origin)) {
        sendJson(res, 403, { error: 'Origin not allowed' })
        return
      }
      res.setHeader('Access-Control-Allow-Origin', origin)
      res.setHeader('Vary', 'Origin')
      res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Ferry-Token')
    }

    if (req.method === 'OPTIONS') {
      res.writeHead(204)
      res.end()
      return
    }

    let url: URL
    try {
      url = new URL(req.url || '/', 'http://127.0.0.1')
    } catch {
      sendJson(res, 400, { error: 'Invalid URL' })
      return
    }

    if (req.method !== 'POST' || url.pathname !== '/stage-drop') {
      sendJson(res, 404, { error: 'Not found' })
      return
    }

    const tokenHeader = req.headers['x-ferry-token']
    const token = typeof tokenHeader === 'string' ? tokenHeader : ''
    const tokenBuf = Buffer.from(token, 'utf8')
    if (tokenBuf.length !== expectedTokenBuf.length || !timingSafeEqual(tokenBuf, expectedTokenBuf)) {
      sendJson(res, 403, { error: 'Unauthorized' })
      return
    }

    const stageId = url.searchParams.get('stageId') ?? ''
    const relativePath = url.searchParams.get('relativePath') ?? ''
    const modifiedAt = url.searchParams.get('modifiedAt') ?? undefined
    if (!stageId || !relativePath) {
      sendJson(res, 400, { error: 'Missing stageId or relativePath' })
      return
    }

    let targetPath: string | null = null
    try {
      const opened = await openStageDropWriteStream(stageId, relativePath, modifiedAt)
      targetPath = opened.targetPath
      const activityStream = new Transform({
        transform(chunk, _encoding, callback) {
          touchStageDropSession(stageId)
          callback(null, chunk)
        }
      })
      await pipeline(req, activityStream, opened.stream)
      sendJson(res, 200, { ok: true })
    } catch (err) {
      if (targetPath) {
        await unlink(targetPath).catch(() => undefined)
      }
      const status =
        err instanceof SshError && err.code === 'NOT_FOUND'
          ? 404
          : err instanceof SshError && err.code === 'VALIDATION'
            ? 400
            : 500
      sendJson(res, status, { error: err instanceof Error ? err.message : String(err) })
    }
  }
}

export function defaultFerryDataDir(): string {
  const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming')
  return path.join(appData, 'Ferry')
}

export function startNeutralinoExtension(options: NeutralinoExtensionOptions): WebSocket {
  const extensionId = options.extensionId || 'js.ferry.sidecar'
  const connectToken = options.nlConnectToken || options.nlToken
  const dataDir = options.dataDir || defaultFerryDataDir()
  const key = unwrapOrCreateMasterKey(dataDir)
  const directToken = randomBytes(32).toString('hex')
  const expectedTokenBuf = Buffer.from(directToken, 'utf8')

  const wsUrl = `ws://127.0.0.1:${options.nlPort}?extensionId=${encodeURIComponent(extensionId)}&connectToken=${encodeURIComponent(connectToken)}`
  const ws = new WebSocket(wsUrl)
  const directClients = new Set<WebSocket>()
  let directPort: number | null = null

  const serializeRpcEvent = (channel: string, payload: unknown): string => {
    // Hot path: UTF-8 terminal output strings carry no binary markers, so skip encodeLine's replacer.
    if (channel === EVENT_CHANNELS.terminalData && payload && typeof (payload as { data?: unknown }).data === 'string') {
      return JSON.stringify({ event: 'rpc_event', data: { channel, payload } })
    }
    return encodeLine({ event: 'rpc_event', data: { channel, payload } })
  }

  const broadcast = (channel: string, payload: unknown): void => {
    let sentDirect = false
    if (directClients.size > 0) {
      const frame = serializeRpcEvent(channel, payload)
      for (const client of directClients) {
        if (client.readyState === WebSocket.OPEN) {
          client.send(frame)
          sentDirect = true
        }
      }
    }
    if (sentDirect || ws.readyState !== WebSocket.OPEN) {
      return
    }
    const nlMsg = {
      id: randomUUID(),
      method: 'app.broadcast',
      accessToken: options.nlToken,
      data: {
        event: 'rpc_event',
        data: { channel, payload }
      }
    }
    if (channel === EVENT_CHANNELS.terminalData && payload && typeof (payload as { data?: unknown }).data === 'string') {
      ws.send(JSON.stringify(nlMsg))
      return
    }
    ws.send(encodeLine(nlMsg))
  }

  setHost(createNodeHost(key, dataDir, () => {}, undefined, broadcast))
  registerSidecarHandlers()

  let initialized = false
  let nlOpen = false
  let closing = false

  const sendReadyBroadcast = (): void => {
    if (ws.readyState !== WebSocket.OPEN) {
      return
    }
    ws.send(
      JSON.stringify({
        id: randomUUID(),
        method: 'app.broadcast',
        accessToken: options.nlToken,
        data: {
          event: 'sidecar:ready',
          data: {
            extensionId,
            ...(directPort && directPort > 0 ? { directPort, directToken } : {})
          }
        }
      })
    )
  }

  const maybeInitialize = (): void => {
    if (!nlOpen || directPort === null || initialized) {
      return
    }
    initialized = true
    initSidecarServices()
    sendReadyBroadcast()
  }

  const stageDropHandler = createStageDropHttpHandler(expectedTokenBuf, options.nlPort)
  const httpServer = createHttpServer((req, res) => {
    void stageDropHandler(req, res)
  })
  const directWss = new WebSocketServer({ server: httpServer, maxPayload: 64 * 1024 * 1024 })
  httpServer.on('listening', () => {
    const addr = httpServer.address()
    directPort = typeof addr === 'object' && addr ? addr.port : 0
    maybeInitialize()
  })
  httpServer.on('error', () => {
    if (directPort === null) {
      directPort = 0
      maybeInitialize()
    }
  })
  httpServer.listen(0, '127.0.0.1')

  const handleMessage = async (
    raw: WebSocket.RawData | string,
    sendReply: (id: unknown, result: unknown) => void
  ): Promise<void> => {
    let parsed: unknown
    try {
      const text = typeof raw === 'string' ? raw : raw.toString('utf8')
      parsed = JSON.parse(text)
    } catch {
      return
    }

    try {
      await dispatchWebSocketMessage(parsed, sendReply, sendReadyBroadcast, () => {
        void shutdown()
      })
    } catch {
      console.error('sidecar: WebSocket message handling failed')
    }
  }

  directWss.on('connection', (client, req) => {
    try {
      const reqUrl = new URL(req.url || '/', 'http://127.0.0.1')
      const token = reqUrl.searchParams.get('token') ?? ''
      const tokenBuf = Buffer.from(token, 'utf8')
      if (tokenBuf.length !== expectedTokenBuf.length || !timingSafeEqual(tokenBuf, expectedTokenBuf)) {
        client.close(1008, 'Unauthorized')
        return
      }
    } catch {
      client.close(1008, 'Unauthorized')
      return
    }
    directClients.add(client)
    client.on('close', () => directClients.delete(client))
    client.on('error', () => directClients.delete(client))
    client.on('message', (raw) => {
      void handleMessage(raw, (id, result) => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(encodeLine({ event: 'rpc_reply', data: { id, result } }))
        }
      })
    })
  })

  const shutdown = async (code = 0): Promise<void> => {
    if (closing) {
      return
    }
    closing = true
    if (initialized) {
      try {
        await shutdownSidecarServices()
      } catch (e) {
        console.error('sidecar: error during shutdown:', e)
      }
    }
    for (const client of directClients) {
      try {
        client.close()
      } catch {
        // Ignore close errors during shutdown.
      }
    }
    try {
      directWss.close()
    } catch {
      // Ignore close errors during shutdown.
    }
    try {
      httpServer.close()
    } catch {
      // Ignore close errors during shutdown.
    }
    try {
      ws.close()
    } catch {
      // Ignore close errors during shutdown.
    }
    process.exit(code)
  }

  registerShutdownHandler(shutdown)

  ws.on('open', () => {
    nlOpen = true
    maybeInitialize()
  })

  ws.on('message', (raw) => {
    // Fast-skip self-echoed Neutralino app.broadcast frames before JSON.parse.
    const rawStr = raw.toString('utf8')
    if (
      rawStr.startsWith('{"event":"rpc_event"') ||
      rawStr.startsWith('{"event":"rpc_reply"') ||
      rawStr.startsWith('{"event":"sidecar:ready"')
    ) {
      return
    }
    void handleMessage(rawStr, (id, result) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(
          encodeLine({
            id: randomUUID(),
            method: 'app.broadcast',
            accessToken: options.nlToken,
            data: {
              event: 'rpc_reply',
              data: { id, result }
            }
          })
        )
      }
    })
  })

  ws.on('close', () => {
    void shutdown()
  })

  ws.on('error', (err) => {
    console.error('sidecar: WebSocket error:', err)
  })

  process.on('SIGINT', () => void shutdown())
  process.on('SIGTERM', () => void shutdown())

  return ws
}
