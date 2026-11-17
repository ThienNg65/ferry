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

interface PredictionResult {
  write: string
  armUnderlineTimer: boolean
  cancelUnderlineTimer: boolean
}

function emptyResult(): PredictionResult {
  return { write: '', armUnderlineTimer: false, cancelUnderlineTimer: false }
}

const UNDERLINE_THRESHOLD_MS = 100
const MAX_PRINTABLE_CHUNK = 128
const PASSWORD_PROMPT_RE =
  /(?:password|passphrase|pin|passcode|otp|verification code|enter secret)\s*(?:for [^:\n]+)?:\s*$|^\[sudo\] password[^\n]*:\s*$/i

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
  private anchorWrapPending = false
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

  onInput(data: string, buf: BufferSnapshot): PredictionResult {
    if (!data) return emptyResult()

    if (buf.type === 'alternate') {
      return this.enterPausedMode('paused_alt')
    }
    if (this.mode === 'paused_alt') {
      this.mode = 'active'
    }

    if (this.mode === 'paused_password' || this.mode === 'paused_noecho') {
      if (data.includes('\r') || data.includes('\n')) {
        this.submittedWhilePaused = true
        this.silentProbe = []
        this.anchor = null
        return emptyResult()
      }
      const probeScalars = this.submittedWhilePaused ? splitPrintableScalars(data) : null
      if (probeScalars) {
        if (this.silentProbe.length === 0) {
          this.anchor = this.normalizeWritePos(buf.cursor, buf.cols)
        }
        this.silentProbe.push(...probeScalars)
      } else {
        this.silentProbe = []
        this.anchor = null
      }
      return emptyResult()
    }

    if (data === '\r' || data === '\n' || data === '\r\n') {
      this.confirmedLineChars = 0
      if (this.pending.length > 0 || this.pendingBackspaces > 0) {
        this.awaitingNewlineConfirm = true
      } else {
        this.anchor = null
        this.renderedPos = null
      }
      return emptyResult()
    }

    if (this.awaitingNewlineConfirm) {
      // Flush cleanly on explicit control/navigation interrupts; hold otherwise until newline arrives
      if (data === '\x03' || data === '\x15' || data === '\x1b') {
        const hadPending = this.pending.length > 0
        const write = this.resetForFlush(buf)
        return { write, armUnderlineTimer: false, cancelUnderlineTimer: hadPending }
      }
      return emptyResult()
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
        eraseReapply += this.buildBackspaceErase(pos, i === 0 && this.anchorWrapPending, cols)
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

  beforeServerWrite(cols: number): string {
    const write = this.predictionsRendered ? this.buildRewindSequence(cols) : ''
    this.predictionsRendered = false
    this.pendingServerWrites++
    return write
  }

  afterServerWrite(buf: BufferSnapshot): PredictionResult {
    if (this.pendingServerWrites > 0) {
      this.pendingServerWrites--
    }

    if (buf.type === 'alternate') {
      return this.enterPausedMode('paused_alt')
    }
    if (this.mode === 'paused_alt') {
      this.mode = 'active'
    }

    if (this.pendingServerWrites > 0) {
      return emptyResult()
    }

    const nowPos: CursorPos = { ...buf.cursor }
    const lineUpToCursor = buf.getLineText(nowPos.absY).slice(0, nowPos.x)
    if (PASSWORD_PROMPT_RE.test(lineUpToCursor)) {
      return this.enterPausedMode('paused_password')
    }

    if (this.mode === 'paused_password' || this.mode === 'paused_noecho') {
      return this.reconcilePausedProbe(buf, nowPos)
    }

    if (this.pending.length === 0 && this.pendingBackspaces === 0) {
      if (this.awaitingNewlineConfirm) {
        const cols = buf.cols
        const nowIdx = nowPos.absY * cols + nowPos.x
        const anchorIdx = this.anchor ? this.anchor.absY * cols + this.anchor.x : -1
        const anchorRow = this.anchor
          ? this.anchorWrapPending
            ? this.anchor.absY - 1
            : this.anchor.absY
          : -1
        if (!this.anchor || nowPos.absY > anchorRow || nowIdx < anchorIdx) {
          this.awaitingNewlineConfirm = false
          this.anchor = null
          this.anchorWrapPending = false
        }
      }
      return emptyResult()
    }

    // Pending chars queued while a server write was already in flight anchor to post-write cursor
    if (!this.anchor) {
      this.anchor = this.normalizeWritePos(nowPos, buf.cols)
      this.anchorWrapPending = buf.cols > 0 && nowPos.x >= buf.cols
      return this.renderRemainingTail(nowPos, buf.cols, false)
    }

    const cols = buf.cols
    const nowIdx = nowPos.absY * cols + nowPos.x
    let anchorIdx = this.anchor.absY * cols + this.anchor.x

    if (this.pendingBackspaces > 0) {
      const effectiveAnchor = retreatCursorN(this.anchor, this.pendingBackspaces, cols)
      const effectiveAnchorIdx = effectiveAnchor.absY * cols + effectiveAnchor.x
      const expectedPending = this.pending.map((p) => p.ch).join('')
      const replaced =
        this.pending.length > 0 && nowIdx > effectiveAnchorIdx
          ? this.extractConfirmedText(buf, effectiveAnchor, nowPos, expectedPending)
          : ''
      const erasedPrefix = this.erasedConfirmedChars.slice(0, replaced.length).join('')

      if (
        this.pending.length > 0 &&
        replaced.length > 0 &&
        replaced !== erasedPrefix &&
        replaced[0] === this.pending[0].ch
      ) {
        // Server applied all pendingBackspaces and started echoing pending chars in the same chunk
        this.pendingBackspaces = 0
        this.erasedConfirmedChars = []
        this.anchor = effectiveAnchor
        this.anchorWrapPending = false
        anchorIdx = effectiveAnchorIdx
      } else if (nowIdx < anchorIdx) {
        const leftSteps = anchorIdx - nowIdx
        if (leftSteps > this.pendingBackspaces) {
          const hadPending = this.pending.length > 0
          this.clearAllPendingState(true)
          return { write: '', armUnderlineTimer: false, cancelUnderlineTimer: hadPending }
        }
        this.erasedConfirmedChars.splice(this.erasedConfirmedChars.length - leftSteps, leftSteps)
        this.pendingBackspaces -= leftSteps
        this.anchor = this.normalizeWritePos(nowPos, cols)
        this.anchorWrapPending = cols > 0 && nowPos.x >= cols
        anchorIdx = nowIdx
      } else if (nowIdx > anchorIdx) {
        const hadPending = this.pending.length > 0
        this.clearAllPendingState(true)
        return { write: '', armUnderlineTimer: false, cancelUnderlineTimer: hadPending }
      }
    }

    let matched = 0
    if (this.pendingBackspaces === 0 && this.pending.length > 0) {
      if (nowIdx < anchorIdx) {
        this.clearAllPendingState(true)
        return { write: '', armUnderlineTimer: false, cancelUnderlineTimer: true }
      }

      if (this.awaitingNewlineConfirm && this.anchorWrapPending && nowPos.absY === this.anchor.absY && nowPos.x === 0) {
        return this.enterPausedMode('paused_noecho')
      }

      if (nowIdx > anchorIdx) {
        const expectedPending = this.pending.map((p) => p.ch).join('')
        const confirmed = this.extractConfirmedText(buf, this.anchor, nowPos, expectedPending)
        while (
          matched < this.pending.length &&
          matched < confirmed.length &&
          this.pending[matched].ch === confirmed[matched]
        ) {
          matched++
        }

        if (this.awaitingNewlineConfirm && nowPos.absY > this.anchor.absY) {
          const wrappedOnly =
            matched === confirmed.length &&
            nowPos.x > 0 &&
            nowPos.absY === this.anchor.absY + Math.floor((this.anchor.x + confirmed.length) / cols)
          if (!wrappedOnly) {
            if (matched === 0) {
              return this.enterPausedMode('paused_noecho')
            }
            this.clearAllPendingState(true)
            return { write: '', armUnderlineTimer: false, cancelUnderlineTimer: true }
          }
        }

        if (matched < confirmed.length) {
          if (matched === 0) {
            return this.enterPausedMode('paused_noecho')
          }
          this.confirmedLineChars += matched
          this.clearAllPendingState(false)
          return { write: '', armUnderlineTimer: false, cancelUnderlineTimer: true }
        }

        this.pending.splice(0, matched)
        if (!this.awaitingNewlineConfirm) {
          this.confirmedLineChars += matched
        }
        this.anchor = this.normalizeWritePos(nowPos, cols)
        this.anchorWrapPending = cols > 0 && nowPos.x >= cols

        if (this.pending.length === 0) {
          if (this.awaitingNewlineConfirm) {
            this.resetTailKeepNewlineWait()
            return { write: '', armUnderlineTimer: false, cancelUnderlineTimer: true }
          }
          this.clearAllPendingState(false)
          return { write: '', armUnderlineTimer: false, cancelUnderlineTimer: true }
        }
      }
    }

    if (this.pendingBackspaces === 0 && this.pending.length === 0) {
      if (this.awaitingNewlineConfirm) {
        this.resetTailKeepNewlineWait()
      } else {
        this.clearAllPendingState(false)
      }
      return emptyResult()
    }

    return this.renderRemainingTail(nowPos, cols, matched > 0)
  }

  private resetTailKeepNewlineWait(): void {
    this.confirmedLineChars = 0
    this.renderedPos = null
    this.maxTouchedAbsY = 0
    this.wrapPending = false
    this.underlined = false
    this.predictionsRendered = false
  }

  reset(): void {
    this.mode = 'active'
    this.pendingServerWrites = 0
    this.submittedWhilePaused = false
    this.silentProbe = []
    this.clearAllPendingState(true)
  }

  private handlePrintable(raw: string, scalars: string[], buf: BufferSnapshot): PredictionResult {
    const now = this.nowFn()
    const wasPendingEmpty = this.pending.length === 0

    if (
      this.pending.length === 0 &&
      this.pendingBackspaces === 0 &&
      this.pendingServerWrites === 0
    ) {
      const writePos = this.normalizeWritePos(buf.cursor, buf.cols)
      this.anchor = writePos
      this.renderedPos = { ...writePos }
      this.maxTouchedAbsY = writePos.absY
      this.wrapPending = false
    }

    for (const ch of scalars) {
      this.pending.push({ ch, sentAt: now })
    }

    let write = ''
    if (this.pendingServerWrites === 0 && this.renderedPos) {
      write = this.underlined ? `\x1b[4m${raw}\x1b[24m` : raw
      this.advanceRenderedPos(scalars.length, buf.cols)
      this.predictionsRendered = true
    }

    return {
      write,
      armUnderlineTimer: wasPendingEmpty && !this.underlined,
      cancelUnderlineTimer: false,
    }
  }

  private handleBackspace(buf: BufferSnapshot): PredictionResult {
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

    if (this.confirmedLineChars > 0 && this.pendingServerWrites === 0) {
      const startWrapPending = this.pendingBackspaces === 0 && buf.cols > 0 && buf.cursor.x >= buf.cols
      if (this.pendingBackspaces === 0) {
        const writePos = this.normalizeWritePos(buf.cursor, buf.cols)
        this.anchor = writePos
        this.anchorWrapPending = startWrapPending
        this.renderedPos = { ...writePos }
        this.maxTouchedAbsY = writePos.absY
        this.wrapPending = startWrapPending
      }
      const curPos = this.renderedPos ?? this.normalizeWritePos(buf.cursor, buf.cols)
      const prevPos = retreatCursor(curPos, buf.cols)
      const cell = buf.getCellText(prevPos.absY, prevPos.x)
      this.erasedConfirmedChars.unshift(cell || ' ')
      this.confirmedLineChars--
      this.pendingBackspaces++

      const write = this.buildBackspaceErase(curPos, this.wrapPending, buf.cols)
      this.wrapPending = false
      this.renderedPos = prevPos
      this.predictionsRendered = true
      return { write, armUnderlineTimer: false, cancelUnderlineTimer: false }
    }

    return { write: '', armUnderlineTimer: false, cancelUnderlineTimer: false }
  }

  private reconcilePausedProbe(buf: BufferSnapshot, nowPos: CursorPos): PredictionResult {
    if (!this.submittedWhilePaused || this.silentProbe.length === 0 || !this.anchor) {
      return emptyResult()
    }

    const cols = buf.cols
    const anchorIdx = this.anchor.absY * cols + this.anchor.x
    const nowIdx = nowPos.absY * cols + nowPos.x

    if (nowIdx === anchorIdx) {
      return emptyResult()
    }
    if (nowIdx < anchorIdx) {
      this.silentProbe = []
      this.anchor = null
      return emptyResult()
    }

    const probeStr = this.silentProbe.join('')
    const confirmed = this.extractConfirmedText(buf, this.anchor, nowPos, probeStr)
    if (confirmed.length > 0 && confirmed.length <= probeStr.length && probeStr.startsWith(confirmed)) {
      const remaining = this.silentProbe.slice(confirmed.length)
      this.mode = 'active'
      this.submittedWhilePaused = false
      this.silentProbe = []
      this.confirmedLineChars = confirmed.length
      this.anchor = null
      if (remaining.length === 0) {
        return emptyResult()
      }
      const now = this.nowFn()
      this.anchor = this.normalizeWritePos(nowPos, cols)
      this.pending = remaining.map((ch) => ({ ch, sentAt: now }))
      return this.renderRemainingTail(nowPos, cols, true)
    }

    this.silentProbe = []
    this.anchor = null
    return emptyResult()
  }

  private enterPausedMode(mode: Exclude<PredictorMode, 'active'>): PredictionResult {
    const hadPending = this.pending.length > 0
    this.mode = mode
    this.submittedWhilePaused = false
    this.silentProbe = []
    this.clearAllPendingState(true)
    return { write: '', armUnderlineTimer: false, cancelUnderlineTimer: hadPending }
  }

  private renderRemainingTail(
    nowPos: CursorPos,
    cols: number,
    armTimerIfPending: boolean
  ): PredictionResult {
    const wasUnderlined = this.underlined
    if (
      !this.underlined &&
      this.pending.length > 0 &&
      this.nowFn() - this.pending[0].sentAt >= UNDERLINE_THRESHOLD_MS
    ) {
      this.underlined = true
    }

    const writePos = this.normalizeWritePos(nowPos, cols)
    this.renderedPos = { ...writePos }
    this.maxTouchedAbsY = writePos.absY
    this.wrapPending = cols > 0 && nowPos.x >= cols

    let write = ''
    for (let i = 0; i < this.pendingBackspaces; i++) {
      write += this.buildBackspaceErase(this.renderedPos, this.wrapPending, cols)
      this.wrapPending = false
      this.renderedPos = retreatCursor(this.renderedPos, cols)
    }

    if (this.pending.length > 0) {
      const tail = this.pending.map((p) => p.ch).join('')
      write += this.underlined ? `\x1b[4m${tail}\x1b[24m` : tail
      this.advanceRenderedPos(this.pending.length, cols)
    }

    this.predictionsRendered = true
    return {
      write,
      armUnderlineTimer: armTimerIfPending && this.pending.length > 0 && !this.underlined,
      cancelUnderlineTimer: !wasUnderlined && this.underlined,
    }
  }

  private normalizeWritePos(pos: CursorPos, cols: number): CursorPos {
    if (cols > 0 && pos.x >= cols) {
      return { absY: pos.absY + 1, x: 0 }
    }
    return { ...pos }
  }

  private advanceRenderedPos(count: number, cols: number): void {
    if (!this.renderedPos) return
    for (let i = 0; i < count; i++) {
      const nextPos = advanceCursor(this.renderedPos, cols)
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
  }

  private extractConfirmedText(
    buf: BufferSnapshot,
    from: CursorPos,
    to: CursorPos,
    expected: string
  ): string {
    if (from.absY === to.absY) {
      let text = ''
      for (let x = from.x; x < to.x; x++) {
        text += buf.getCellText(from.absY, x) || ' '
      }
      return text
    }

    let text = ''
    for (let y = from.absY; y < to.absY; y++) {
      const startX = y === from.absY ? from.x : 0
      const lineLen = Math.min(buf.cols, buf.getLineText(y).length)
      for (let x = startX; x < lineLen; x++) {
        text += buf.getCellText(y, x) || ' '
      }

      const rowWrappedPastMargin = y + 1 < to.absY || to.x > 0
      if (rowWrappedPastMargin && lineLen < buf.cols) {
        let idx = text.length
        let canReachMargin = true
        for (let x = Math.max(startX, lineLen); x < buf.cols; x++) {
          const cell = buf.getCellText(y, x) || ' '
          if (expected[idx] !== ' ' || cell !== ' ') {
            canReachMargin = false
            break
          }
          idx++
        }
        if (canReachMargin) {
          for (let x = Math.max(startX, lineLen); x < buf.cols; x++) {
            text += buf.getCellText(y, x) || ' '
          }
        } else if (y === from.absY && text.length === 0) {
          return ''
        }
      } else if (y === from.absY && text.length === 0) {
        return ''
      }
    }

    for (let x = 0; x < to.x; x++) {
      text += buf.getCellText(to.absY, x) || ' '
    }
    return text
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
        !this.anchorWrapPending &&
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
    this.anchorWrapPending = false
    this.renderedPos = null
    this.maxTouchedAbsY = 0
    this.wrapPending = false
    this.underlined = false
    this.predictionsRendered = false
    this.awaitingNewlineConfirm = false
  }
}
