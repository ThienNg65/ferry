import { randomBytes, randomUUID, timingSafeEqual } from 'crypto'
import * as os from 'os'
import * as path from 'path'
import WebSocket, { WebSocketServer } from 'ws'
import { EVENT_CHANNELS } from '../shared/contract'
import { setHost } from '../main/host/host'
import { unwrapOrCreateMasterKey } from '../main/host/dpapiKey'
import { registerSidecarHandlers } from '../main/ipc/registerSidecar'
import { createNodeHost } from './nodeHost'
import { dispatchInvoke, dispatchSend, encodeLine } from './protocol'
import { initSidecarServices, registerShutdownHandler, shutdownSidecarServices } from './sidecar'

export interface NeutralinoExtensionOptions {
  nlPort: string
  nlToken: string
  nlConnectToken?: string
  extensionId?: string
  dataDir?: string
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

  const directWss = new WebSocketServer({ host: '127.0.0.1', port: 0, maxPayload: 64 * 1024 * 1024 })
  directWss.on('listening', () => {
    const addr = directWss.address()
    directPort = typeof addr === 'object' && addr ? addr.port : 0
    maybeInitialize()
  })
  directWss.on('error', () => {
    if (directPort === null) {
      directPort = 0
      maybeInitialize()
    }
  })

  const handleMessage = async (
    raw: WebSocket.RawData | string,
    sendReply: (id: unknown, result: unknown) => void
  ): Promise<void> => {
    let msg: { event?: string; data?: Record<string, unknown> }
    try {
      const text = typeof raw === 'string' ? raw : raw.toString('utf8')
      msg = JSON.parse(text) as { event?: string; data?: Record<string, unknown> }
    } catch {
      return
    }
    if (msg.event === 'rpc_send' && msg.data) {
      dispatchSend(msg.data.channel, msg.data.payload)
    } else if (msg.event === 'rpc_invoke' && msg.data) {
      const { id, channel, args } = msg.data
      const result = await dispatchInvoke(channel, args)
      sendReply(id, result)
    } else if (msg.event === 'sidecar:hello') {
      sendReadyBroadcast()
    } else if (msg.event === 'windowClose') {
      void shutdown()
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
      await shutdownSidecarServices()
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
