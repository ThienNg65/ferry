import { StringDecoder } from 'string_decoder'
import type { ClientChannel } from 'ssh2'
import { host } from '../host/host'
import { SessionManager } from '../ssh/SessionManager'
import { shellEscape } from '../ssh/shellEscape'
import { FlowControl } from './FlowControl'
import { OutputBatcher } from './OutputBatcher'
import { EVENT_CHANNELS, type TerminalDataEvent, type TerminalExitEvent } from '../../shared/contract'

const EARLY_EXIT_MS = 1500

interface TerminalEntry {
  sessionId: string
  stream: ClientChannel
  exitCode: number | null
  flow: FlowControl
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
  private readonly openingTerminals = new Set<string>()
  private readonly cancelledOpens = new Set<string>()

  static getInstance(): TerminalManager {
    if (TerminalManager.instance === null) {
      TerminalManager.instance = new TerminalManager()
    }
    return TerminalManager.instance
  }

  private broadcastData(terminalId: string, data: string): void {
    const payload: TerminalDataEvent = { terminalId, data }
    host().broadcast(EVENT_CHANNELS.terminalData, payload)
  }

  private broadcastExit(terminalId: string, exitCode: number | null): void {
    const payload: TerminalExitEvent = { terminalId, exitCode }
    host().broadcast(EVENT_CHANNELS.terminalExit, payload)
  }

  /** Opens a PTY shell on `sessionId`'s connection. `terminalId` is caller-chosen. */
  async open(terminalId: string, sessionId: string, cols: number, rows: number): Promise<void> {
    this.cancelledOpens.delete(terminalId)
    this.openingTerminals.add(terminalId)
    try {
      const shell = SessionManager.getInstance().shell(sessionId)
      const cwd = SessionManager.getInstance().cwd(sessionId)
      const hasCwd = Boolean(cwd) && cwd !== '.'
      const openPlain = async (): Promise<void> => {
        this.openingTerminals.add(terminalId)
        try {
          const plain = await shell.openShell({ cols, rows })
          if (this.cancelledOpens.has(terminalId)) {
            this.cancelledOpens.delete(terminalId)
            plain.end()
            ;(plain as unknown as { destroy?: () => void }).destroy?.()
            return
          }
          this.attach(terminalId, sessionId, plain)
          if (hasCwd) {
            plain.write(` cd ${shellEscape(cwd)}\n`)
          }
        } finally {
          this.openingTerminals.delete(terminalId)
        }
      }
      if (!hasCwd) {
        await openPlain()
        return
      }
      let stream: ClientChannel
      try {
        stream = await shell.openShellAt(cwd, { cols, rows })
      } catch {
        if (this.cancelledOpens.has(terminalId)) {
          this.cancelledOpens.delete(terminalId)
          return
        }
        await openPlain()
        return
      }
      if (this.cancelledOpens.has(terminalId)) {
        this.cancelledOpens.delete(terminalId)
        stream.end()
        ;(stream as unknown as { destroy?: () => void }).destroy?.()
        return
      }
      this.attach(terminalId, sessionId, stream, openPlain)
    } finally {
      this.openingTerminals.delete(terminalId)
    }
  }

  private attach(terminalId: string, sessionId: string, stream: ClientChannel, fallback?: () => Promise<void>): void {
    const startedAt = Date.now()
    let sawData = false
    const flow = new FlowControl(
      () => stream.pause(),
      () => stream.resume()
    )
    const entry: TerminalEntry = { sessionId, stream, exitCode: null, flow }
    this.terminals.set(terminalId, entry)

    const decoder = new StringDecoder('utf8')
    const emitText = (text: string): void => {
      if (text.length === 0) {
        return
      }
      flow.sent(text.length)
      this.broadcastData(terminalId, text)
    }
    const batcher = new OutputBatcher((buf) => {
      if (this.terminals.get(terminalId) !== entry) {
        return
      }
      emitText(decoder.write(buf))
    })
    stream.on('data', (chunk: Buffer) => {
      if (this.terminals.get(terminalId) !== entry) {
        return
      }
      sawData = true
      batcher.push(chunk)
    })
    stream.on('exit', (code: number | null) => {
      entry.exitCode = code
    })
    stream.on('close', () => {
      const closedByUser = this.terminals.get(terminalId) !== entry
      batcher.flush()
      if (!closedByUser) {
        emitText(decoder.end())
        this.terminals.delete(terminalId)
      }
      if (fallback && !closedByUser && !sawData && Date.now() - startedAt < EARLY_EXIT_MS) {
        void fallback().catch(() => this.broadcastExit(terminalId, entry.exitCode))
        return
      }
      if (!closedByUser) {
        this.broadcastExit(terminalId, entry.exitCode)
      }
    })
  }

  /** Sends keystrokes/input to a shell. */
  write(terminalId: string, data: string): void {
    this.terminals.get(terminalId)?.stream.write(data)
  }

  ack(terminalId: string, bytes: number): void {
    this.terminals.get(terminalId)?.flow.ack(bytes)
  }

  /** Resizes a shell's pseudo-terminal. */
  resize(terminalId: string, cols: number, rows: number): void {
    this.terminals.get(terminalId)?.stream.setWindow(rows, cols, 0, 0)
  }

  /** Ends a shell. Safe to call on an already-closed terminal. */
  close(terminalId: string): void {
    const entry = this.terminals.get(terminalId)
    if (!entry) {
      if (this.openingTerminals.has(terminalId)) {
        this.cancelledOpens.add(terminalId)
      }
      return
    }
    this.terminals.delete(terminalId)
    entry.stream.end()
    ;(entry.stream as unknown as { close?: () => void; destroy?: () => void }).close?.()
    ;(entry.stream as unknown as { destroy?: () => void }).destroy?.()
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
