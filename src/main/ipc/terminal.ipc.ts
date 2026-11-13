import { randomUUID } from 'crypto'
import { handle, onSend } from './envelope'
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

  onSend<TerminalInputEvent>(SEND_CHANNELS.terminalInput, (_event, payload) => {
    if (typeof payload?.terminalId !== 'string' || typeof payload.data !== 'string') {
      return
    }
    TerminalManager.getInstance().write(payload.terminalId, payload.data)
  })

  onSend<TerminalResizeEvent>(SEND_CHANNELS.terminalResize, (_event, payload) => {
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

  onSend<TerminalAckEvent>(SEND_CHANNELS.terminalAck, (_event, payload) => {
    if (typeof payload?.terminalId !== 'string' || !Number.isFinite(payload.bytes) || payload.bytes < 0) {
      return
    }
    TerminalManager.getInstance().ack(payload.terminalId, payload.bytes)
  })

  handle<void>(INVOKE_CHANNELS.terminalClose, (terminalId) => {
    TerminalManager.getInstance().close(terminalId as string)
  })
}
