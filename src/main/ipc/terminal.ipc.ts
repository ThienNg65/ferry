import { randomUUID } from 'crypto'
import { ipcMain } from 'electron'
import { handle } from './envelope'
import { INVOKE_CHANNELS, SEND_CHANNELS } from '../../shared/contract'
import type {
  TerminalAckEvent,
  TerminalInputEvent,
  TerminalOpenRequest,
  TerminalOpenResult,
  TerminalResizeEvent
} from '../../shared/contract'
import { TerminalManager } from '../terminal/TerminalManager'

/** Registers handlers for opening/driving/closing an interactive SSH shell (PTY). */
export function registerTerminalHandlers(): void {
  handle<TerminalOpenResult>(INVOKE_CHANNELS.terminalOpen, async (req) => {
    const request = req as TerminalOpenRequest
    const terminalId = randomUUID()
    await TerminalManager.getInstance().open(terminalId, request.sessionId, request.cols, request.rows)
    return { terminalId }
  })

  ipcMain.on(SEND_CHANNELS.terminalInput, (_event, payload: TerminalInputEvent) => {
    if (typeof payload?.terminalId !== 'string' || typeof payload.data !== 'string') {
      return
    }
    TerminalManager.getInstance().write(payload.terminalId, payload.data)
  })

  ipcMain.on(SEND_CHANNELS.terminalResize, (_event, payload: TerminalResizeEvent) => {
    if (
      typeof payload?.terminalId !== 'string' ||
      !Number.isInteger(payload.cols) ||
      !Number.isInteger(payload.rows) ||
      payload.cols < 1 ||
      payload.rows < 1
    ) {
      return
    }
    TerminalManager.getInstance().resize(payload.terminalId, payload.cols, payload.rows)
  })

  ipcMain.on(SEND_CHANNELS.terminalAck, (_event, payload: TerminalAckEvent) => {
    if (typeof payload?.terminalId !== 'string' || !Number.isFinite(payload.bytes) || payload.bytes < 0) {
      return
    }
    TerminalManager.getInstance().ack(payload.terminalId, payload.bytes)
  })

  handle<void>(INVOKE_CHANNELS.terminalClose, (terminalId) => {
    TerminalManager.getInstance().close(terminalId as string)
  })
}
