import type { IpcMainInvokeEvent } from 'electron'
import { err, ok, type IpcResult, type IpcErrorCode, type InvokeChannel, type SendChannel } from '../../shared/contract'
import { SshError } from '../ssh/errors'

export type ChannelHandler = (event: IpcMainInvokeEvent, ...args: unknown[]) => Promise<IpcResult<unknown>>
export type SendChannelHandler = (event: unknown, payload: unknown) => void

export const handlers = new Map<InvokeChannel, ChannelHandler>()
export const sendHandlers = new Map<SendChannel, SendChannelHandler>()

async function envelope<T>(run: () => Promise<T> | T): Promise<IpcResult<T>> {
  try {
    return ok(await run())
  } catch (e) {
    if (e instanceof SshError) {
      return err(e.code, e.message, e.hostKey)
    }
    const code: IpcErrorCode = 'UNKNOWN'
    return err(code, e instanceof Error ? e.message : String(e))
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
  handlers.set(channel, (_event, ...args) => envelope(() => fn(...args)))
}

/**
 * Same envelope as {@link handle}, but also hands the handler the raw
 * `IpcMainInvokeEvent` — needed only by the rare handler that must act on
 * `event.sender` itself (e.g. `WebContents.startDrag`).
 */
export function handleWithEvent<T>(
  channel: InvokeChannel,
  fn: (event: IpcMainInvokeEvent, ...args: unknown[]) => Promise<T> | T
): void {
  handlers.set(channel, (event, ...args) => envelope(() => fn(event, ...args)))
}

/** Registers a fire-and-forget send handler into the shared registry. */
export function onSend<T>(
  channel: SendChannel,
  fn: (event: unknown, payload: T) => void
): void {
  sendHandlers.set(channel, (event, payload) => fn(event, payload as T))
}
