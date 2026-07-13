import { defineStore } from 'pinia'
import type { Terminal } from '@xterm/xterm'
import type { FitAddon } from '@xterm/addon-fit'
import { INVOKE_CHANNELS, EVENT_CHANNELS } from '@shared/contract'
import type { TerminalDataEvent, TerminalExitEvent, TerminalOpenResult } from '@shared/contract'
import { invoke, onEvent } from '../api'

interface TerminalInstance {
  terminalId: string
  term: Terminal
  fit: FitAddon
}

/**
 * Live xterm.js instances, kept OUTSIDE Pinia's reactive state (a plain
 * module-scoped cache) and keyed by sessionId — one terminal per session.
 * Kept alive here (not in a component) is what lets a background session's
 * shell keep filling its scrollback while a different site tab or dock tab
 * is showing; components only ever attach/detach the DOM, never own the
 * `Terminal` object itself.
 */
const instances = new Map<string, TerminalInstance>()

/**
 * In-flight `ensureTerminal()` calls, keyed by sessionId. Needed because the
 * check-then-act in `ensureTerminal` has an `await` gap — without this, two
 * overlapping calls for the same session (e.g. the auto-open-on-connect call
 * racing a user click on the Terminal dock tab) would both pass the
 * `instances.get(sessionId)` check as undefined and each open a real PTY.
 */
const pending = new Map<string, Promise<string>>()

function findByTerminalId(terminalId: string): TerminalInstance | undefined {
  for (const inst of instances.values()) {
    if (inst.terminalId === terminalId) {
      return inst
    }
  }
  return undefined
}

let dataUnsub: (() => void) | null = null
let exitUnsub: (() => void) | null = null

function ensureSubscriptions(): void {
  if (dataUnsub) {
    return
  }
  dataUnsub = onEvent<TerminalDataEvent>(EVENT_CHANNELS.terminalData, (evt) => {
    findByTerminalId(evt.terminalId)?.term.write(evt.data)
  })
  exitUnsub = onEvent<TerminalExitEvent>(EVENT_CHANNELS.terminalExit, (evt) => {
    findByTerminalId(evt.terminalId)?.term.write('\r\n[Process exited]\r\n')
  })
}

interface TerminalStreamsState {
  /** Reactive mirror of `instances`' keys, so components can `v-for` over known sessions. */
  knownSessionIds: string[]
}

export const useTerminalStreamsStore = defineStore('terminalStreams', {
  state: (): TerminalStreamsState => ({ knownSessionIds: [] }),

  actions: {
    /** Returns the cached instance for a session, if one has been opened. */
    getInstance(sessionId: string): TerminalInstance | undefined {
      return instances.get(sessionId)
    },

    /** Opens (or returns the existing/in-flight) terminal for `sessionId`. */
    async ensureTerminal(sessionId: string): Promise<string> {
      const existing = instances.get(sessionId)
      if (existing) {
        return existing.terminalId
      }
      const inFlight = pending.get(sessionId)
      if (inFlight) {
        return inFlight
      }
      ensureSubscriptions()
      const openPromise = (async (): Promise<string> => {
        const { terminalId } = await invoke<TerminalOpenResult>(INVOKE_CHANNELS.terminalOpen, {
          sessionId,
          cols: 80,
          rows: 24
        })
        // Deferred to first actual use — @xterm/xterm isn't parsed/evaluated
        // until a terminal is opened, keeping it off the cold-start path.
        const [{ Terminal }, { FitAddon }] = await Promise.all([import('@xterm/xterm'), import('@xterm/addon-fit')])
        const term = new Terminal({ cursorBlink: true, convertEol: true })
        const fit = new FitAddon()
        term.loadAddon(fit)
        term.onData((data) => {
          void invoke<void>(INVOKE_CHANNELS.terminalWrite, { terminalId, data })
        })
        instances.set(sessionId, { terminalId, term, fit })
        this.knownSessionIds.push(sessionId)
        return terminalId
      })()
      pending.set(sessionId, openPromise)
      try {
        return await openPromise
      } finally {
        pending.delete(sessionId)
      }
    },

    /** Notifies the backend of a new pty size after a fit(). */
    resize(sessionId: string, cols: number, rows: number): void {
      const inst = instances.get(sessionId)
      if (!inst) {
        return
      }
      void invoke<void>(INVOKE_CHANNELS.terminalResize, { terminalId: inst.terminalId, cols, rows })
    },

    /** Tears down a session's terminal entirely — called when its tab closes/disconnects. */
    async disposeForSession(sessionId: string): Promise<void> {
      const inst = instances.get(sessionId)
      if (!inst) {
        return
      }
      instances.delete(sessionId)
      this.knownSessionIds = this.knownSessionIds.filter((id) => id !== sessionId)
      try {
        await invoke<void>(INVOKE_CHANNELS.terminalClose, inst.terminalId)
      } finally {
        inst.term.dispose()
      }
    }
  }
})
