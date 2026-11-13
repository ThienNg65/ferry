import type { IpcMainInvokeEvent } from 'electron'
import { createInterface } from 'readline'
import type { Readable } from 'stream'
import { err, type InvokeChannel, type SendChannel } from '../shared/contract'
import { handlers, sendHandlers } from '../main/ipc/envelope'

export interface InitMessage {
  type: 'init'
  key: string
  dataDir: string
}

export interface SidecarHooks {
  init(message: InitMessage): void
  shutdown(): Promise<void>
}

export type WriteLine = (line: string) => void

export function encodeLine(value: unknown): string {
  return JSON.stringify(value, function (key, replaced) {
    const raw = (this as Record<string, unknown>)[key]
    if (raw instanceof Uint8Array) {
      return { __b64: Buffer.from(raw.buffer, raw.byteOffset, raw.byteLength).toString('base64') }
    }
    return replaced
  })
}

export function decodeB64Deep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(decodeB64Deep)
  }
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>
    const keys = Object.keys(record)
    if (keys.length === 1 && keys[0] === '__b64' && typeof record.__b64 === 'string') {
      return Buffer.from(record.__b64, 'base64')
    }
    const out: Record<string, unknown> = {}
    for (const key of keys) {
      out[key] = decodeB64Deep(record[key])
    }
    return out
  }
  return value
}

export async function dispatchInvoke(channel: unknown, args: unknown) {
  const handler = typeof channel === 'string' ? handlers.get(channel as InvokeChannel) : undefined
  const decodedArgs = Array.isArray(args) ? (decodeB64Deep(args) as unknown[]) : []
  return handler
    ? await handler({} as IpcMainInvokeEvent, ...decodedArgs)
    : err('UNKNOWN', `IPC channel not handled by sidecar: ${String(channel)}`)
}

export function dispatchSend(channel: unknown, payload: unknown): void {
  const handler = typeof channel === 'string' ? sendHandlers.get(channel as SendChannel) : undefined
  if (handler) {
    handler({}, decodeB64Deep(payload))
  }
}

async function dispatch(id: unknown, channel: unknown, args: unknown, write: WriteLine): Promise<void> {
  const result = await dispatchInvoke(channel, args)
  write(encodeLine({ id, result }))
}

export function serve(input: Readable, write: WriteLine, hooks: SidecarHooks): void {
  let closing = false
  const shutdown = (): void => {
    if (!closing) {
      closing = true
      void hooks.shutdown()
    }
  }
  const lines = createInterface({ input, crlfDelay: Infinity })
  lines.on('line', (line) => {
    if (!line.trim()) {
      return
    }
    let message: Record<string, unknown>
    try {
      message = JSON.parse(line)
    } catch {
      console.error(`sidecar: ignoring malformed line (${line.length} chars)`)
      return
    }
    if (message.type === 'init') {
      hooks.init(message as unknown as InitMessage)
    } else if (message.type === 'shutdown') {
      shutdown()
    } else if (message.type === 'send') {
      dispatchSend(message.channel, message.payload)
    } else {
      void dispatch(message.id, message.channel, message.args, write)
    }
  })
  lines.on('close', shutdown)
}
