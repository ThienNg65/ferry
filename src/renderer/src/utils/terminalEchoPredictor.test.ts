import { describe, expect, it } from 'vitest'
import {
  TerminalEchoPredictor,
  type BufferSnapshot,
  type CursorPos,
} from './terminalEchoPredictor'

class FakeBuffer implements BufferSnapshot {
  type: 'normal' | 'alternate' = 'normal'
  cols: number
  lines: string[]
  cursor: CursorPos
  private wrapPending = false

  constructor(cols = 80, initialLines: string[] = [''], cursor: CursorPos = { absY: 0, x: 0 }) {
    this.cols = cols
    this.lines = initialLines.map((l) => l.padEnd(cols, ' ').slice(0, cols))
    this.cursor = { ...cursor }
  }

  private ensureRow(absY: number): void {
    while (this.lines.length <= absY) {
      this.lines.push(' '.repeat(this.cols))
    }
  }

  getLineText(absY: number): string {
    return (this.lines[absY] ?? '').replace(/\s+$/, '')
  }

  getCellText(absY: number, x: number): string {
    const line = this.lines[absY] ?? ''
    const ch = line[x] ?? ''
    return ch === ' ' ? ' ' : ch
  }

  /** Minimal ANSI/VT applier for verifying rendered + rewound buffer state in tests. */
  apply(seq: string): void {
    let i = 0
    while (i < seq.length) {
      const ch = seq[i]
      if (ch === '\x1b' && seq[i + 1] === '[') {
        const match = /^\x1b\[([0-9;?]*)([A-Za-z])/.exec(seq.slice(i))
        if (match) {
          const params = match[1]
          const cmd = match[2]
          const n = params === '' ? 1 : Number.parseInt(params, 10)
          if (cmd !== 'm') this.wrapPending = false
          if (cmd === 'A') {
            this.cursor.absY = Math.max(0, this.cursor.absY - n)
          } else if (cmd === 'B') {
            this.cursor.absY += n
            this.ensureRow(this.cursor.absY)
          } else if (cmd === 'G') {
            this.cursor.x = Math.max(0, Math.min(this.cols - 1, n - 1))
          } else if (cmd === 'K') {
            this.ensureRow(this.cursor.absY)
            const mode = params === '' ? 0 : n
            const row = this.lines[this.cursor.absY].split('')
            if (mode === 0) {
              for (let c = this.cursor.x; c < this.cols; c++) row[c] = ' '
            } else if (mode === 2) {
              for (let c = 0; c < this.cols; c++) row[c] = ' '
            }
            this.lines[this.cursor.absY] = row.join('')
          }
          // SGR 'm' and other CSI sequences don't move cursor or change text
          i += match[0].length
          continue
        }
      }
      if (ch === '\b') {
        this.wrapPending = false
        if (this.cursor.x > 0) this.cursor.x -= 1
        i++
        continue
      }
      if (ch === '\r') {
        this.wrapPending = false
        this.cursor.x = 0
        i++
        continue
      }
      if (ch === '\n') {
        this.wrapPending = false
        this.cursor.absY += 1
        this.ensureRow(this.cursor.absY)
        i++
        continue
      }
      if (this.wrapPending) {
        this.cursor.absY += 1
        this.cursor.x = 0
        this.wrapPending = false
      }
      this.ensureRow(this.cursor.absY)
      const row = this.lines[this.cursor.absY].split('')
      row[this.cursor.x] = ch
      this.lines[this.cursor.absY] = row.join('')
      if (this.cursor.x + 1 >= this.cols) {
        this.wrapPending = true
      } else {
        this.cursor.x += 1
      }
      i++
    }
  }
}

describe('TerminalEchoPredictor', () => {
  it('predicts_printable_ascii_without_underline_initially', () => {
    let now = 1000
    const predictor = new TerminalEchoPredictor(() => now)
    const buf = new FakeBuffer(80, ['user@host:$ '], { absY: 0, x: 10 })

    const r1 = predictor.onInput('g', buf)
    expect(r1).toEqual({ write: 'g', armUnderlineTimer: true, cancelUnderlineTimer: false })
    buf.apply(r1.write)

    const r2 = predictor.onInput('i', buf)
    expect(r2).toEqual({ write: 'i', armUnderlineTimer: false, cancelUnderlineTimer: false })
    buf.apply(r2.write)

    const r3 = predictor.onInput('t', buf)
    expect(r3).toEqual({ write: 't', armUnderlineTimer: false, cancelUnderlineTimer: false })
    buf.apply(r3.write)

    expect(predictor.getSnapshot()).toEqual({
      mode: 'active',
      pendingCount: 3,
      underlined: false,
      predictionsRendered: true,
      pendingServerWrites: 0,
    })
    expect(buf.getLineText(0)).toBe('user@host:git')
  })

  it('applies_underline_on_100ms_timeout_and_renders_subsequent_chars_underlined', () => {
    let now = 1000
    const predictor = new TerminalEchoPredictor(() => now)
    const buf = new FakeBuffer(80, ['user@host:$ '], { absY: 0, x: 12 })

    for (const ch of ['g', 'i', 't']) {
      const r = predictor.onInput(ch, buf)
      buf.apply(r.write)
    }

    now += 99
    expect(predictor.applyUnderlineTimeout(80)).toBe('')
    expect(predictor.getSnapshot().underlined).toBe(false)

    now += 1
    const ul = predictor.applyUnderlineTimeout(80)
    expect(ul).toContain('\x1b[4mgit\x1b[24m')
    expect(predictor.getSnapshot().underlined).toBe(true)
    buf.apply(ul)
    expect(buf.getLineText(0)).toBe('user@host:$ git')
    expect(buf.cursor).toEqual({ absY: 0, x: 15 })

    const rSpace = predictor.onInput(' ', buf)
    expect(rSpace.write).toBe('\x1b[4m \x1b[24m')
    expect(rSpace.armUnderlineTimer).toBe(false)
    buf.apply(rSpace.write)
    expect(buf.cursor).toEqual({ absY: 0, x: 16 })
  })

  it('wraps_correctly_across_cols_boundary_and_rewinds', () => {
    const predictor = new TerminalEchoPredictor(() => 1000)
    const buf = new FakeBuffer(10, ['01234567'], { absY: 0, x: 8 })

    const r = predictor.onInput('abcd', buf)
    expect(r.write).toBe('abcd')
    buf.apply(r.write)
    expect(buf.getLineText(0)).toBe('01234567ab')
    expect(buf.getLineText(1)).toBe('cd')
    expect(buf.cursor).toEqual({ absY: 1, x: 2 })

    const rewind = predictor.resetForFlush(buf)
    expect(rewind).toContain('\x1b[1A')
    expect(rewind).toContain('\x1b[2K')
    expect(rewind).toContain('\x1b[9G\x1b[K')
    buf.apply(rewind)

    expect(buf.getLineText(0)).toBe('01234567')
    expect(buf.getLineText(1)).toBe('')
    expect(buf.cursor).toEqual({ absY: 0, x: 8 })
    expect(predictor.getSnapshot().pendingCount).toBe(0)
    expect(predictor.getSnapshot().predictionsRendered).toBe(false)
  })

  it('backspace_pops_unconfirmed_char_and_rewinds_single_cell', () => {
    const predictor = new TerminalEchoPredictor(() => 1000)
    const buf = new FakeBuffer(10, ['$ '], { absY: 0, x: 2 })

    for (const ch of ['a', 'b']) {
      buf.apply(predictor.onInput(ch, buf).write)
    }

    const bs1 = predictor.onInput('\x7f', buf)
    expect(bs1.write).toBe('\b \b')
    expect(bs1.cancelUnderlineTimer).toBe(false)
    buf.apply(bs1.write)
    expect(buf.getLineText(0)).toBe('$ a')
    expect(buf.cursor).toEqual({ absY: 0, x: 3 })
    expect(predictor.getSnapshot().pendingCount).toBe(1)

    // Now test wrap-back from x === 0 to previous row cols - 1
    const wrapBuf = new FakeBuffer(10, ['01234567'], { absY: 0, x: 8 })
    const wrapPredictor = new TerminalEchoPredictor(() => 1000)
    wrapPredictor.onInput('a', wrapBuf)
    wrapBuf.apply('a')
    wrapPredictor.onInput('b', wrapBuf)
    wrapBuf.apply('b')
    wrapPredictor.onInput('c', wrapBuf)
    wrapBuf.apply('c')
    expect(wrapBuf.cursor).toEqual({ absY: 1, x: 1 })

    // Backspace 'c' -> cursor lands at (1, 0)
    const bsWrap1 = wrapPredictor.onInput('\x7f', wrapBuf)
    expect(bsWrap1.write).toBe('\b \b')
    wrapBuf.apply(bsWrap1.write)
    expect(wrapBuf.cursor).toEqual({ absY: 1, x: 0 })

    // Backspace 'b' from (1, 0) -> wraps back to (0, 9)
    const bsWrap2 = wrapPredictor.onInput('\x7f', wrapBuf)
    expect(bsWrap2.write).toBe('\x1b[1A\x1b[10G \x1b[10G')
    wrapBuf.apply(bsWrap2.write)
    expect(wrapBuf.cursor).toEqual({ absY: 0, x: 9 })
    expect(wrapBuf.getLineText(0)).toBe('01234567a')
    expect(wrapPredictor.getSnapshot().pendingCount).toBe(1)
  })

  it('backspace_at_empty_prompt_is_ignored', () => {
    const predictor = new TerminalEchoPredictor(() => 1000)
    const buf = new FakeBuffer(80, ['user@host:$ '], { absY: 0, x: 12 })

    const res = predictor.onInput('\x7f', buf)
    expect(res).toEqual({ write: '', armUnderlineTimer: false, cancelUnderlineTimer: false })
    expect(buf.cursor).toEqual({ absY: 0, x: 12 })
    expect(predictor.getSnapshot().predictionsRendered).toBe(false)
  })

  it('wide_or_combining_unicode_and_control_keys_flush_predictions', () => {
    for (const trigger of ['中', '\u0301', '🚀', '\t', '\x03', '\x1b[A', 'x'.repeat(129)]) {
      const predictor = new TerminalEchoPredictor(() => 1000)
      const buf = new FakeBuffer(80, ['$ '], { absY: 0, x: 2 })

      buf.apply(predictor.onInput('a', buf).write)
      buf.apply(predictor.onInput('b', buf).write)
      expect(buf.getLineText(0)).toBe('$ ab')

      const flush = predictor.onInput(trigger, buf)
      expect(flush.write.length).toBeGreaterThan(0)
      expect(flush.cancelUnderlineTimer).toBe(true)
      buf.apply(flush.write)

      expect(buf.getLineText(0)).toBe('$')
      expect(buf.cursor).toEqual({ absY: 0, x: 2 })
      expect(predictor.getSnapshot().pendingCount).toBe(0)
      expect(predictor.getSnapshot().predictionsRendered).toBe(false)
    }
  })

  it('keeps_pending_command_visible_on_enter_until_flushed_and_pauses_on_alternate_buffer', () => {
    const predictor = new TerminalEchoPredictor(() => 1000)
    const buf = new FakeBuffer(80, ['$ '], { absY: 0, x: 2 })

    buf.apply(predictor.onInput('l', buf).write)
    buf.apply(predictor.onInput('s', buf).write)

    const enter = predictor.onInput('\r', buf)
    expect(enter.write).toBe('')
    expect(predictor.getSnapshot().pendingCount).toBe(2)
    expect(predictor.getSnapshot().predictionsRendered).toBe(true)

    // Subsequent printable key while awaiting newline does not render locally
    const afterEnter = predictor.onInput('x', buf)
    expect(afterEnter.write).toBe('')

    // Alternate screen pauses predictor
    buf.type = 'alternate'
    const altRes = predictor.onInput('j', buf)
    expect(altRes.write).toBe('')
    expect(predictor.getSnapshot().mode).toBe('paused_alt')
    expect(predictor.getSnapshot().pendingCount).toBe(0)
  })
})
