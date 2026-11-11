import { defineStore } from 'pinia'
import type { Terminal } from '@xterm/xterm'
import type { FitAddon } from '@xterm/addon-fit'
import type { SearchAddon } from '@xterm/addon-search'
import { INVOKE_CHANNELS, EVENT_CHANNELS, SEND_CHANNELS } from '@shared/contract'
import type { ClipboardTextResult, TerminalAckEvent, TerminalInputEvent, TerminalResizeEvent, TerminalDataEvent, TerminalExitEvent, TerminalOpenResult } from '@shared/contract'
import { invoke, onEvent } from '../api'
import { terminalKeyAction } from '../utils/terminalKeys'
import { useUiStore } from './ui.store'

interface TerminalInstance {
  terminalId: string
  term: Terminal
  fit: FitAddon
  search: SearchAddon
  unacked: number
  cols: number
  rows: number
}

const ACK_BATCH_BYTES = 100 * 1024
export const TERMINAL_SEARCH_EVENT = 'ferry:terminal-search'

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

/**
 * In-flight `disposeForSession()` calls, keyed by sessionId. `disposeForSession`
 * deletes `instances`' entry synchronously before its own `await invoke(...)` —
 * without this reservation, a same-tick `ensureTerminal(sessionId)` call would
 * pass the `instances.get(sessionId)` check as undefined and race it, opening
 * a brand-new PTY for a session whose close is still in-flight main-side.
 */
const disposing = new Map<string, Promise<void>>()

/** Copies the terminal's current selection to the OS clipboard, then clears it. */
function copySelection(term: Terminal): void {
  if (term.hasSelection()) {
    void navigator.clipboard.writeText(term.getSelection())
    term.clearSelection()
  }
}

/**
 * Reads the OS clipboard (main-process side — reliable under the sandboxed
 * renderer, unlike navigator.clipboard.readText()) and pastes it. `paste()`
 * (not `write()`) so bracketed-paste mode works in vim/zsh, and the text flows
 * through the existing onData → terminal:write path like typed input.
 */
async function pasteInto(term: Terminal): Promise<void> {
  const { text } = await invoke<ClipboardTextResult>(INVOKE_CHANNELS.systemClipboardReadText)
  if (text) {
    term.paste(text)
  }
}

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
let onShellExited: ((sessionId: string) => void) | null = null

function ensureSubscriptions(): void {
  if (dataUnsub) {
    return
  }
  dataUnsub = onEvent<TerminalDataEvent>(EVENT_CHANNELS.terminalData, (evt) => {
    const inst = findByTerminalId(evt.terminalId)
    const bytes = evt.data.length
    if (!inst) {
      const ack: TerminalAckEvent = { terminalId: evt.terminalId, bytes }
      window.api.send(SEND_CHANNELS.terminalAck, ack)
      return
    }
    inst.term.write(evt.data, () => {
      inst.unacked += bytes
      if (inst.unacked >= ACK_BATCH_BYTES) {
        const ack: TerminalAckEvent = { terminalId: inst.terminalId, bytes: inst.unacked }
        inst.unacked = 0
        window.api.send(SEND_CHANNELS.terminalAck, ack)
      }
    })
  })
  exitUnsub = onEvent<TerminalExitEvent>(EVENT_CHANNELS.terminalExit, (evt) => {
    const entry = [...instances.entries()].find(([, inst]) => inst.terminalId === evt.terminalId)
    if (!entry) {
      return
    }
    entry[1].term.write('\r\n[Process exited]\r\n')
    onShellExited?.(entry[0])
  })
}

interface TerminalStreamsState {
  /** Reactive mirror of `instances`' keys, so components can `v-for` over known sessions. */
  knownSessionIds: string[]
  exitedSessionIds: string[]
}

export const useTerminalStreamsStore = defineStore('terminalStreams', {
  state: (): TerminalStreamsState => ({ knownSessionIds: [], exitedSessionIds: [] }),

  actions: {
    markExited(sessionId: string): void {
      if (!this.exitedSessionIds.includes(sessionId)) {
        this.exitedSessionIds.push(sessionId)
      }
    },

    async restart(sessionId: string): Promise<void> {
      const inst = instances.get(sessionId)
      if (!inst) {
        return
      }
      const { terminalId } = await invoke<TerminalOpenResult>(INVOKE_CHANNELS.terminalOpen, {
        sessionId,
        cols: inst.term.cols,
        rows: inst.term.rows
      })
      inst.terminalId = terminalId
      inst.unacked = 0
      inst.cols = inst.term.cols
      inst.rows = inst.term.rows
      this.exitedSessionIds = this.exitedSessionIds.filter((id) => id !== sessionId)
      inst.term.write('\r\n[Shell restarted]\r\n')
      inst.term.focus()
    },

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
      // Wait out an in-flight dispose instead of racing it — otherwise a new
      // PTY could be opened for a session whose old one hasn't finished
      // closing main-side yet. Re-check `pending`/`instances` afterwards: if
      // another concurrent `ensureTerminal` call was also waiting on the same
      // dispose, it may have already reserved (or finished) the open in the
      // interim.
      const inFlightDispose = disposing.get(sessionId)
      if (inFlightDispose) {
        await inFlightDispose
        const existingAfterDispose = instances.get(sessionId)
        if (existingAfterDispose) {
          return existingAfterDispose.terminalId
        }
        const pendingAfterDispose = pending.get(sessionId)
        if (pendingAfterDispose) {
          return pendingAfterDispose
        }
      }
      onShellExited = (id) => this.markExited(id)
      ensureSubscriptions()
      const openPromise = (async (): Promise<string> => {
        const { terminalId } = await invoke<TerminalOpenResult>(INVOKE_CHANNELS.terminalOpen, {
          sessionId,
          cols: 80,
          rows: 24
        })
        // Deferred to first actual use — @xterm/xterm isn't parsed/evaluated
        // until a terminal is opened, keeping it off the cold-start path.
        const [{ Terminal }, { FitAddon }, { SearchAddon }] = await Promise.all([
          import('@xterm/xterm'),
          import('@xterm/addon-fit'),
          import('@xterm/addon-search')
        ])
        const term = new Terminal({ cursorBlink: true, scrollback: useUiStore().terminalScrollback, ...useUiStore().terminalAppearance })
        const fit = new FitAddon()
        term.loadAddon(fit)
        const search = new SearchAddon()
        term.loadAddon(search)
        term.onData((data) => {
          const input: TerminalInputEvent = { terminalId, data }
          window.api.send(SEND_CHANNELS.terminalInput, input)
        })
        // Clipboard shortcuts (Ctrl+C copies only when a selection exists —
        // otherwise it stays a SIGINT; Ctrl+V/Ctrl+Shift+V/Shift+Insert paste).
        // Returning false stops xterm's own processing; preventDefault stops
        // Chromium's native paste from double-firing into the hidden textarea.
        term.attachCustomKeyEventHandler((ev) => {
          if (ev.type === 'keydown' && ev.ctrlKey && ev.shiftKey && ev.key.toLowerCase() === 'f') {
            ev.preventDefault()
            window.dispatchEvent(new CustomEvent(TERMINAL_SEARCH_EVENT))
            return false
          }
          const action = terminalKeyAction(ev, term.hasSelection())
          if (action === 'copy') {
            ev.preventDefault()
            copySelection(term)
            return false
          }
          if (action === 'paste') {
            ev.preventDefault()
            void pasteInto(term)
            return false
          }
          return true
        })
        instances.set(sessionId, { terminalId, term, fit, search, unacked: 0, cols: 0, rows: 0 })
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

    applyAppearance(): void {
      const { fontFamily, fontSize, lineHeight, theme } = useUiStore().terminalAppearance
      for (const { term } of instances.values()) {
        term.options.scrollback = useUiStore().terminalScrollback
        term.options.fontFamily = fontFamily
        term.options.fontSize = fontSize
        term.options.lineHeight = lineHeight
        term.options.theme = { ...theme }
        term.clearTextureAtlas()
      }
    },

    /** Moves keyboard focus into a session's terminal (no-op if none is open). */
    focus(sessionId: string): void {
      instances.get(sessionId)?.term.focus()
    },

    /**
     * Right-click convention (PuTTY/WinSCP): copy the selection if there is
     * one, otherwise paste the clipboard at the prompt.
     */
    async copyOrPaste(sessionId: string): Promise<void> {
      const inst = instances.get(sessionId)
      if (!inst) {
        return
      }
      if (inst.term.hasSelection()) {
        copySelection(inst.term)
      } else {
        await pasteInto(inst.term)
      }
    },

    /** Notifies the backend of a new pty size after a fit(). */
    resize(sessionId: string, cols: number, rows: number): void {
      const inst = instances.get(sessionId)
      if (!inst) {
        return
      }
      if (inst.cols === cols && inst.rows === rows) {
        return
      }
      inst.cols = cols
      inst.rows = rows
      const size: TerminalResizeEvent = { terminalId: inst.terminalId, cols, rows }
      window.api.send(SEND_CHANNELS.terminalResize, size)
    },

    /** Tears down a session's terminal entirely — called when its tab closes/disconnects. */
    async disposeForSession(sessionId: string): Promise<void> {
      const inFlight = disposing.get(sessionId)
      if (inFlight) {
        return inFlight
      }
      const inst = instances.get(sessionId)
      if (!inst) {
        return
      }
      instances.delete(sessionId)
      this.knownSessionIds = this.knownSessionIds.filter((id) => id !== sessionId)
      this.exitedSessionIds = this.exitedSessionIds.filter((id) => id !== sessionId)
      const disposePromise = (async (): Promise<void> => {
        try {
          await invoke<void>(INVOKE_CHANNELS.terminalClose, inst.terminalId)
        } finally {
          inst.term.dispose()
        }
      })()
      disposing.set(sessionId, disposePromise)
      try {
        await disposePromise
      } finally {
        disposing.delete(sessionId)
      }
    }
  }
})
