import { defineStore } from 'pinia'
import type { IMarker, Terminal } from '@xterm/xterm'
import type { FitAddon } from '@xterm/addon-fit'
import type { SearchAddon } from '@xterm/addon-search'
import type { WebglAddon } from '@xterm/addon-webgl'
import { INVOKE_CHANNELS, EVENT_CHANNELS, SEND_CHANNELS } from '@shared/contract'
import type { ClipboardTextResult, TerminalAckEvent, TerminalInputEvent, TerminalResizeEvent, TerminalDataEvent, TerminalExitEvent, TerminalOpenResult } from '@shared/contract'
import { invoke, onEvent } from '../api'
import { TerminalEchoPredictor, updatePendingUtf8, type BufferSnapshot } from '../utils/terminalEchoPredictor'
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
  writeGeneration: number
  evictedOffset: number
  scrollMarker: IMarker | null
  scrollMarkerLastLine: number
  decoder: TextDecoder
  pendingUtf8Bytes: number
}

const ACK_BATCH_BYTES = 100 * 1024
const MAX_EARLY_BUFFER_BYTES = 64 * 1024
const PREDICTIVE_UNDERLINE_MS = 100
const PREDICTIVE_UNDERLINE_RETRY_MS = 10
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
const restarting = new Map<string, Promise<void>>()
const earlyOutput = new Map<string, { chunks: Array<string | Uint8Array>; bytes: number }>()
const earlyExits = new Set<string>()
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
    void navigator.clipboard.writeText(term.getSelection()).catch(() => {})
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

function resetScrollTracker(inst: TerminalInstance): void {
  if (inst.scrollMarker && !inst.scrollMarker.isDisposed) {
    inst.scrollMarker.dispose()
  }
  inst.scrollMarker = null
  inst.scrollMarkerLastLine = 0
  inst.evictedOffset = 0
  inst.decoder = new TextDecoder('utf-8', { fatal: false })
  inst.pendingUtf8Bytes = 0
}

function syncScrollOffset(inst: TerminalInstance): number {
  const active = inst.term.buffer.active
  if (active.type !== 'normal' || typeof inst.term.registerMarker !== 'function') {
    return inst.evictedOffset
  }
  if (inst.scrollMarker) {
    if (inst.scrollMarker.isDisposed) {
      inst.evictedOffset += inst.scrollMarkerLastLine + 1
      inst.scrollMarker = null
    } else {
      if (inst.scrollMarker.line < inst.scrollMarkerLastLine) {
        inst.evictedOffset += inst.scrollMarkerLastLine - inst.scrollMarker.line
      }
      inst.scrollMarker.dispose()
      inst.scrollMarker = null
    }
  }
  const marker = inst.term.registerMarker(0)
  if (marker && !marker.isDisposed && marker.line >= 0) {
    inst.scrollMarker = marker
    inst.scrollMarkerLastLine = active.baseY + active.cursorY
  } else {
    if (marker && !marker.isDisposed) {
      marker.dispose()
    }
    inst.scrollMarkerLastLine = 0
  }
  return inst.evictedOffset
}

function snapshotBuffer(inst: TerminalInstance): BufferSnapshot {
  const term = inst.term
  const active = term.buffer.active
  const offset = syncScrollOffset(inst)
  return {
    type: active.type,
    cols: term.cols,
    cursor: {
      absY: offset + active.baseY + active.cursorY,
      x: active.cursorX
    },
    getLineText(absY: number): string {
      const realY = absY - offset
      if (realY < 0) return ''
      return active.getLine(realY)?.translateToString(true) ?? ''
    },
    getCellText(absY: number, x: number): string {
      const realY = absY - offset
      if (realY < 0) return ''
      return active.getLine(realY)?.getCell(x)?.getChars() ?? ''
    }
  }
}

function clearUnderlineTimer(inst: TerminalInstance): void {
  if (inst.underlineTimer !== null) {
    clearTimeout(inst.underlineTimer)
    inst.underlineTimer = null
  }
}

function scheduleUnderlineTimer(sessionId: string, inst: TerminalInstance, delayMs: number): void {
  clearUnderlineTimer(inst)
  inst.underlineTimer = setTimeout(() => {
    inst.underlineTimer = null
    if (instances.get(sessionId) !== inst) {
      return
    }
    const snap = inst.predictor.getSnapshot()
    if (snap.pendingServerWrites !== 0) {
      return
    }
    const underlineWrite = inst.predictor.applyUnderlineTimeout(inst.term.cols)
    if (underlineWrite) {
      inst.term.write(underlineWrite)
      return
    }
    // Re-arm briefly if OS timer fired slightly before the 100ms threshold.
    if (snap.mode === 'active' && snap.pendingCount > 0 && snap.predictionsRendered && !snap.underlined) {
      scheduleUnderlineTimer(sessionId, inst, PREDICTIVE_UNDERLINE_RETRY_MS)
    }
  }, delayMs)
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
    scheduleUnderlineTimer(sessionId, inst, PREDICTIVE_UNDERLINE_MS)
  }
}

function flushInstancePredictions(inst: TerminalInstance): Promise<void> {
  clearUnderlineTimer(inst)
  const write = inst.predictor.resetForFlush(snapshotBuffer(inst))
  if (!write) {
    return Promise.resolve()
  }
  inst.writeGeneration++
  return new Promise<void>((resolve) => {
    inst.term.write(write, () => resolve())
  })
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

function handleAfterServerWrite(
  sessionId: string,
  inst: TerminalInstance,
  serverData?: string,
  hasIncompleteMultibyte = false
): void {
  if (instances.get(sessionId) !== inst) {
    return
  }
  const res = inst.predictor.afterServerWrite(snapshotBuffer(inst), serverData, hasIncompleteMultibyte)
  applyPredictionResult(sessionId, inst, res)
}

function writeChunkWithAck(sessionId: string, inst: TerminalInstance, data: string | Uint8Array): void {
  // Flow control counts only raw server payload bytes, never local predictive/rewind escapes.
  const bytes = data.length
  const targetTerminalId = inst.terminalId
  const gen = inst.writeGeneration
  const predictive = useUiStore().terminalPredictiveEcho
  const prefix = predictive ? inst.predictor.beforeServerWrite(inst.term.cols) : ''
  let serverData: string | undefined
  let hasIncompleteMultibyte = false
  if (predictive) {
    if (typeof data === 'string') {
      serverData = data
      inst.pendingUtf8Bytes = 0
    } else {
      inst.pendingUtf8Bytes = updatePendingUtf8(inst.pendingUtf8Bytes, data)
      hasIncompleteMultibyte = inst.pendingUtf8Bytes > 0
      serverData = inst.decoder.decode(data, { stream: true })
    }
  }
  inst.term.write(prependPrefix(prefix, data), () => {
    if (inst.terminalId === targetTerminalId) {
      inst.unacked += bytes
      if (inst.unacked >= ACK_BATCH_BYTES) {
        const ack: TerminalAckEvent = { terminalId: inst.terminalId, bytes: inst.unacked }
        inst.unacked = 0
        window.api.send(SEND_CHANNELS.terminalAck, ack)
      }
    }
    if (
      predictive &&
      inst.writeGeneration === gen &&
      instances.get(sessionId) === inst &&
      inst.terminalId === targetTerminalId
    ) {
      handleAfterServerWrite(sessionId, inst, serverData, hasIncompleteMultibyte)
    }
  })
}

function emitExited(sessionId: string, inst: TerminalInstance): void {
  clearUnderlineTimer(inst)
  const prefix = inst.predictor.beforeServerWrite(inst.term.cols)
  inst.predictor.reset()
  resetScrollTracker(inst)
  inst.writeGeneration++
  inst.term.write(`${prefix}\r\n[Process exited]\r\n`)
  onShellExited?.(sessionId)
}

function drainEarlyOutput(sessionId: string, inst: TerminalInstance): void {
  const buffered = earlyOutput.get(inst.terminalId)
  if (buffered) {
    earlyOutput.delete(inst.terminalId)
    for (const chunk of buffered.chunks) {
      writeChunkWithAck(sessionId, inst, chunk)
    }
  }
  if (earlyExits.delete(inst.terminalId)) {
    emitExited(sessionId, inst)
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
      if (opensInFlight > 0) {
        earlyExits.add(evt.terminalId)
      }
      return
    }
    emitExited(entry[0], entry[1])
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
      const existingRestart = restarting.get(sessionId)
      if (existingRestart) {
        return existingRestart
      }
      const inst = instances.get(sessionId)
      if (!inst) {
        return
      }
      const run = (async (): Promise<void> => {
        clearUnderlineTimer(inst)
        inst.predictor.reset()
        resetScrollTracker(inst)
        inst.writeGeneration++
        opensInFlight++
        try {
          const { terminalId } = await invoke<TerminalOpenResult>(INVOKE_CHANNELS.terminalOpen, {
            sessionId,
            cols: inst.term.cols,
            rows: inst.term.rows
          })
          if (instances.get(sessionId) !== inst) {
            void invoke<void>(INVOKE_CHANNELS.terminalClose, terminalId).catch(() => {})
            return
          }
          inst.terminalId = terminalId
          inst.unacked = 0
          inst.cols = inst.term.cols
          inst.rows = inst.term.rows
          this.exitedSessionIds = this.exitedSessionIds.filter((id) => id !== sessionId)
          inst.term.write('\r\n[Shell restarted]\r\n')
          clearUnderlineTimer(inst)
          inst.predictor.reset()
          resetScrollTracker(inst)
          inst.writeGeneration++
          drainEarlyOutput(sessionId, inst)
          inst.term.focus()
        } finally {
          opensInFlight--
          if (opensInFlight === 0) {
            earlyOutput.clear()
            earlyExits.clear()
          }
        }
      })()
      restarting.set(sessionId, run)
      try {
        await run
      } finally {
        if (restarting.get(sessionId) === run) {
          restarting.delete(sessionId)
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
          const term = new Terminal({ cursorBlink: true, allowProposedApi: true, scrollback: useUiStore().terminalScrollback, ...useUiStore().terminalAppearance })
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
            underlineTimer: null,
            writeGeneration: 0,
            evictedOffset: 0,
            scrollMarker: null,
            scrollMarkerLastLine: 0,
            decoder: new TextDecoder('utf-8', { fatal: false }),
            pendingUtf8Bytes: 0
          }
          term.onData((data) => {
            const input: TerminalInputEvent = { terminalId: inst.terminalId, data }
            window.api.send(SEND_CHANNELS.terminalInput, input)
            if (!useUiStore().terminalPredictiveEcho) {
              return
            }
            const res = inst.predictor.onInput(data, snapshotBuffer(inst))
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
              void pasteInto(term).catch(() => {})
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
            earlyExits.clear()
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
    flushPredictions(sessionId: string): Promise<void> {
      const inst = instances.get(sessionId)
      if (!inst) {
        return Promise.resolve()
      }
      return flushInstancePredictions(inst)
    },

    /** Clears active predictions across open instances when predictive local echo is disabled. */
    syncPredictiveEchoSetting(): void {
      if (useUiStore().terminalPredictiveEcho) {
        return
      }
      for (const inst of instances.values()) {
        void flushInstancePredictions(inst)
        inst.predictor.reset()
        resetScrollTracker(inst)
        inst.writeGeneration++
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
        resetScrollTracker(inst)
        inst.writeGeneration++
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
