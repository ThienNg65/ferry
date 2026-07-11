import { BrowserWindow } from 'electron'
import type { ClientChannel } from 'ssh2'
import { SessionManager } from '../ssh/SessionManager'
import { EVENT_CHANNELS, type TerminalDataEvent, type TerminalExitEvent } from '../../shared/contract'

interface TerminalEntry {
  sessionId: string
  stream: ClientChannel
  exitCode: number | null
}

/**
 * TerminalManager — one interactive SSH shell (PTY) per `terminalId`, mirroring
 * {@link TailManager}'s shape. Unlike the tail subsystem there is no
 * auto-reconnect: a dropped shell is just gone, same as closing a real
 * terminal window.
 */
export class TerminalManager {
  private static instance: TerminalManager | null = null
  private readonly terminals = new Map<string, TerminalEntry>()

  static getInstance(): TerminalManager {
    if (TerminalManager.instance === null) {
      TerminalManager.instance = new TerminalManager()
    }
    return TerminalManager.instance
  }

  private broadcastData(terminalId: string, data: Uint8Array): void {
    const payload: TerminalDataEvent = { terminalId, data }
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send(EVENT_CHANNELS.terminalData, payload)
      }
    }
  }

  private broadcastExit(terminalId: string, exitCode: number | null): void {
    const payload: TerminalExitEvent = { terminalId, exitCode }
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send(EVENT_CHANNELS.terminalExit, payload)
      }
    }
  }

  /** Opens a PTY shell on `sessionId`'s connection. `terminalId` is caller-chosen. */
  async open(terminalId: string, sessionId: string, cols: number, rows: number): Promise<void> {
    const shell = SessionManager.getInstance().shell(sessionId)
    const stream = await shell.openShell({ cols, rows })
    const entry: TerminalEntry = { sessionId, stream, exitCode: null }
    this.terminals.set(terminalId, entry)

    stream.on('data', (chunk: Buffer) => {
      this.broadcastData(terminalId, new Uint8Array(chunk))
    })
    stream.on('exit', (code: number | null) => {
      entry.exitCode = code
    })
    stream.on('close', () => {
      this.terminals.delete(terminalId)
      this.broadcastExit(terminalId, entry.exitCode)
    })
  }

  /** Sends keystrokes/input to a shell. */
  write(terminalId: string, data: string): void {
    this.terminals.get(terminalId)?.stream.write(data)
  }

  /** Resizes a shell's pseudo-terminal. */
  resize(terminalId: string, cols: number, rows: number): void {
    this.terminals.get(terminalId)?.stream.setWindow(rows, cols, 0, 0)
  }

  /** Ends a shell. Safe to call on an already-closed terminal. */
  close(terminalId: string): void {
    const entry = this.terminals.get(terminalId)
    if (!entry) {
      return
    }
    entry.stream.end()
    this.terminals.delete(terminalId)
  }

  /** Closes every terminal bound to a session — called when that session closes. */
  closeAllForSession(sessionId: string): void {
    for (const [terminalId, entry] of this.terminals) {
      if (entry.sessionId === sessionId) {
        this.close(terminalId)
      }
    }
  }
}
