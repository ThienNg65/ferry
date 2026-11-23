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
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
        continue
      }
      out[key] = decodeB64Deep(record[key])
    }
    return out
  }
  return value
}

export async function dispatchInvoke(channel: unknown, args: unknown) {
  if (typeof channel !== 'string') {
    return err('UNKNOWN', 'Invalid sidecar IPC channel')
  }
  const handler = handlers.get(channel as InvokeChannel)
  if (typeof handler !== 'function') {
    return err('UNKNOWN', 'IPC channel not handled by sidecar')
  }
  try {
    const decodedArgs = Array.isArray(args) ? (decodeB64Deep(args) as unknown[]) : []
    const result = await handler({}, ...decodedArgs)
    if (!result.ok && result.code === 'UNKNOWN') {
      // The IPC envelope can convert an unexpected Error into UNKNOWN with its raw message.
      console.error('sidecar: invoke handler failed')
      return err('UNKNOWN', 'The operation failed unexpectedly')
    }
    return result
  } catch {
    // Do not forward exception messages or stacks across the renderer boundary.
    console.error('sidecar: invoke handler failed')
    return err('UNKNOWN', 'The operation failed unexpectedly')
  }
}

/** Shared invoke/reply boundary used by stdin and both WebSocket transports. */
export async function replyToInvoke(
  id: unknown,
  channel: unknown,
  args: unknown,
  reply: (id: unknown, result: Awaited<ReturnType<typeof dispatchInvoke>>) => void
): Promise<void> {
  const result = await dispatchInvoke(channel, args)
  reply(id, result)
}

export async function dispatchWebSocketMessage(
  message: unknown,
  sendReply: (id: unknown, result: Awaited<ReturnType<typeof dispatchInvoke>>) => void,
  onHello: () => void,
  onWindowClose: () => void
): Promise<void> {
  if (!message || typeof message !== 'object' || Array.isArray(message)) {
    return
  }

  const msg = message as { event?: string; data?: Record<string, unknown> }
  if (msg.event === 'rpc_send' && msg.data && typeof msg.data === 'object') {
    dispatchSend(msg.data.channel, msg.data.payload)
  } else if (msg.event === 'rpc_invoke' && msg.data && typeof msg.data === 'object') {
    const { id, channel, args } = msg.data
    await replyToInvoke(id, channel, args, sendReply)
  } else if (msg.event === 'sidecar:hello') {
    onHello()
  } else if (msg.event === 'windowClose') {
    onWindowClose()
  }
}

export function dispatchSend(channel: unknown, payload: unknown): void {
  if (typeof channel !== 'string') {
    return
  }
  const handler = sendHandlers.get(channel as SendChannel)
  if (typeof handler !== 'function') {
    return
  }
  try {
    handler({}, decodeB64Deep(payload))
  } catch (e) {
    console.error('sidecar: send handler failed for "%s":', channel, e)
  }
}

async function dispatch(id: unknown, channel: unknown, args: unknown, write: WriteLine): Promise<void> {
  try {
    await replyToInvoke(id, channel, args, (replyId, result) => write(encodeLine({ id: replyId, result })))
  } catch {
    console.error('sidecar: failed to write invoke reply')
  }
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
    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch {
      console.error(`sidecar: ignoring malformed line (${line.length} chars)`)
      return
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return
    }
    const message = parsed as Record<string, unknown>
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
