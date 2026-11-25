import { err, ok, type IpcResult, type IpcErrorCode, type InvokeChannel, type SendChannel } from '../../shared/contract'
import { logAppEvent } from '../host/appLog'
import { SshError } from '../ssh/errors'

export type ChannelHandler = (event: unknown, ...args: unknown[]) => Promise<IpcResult<unknown>>
export type SendChannelHandler = (event: unknown, payload: unknown) => void

export const handlers = new Map<InvokeChannel, ChannelHandler>()
export const sendHandlers = new Map<SendChannel, SendChannelHandler>()

async function envelope<T>(channel: InvokeChannel, run: () => Promise<T> | T): Promise<IpcResult<T>> {
  const startedAt = Date.now()
  try {
    return ok(await run())
  } catch (e) {
    const durationMs = Date.now() - startedAt
    if (e instanceof SshError) {
      logAppEvent('warn', 'ipc.failed', { channel, code: e.code, durationMs, message: e.message })
      return err(e.code, e.message, e.hostKey)
    }
    const code: IpcErrorCode = 'UNKNOWN'
    const message = e instanceof Error ? e.message : String(e)
    logAppEvent('error', 'ipc.failed', {
      channel,
      code,
      durationMs,
      message,
      ...(e instanceof Error && e.stack ? { stack: e.stack } : {})
    })
    return err(code, message)
  }
}

/**
 * Registers a handler whose result is always wrapped in the shared
 * {@link IpcResult} envelope — success becomes `{ ok: true, data }`, any thrown
 * error becomes `{ ok: false, code, message }`. {@link SshError}s carry their
 * own code through; anything else maps to `UNKNOWN`.
 *
 * @param channel - a typed invoke channel from the contract
 * @param fn      - the handler; its resolved value becomes `data`
 */
export function handle<T>(
  channel: InvokeChannel,
  fn: (...args: unknown[]) => Promise<T> | T
): void {
  handlers.set(channel, (_event, ...args) => envelope(channel, () => fn(...args)))
}

/** Registers a fire-and-forget send handler into the shared registry. */
export function onSend<T>(
  channel: SendChannel,
  fn: (event: unknown, payload: T) => void
): void {
  sendHandlers.set(channel, (event, payload) => fn(event, payload as T))
}
