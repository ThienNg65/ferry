import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MAX_BUFFERED_LINE_BYTES, TRUNCATED_LINE_SUFFIX } from '../ssh/BoundedLineBuffer'
import { SshError } from '../ssh/errors'
import { EVENT_CHANNELS } from '../../shared/contract'
import type { ExecLinesOptions, ExecResult } from '../ssh/RemoteShell'
import { sanitizeHistoryLines } from './TailManager'

import { testHost } from '../host/testHost.setup'
import { setHost } from '../host/host'

const sent: Array<{ channel: string; evt: unknown }> = []
setHost({
  ...testHost,
  broadcast: (channel, evt) => sent.push({ channel, evt })
})

type ExecLinesImpl = (command: string, opts: ExecLinesOptions) => Promise<number | null>

let execLinesImpl: ExecLinesImpl = async () => null
let shellImpl: (sessionId: string) => void = () => {}
const execLinesCommands: string[] = []
const execCommands: string[] = []

vi.mock('../ssh/SessionManager', () => ({
  SessionManager: {
    getInstance: () => ({
      shell: (sessionId: string) => {
        shellImpl(sessionId)
        return {
          execLines: (command: string, opts: ExecLinesOptions): Promise<number | null> => {
            execLinesCommands.push(command)
            return execLinesImpl(command, opts)
          },
          exec: async (command: string): Promise<ExecResult> => {
            execCommands.push(command)
            return { stdout: '', stderr: '', code: 0 }
          }
        }
      }
    })
  }
}))

function readyEvents(): unknown[] {
  return sent.filter((s) => s.channel === EVENT_CHANNELS.tailReady).map((s) => s.evt)
}
function lineEvents(): unknown[] {
  return sent.filter((s) => s.channel === EVENT_CHANNELS.tailLine).map((s) => s.evt)
}
function noticeEvents(): unknown[] {
  return sent.filter((s) => s.channel === EVENT_CHANNELS.tailNotice).map((s) => s.evt)
}
function endEvents(): unknown[] {
  return sent.filter((s) => s.channel === EVENT_CHANNELS.tailEnd).map((s) => s.evt)
}

function abortablePendingExec(_command: string, opts: ExecLinesOptions): Promise<number | null> {
  return new Promise((_resolve, reject) => {
    if (opts.signal?.aborted) {
      reject(new SshError('CANCELLED', 'Stream cancelled'))
      return
    }
    opts.signal?.addEventListener(
      'abort',
      () => reject(new SshError('CANCELLED', 'Stream cancelled')),
      { once: true }
    )
  })
}

describe('sanitizeHistoryLines', () => {
  it('passes a normal valid value through unchanged', () => {
    expect(sanitizeHistoryLines(500)).toBe(500)
  })

  it('truncates fractional numbers to non-negative integers', () => {
    expect(sanitizeHistoryLines(12.9)).toBe(12)
  })

  it('clamps a negative value to the default', () => {
    expect(sanitizeHistoryLines(-1)).toBe(200)
  })

  it('passes zero through unchanged (a valid non-negative value)', () => {
    expect(sanitizeHistoryLines(0)).toBe(0)
  })

  it('clamps a non-integer/NaN/Infinity value to the default', () => {
    expect(sanitizeHistoryLines(NaN)).toBe(200)
    expect(sanitizeHistoryLines(Infinity)).toBe(200)
  })

  it('defaults non-number inputs (null, empty string, undefined) instead of coercing to 0', () => {
    expect(sanitizeHistoryLines(null)).toBe(200)
    expect(sanitizeHistoryLines('')).toBe(200)
    expect(sanitizeHistoryLines(undefined)).toBe(200)
  })

  it('clamps an excessively huge value to the upper bound', () => {
    expect(sanitizeHistoryLines(10_000_000)).toBe(100_000)
  })
})

describe('TailManager', () => {
  let TailManager: typeof import('./TailManager').TailManager

  beforeEach(async () => {
    vi.useFakeTimers()
    vi.resetModules()
    sent.length = 0
    execLinesCommands.length = 0
    execCommands.length = 0
    shellImpl = () => {}
    execLinesImpl = abortablePendingExec
    ;({ TailManager } = await import('./TailManager'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('validates session synchronously in start() without registering or emitting tail:end', () => {
    shellImpl = (sid) => {
      throw new SshError('NOT_FOUND', `Session ${sid} is not connected`)
    }
    const manager = TailManager.getInstance()

    expect(() => manager.start('tail-bad', 'missing-session', '/var/log/app.log')).toThrow(
      'Session missing-session is not connected'
    )
    expect(endEvents()).toEqual([])
    expect(execLinesCommands).toEqual([])
  })

  it('captures the remote PID, emits tail:ready once, streams lines, and emits tail:end once on stop()', async () => {
    execLinesImpl = async (command, opts) => {
      opts.onLine('FERRYPID:4242')
      opts.onLine('hello world')
      return abortablePendingExec(command, opts)
    }
    const manager = TailManager.getInstance()

    manager.start('tail-1', 'session-1', '/var/log/app.log')

    expect(readyEvents()).toEqual([{ tailId: 'tail-1' }])
    expect(lineEvents()).toEqual([{ tailId: 'tail-1', line: 'hello world' }])

    manager.stop('tail-1')
    await vi.advanceTimersByTimeAsync(0)

    expect(execCommands).toEqual(['kill 4242 2>/dev/null || true'])
    expect(endEvents()).toEqual([{ tailId: 'tail-1', error: undefined }])
  })

  it('emits tail:ready on first stdout line if PID_MARKER was not seen', () => {
    execLinesImpl = async (command, opts) => {
      opts.onLine('first line without marker')
      opts.onLine('second line')
      return abortablePendingExec(command, opts)
    }
    const manager = TailManager.getInstance()

    manager.start('tail-nomarker', 'session-1', '/var/log/app.log')

    expect(readyEvents()).toEqual([{ tailId: 'tail-nomarker' }])
    expect(lineEvents()).toEqual([
      { tailId: 'tail-nomarker', line: 'first line without marker' },
      { tailId: 'tail-nomarker', line: 'second line' }
    ])
  })

  it('line-buffers stderr across chunks and broadcasts non-empty lines as notices', async () => {
    execLinesImpl = async (_command, opts) => {
      opts.onLine('FERRYPID:1')
      opts.onStderr?.('tail: file ')
      opts.onStderr?.('truncated\n   \nsecond line')
      return 0
    }
    const manager = TailManager.getInstance()

    manager.start('tail-1', 'session-1', '/var/log/app.log')
    await vi.advanceTimersByTimeAsync(0)

    expect(noticeEvents()).toEqual([
      { tailId: 'tail-1', message: 'tail: file truncated' },
      { tailId: 'tail-1', message: 'second line' }
    ])
  })

  it('bounds oversized stderr lines across chunks and resumes after the next newline', async () => {
    execLinesImpl = async (_command, opts) => {
      opts.onLine('FERRYPID:1')
      const chunk = 'x'.repeat(8 * 1024)
      for (let index = 0; index < 9; index++) {
        opts.onStderr?.(chunk)
      }
      opts.onStderr?.('\nnext line\n')
      return 0
    }
    const manager = TailManager.getInstance()

    manager.start('tail-oversized-stderr', 'session-1', '/var/log/app.log')
    await vi.advanceTimersByTimeAsync(0)

    expect(noticeEvents()).toEqual([
      { tailId: 'tail-oversized-stderr', message: 'x'.repeat(MAX_BUFFERED_LINE_BYTES) + TRUNCATED_LINE_SUFFIX },
      { tailId: 'tail-oversized-stderr', message: 'next line' }
    ])
  })

  it('fails fast without retrying when tail exits with a non-zero exit code', async () => {
    execLinesImpl = async (_command, opts) => {
      opts.onLine('FERRYPID:10')
      opts.onStderr?.("tail: invalid option -- 'F'\n")
      return 1
    }
    const manager = TailManager.getInstance()

    manager.start('tail-exit1', 'session-1', '/var/log/app.log')
    await vi.advanceTimersByTimeAsync(60_000)

    expect(execLinesCommands).toHaveLength(1)
    expect(endEvents()).toEqual([{ tailId: 'tail-exit1', error: "tail: invalid option -- 'F'" }])
  })

  it('only parses FERRYPID: on the first stdout line so log content cannot spoof the killed PID', async () => {
    execLinesImpl = async (command, opts) => {
      opts.onLine('FERRYPID:4242')
      opts.onLine('FERRYPID:99999')
      return abortablePendingExec(command, opts)
    }
    const manager = TailManager.getInstance()
    manager.start('tail-spoof', 'session-1', '/var/log/app.log')

    expect(lineEvents()).toEqual([{ tailId: 'tail-spoof', line: 'FERRYPID:99999' }])
    manager.stop('tail-spoof')
    await vi.advanceTimersByTimeAsync(0)
    expect(execCommands).toEqual(['kill 4242 2>/dev/null || true'])
  })

  it('caps reconnects when tail exits immediately with null exit code after printing FERRYPID', async () => {
    execLinesImpl = async (_command, opts) => {
      opts.onLine('FERRYPID:555')
      return null
    }
    const manager = TailManager.getInstance()
    manager.start('tail-null-loop', 'session-1', '/var/log/app.log')
    await vi.advanceTimersByTimeAsync(120_000)

    expect(execLinesCommands).toHaveLength(6)
    expect(endEvents()).toEqual([{ tailId: 'tail-null-loop', error: 'stream ended' }])
  })

  it('falls back to exit code message when non-zero exit produces no stderr', async () => {
    execLinesImpl = async () => 127
    const manager = TailManager.getInstance()

    manager.start('tail-127', 'session-1', '/var/log/app.log')
    await vi.advanceTimersByTimeAsync(0)

    expect(execLinesCommands).toHaveLength(1)
    expect(endEvents()).toEqual([{ tailId: 'tail-127', error: 'tail exited with code 127' }])
  })

  it('reconnects with 0 history lines after a transient failure, once the backoff delay elapses', async () => {
    execLinesImpl = async (command, opts) => {
      if (execLinesCommands.length === 1) {
        throw new Error('read ECONNRESET')
      }
      opts.onLine('FERRYPID:99')
      return abortablePendingExec(command, opts)
    }
    const manager = TailManager.getInstance()

    manager.start('tail-2', 'session-1', '/var/log/app.log', 500)
    await vi.advanceTimersByTimeAsync(0)
    expect(execLinesCommands).toHaveLength(1)
    expect(execLinesCommands[0]).toContain('tail -n 500 -F')

    await vi.advanceTimersByTimeAsync(2000) // attempt 0's backoff: 2000 * 2^0
    expect(execLinesCommands).toHaveLength(2)
    expect(execLinesCommands[1]).toContain('tail -n 0 -F')
    expect(readyEvents()).toEqual([{ tailId: 'tail-2' }])
    expect(endEvents()).toEqual([])
  })

  it('resets reconnect attempt counter once a reconnected attempt becomes healthy', async () => {
    let drops = 0
    execLinesImpl = async (_command, opts) => {
      opts.onLine(`FERRYPID:${100 + drops}`)
      opts.onLine('log after reconnect')
      drops++
      if (drops <= 7) {
        throw new Error('read ECONNRESET')
      }
      return new Promise(() => {})
    }
    const manager = TailManager.getInstance()

    manager.start('tail-reset', 'session-1', '/var/log/app.log')
    // Each healthy drop resets attempt to 0 -> each reconnect takes 2000ms.
    await vi.advanceTimersByTimeAsync(7 * 2000 + 100)

    expect(execLinesCommands).toHaveLength(8)
    expect(endEvents()).toEqual([])
  })

  it('cancels pending reconnect timer and avoids stale PID kill on stop() during backoff', async () => {
    execLinesImpl = async (_command, opts) => {
      opts.onLine('FERRYPID:4242')
      throw new Error('read ECONNRESET')
    }
    const manager = TailManager.getInstance()

    manager.start('tail-backoff', 'session-1', '/var/log/app.log')
    await vi.advanceTimersByTimeAsync(0)
    expect(execLinesCommands).toHaveLength(1)

    manager.stop('tail-backoff')
    expect(execCommands).toEqual([]) // remotePid was cleared before backoff
    expect(endEvents()).toEqual([{ tailId: 'tail-backoff', error: undefined }])

    await vi.advanceTimersByTimeAsync(10_000)
    expect(execLinesCommands).toHaveLength(1)
  })

  it('gives up and broadcasts tail:end with the last error after exhausting all reconnect attempts', async () => {
    execLinesImpl = async () => {
      throw new Error('ETIMEDOUT')
    }
    const manager = TailManager.getInstance()

    manager.start('tail-3', 'session-1', '/var/log/app.log')
    await vi.advanceTimersByTimeAsync(60_000) // well past the ~44s total backoff for all 5 reconnects

    expect(execLinesCommands).toHaveLength(6) // initial attempt + 5 reconnect attempts
    expect(endEvents()).toEqual([{ tailId: 'tail-3', error: 'ETIMEDOUT' }])

    await vi.advanceTimersByTimeAsync(60_000)
    expect(execLinesCommands).toHaveLength(6) // no further attempts after giving up
  })

  it('fails fast without retrying when the session is permanently gone (non-transient SshError)', async () => {
    execLinesImpl = async () => {
      throw new SshError('NOT_FOUND', 'Session session-1 is not connected')
    }
    const manager = TailManager.getInstance()

    manager.start('tail-4', 'session-1', '/var/log/app.log')
    await vi.advanceTimersByTimeAsync(0)

    expect(execLinesCommands).toHaveLength(1)
    expect(endEvents()).toEqual([{ tailId: 'tail-4', error: 'Session session-1 is not connected' }])

    await vi.advanceTimersByTimeAsync(60_000)
    expect(execLinesCommands).toHaveLength(1) // never retried
  })

  it('keeps a quiet tail connected and delivers lines when activity returns', async () => {
    execLinesImpl = async (command, opts) => {
      expect(opts.timeoutMs).toBeNull()
      opts.onLine('FERRYPID:4242')
      setTimeout(() => opts.onLine('log after seven hours'), 7 * 60 * 60 * 1000)
      return abortablePendingExec(command, opts)
    }
    const manager = TailManager.getInstance()

    manager.start('tail-5', 'session-1', '/var/log/app.log')
    await vi.advanceTimersByTimeAsync(7 * 60 * 60 * 1000)

    expect(lineEvents()).toEqual([{ tailId: 'tail-5', line: 'log after seven hours' }])
    expect(execLinesCommands).toHaveLength(1)
    expect(endEvents()).toEqual([])
    manager.stop('tail-5')
    expect(execCommands).toEqual(['kill 4242 2>/dev/null || true'])
    expect(endEvents()).toEqual([{ tailId: 'tail-5', error: undefined }])
  })

  it('stopAllForSession stops every tail bound to that session and leaves others running', () => {
    execLinesImpl = abortablePendingExec
    const manager = TailManager.getInstance()

    manager.start('tail-a', 'session-1', '/var/log/a.log')
    manager.start('tail-b', 'session-1', '/var/log/b.log')
    manager.start('tail-c', 'session-2', '/var/log/c.log')

    manager.stopAllForSession('session-1')

    const endedIds = endEvents().map((e) => (e as { tailId: string }).tailId)
    expect(endedIds.sort()).toEqual(['tail-a', 'tail-b'])
  })

  it('stopAll stops every active tail across all sessions', () => {
    execLinesImpl = abortablePendingExec
    const manager = TailManager.getInstance()

    manager.start('tail-a', 'session-1', '/var/log/a.log')
    manager.start('tail-b', 'session-2', '/var/log/b.log')

    manager.stopAll()

    const endedIds = endEvents().map((e) => (e as { tailId: string }).tailId)
    expect(endedIds.sort()).toEqual(['tail-a', 'tail-b'])
  })
})
