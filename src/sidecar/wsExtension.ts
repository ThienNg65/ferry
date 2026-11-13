import { randomUUID } from 'crypto'
import * as os from 'os'
import * as path from 'path'
import WebSocket from 'ws'
import { setHost } from '../main/host/host'
import { unwrapOrCreateMasterKey } from '../main/host/dpapiKey'
import { registerSidecarHandlers } from '../main/ipc/registerSidecar'
import { createNodeHost } from './nodeHost'
import { dispatchInvoke, dispatchSend, encodeLine } from './protocol'
import { initSidecarServices, shutdownSidecarServices } from './sidecar'

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

  const wsUrl = `ws://127.0.0.1:${options.nlPort}?extensionId=${encodeURIComponent(extensionId)}&connectToken=${encodeURIComponent(connectToken)}`
  const ws = new WebSocket(wsUrl)

  const broadcast = (channel: string, payload: unknown): void => {
    if (ws.readyState !== WebSocket.OPEN) {
      return
    }
    ws.send(
      encodeLine({
        id: randomUUID(),
        method: 'app.broadcast',
        accessToken: options.nlToken,
        data: {
          event: 'rpc_event',
          data: { channel, payload }
        }
      })
    )
  }

  setHost(createNodeHost(key, dataDir, () => {}, undefined, broadcast))
  registerSidecarHandlers()

  let initialized = false
  let closing = false
  const shutdown = async (): Promise<void> => {
    if (closing) {
      return
    }
    closing = true
    if (initialized) {
      await shutdownSidecarServices()
    }
    try {
      ws.close()
    } catch {
      // Ignore close errors during shutdown.
    }
    process.exit(0)
  }

  ws.on('open', () => {
    initialized = true
    initSidecarServices()
    ws.send(
      JSON.stringify({
        id: randomUUID(),
        method: 'app.broadcast',
        accessToken: options.nlToken,
        data: { event: 'sidecar:ready', data: { extensionId } }
      })
    )
  })

  ws.on('message', async (raw) => {
    let msg: { event?: string; data?: Record<string, unknown> }
    try {
      msg = JSON.parse(raw.toString('utf8')) as { event?: string; data?: Record<string, unknown> }
    } catch {
      return
    }
    if (msg.event === 'rpc_invoke' && msg.data) {
      const { id, channel, args } = msg.data
      const result = await dispatchInvoke(channel, args)
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
    } else if (msg.event === 'rpc_send' && msg.data) {
      dispatchSend(msg.data.channel, msg.data.payload)
    } else if (msg.event === 'windowClose') {
      void shutdown()
    }
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
