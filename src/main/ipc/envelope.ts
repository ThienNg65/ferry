import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import { err, ok, type IpcResult, type IpcErrorCode, type InvokeChannel } from '../../shared/contract'
import { SshError } from '../ssh/errors'

/**
 * Registers an `ipcMain.handle` whose result is always wrapped in the shared
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
  ipcMain.removeHandler(channel)
  ipcMain.handle(channel, async (_event, ...args: unknown[]): Promise<IpcResult<T>> => {
    try {
      return ok(await fn(...args))
    } catch (e) {
      if (e instanceof SshError) {
        return err(e.code, e.message)
      }
      const code: IpcErrorCode = 'UNKNOWN'
      return err(code, e instanceof Error ? e.message : String(e))
    }
  })
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
  ipcMain.removeHandler(channel)
  ipcMain.handle(channel, async (event, ...args: unknown[]): Promise<IpcResult<T>> => {
    try {
      return ok(await fn(event, ...args))
    } catch (e) {
      if (e instanceof SshError) {
        return err(e.code, e.message)
      }
      const code: IpcErrorCode = 'UNKNOWN'
      return err(code, e instanceof Error ? e.message : String(e))
    }
  })
}
