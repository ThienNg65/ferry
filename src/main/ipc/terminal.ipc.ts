import { randomUUID } from 'crypto'
import { handle } from './envelope'
import { INVOKE_CHANNELS } from '../../shared/contract'
import type { TerminalOpenResult } from '../../shared/contract'
import { TerminalManager } from '../terminal/TerminalManager'

/** Request payload for `terminal:open`. */
interface TerminalOpenRequest {
  sessionId: string
  cols: number
  rows: number
}

/** Request payload for `terminal:write`. */
interface TerminalWriteRequest {
  terminalId: string
  data: string
}

/** Request payload for `terminal:resize`. */
interface TerminalResizeRequest {
  terminalId: string
  cols: number
  rows: number
}

/** Registers handlers for opening/driving/closing an interactive SSH shell (PTY). */
export function registerTerminalHandlers(): void {
  handle<TerminalOpenResult>(INVOKE_CHANNELS.terminalOpen, async (req) => {
    const request = req as TerminalOpenRequest
    const terminalId = randomUUID()
    await TerminalManager.getInstance().open(terminalId, request.sessionId, request.cols, request.rows)
    return { terminalId }
  })

  handle<void>(INVOKE_CHANNELS.terminalWrite, (req) => {
    const request = req as TerminalWriteRequest
    TerminalManager.getInstance().write(request.terminalId, request.data)
  })

  handle<void>(INVOKE_CHANNELS.terminalResize, (req) => {
    const request = req as TerminalResizeRequest
    TerminalManager.getInstance().resize(request.terminalId, request.cols, request.rows)
  })

  handle<void>(INVOKE_CHANNELS.terminalClose, (terminalId) => {
    TerminalManager.getInstance().close(terminalId as string)
  })
}
