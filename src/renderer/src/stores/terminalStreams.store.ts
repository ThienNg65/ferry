import { defineStore } from 'pinia'
import type { Terminal } from '@xterm/xterm'
import type { FitAddon } from '@xterm/addon-fit'
import type { SearchAddon } from '@xterm/addon-search'
import type { WebglAddon } from '@xterm/addon-webgl'
import { INVOKE_CHANNELS, EVENT_CHANNELS, SEND_CHANNELS } from '@shared/contract'
import type { ClipboardTextResult, TerminalAckEvent, TerminalInputEvent, TerminalResizeEvent, TerminalDataEvent, TerminalExitEvent, TerminalOpenResult } from '@shared/contract'
import { invoke, onEvent } from '../api'
import { TerminalEchoPredictor, type BufferSnapshot } from '../utils/terminalEchoPredictor'
import { terminalKeyAction } from '../utils/terminalKeys'
import { useUiStore } from './ui.store'

interface TerminalInstance {
  terminalId: string
  term: Terminal
  fit: FitAddon
  search: SearchAddon
  WebglAddonCtor?: typeof WebglAddon
  unacked: number
  cols: number
  rows: number
  predictor: TerminalEchoPredictor
  underlineTimer: ReturnType<typeof setTimeout> | null
}

const ACK_BATCH_BYTES = 100 * 1024
const MAX_EARLY_BUFFER_BYTES = 64 * 1024
const PREDICTIVE_UNDERLINE_MS = 100
const textEncoder = new TextEncoder()
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
const earlyOutput = new Map<string, { chunks: Array<string | Uint8Array>; bytes: number }>()
let opensInFlight = 0

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

function snapshotBuffer(term: Terminal): BufferSnapshot {
  const active = term.buffer.active
  return {
    type: active.type,
    cols: term.cols,
    cursor: {
      absY: active.baseY + active.cursorY,
      x: active.cursorX
    },
    getLineText(absY: number): string {
      return active.getLine(absY)?.translateToString(true) ?? ''
    },
    getCellText(absY: number, x: number): string {
      return active.getLine(absY)?.getCell(x)?.getChars() ?? ''
    }
  }
}

function clearUnderlineTimer(inst: TerminalInstance): void {
  if (inst.underlineTimer !== null) {
    clearTimeout(inst.underlineTimer)
    inst.underlineTimer = null
  }
}

function applyPredictionResult(
  sessionId: string,
  inst: TerminalInstance,
  res: { write: string; armUnderlineTimer: boolean; cancelUnderlineTimer: boolean }
): void {
  if (res.cancelUnderlineTimer) {
    clearUnderlineTimer(inst)
  }
  if (res.write) {
    inst.term.write(res.write)
  }
  if (res.armUnderlineTimer) {
    clearUnderlineTimer(inst)
    inst.underlineTimer = setTimeout(() => {
      inst.underlineTimer = null
      if (instances.get(sessionId) !== inst) {
        return
      }
      if (inst.predictor.getSnapshot().pendingServerWrites !== 0) {
        return
      }
      const underlineWrite = inst.predictor.applyUnderlineTimeout(inst.term.cols)
      if (underlineWrite) {
        inst.term.write(underlineWrite)
      }
    }, PREDICTIVE_UNDERLINE_MS)
  }
}

function flushInstancePredictions(inst: TerminalInstance): void {
  clearUnderlineTimer(inst)
  const write = inst.predictor.resetForFlush(snapshotBuffer(inst.term))
  if (write) {
    inst.term.write(write)
  }
}

function findEntryByTerminalId(terminalId: string): [string, TerminalInstance] | undefined {
  for (const entry of instances.entries()) {
    if (entry[1].terminalId === terminalId) {
      return entry
    }
  }
  return undefined
}

let dataUnsub: (() => void) | null = null
let exitUnsub: (() => void) | null = null
let onShellExited: ((sessionId: string) => void) | null = null

function prependPrefix(prefix: string, data: string | Uint8Array): string | Uint8Array {
  if (!prefix) {
    return data
  }
  if (typeof data === 'string') {
    return prefix + data
  }
  const prefixBytes = textEncoder.encode(prefix)
  const combined = new Uint8Array(prefixBytes.length + data.length)
  combined.set(prefixBytes, 0)
  combined.set(data, prefixBytes.length)
  return combined
}

function handleAfterServerWrite(sessionId: string, inst: TerminalInstance): void {
  if (instances.get(sessionId) !== inst) {
    return
  }
  const res = inst.predictor.afterServerWrite(snapshotBuffer(inst.term))
  applyPredictionResult(sessionId, inst, res)
}

function writeChunkWithAck(sessionId: string, inst: TerminalInstance, data: string | Uint8Array): void {
  // Flow control counts only raw server payload bytes, never local predictive/rewind escapes.
  const bytes = data.length
  const targetTerminalId = inst.terminalId
  const prefix = inst.predictor.beforeServerWrite(inst.term.cols)
  inst.term.write(prependPrefix(prefix, data), () => {
    if (inst.terminalId !== targetTerminalId) {
      return
    }
    inst.unacked += bytes
    if (inst.unacked >= ACK_BATCH_BYTES) {
      const ack: TerminalAckEvent = { terminalId: inst.terminalId, bytes: inst.unacked }
      inst.unacked = 0
      window.api.send(SEND_CHANNELS.terminalAck, ack)
    }
    handleAfterServerWrite(sessionId, inst)
  })
}

function drainEarlyOutput(sessionId: string, inst: TerminalInstance): void {
  const buffered = earlyOutput.get(inst.terminalId)
  if (!buffered) {
    return
  }
  earlyOutput.delete(inst.terminalId)
  for (const chunk of buffered.chunks) {
    writeChunkWithAck(sessionId, inst, chunk)
  }
}

function ensureSubscriptions(): void {
  if (dataUnsub) {
    return
  }
  dataUnsub = onEvent<TerminalDataEvent>(EVENT_CHANNELS.terminalData, (evt) => {
    const entry = findEntryByTerminalId(evt.terminalId)
    const bytes = evt.data.length
    if (!entry) {
      // Buffer early prompt/MOTD output arriving while terminal:open or restart is still completing.
      if (opensInFlight > 0) {
        let bucket = earlyOutput.get(evt.terminalId)
        if (!bucket) {
          bucket = { chunks: [], bytes: 0 }
          earlyOutput.set(evt.terminalId, bucket)
        }
        if (bucket.bytes + bytes <= MAX_EARLY_BUFFER_BYTES) {
          bucket.chunks.push(evt.data)
          bucket.bytes += bytes
          return
        }
      }
      const ack: TerminalAckEvent = { terminalId: evt.terminalId, bytes }
      window.api.send(SEND_CHANNELS.terminalAck, ack)
      return
    }
    writeChunkWithAck(entry[0], entry[1], evt.data)
  })
  exitUnsub = onEvent<TerminalExitEvent>(EVENT_CHANNELS.terminalExit, (evt) => {
    const entry = findEntryByTerminalId(evt.terminalId)
    if (!entry) {
      return
    }
    const [sessionId, inst] = entry
    clearUnderlineTimer(inst)
    const prefix = inst.predictor.beforeServerWrite(inst.term.cols)
    inst.predictor.reset()
    inst.term.write(`${prefix}\r\n[Process exited]\r\n`)
    onShellExited?.(sessionId)
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
      clearUnderlineTimer(inst)
      inst.predictor.reset()
      opensInFlight++
      try {
        const { terminalId } = await invoke<TerminalOpenResult>(INVOKE_CHANNELS.terminalOpen, {
          sessionId,
          cols: inst.term.cols,
          rows: inst.term.rows
        })
        if (instances.get(sessionId) !== inst) {
          return
        }
        inst.terminalId = terminalId
        inst.unacked = 0
        inst.cols = inst.term.cols
        inst.rows = inst.term.rows
        clearUnderlineTimer(inst)
        inst.predictor.reset()
        this.exitedSessionIds = this.exitedSessionIds.filter((id) => id !== sessionId)
        inst.term.write('\r\n[Shell restarted]\r\n')
        drainEarlyOutput(sessionId, inst)
        inst.term.focus()
      } finally {
        opensInFlight--
        if (opensInFlight === 0) {
          earlyOutput.clear()
        }
      }
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
        opensInFlight++
        try {
          // Overlap xterm module loading with the SSH PTY open round-trip.
          const [{ terminalId }, { Terminal }, { FitAddon }, { SearchAddon }, webglMod] = await Promise.all([
            invoke<TerminalOpenResult>(INVOKE_CHANNELS.terminalOpen, {
              sessionId,
              cols: 80,
              rows: 24
            }),
            import('@xterm/xterm'),
            import('@xterm/addon-fit'),
            import('@xterm/addon-search'),
            import('@xterm/addon-webgl').catch(() => undefined)
          ])
          const term = new Terminal({ cursorBlink: true, scrollback: useUiStore().terminalScrollback, ...useUiStore().terminalAppearance })
          const fit = new FitAddon()
          term.loadAddon(fit)
          const search = new SearchAddon()
          term.loadAddon(search)
          const inst: TerminalInstance = {
            terminalId,
            term,
            fit,
            search,
            WebglAddonCtor: webglMod?.WebglAddon,
            unacked: 0,
            cols: 80,
            rows: 24,
            predictor: new TerminalEchoPredictor(),
            underlineTimer: null
          }
          term.onData((data) => {
            const input: TerminalInputEvent = { terminalId: inst.terminalId, data }
            window.api.send(SEND_CHANNELS.terminalInput, input)
            if (!useUiStore().terminalPredictiveEcho) {
              return
            }
            const res = inst.predictor.onInput(data, snapshotBuffer(inst.term))
            applyPredictionResult(sessionId, inst, res)
          })
          // Clipboard shortcuts (Ctrl+C copies only when a selection exists —
          // otherwise it stays a SIGINT; Ctrl+V/Ctrl+Shift+V/Shift+Insert paste).
          // Returning false stops xterm's own processing; preventDefault stops
          // Chromium's native paste from double-firing into the hidden textarea.
          term.attachCustomKeyEventHandler((ev) => {
            if (ev.type === 'keydown' && (ev.ctrlKey || ev.metaKey) && !ev.altKey && !ev.shiftKey && ev.code === 'Backquote') {
              return false
            }
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
          instances.set(sessionId, inst)
          drainEarlyOutput(sessionId, inst)
          this.knownSessionIds.push(sessionId)
          return terminalId
        } finally {
          opensInFlight--
          if (opensInFlight === 0) {
            earlyOutput.clear()
          }
        }
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

    /** Rewinds and clears unconfirmed local predictions before fit()/resize. */
    flushPredictions(sessionId: string): void {
      const inst = instances.get(sessionId)
      if (!inst) {
        return
      }
      flushInstancePredictions(inst)
    },

    /** Clears active predictions across open instances when predictive local echo is disabled. */
    syncPredictiveEchoSetting(): void {
      if (useUiStore().terminalPredictiveEcho) {
        return
      }
      for (const inst of instances.values()) {
        flushInstancePredictions(inst)
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
      const inFlightOpen = pending.get(sessionId)
      if (!inFlightOpen && !instances.has(sessionId)) {
        return
      }
      const disposePromise = (async (): Promise<void> => {
        if (inFlightOpen) {
          await inFlightOpen.catch(() => undefined)
        }
        const inst = instances.get(sessionId)
        if (!inst) {
          return
        }
        instances.delete(sessionId)
        clearUnderlineTimer(inst)
        inst.predictor.reset()
        this.knownSessionIds = this.knownSessionIds.filter((id) => id !== sessionId)
        this.exitedSessionIds = this.exitedSessionIds.filter((id) => id !== sessionId)
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
