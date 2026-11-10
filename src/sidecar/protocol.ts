import type { IpcMainInvokeEvent } from 'electron'
import { createInterface } from 'readline'
import type { Readable } from 'stream'
import { err, type InvokeChannel } from '../shared/contract'
import { handlers } from '../main/ipc/envelope'

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

async function dispatch(id: unknown, channel: unknown, args: unknown, write: WriteLine): Promise<void> {
  const handler = typeof channel === 'string' ? handlers.get(channel as InvokeChannel) : undefined
  const result = handler
    ? await handler({} as IpcMainInvokeEvent, ...(Array.isArray(args) ? args : []))
    : err('UNKNOWN', `IPC channel not handled by sidecar: ${String(channel)}`)
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
    } else {
      void dispatch(message.id, message.channel, message.args, write)
    }
  })
  lines.on('close', shutdown)
}
