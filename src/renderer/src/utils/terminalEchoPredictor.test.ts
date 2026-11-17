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
    return line[x] ?? ''
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
            if (this.cursor.x >= this.cols) this.cursor.x = this.cols - 1
          } else if (cmd === 'B') {
            this.cursor.absY += n
            this.ensureRow(this.cursor.absY)
            if (this.cursor.x >= this.cols) this.cursor.x = this.cols - 1
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
        if (this.cursor.x >= this.cols) this.cursor.x = this.cols - 1
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
      if (this.wrapPending || this.cursor.x >= this.cols) {
        this.cursor.absY += 1
        this.cursor.x = 0
        this.wrapPending = false
      }
      this.ensureRow(this.cursor.absY)
      const row = this.lines[this.cursor.absY].split('')
      row[this.cursor.x] = ch
      this.lines[this.cursor.absY] = row.join('')
      this.cursor.x += 1
      if (this.cursor.x >= this.cols) {
        this.wrapPending = true
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
    for (const ch of ['a', 'b', 'c']) {
      wrapBuf.apply(wrapPredictor.onInput(ch, wrapBuf).write)
    }
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

  it('reconciles_partial_and_ansi_colored_server_echoes', () => {
    const predictor = new TerminalEchoPredictor(() => 1000)
    const buf = new FakeBuffer(80, ['$ '], { absY: 0, x: 2 })

    for (const ch of ['g', 'i', 't']) {
      buf.apply(predictor.onInput(ch, buf).write)
    }
    expect(buf.getLineText(0)).toBe('$ git')

    // Server sends ANSI-colored partial echo 'gi'
    const prefix1 = predictor.beforeServerWrite(80)
    expect(prefix1.length).toBeGreaterThan(0)
    expect(predictor.getSnapshot().predictionsRendered).toBe(false)
    expect(predictor.getSnapshot().pendingServerWrites).toBe(1)

    buf.apply(prefix1 + '\x1b[32mgi\x1b[0m')
    expect(buf.getLineText(0)).toBe('$ gi')
    expect(buf.cursor).toEqual({ absY: 0, x: 4 })

    const after1 = predictor.afterServerWrite(buf)
    expect(after1.write).toBe('t')
    expect(after1.cancelUnderlineTimer).toBe(false)
    expect(predictor.getSnapshot().pendingCount).toBe(1)
    expect(predictor.getSnapshot().predictionsRendered).toBe(true)
    buf.apply(after1.write)
    expect(buf.getLineText(0)).toBe('$ git')
    expect(buf.cursor).toEqual({ absY: 0, x: 5 })

    // Server sends final colored 't'
    const prefix2 = predictor.beforeServerWrite(80)
    buf.apply(prefix2 + '\x1b[32mt\x1b[0m')
    const after2 = predictor.afterServerWrite(buf)
    expect(after2).toEqual({ write: '', armUnderlineTimer: false, cancelUnderlineTimer: true })
    expect(predictor.getSnapshot().pendingCount).toBe(0)
    expect(predictor.getSnapshot().predictionsRendered).toBe(false)
    expect(buf.getLineText(0)).toBe('$ git')
    expect(buf.cursor).toEqual({ absY: 0, x: 5 })
  })

  it('wraps_across_cols_on_beforeServerWrite_and_reconciles_tail', () => {
    const predictor = new TerminalEchoPredictor(() => 1000)
    const buf = new FakeBuffer(10, ['01234567'], { absY: 0, x: 8 })

    buf.apply(predictor.onInput('abcd', buf).write)
    expect(buf.getLineText(0)).toBe('01234567ab')
    expect(buf.getLineText(1)).toBe('cd')

    const prefix1 = predictor.beforeServerWrite(10)
    buf.apply(prefix1 + 'ab')
    expect(buf.getLineText(0)).toBe('01234567ab')
    expect(buf.getLineText(1)).toBe('')

    const after1 = predictor.afterServerWrite(buf)
    expect(after1.write).toBe('cd')
    buf.apply(after1.write)
    expect(buf.getLineText(1)).toBe('cd')
    expect(buf.cursor).toEqual({ absY: 1, x: 2 })

    const prefix2 = predictor.beforeServerWrite(10)
    buf.apply(prefix2 + 'cd')
    const after2 = predictor.afterServerWrite(buf)
    expect(after2.write).toBe('')
    expect(after2.cancelUnderlineTimer).toBe(true)
    expect(predictor.getSnapshot().pendingCount).toBe(0)
  })

  it('backspace_over_confirmed_chars_losslessly_restores_on_rewind', () => {
    let now = 1000
    const predictor = new TerminalEchoPredictor(() => now)
    const buf = new FakeBuffer(80, ['$ '], { absY: 0, x: 2 })

    // Confirm 'ls' so confirmedLineChars === 2
    for (const ch of ['l', 's']) {
      buf.apply(predictor.onInput(ch, buf).write)
    }
    const pConfirm = predictor.beforeServerWrite(80)
    buf.apply(pConfirm + 'ls')
    predictor.afterServerWrite(buf)
    expect(buf.getLineText(0)).toBe('$ ls')
    expect(buf.cursor).toEqual({ absY: 0, x: 4 })

    // Speculative backspace with '\x7f' erases 's' locally
    const bs1 = predictor.onInput('\x7f', buf)
    expect(bs1.write).toBe('\b \b')
    buf.apply(bs1.write)
    expect(buf.getLineText(0)).toBe('$ l')
    expect(buf.cursor).toEqual({ absY: 0, x: 3 })

    // Rewind before server's real '\b \b' arrives must restore 's'
    const prefix1 = predictor.beforeServerWrite(80)
    expect(predictor.getSnapshot().predictionsRendered).toBe(false)
    expect(predictor.getSnapshot().pendingServerWrites).toBe(1)
    buf.apply(prefix1)
    expect(buf.getLineText(0)).toBe('$ ls')
    expect(buf.cursor).toEqual({ absY: 0, x: 4 })

    // Server applies real backspace and reconciles cleanly
    buf.apply('\b \b')
    const after1 = predictor.afterServerWrite(buf)
    expect(after1).toEqual({ write: '', armUnderlineTimer: false, cancelUnderlineTimer: false })
    expect(predictor.getSnapshot().predictionsRendered).toBe(false)
    expect(buf.getLineText(0)).toBe('$ l')
    expect(buf.cursor).toEqual({ absY: 0, x: 3 })

    // Now test '\b' over remaining confirmed char 'l', plus underline timeout with pendingBackspaces
    const bs2 = predictor.onInput('\b', buf)
    expect(bs2.write).toBe('\b \b')
    buf.apply(bs2.write)
    expect(buf.getLineText(0)).toBe('$')
    expect(buf.cursor).toEqual({ absY: 0, x: 2 })

    // At confirmedLineChars === 0, another '\b' must NOT erase the prompt
    const bsPrompt = predictor.onInput('\b', buf)
    expect(bsPrompt.write).toBe('')
    expect(buf.getLineText(0)).toBe('$')

    // Type 'a' after confirmed backspace and trigger 100ms underline timeout
    buf.apply(predictor.onInput('a', buf).write)
    expect(buf.getLineText(0)).toBe('$ a')
    now += 100
    const ul = predictor.applyUnderlineTimeout(80)
    expect(ul).toContain('\x1b[4ma\x1b[24m')
    buf.apply(ul)
    expect(buf.getLineText(0)).toBe('$ a')
    expect(buf.cursor).toEqual({ absY: 0, x: 3 })

    // Rewind before server write still restores 'l' so server's '\b \ba' applies cleanly
    const prefix2 = predictor.beforeServerWrite(80)
    buf.apply(prefix2)
    expect(buf.getLineText(0)).toBe('$ l')
    expect(buf.cursor).toEqual({ absY: 0, x: 3 })

    buf.apply('\b \ba')
    const after2 = predictor.afterServerWrite(buf)
    expect(after2.write).toBe('')
    expect(after2.cancelUnderlineTimer).toBe(true)
    expect(buf.getLineText(0)).toBe('$ a')
    expect(buf.cursor).toEqual({ absY: 0, x: 3 })
  })

  it('overlapping_server_writes_do_not_double_rewind_or_prematurely_render', () => {
    const predictor = new TerminalEchoPredictor(() => 1000)
    const buf = new FakeBuffer(80, ['$ '], { absY: 0, x: 2 })

    for (const ch of ['g', 'i', 't']) {
      buf.apply(predictor.onInput(ch, buf).write)
    }

    const prefix1 = predictor.beforeServerWrite(80)
    expect(prefix1.length).toBeGreaterThan(0)
    expect(predictor.getSnapshot().predictionsRendered).toBe(false)
    expect(predictor.getSnapshot().pendingServerWrites).toBe(1)

    const prefix2 = predictor.beforeServerWrite(80)
    expect(prefix2).toBe('')
    expect(predictor.getSnapshot().predictionsRendered).toBe(false)
    expect(predictor.getSnapshot().pendingServerWrites).toBe(2)

    buf.apply(prefix1 + 'g')
    const after1 = predictor.afterServerWrite(buf)
    expect(after1).toEqual({ write: '', armUnderlineTimer: false, cancelUnderlineTimer: false })
    expect(predictor.getSnapshot().pendingServerWrites).toBe(1)
    expect(predictor.getSnapshot().predictionsRendered).toBe(false)

    buf.apply(prefix2 + 'i')
    const after2 = predictor.afterServerWrite(buf)
    expect(after2.write).toBe('t')
    expect(predictor.getSnapshot().pendingServerWrites).toBe(0)
    expect(predictor.getSnapshot().predictionsRendered).toBe(true)
    expect(predictor.getSnapshot().pendingCount).toBe(1)

    buf.apply(after2.write)
    expect(buf.getLineText(0)).toBe('$ git')
  })

  it('enter_keeps_pending_command_visible_until_server_newline_arrives', () => {
    const predictor = new TerminalEchoPredictor(() => 1000)
    const buf = new FakeBuffer(80, ['$ '], { absY: 0, x: 2 })

    buf.apply(predictor.onInput('l', buf).write)
    buf.apply(predictor.onInput('s', buf).write)

    const enter = predictor.onInput('\r', buf)
    expect(enter).toEqual({ write: '', armUnderlineTimer: false, cancelUnderlineTimer: false })
    expect(buf.getLineText(0)).toBe('$ ls')

    const prefix = predictor.beforeServerWrite(80)
    expect(prefix.length).toBeGreaterThan(0)
    buf.apply(prefix + 'ls\r\nfile.txt\r\n$ ')

    const after = predictor.afterServerWrite(buf)
    expect(after).toEqual({ write: '', armUnderlineTimer: false, cancelUnderlineTimer: true })
    expect(predictor.getSnapshot()).toEqual({
      mode: 'active',
      pendingCount: 0,
      underlined: false,
      predictionsRendered: false,
      pendingServerWrites: 0,
    })

    // Subsequent typing predicts immediately
    const next = predictor.onInput('p', buf)
    expect(next.write).toBe('p')
  })

  it('pauses_on_alternate_buffer_and_resumes_on_normal_buffer', () => {
    const predictor = new TerminalEchoPredictor(() => 1000)
    const buf = new FakeBuffer(80, ['$ '], { absY: 0, x: 2 })

    buf.apply(predictor.onInput('v', buf).write)

    const prefix1 = predictor.beforeServerWrite(80)
    buf.apply(prefix1)
    buf.type = 'alternate'
    const altAfter = predictor.afterServerWrite(buf)
    expect(altAfter.cancelUnderlineTimer).toBe(true)
    expect(predictor.getSnapshot().mode).toBe('paused_alt')
    expect(predictor.getSnapshot().pendingCount).toBe(0)

    expect(predictor.onInput('j', buf).write).toBe('')
    expect(predictor.getSnapshot().mode).toBe('paused_alt')

    const prefix2 = predictor.beforeServerWrite(80)
    expect(prefix2).toBe('')
    buf.type = 'normal'
    const normAfter = predictor.afterServerWrite(buf)
    expect(normAfter).toEqual({ write: '', armUnderlineTimer: false, cancelUnderlineTimer: false })
    expect(predictor.getSnapshot().mode).toBe('active')

    expect(predictor.onInput('l', buf).write).toBe('l')
  })

  it('pauses_on_password_prompt_and_multi_chunk_sudo_retry_never_leaks', () => {
    const predictor = new TerminalEchoPredictor(() => 1000)
    const buf = new FakeBuffer(80, [''], { absY: 0, x: 0 })

    // Server prints sudo password prompt
    buf.apply(predictor.beforeServerWrite(80) + '[sudo] password for dev: ')
    predictor.afterServerWrite(buf)
    expect(predictor.getSnapshot().mode).toBe('paused_password')

    // User enters first secret + Enter -> zero local echo
    for (const ch of ['b', 'a', 'd', '\r']) {
      expect(predictor.onInput(ch, buf).write).toBe('')
    }

    // Chunk 1 of retry: 'Sorry, try again.\r\n'
    buf.apply(predictor.beforeServerWrite(80) + '\r\nSorry, try again.\r\n')
    predictor.afterServerWrite(buf)
    expect(predictor.getSnapshot().mode).toBe('paused_password')

    // Even if user types before Chunk 2 arrives (then hits Ctrl+C or Chunk 2 arrives), never leaks
    expect(predictor.onInput('x', buf).write).toBe('')
    expect(predictor.onInput('\x03', buf).write).toBe('')

    // Chunk 2 of retry: '[sudo] password for dev: '
    buf.apply(predictor.beforeServerWrite(80) + '[sudo] password for dev: ')
    predictor.afterServerWrite(buf)
    expect(predictor.getSnapshot().mode).toBe('paused_password')

    // Retried secret + Enter -> zero local echo
    for (const ch of ['g', 'o', 'o', 'd', '\r']) {
      expect(predictor.onInput(ch, buf).write).toBe('')
    }

    // Normal shell prompt returns -> stays paused until silentProbe confirms echo
    buf.apply(predictor.beforeServerWrite(80) + '\r\ndev@box:~$ ')
    predictor.afterServerWrite(buf)
    expect(predictor.getSnapshot().mode).toBe('paused_password')

    // Non-printable input after a silentProbe char resets both probe and anchor cleanly
    expect(predictor.onInput('q', buf).write).toBe('')
    expect(predictor.onInput('\x7f', buf).write).toBe('')
    buf.apply(predictor.beforeServerWrite(80) + ' ')
    predictor.afterServerWrite(buf)

    // Typing 'l' re-records anchor at new cursor and waits silently for server echo
    const firstChar = predictor.onInput('l', buf)
    expect(firstChar.write).toBe('')
    expect(predictor.getSnapshot().mode).toBe('paused_password')

    // Server echoes 'l' -> re-arms 'active'
    buf.apply(predictor.beforeServerWrite(80) + 'l')
    predictor.afterServerWrite(buf)
    expect(predictor.getSnapshot().mode).toBe('active')

    // Typing 's' now predicts at 0ms
    const secondChar = predictor.onInput('s', buf)
    expect(secondChar.write).toBe('s')
    expect(secondChar.armUnderlineTimer).toBe(true)
  })

  it('output_only_paused_noecho_on_unrecognized_secret_prompt', () => {
    let now = 1000
    const predictor = new TerminalEchoPredictor(() => now)
    const buf = new FakeBuffer(80, ['Custom key: '], { absY: 0, x: 12 })

    for (const ch of ['s', 'e', 'c']) {
      buf.apply(predictor.onInput(ch, buf).write)
    }

    // Slow server (>2s) never switches to paused_noecho without output
    now += 2500
    const ul = predictor.applyUnderlineTimeout(80)
    expect(ul).toContain('\x1b[4msec\x1b[24m')
    buf.apply(ul)
    expect(predictor.getSnapshot().mode).toBe('active')

    expect(predictor.onInput('\r', buf).write).toBe('')

    // Server responds with newline only (echo disabled)
    const prefix = predictor.beforeServerWrite(80)
    buf.apply(prefix + '\r\n')
    expect(buf.getLineText(0)).toBe('Custom key:')

    const after = predictor.afterServerWrite(buf)
    expect(after).toEqual({ write: '', armUnderlineTimer: false, cancelUnderlineTimer: true })
    expect(predictor.getSnapshot().mode).toBe('paused_noecho')
    expect(predictor.getSnapshot().pendingCount).toBe(0)

    // Subsequent typing does not echo locally
    expect(predictor.onInput('x', buf).write).toBe('')
  })

  it('reset_clears_all_state_to_active_for_shell_restart', () => {
    const predictor = new TerminalEchoPredictor(() => 1000)
    const buf = new FakeBuffer(80, ['[sudo] password for dev: '], { absY: 0, x: 25 })

    predictor.beforeServerWrite(80)
    predictor.afterServerWrite(buf)
    expect(predictor.getSnapshot().mode).toBe('paused_password')

    predictor.beforeServerWrite(80)
    expect(predictor.getSnapshot().pendingServerWrites).toBe(1)

    predictor.reset()
    expect(predictor.getSnapshot()).toEqual({
      mode: 'active',
      pendingCount: 0,
      underlined: false,
      predictionsRendered: false,
      pendingServerWrites: 0,
    })

    const promptBuf = new FakeBuffer(80, ['$ '], { absY: 0, x: 2 })
    expect(predictor.onInput('a', promptBuf).write).toBe('a')
  })

  it('reconciles_multi_backspace_and_replacement_char_in_single_server_chunk', () => {
    const predictor = new TerminalEchoPredictor(() => 1000)
    const buf = new FakeBuffer(80, ['$ '], { absY: 0, x: 2 })

    for (const ch of ['l', 's']) {
      buf.apply(predictor.onInput(ch, buf).write)
    }
    buf.apply(predictor.beforeServerWrite(80) + 'ls')
    predictor.afterServerWrite(buf)

    // Backspace both confirmed chars and type replacement 'c'
    buf.apply(predictor.onInput('\x7f', buf).write)
    buf.apply(predictor.onInput('\x7f', buf).write)
    buf.apply(predictor.onInput('c', buf).write)
    expect(buf.getLineText(0)).toBe('$ c')
    expect(buf.cursor).toEqual({ absY: 0, x: 3 })

    // Rewind restores 'ls', then server echoes '\b \b\b \bc' in one chunk
    const prefix = predictor.beforeServerWrite(80)
    buf.apply(prefix)
    expect(buf.getLineText(0)).toBe('$ ls')
    expect(buf.cursor).toEqual({ absY: 0, x: 4 })

    buf.apply('\b \b\b \bc')
    const after = predictor.afterServerWrite(buf)
    expect(after).toEqual({ write: '', armUnderlineTimer: false, cancelUnderlineTimer: true })
    expect(predictor.getSnapshot().pendingCount).toBe(0)
    expect(predictor.getSnapshot().predictionsRendered).toBe(false)
    expect(buf.getLineText(0)).toBe('$ c')
    expect(buf.cursor).toEqual({ absY: 0, x: 3 })

    // Subsequent beforeServerWrite must not restore old 'l' over 'c'
    expect(predictor.beforeServerWrite(80)).toBe('')
    predictor.afterServerWrite(buf)
    expect(buf.getLineText(0)).toBe('$ c')

    // Confirmed budget is 1 ('c'), so one backspace is allowed and a second stops at '$ '
    expect(predictor.onInput('\x7f', buf).write).toBe('\b \b')
    expect(predictor.onInput('\x7f', buf).write).toBe('')
  })

  it('confirmed_backspace_reconciliation_clears_predictions_rendered_without_spurious_rewind', () => {
    const predictor = new TerminalEchoPredictor(() => 1000)
    const buf = new FakeBuffer(80, ['$ '], { absY: 0, x: 2 })

    for (const ch of ['l', 's']) {
      buf.apply(predictor.onInput(ch, buf).write)
    }
    buf.apply(predictor.beforeServerWrite(80) + 'ls')
    predictor.afterServerWrite(buf)

    buf.apply(predictor.onInput('\x7f', buf).write)
    // Simulate server applying real backspace AND drawing RPROMPT to the right of the cursor
    buf.apply(predictor.beforeServerWrite(80) + '\b \b\x1b[11GRPROMPT\x1b[4G')
    const after = predictor.afterServerWrite(buf)
    expect(after).toEqual({ write: '', armUnderlineTimer: false, cancelUnderlineTimer: false })
    expect(predictor.getSnapshot().predictionsRendered).toBe(false)
    expect(buf.getLineText(0)).toBe('$ l       RPROMPT')

    // Next server write must not emit \x1b[K that would wipe RPROMPT
    const nextPrefix = predictor.beforeServerWrite(80)
    expect(nextPrefix).toBe('')
    buf.apply(nextPrefix)
    expect(buf.getLineText(0)).toBe('$ l       RPROMPT')
  })

  it('chunked_command_echo_before_newline_keeps_awaiting_newline_confirm', () => {
    const predictor = new TerminalEchoPredictor(() => 1000)
    const buf = new FakeBuffer(80, ['$ '], { absY: 0, x: 2 })

    buf.apply(predictor.onInput('l', buf).write)
    buf.apply(predictor.onInput('s', buf).write)
    expect(predictor.onInput('\r', buf).write).toBe('')

    // Chunk 1 echoes 'ls' before '\r\n' arrives
    const prefix1 = predictor.beforeServerWrite(80)
    buf.apply(prefix1 + 'ls')
    const after1 = predictor.afterServerWrite(buf)
    expect(after1).toEqual({ write: '', armUnderlineTimer: false, cancelUnderlineTimer: true })
    expect(predictor.getSnapshot().pendingCount).toBe(0)
    expect(predictor.getSnapshot().predictionsRendered).toBe(false)

    // Before '\r\n' arrives, keystrokes and backspaces must NOT predict onto or erase 'ls'
    expect(predictor.onInput('x', buf).write).toBe('')
    expect(predictor.onInput('\x7f', buf).write).toBe('')
    expect(buf.getLineText(0)).toBe('$ ls')

    // Chunk 2 delivers '\r\n$ ' -> re-enables prediction on the new prompt
    expect(predictor.beforeServerWrite(80)).toBe('')
    buf.apply('\r\n$ ')
    const after2 = predictor.afterServerWrite(buf)
    expect(after2).toEqual({ write: '', armUnderlineTimer: false, cancelUnderlineTimer: false })
    expect(predictor.onInput('p', buf).write).toBe('p')
  })

  it('confirmed_backspace_rewind_from_deferred_wrap_preserves_wrap_cursor', () => {
    let now = 1000
    const predictor = new TerminalEchoPredictor(() => now)
    const buf = new FakeBuffer(10, ['', ''], { absY: 1, x: 0 })

    // Confirm 10 chars filling row 1 (cols = 10) -> cursor enters deferred wrap at (1, 10)
    for (const ch of '0123456789') {
      buf.apply(predictor.onInput(ch, buf).write)
    }
    buf.apply(predictor.beforeServerWrite(10) + '0123456789')
    predictor.afterServerWrite(buf)
    expect(buf.cursor).toEqual({ absY: 1, x: 10 })

    // Speculative backspace erases '9' at (1, 9)
    const bs = predictor.onInput('\x7f', buf)
    expect(bs.write).toBe('\x1b[10G \x1b[10G')
    buf.apply(bs.write)
    expect(buf.getLineText(1)).toBe('012345678')
    expect(buf.cursor).toEqual({ absY: 1, x: 9 })

    // Rewind restores '9' and must preserve deferred wrap at (1, 10), not move to (2, 0)
    const prefix = predictor.beforeServerWrite(10)
    buf.apply(prefix)
    expect(buf.getLineText(1)).toBe('0123456789')
    expect(buf.cursor).toEqual({ absY: 1, x: 10 })

    // Server's real erase at col 10 reconciles cleanly
    buf.apply('\x1b[10G \x1b[10G')
    const after = predictor.afterServerWrite(buf)
    expect(after).toEqual({ write: '', armUnderlineTimer: false, cancelUnderlineTimer: false })
    expect(predictor.getSnapshot().predictionsRendered).toBe(false)
    expect(buf.getLineText(1)).toBe('012345678')
    expect(buf.cursor).toEqual({ absY: 1, x: 9 })

    // Verify underline timeout with pendingBackspaces from deferred wrap on row 1 (absY = 1)
    const buf2 = new FakeBuffer(10, ['', ''], { absY: 1, x: 0 })
    const p2 = new TerminalEchoPredictor(() => now)
    for (const ch of '0123456789') {
      buf2.apply(p2.onInput(ch, buf2).write)
    }
    buf2.apply(p2.beforeServerWrite(10) + '0123456789')
    p2.afterServerWrite(buf2)
    buf2.apply(p2.onInput('\x7f', buf2).write)
    buf2.apply(p2.onInput('x', buf2).write)
    now += 100
    const ul = p2.applyUnderlineTimeout(10)
    buf2.apply(ul)
    expect(buf2.getLineText(1)).toBe('012345678x')
    expect(buf2.cursor).toEqual({ absY: 1, x: 10 })
  })

  it('extract_confirmed_text_preserves_trailing_spaces_across_line_wrap', () => {
    // Case A: space right at cols - 1 wraps before 'a'
    const p1 = new TerminalEchoPredictor(() => 1000)
    const buf1 = new FakeBuffer(10, ['012345678'], { absY: 0, x: 9 })
    buf1.apply(p1.onInput(' ', buf1).write)
    buf1.apply(p1.onInput('a', buf1).write)
    expect(buf1.cursor).toEqual({ absY: 1, x: 1 })

    buf1.apply(p1.beforeServerWrite(10) + ' a')
    const after1 = p1.afterServerWrite(buf1)
    expect(after1).toEqual({ write: '', armUnderlineTimer: false, cancelUnderlineTimer: true })
    expect(p1.getSnapshot().mode).toBe('active')
    expect(p1.getSnapshot().pendingCount).toBe(0)

    // Case B: 'a b' wraps with space at cols - 1 while 'c' remains pending
    const p2 = new TerminalEchoPredictor(() => 1000)
    const buf2 = new FakeBuffer(10, ['01234567'], { absY: 0, x: 8 })
    for (const ch of ['a', ' ', 'b', 'c']) {
      buf2.apply(p2.onInput(ch, buf2).write)
    }
    buf2.apply(p2.beforeServerWrite(10) + 'a b')
    const after2 = p2.afterServerWrite(buf2)
    expect(after2.write).toBe('c')
    expect(p2.getSnapshot().mode).toBe('active')
    expect(p2.getSnapshot().pendingCount).toBe(1)
  })
})
