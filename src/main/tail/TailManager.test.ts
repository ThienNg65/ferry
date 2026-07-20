import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SshError } from '../ssh/errors'
import { EVENT_CHANNELS } from '../../shared/contract'
import type { ExecLinesOptions, ExecResult } from '../ssh/RemoteShell'

// TailManager broadcasts via BrowserWindow.getAllWindows() — vitest runs
// outside a real Electron process, so mock only that (same pattern as
// OperationRegistry.test.ts).
const sent: Array<{ channel: string; evt: unknown }> = []
vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: () => [
      {
        isDestroyed: () => false,
        webContents: { send: (channel: string, evt: unknown) => sent.push({ channel, evt }) }
      }
    ]
  }
}))

type ExecLinesImpl = (command: string, opts: ExecLinesOptions) => Promise<number | null>

let execLinesImpl: ExecLinesImpl = async () => null
const execLinesCommands: string[] = []
const execCommands: string[] = []

vi.mock('../ssh/SessionManager', () => ({
  SessionManager: {
    getInstance: () => ({
      shell: (_sessionId: string) => ({
        execLines: (command: string, opts: ExecLinesOptions): Promise<number | null> => {
          execLinesCommands.push(command)
          return execLinesImpl(command, opts)
        },
        exec: async (command: string): Promise<ExecResult> => {
          execCommands.push(command)
          return { stdout: '', stderr: '', code: 0 }
        }
      })
    })
  }
}))

function lineEvents(): unknown[] {
  return sent.filter((s) => s.channel === EVENT_CHANNELS.tailLine).map((s) => s.evt)
}
function noticeEvents(): unknown[] {
  return sent.filter((s) => s.channel === EVENT_CHANNELS.tailNotice).map((s) => s.evt)
}
function endEvents(): unknown[] {
  return sent.filter((s) => s.channel === EVENT_CHANNELS.tailEnd).map((s) => s.evt)
}

describe('TailManager', () => {
  let TailManager: typeof import('./TailManager').TailManager

  beforeEach(async () => {
    vi.useFakeTimers()
    vi.resetModules()
    sent.length = 0
    execLinesCommands.length = 0
    execCommands.length = 0
    execLinesImpl = async () => new Promise(() => {}) // hangs by default unless a test overrides it
    ;({ TailManager } = await import('./TailManager'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('captures the remote PID from the marker line, streams lines, and kills the PID on stop()', () => {
    execLinesImpl = async (_command, opts) => {
      opts.onLine('FERRYPID:4242')
      opts.onLine('hello world')
      return new Promise(() => {})
    }
    const manager = TailManager.getInstance()

    manager.start('tail-1', 'session-1', '/var/log/app.log')

    expect(lineEvents()).toEqual([{ tailId: 'tail-1', line: 'hello world' }])

    manager.stop('tail-1')

    expect(execCommands).toEqual(['kill 4242 2>/dev/null || true'])
    expect(endEvents()).toEqual([{ tailId: 'tail-1', error: undefined }])
  })

  it('broadcasts stderr chunks as notices', () => {
    execLinesImpl = async (_command, opts) => {
      opts.onLine('FERRYPID:1')
      opts.onStderr?.('tail: file truncated')
      return new Promise(() => {})
    }
    const manager = TailManager.getInstance()

    manager.start('tail-1', 'session-1', '/var/log/app.log')

    expect(noticeEvents()).toEqual([{ tailId: 'tail-1', message: 'tail: file truncated' }])
  })

  it('reconnects with 0 history lines after a transient failure, once the backoff delay elapses', async () => {
    execLinesImpl = async () => {
      if (execLinesCommands.length === 1) {
        throw new Error('read ECONNRESET')
      }
      return new Promise(() => {})
    }
    const manager = TailManager.getInstance()

    manager.start('tail-2', 'session-1', '/var/log/app.log', 500)
    await vi.advanceTimersByTimeAsync(0)
    expect(execLinesCommands).toHaveLength(1)
    expect(execLinesCommands[0]).toContain('tail -n 500 -F')

    await vi.advanceTimersByTimeAsync(2000) // attempt 0's backoff: 2000 * 2^0
    expect(execLinesCommands).toHaveLength(2)
    expect(execLinesCommands[1]).toContain('tail -n 0 -F')
    expect(endEvents()).toEqual([])
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

  it('reaps a stream once it has been idle past the idle TTL', async () => {
    execLinesImpl = async () => new Promise(() => {}) // no lines ever arrive
    const manager = TailManager.getInstance()

    manager.start('tail-5', 'session-1', '/var/log/app.log')
    await vi.advanceTimersByTimeAsync(30 * 60 * 1000 + 60_000) // IDLE_TTL_MS plus one reaper tick

    expect(endEvents()).toEqual([{ tailId: 'tail-5', error: undefined }])
  })

  it('stopAllForSession stops every tail bound to that session and leaves others running', () => {
    execLinesImpl = async () => new Promise(() => {})
    const manager = TailManager.getInstance()

    manager.start('tail-a', 'session-1', '/var/log/a.log')
    manager.start('tail-b', 'session-1', '/var/log/b.log')
    manager.start('tail-c', 'session-2', '/var/log/c.log')

    manager.stopAllForSession('session-1')

    const endedIds = endEvents().map((e) => (e as { tailId: string }).tailId)
    expect(endedIds.sort()).toEqual(['tail-a', 'tail-b'])
  })
})
