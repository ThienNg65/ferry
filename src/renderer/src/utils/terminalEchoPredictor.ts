export type PredictorMode = 'active' | 'paused_alt' | 'paused_password' | 'paused_noecho'

export interface CursorPos {
  absY: number
  x: number
}

export interface BufferSnapshot {
  type: 'normal' | 'alternate'
  cols: number
  cursor: CursorPos
  getLineText(absY: number): string
  getCellText(absY: number, x: number): string
}

export interface PredictorSnapshot {
  mode: PredictorMode
  pendingCount: number
  underlined: boolean
  predictionsRendered: boolean
  pendingServerWrites: number
}

interface PendingChar {
  ch: string
  sentAt: number
}

const UNDERLINE_THRESHOLD_MS = 100
const MAX_PRINTABLE_CHUNK = 128

const ZERO_WIDTH_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x0300, 0x036f],
  [0x1ab0, 0x1aff],
  [0x1dc0, 0x1dff],
  [0x200b, 0x200f],
  [0x202a, 0x202e],
  [0x2060, 0x206f],
  [0x20d0, 0x20ff],
  [0xfe00, 0xfe0f],
  [0xfe20, 0xfe2f],
]

const WIDE_BMP_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x1100, 0x115f],
  [0x231a, 0x231b],
  [0x2329, 0x232a],
  [0x23e9, 0x23f3],
  [0x23f8, 0x23fa],
  [0x25fd, 0x25fe],
  [0x2614, 0x2615],
  [0x2648, 0x2653],
  [0x267f, 0x267f],
  [0x2693, 0x2693],
  [0x26a1, 0x26a1],
  [0x26aa, 0x26ab],
  [0x26bd, 0x26be],
  [0x26c4, 0x26c5],
  [0x26ce, 0x26ce],
  [0x26d4, 0x26d4],
  [0x26ea, 0x26ea],
  [0x26f2, 0x26f3],
  [0x26f5, 0x26f5],
  [0x26fa, 0x26fa],
  [0x26fd, 0x26fd],
  [0x2705, 0x2705],
  [0x270a, 0x270b],
  [0x2728, 0x2728],
  [0x274c, 0x274c],
  [0x274e, 0x274e],
  [0x2753, 0x2755],
  [0x2757, 0x2757],
  [0x2795, 0x2797],
  [0x27b0, 0x27b0],
  [0x27bf, 0x27bf],
  [0x2b1b, 0x2b1c],
  [0x2b50, 0x2b50],
  [0x2b55, 0x2b55],
  [0x2e80, 0x303e],
  [0x3040, 0xa4cf],
  [0xa960, 0xa97f],
  [0xac00, 0xd7a3],
  [0xf900, 0xfaff],
  [0xfe10, 0xfe19],
  [0xfe30, 0xfe6f],
  [0xff00, 0xff60],
  [0xffe0, 0xffe6],
]

function inRanges(cp: number, ranges: ReadonlyArray<readonly [number, number]>): boolean {
  for (const [start, end] of ranges) {
    if (cp >= start && cp <= end) return true
  }
  return false
}

/** Returns true only for single-cell printable Unicode scalars safe to predict locally. */
export function isSingleWidthScalar(ch: string): boolean {
  const cp = ch.codePointAt(0)
  if (cp === undefined || cp > 0xffff) return false
  if (cp <= 0x1f || (cp >= 0x7f && cp <= 0x9f)) return false
  if (cp >= 0xd800 && cp <= 0xdfff) return false
  if (cp === 0x00ad || cp === 0xfeff) return false
  if (inRanges(cp, ZERO_WIDTH_RANGES)) return false
  if (inRanges(cp, WIDE_BMP_RANGES)) return false
  return true
}

export function advanceCursor(pos: CursorPos, cols: number): CursorPos {
  if (cols <= 0) return { ...pos }
  if (pos.x + 1 >= cols) {
    return { absY: pos.absY + 1, x: 0 }
  }
  return { absY: pos.absY, x: pos.x + 1 }
}

export function retreatCursor(pos: CursorPos, cols: number): CursorPos {
  if (cols <= 0) return { ...pos }
  if (pos.x > 0) {
    return { absY: pos.absY, x: pos.x - 1 }
  }
  if (pos.absY > 0) {
    return { absY: pos.absY - 1, x: cols - 1 }
  }
  return { absY: 0, x: 0 }
}

function retreatCursorN(pos: CursorPos, steps: number, cols: number): CursorPos {
  let cur = { ...pos }
  for (let i = 0; i < steps; i++) {
    cur = retreatCursor(cur, cols)
  }
  return cur
}

function splitPrintableScalars(data: string): string[] | null {
  if (!data) return null
  const scalars = Array.from(data)
  if (scalars.length === 0 || scalars.length > MAX_PRINTABLE_CHUNK) return null
  for (const ch of scalars) {
    if (!isSingleWidthScalar(ch)) return null
  }
  return scalars
}

/**
 * Pure Mosh-style predictive local echo state machine for xterm.js over SSH.
 */
export class TerminalEchoPredictor {
  private readonly nowFn: () => number
  private mode: PredictorMode = 'active'
  private pending: PendingChar[] = []
  private pendingBackspaces = 0
  private erasedConfirmedChars: string[] = []
  private confirmedLineChars = 0
  private anchor: CursorPos | null = null
  private renderedPos: CursorPos | null = null
  private maxTouchedAbsY = 0
  private wrapPending = false
  private underlined = false
  private predictionsRendered = false
  private pendingServerWrites = 0
  private awaitingNewlineConfirm = false
  private submittedWhilePaused = false
  private silentProbe: string[] = []

  constructor(nowFn: () => number = () => Date.now()) {
    this.nowFn = nowFn
  }

  getSnapshot(): PredictorSnapshot {
    return {
      mode: this.mode,
      pendingCount: this.pending.length,
      underlined: this.underlined,
      predictionsRendered: this.predictionsRendered,
      pendingServerWrites: this.pendingServerWrites,
    }
  }

  onInput(
    data: string,
    buf: BufferSnapshot
  ): { write: string; armUnderlineTimer: boolean; cancelUnderlineTimer: boolean } {
    const emptyResult = { write: '', armUnderlineTimer: false, cancelUnderlineTimer: false }
    if (!data) return emptyResult

    if (buf.type === 'alternate') {
      const hadPending = this.pending.length > 0
      this.mode = 'paused_alt'
      this.clearAllPendingState(true)
      return { write: '', armUnderlineTimer: false, cancelUnderlineTimer: hadPending }
    }
    if (this.mode === 'paused_alt') {
      this.mode = 'active'
    }

    if (this.mode === 'paused_password' || this.mode === 'paused_noecho') {
      if (data.includes('\r') || data.includes('\n')) {
        this.submittedWhilePaused = true
        this.silentProbe = []
        this.anchor = null
        return emptyResult
      }
      const probeScalars = this.submittedWhilePaused ? splitPrintableScalars(data) : null
      if (probeScalars) {
        if (this.silentProbe.length === 0) {
          this.anchor = { ...buf.cursor }
        }
        this.silentProbe.push(...probeScalars)
      } else {
        this.silentProbe = []
      }
      return emptyResult
    }

    if (data === '\r' || data === '\n' || data === '\r\n') {
      this.confirmedLineChars = 0
      if (this.pending.length > 0 || this.pendingBackspaces > 0) {
        this.awaitingNewlineConfirm = true
      } else {
        this.anchor = null
        this.renderedPos = null
      }
      return emptyResult
    }

    if (this.awaitingNewlineConfirm) {
      // Flush cleanly on explicit control/navigation interrupts; hold otherwise until newline arrives
      if (data === '\x03' || data === '\x15' || data === '\x1b') {
        const hadPending = this.pending.length > 0
        const write = this.resetForFlush(buf)
        return { write, armUnderlineTimer: false, cancelUnderlineTimer: hadPending }
      }
      return emptyResult
    }

    if (data === '\x7f' || data === '\b') {
      return this.handleBackspace(buf)
    }

    const scalars = splitPrintableScalars(data)
    if (scalars) {
      return this.handlePrintable(data, scalars, buf)
    }

    // Control keys, arrow/escape sequences, Tab, wide/combining Unicode, or large pastes flush predictions
    const hadPending = this.pending.length > 0
    const write = this.resetForFlush(buf)
    return { write, armUnderlineTimer: false, cancelUnderlineTimer: hadPending }
  }

  applyUnderlineTimeout(cols: number): string {
    if (
      this.mode !== 'active' ||
      this.pending.length === 0 ||
      this.pendingServerWrites > 0 ||
      !this.predictionsRendered ||
      this.underlined
    ) {
      return ''
    }
    if (this.nowFn() - this.pending[0].sentAt < UNDERLINE_THRESHOLD_MS) {
      return ''
    }
    this.underlined = true
    const rewind = this.buildRewindSequence(cols)
    let eraseReapply = ''
    if (this.pendingBackspaces > 0 && this.anchor) {
      // Rewind restored erasedConfirmedChars and parked at anchor; re-erase them before underlined tail
      let pos = { ...this.anchor }
      for (let i = 0; i < this.pendingBackspaces; i++) {
        eraseReapply += this.buildBackspaceErase(pos, false, cols)
        pos = retreatCursor(pos, cols)
      }
    }
    const text = this.pending.map((p) => p.ch).join('')
    return `${rewind}${eraseReapply}\x1b[4m${text}\x1b[24m`
  }

  resetForFlush(buf: BufferSnapshot): string {
    const write = this.predictionsRendered ? this.buildRewindSequence(buf.cols) : ''
    this.clearAllPendingState(true)
    return write
  }

  private handlePrintable(
    raw: string,
    scalars: string[],
    buf: BufferSnapshot
  ): { write: string; armUnderlineTimer: boolean; cancelUnderlineTimer: boolean } {
    const now = this.nowFn()
    const wasPendingEmpty = this.pending.length === 0

    if (this.pending.length === 0 && this.pendingBackspaces === 0) {
      this.anchor = { ...buf.cursor }
      this.renderedPos = { ...buf.cursor }
      this.maxTouchedAbsY = buf.cursor.absY
      this.wrapPending = false
    }

    for (const ch of scalars) {
      this.pending.push({ ch, sentAt: now })
    }

    let write = ''
    if (this.pendingServerWrites === 0 && this.renderedPos) {
      write = this.underlined ? `\x1b[4m${raw}\x1b[24m` : raw
      for (let i = 0; i < scalars.length; i++) {
        const nextPos = advanceCursor(this.renderedPos, buf.cols)
        if (nextPos.x === 0) {
          // Writing into cols - 1 sets xterm's wrapnext flag without advancing row until next char
          this.wrapPending = true
          this.maxTouchedAbsY = Math.max(this.maxTouchedAbsY, this.renderedPos.absY)
        } else {
          this.wrapPending = false
          this.maxTouchedAbsY = Math.max(this.maxTouchedAbsY, nextPos.absY)
        }
        this.renderedPos = nextPos
      }
      this.predictionsRendered = true
    }

    return {
      write,
      armUnderlineTimer: wasPendingEmpty && !this.underlined,
      cancelUnderlineTimer: false,
    }
  }

  private handleBackspace(
    buf: BufferSnapshot
  ): { write: string; armUnderlineTimer: boolean; cancelUnderlineTimer: boolean } {
    if (this.pending.length > 0) {
      this.pending.pop()
      let write = ''
      if (this.pendingServerWrites === 0 && this.predictionsRendered && this.renderedPos) {
        write = this.buildBackspaceErase(this.renderedPos, this.wrapPending, buf.cols)
        this.wrapPending = false
        this.renderedPos = retreatCursor(this.renderedPos, buf.cols)
      }
      const nowEmpty = this.pending.length === 0 && this.pendingBackspaces === 0
      if (nowEmpty) {
        this.clearAllPendingState(false)
      } else if (this.pending.length === 0) {
        this.underlined = false
      }
      return {
        write,
        armUnderlineTimer: false,
        cancelUnderlineTimer: this.pending.length === 0,
      }
    }

    if (this.confirmedLineChars > 0) {
      if (this.pendingBackspaces === 0) {
        this.anchor = { ...buf.cursor }
        this.renderedPos = { ...buf.cursor }
        this.maxTouchedAbsY = buf.cursor.absY
        this.wrapPending = false
      }
      const curPos = this.renderedPos ?? buf.cursor
      const prevPos = retreatCursor(curPos, buf.cols)
      const cell = buf.getCellText(prevPos.absY, prevPos.x)
      this.erasedConfirmedChars.unshift(cell || ' ')
      this.confirmedLineChars--
      this.pendingBackspaces++

      let write = ''
      if (this.pendingServerWrites === 0) {
        write = this.buildBackspaceErase(curPos, this.wrapPending, buf.cols)
        this.wrapPending = false
        this.renderedPos = prevPos
        this.predictionsRendered = true
      }
      return { write, armUnderlineTimer: false, cancelUnderlineTimer: false }
    }

    return { write: '', armUnderlineTimer: false, cancelUnderlineTimer: false }
  }

  private buildBackspaceErase(pos: CursorPos, wrapPending: boolean, cols: number): string {
    if (wrapPending) {
      return `\x1b[${cols}G \x1b[${cols}G`
    }
    if (pos.x === 0 && pos.absY > 0) {
      return `\x1b[1A\x1b[${cols}G \x1b[${cols}G`
    }
    return '\b \b'
  }

  private buildRewindSequence(cols: number): string {
    if (!this.anchor || !this.renderedPos) return ''

    const startPos =
      this.erasedConfirmedChars.length === 0
        ? this.anchor
        : retreatCursorN(this.anchor, this.erasedConfirmedChars.length, cols)

    const actualCursorAbsY = this.wrapPending
      ? Math.max(0, this.renderedPos.absY - 1)
      : this.renderedPos.absY

    let seq = ''
    const dyFromCursor = actualCursorAbsY - startPos.absY
    if (dyFromCursor > 0) {
      seq += `\x1b[${dyFromCursor}A`
    } else if (dyFromCursor < 0) {
      seq += `\x1b[${-dyFromCursor}B`
    }

    seq += `\x1b[0m\x1b[${startPos.x + 1}G\x1b[K`

    const maxRow = Math.max(this.maxTouchedAbsY, this.anchor.absY, startPos.absY)
    for (let y = startPos.absY + 1; y <= maxRow; y++) {
      seq += '\x1b[1B\x1b[1G\x1b[2K'
    }
    if (maxRow > startPos.absY) {
      seq += `\x1b[${maxRow - startPos.absY}A\x1b[${startPos.x + 1}G`
    }

    if (this.erasedConfirmedChars.length > 0) {
      seq += this.erasedConfirmedChars.join('')
      if (
        this.anchor.x === 0 &&
        this.anchor.absY > startPos.absY &&
        cols > 0 &&
        (startPos.x + this.erasedConfirmedChars.length) % cols === 0
      ) {
        seq += '\x1b[1B\x1b[1G'
      }
    }

    return seq
  }

  private clearAllPendingState(resetConfirmedLineChars: boolean): void {
    this.pending = []
    this.pendingBackspaces = 0
    this.erasedConfirmedChars = []
    if (resetConfirmedLineChars) {
      this.confirmedLineChars = 0
    }
    this.anchor = null
    this.renderedPos = null
    this.maxTouchedAbsY = 0
    this.wrapPending = false
    this.underlined = false
    this.predictionsRendered = false
    this.awaitingNewlineConfirm = false
  }
}
