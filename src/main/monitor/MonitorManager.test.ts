import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EVENT_CHANNELS } from '../../shared/contract'

// MonitorManager broadcasts via BrowserWindow.getAllWindows() — vitest runs
// outside a real Electron process, so mock only that (same pattern as
// TailManager.test.ts / TerminalManager.test.ts).
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

interface FakeExecResult {
  stdout: string
  stderr: string
  code: number
}
type ExecImpl = (command: string, opts: { timeoutMs?: number }) => Promise<FakeExecResult>
type ShellFactory = (sessionId: string) => { exec: ExecImpl }

let execImpl: ExecImpl = async () => ({ stdout: validTickOutput(), stderr: '', code: 0 })
let shellFactory: ShellFactory = (_sessionId: string) => ({ exec: (command, opts) => execImpl(command, opts) })
const execCommands: string[] = []

vi.mock('../ssh/SessionManager', () => ({
  SessionManager: {
    getInstance: () => ({
      shell: (sessionId: string) => {
        const { exec } = shellFactory(sessionId)
        return {
          exec: (command: string, opts: { timeoutMs?: number }) => {
            execCommands.push(command)
            return exec(command, opts)
          }
        }
      }
    })
  }
}))

/** Minimal valid tick output: one CPU row, parseable meminfo/loadavg/uptime/disk, no processes. */
function validTickOutput(): string {
  const stat = 'cpu  100 0 100 700 100 0 0 0 0 0'
  const mem = [
    'MemTotal:        8000000 kB',
    'MemFree:         2000000 kB',
    'MemAvailable:    5000000 kB',
    'Buffers:          300000 kB',
    'Cached:          2500000 kB',
    'SwapTotal:       1000000 kB',
    'SwapFree:         750000 kB'
  ].join('\n')
  const load = '0.10 0.20 0.30 1/200 1234'
  const uptime = '12345.67 6789.01'
  const disk = ['Filesystem     1024-blocks   Used  Available Capacity Mounted on', '/dev/sda1        100000000 50000000 45000000  53% /'].join(
    '\n'
  )
  const proc = ''
  return [stat, mem, load, uptime, disk, proc].join('\n@@@\n')
}

/** A tick output whose /proc/stat section is empty — the "not Linux/no procfs" signal. */
function unsupportedTickOutput(): string {
  return ['', 'MemTotal: 100 kB', '0.1 0.1 0.1', '10', '', ''].join('\n@@@\n')
}

function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void } {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function sampleEvents(): unknown[] {
  return sent.filter((s) => s.channel === EVENT_CHANNELS.monitorSample).map((s) => s.evt)
}
function statusEvents(): unknown[] {
  return sent.filter((s) => s.channel === EVENT_CHANNELS.monitorStatus).map((s) => s.evt)
}

describe('MonitorManager', () => {
  let MonitorManager: typeof import('./MonitorManager').MonitorManager

  beforeEach(async () => {
    vi.useFakeTimers()
    vi.resetModules()
    sent.length = 0
    execCommands.length = 0
    execImpl = async () => ({ stdout: validTickOutput(), stderr: '', code: 0 })
    shellFactory = (_sessionId: string) => ({ exec: (command, opts) => execImpl(command, opts) })
    ;({ MonitorManager } = await import('./MonitorManager'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('start() broadcasts "started" and the first tick broadcasts a sample once exec resolves', async () => {
    const manager = MonitorManager.getInstance()

    manager.start('session-1')
    expect(statusEvents()).toEqual([{ sessionId: 'session-1', state: 'started', message: undefined }])

    await vi.advanceTimersByTimeAsync(0)

    expect(execCommands).toHaveLength(1)
    const samples = sampleEvents() as Array<{ sessionId: string; cpu: unknown }>
    expect(samples).toHaveLength(1)
    expect(samples[0].sessionId).toBe('session-1')
    expect(samples[0].cpu).toBeNull() // no prior reading yet on the first tick
  })

  it('reschedules and broadcasts another sample once the configured interval elapses', async () => {
    const manager = MonitorManager.getInstance()

    manager.start('session-1', 5000)
    await vi.advanceTimersByTimeAsync(0)
    expect(execCommands).toHaveLength(1)

    await vi.advanceTimersByTimeAsync(4999)
    expect(execCommands).toHaveLength(1) // not yet

    await vi.advanceTimersByTimeAsync(1)
    expect(execCommands).toHaveLength(2)
    expect(sampleEvents()).toHaveLength(2)
  })

  it('stop() halts future ticks', async () => {
    const manager = MonitorManager.getInstance()

    manager.start('session-1', 1000)
    await vi.advanceTimersByTimeAsync(0)
    expect(execCommands).toHaveLength(1)

    manager.stop('session-1')
    await vi.advanceTimersByTimeAsync(60_000)

    expect(execCommands).toHaveLength(1) // no further ticks after stop()
  })

  it('stop() on a session with no active monitor is a no-op (no status broadcast)', () => {
    const manager = MonitorManager.getInstance()
    manager.stop('never-started')
    expect(statusEvents()).toEqual([])
  })

  it('stopAllForSession is an alias of stop()', async () => {
    const manager = MonitorManager.getInstance()

    manager.start('session-1', 1000)
    await vi.advanceTimersByTimeAsync(0)
    expect(execCommands).toHaveLength(1)

    manager.stopAllForSession('session-1')
    await vi.advanceTimersByTimeAsync(60_000)

    expect(execCommands).toHaveLength(1)
    expect(statusEvents().at(-1)).toEqual({ sessionId: 'session-1', state: 'stopped', message: undefined })
  })

  it('a second start() for the same session restarts cleanly (stops the prior monitor first)', async () => {
    const manager = MonitorManager.getInstance()

    manager.start('session-1', 1000)
    await vi.advanceTimersByTimeAsync(0)
    manager.start('session-1', 1000) // restart — must not leave two competing timer chains
    await vi.advanceTimersByTimeAsync(0)

    execCommands.length = 0
    await vi.advanceTimersByTimeAsync(1000)
    expect(execCommands).toHaveLength(1) // exactly one tick per interval, not two
  })

  it(
    'a stop() that fires while a tick is awaiting exec() suppresses that tick\'s sample/status and does not ' +
      'schedule another timer once the stale exec resolves',
    async () => {
      const inFlight = deferred<FakeExecResult>()
      execImpl = async () => inFlight.promise
      const manager = MonitorManager.getInstance()

      manager.start('session-1', 1000)
      await vi.advanceTimersByTimeAsync(0) // tick starts, is now awaiting exec()
      expect(execCommands).toHaveLength(1)

      manager.stop('session-1')
      sent.length = 0 // clear the 'started'/'stopped' broadcasts already fired synchronously

      inFlight.resolve({ stdout: validTickOutput(), stderr: '', code: 0 })
      await vi.advanceTimersByTimeAsync(0)

      expect(sampleEvents()).toEqual([]) // stale tick must not broadcast
      expect(statusEvents()).toEqual([]) // and must not broadcast any further status either

      // The stale tick also must not have scheduled a follow-up timer.
      await vi.advanceTimersByTimeAsync(60_000)
      expect(execCommands).toHaveLength(1)
    }
  )

  it('reports "unsupported" and stops when /proc/stat is empty (non-Linux remote)', async () => {
    execImpl = async () => ({ stdout: unsupportedTickOutput(), stderr: '', code: 0 })
    const manager = MonitorManager.getInstance()

    manager.start('session-1')
    await vi.advanceTimersByTimeAsync(0)

    expect(statusEvents()).toEqual([
      { sessionId: 'session-1', state: 'started', message: undefined },
      { sessionId: 'session-1', state: 'unsupported', message: 'Resource monitoring requires a Linux /proc filesystem' },
      { sessionId: 'session-1', state: 'stopped', message: undefined } // 'unsupported' internally calls stop()
    ])

    await vi.advanceTimersByTimeAsync(60_000)
    expect(execCommands).toHaveLength(1) // no retry after "unsupported"
  })

  it('gives up and reports "error" after MAX_CONSECUTIVE_FAILURES exec failures in a row', async () => {
    execImpl = async () => {
      throw new Error('ECONNRESET')
    }
    const manager = MonitorManager.getInstance()

    manager.start('session-1', 1000)
    await vi.advanceTimersByTimeAsync(0) // failure 1
    await vi.advanceTimersByTimeAsync(1000) // failure 2
    await vi.advanceTimersByTimeAsync(1000) // failure 3 -> gives up

    expect(execCommands).toHaveLength(3)
    // 'error' internally calls stop(), which broadcasts its own 'stopped' status right after —
    // so 'error' is the second-to-last event, not the last.
    expect(statusEvents().at(-2)).toEqual({ sessionId: 'session-1', state: 'error', message: 'ECONNRESET' })
    expect(statusEvents().at(-1)).toEqual({ sessionId: 'session-1', state: 'stopped', message: undefined })

    await vi.advanceTimersByTimeAsync(60_000)
    expect(execCommands).toHaveLength(3) // no further attempts
  })

  it('recovers after a transient failure without giving up, once a later tick succeeds', async () => {
    let call = 0
    execImpl = async () => {
      call += 1
      if (call === 1) {
        throw new Error('transient')
      }
      return { stdout: validTickOutput(), stderr: '', code: 0 }
    }
    const manager = MonitorManager.getInstance()

    manager.start('session-1', 1000)
    await vi.advanceTimersByTimeAsync(0) // failure 1 (below MAX_CONSECUTIVE_FAILURES)
    await vi.advanceTimersByTimeAsync(1000) // success — resets the failure counter

    expect(execCommands).toHaveLength(2)
    expect(sampleEvents()).toHaveLength(1)
    expect(statusEvents().some((e) => (e as { state: string }).state === 'error')).toBe(false)
  })

  it('stops quietly with no error broadcast when the underlying session is already gone', async () => {
    shellFactory = () => {
      throw new Error('Session session-1 is not connected')
    }
    const manager = MonitorManager.getInstance()

    manager.start('session-1')
    await vi.advanceTimersByTimeAsync(0)

    expect(execCommands).toHaveLength(0)
    expect(statusEvents()).toEqual([
      { sessionId: 'session-1', state: 'started', message: undefined },
      { sessionId: 'session-1', state: 'stopped', message: undefined }
    ])
  })
})

describe('sanitizeIntervalMs', () => {
  let sanitizeIntervalMs: typeof import('./MonitorManager').sanitizeIntervalMs

  beforeEach(async () => {
    vi.resetModules()
    ;({ sanitizeIntervalMs } = await import('./MonitorManager'))
  })

  it('defaults to 2000ms when undefined', () => {
    expect(sanitizeIntervalMs(undefined)).toBe(2000)
  })

  it('passes through a valid in-range value unchanged', () => {
    expect(sanitizeIntervalMs(5000)).toBe(5000)
  })

  it('clamps a too-small value up to the 1000ms floor', () => {
    expect(sanitizeIntervalMs(1)).toBe(1000)
    expect(sanitizeIntervalMs(999)).toBe(1000)
  })

  it('clamps a too-large value down to the 30000ms ceiling', () => {
    expect(sanitizeIntervalMs(30_001)).toBe(30_000)
    expect(sanitizeIntervalMs(1_000_000)).toBe(30_000)
  })

  it('falls back to the default for zero or negative values', () => {
    expect(sanitizeIntervalMs(0)).toBe(2000)
    expect(sanitizeIntervalMs(-1)).toBe(2000)
    expect(sanitizeIntervalMs(-1000)).toBe(2000)
  })

  it('falls back to the default for non-finite/garbage runtime values (IPC payload is untrusted)', () => {
    expect(sanitizeIntervalMs(NaN)).toBe(2000)
    expect(sanitizeIntervalMs(Infinity)).toBe(2000)
    expect(sanitizeIntervalMs('5000' as unknown as number)).toBe(5000) // Number('5000') coerces fine
    expect(sanitizeIntervalMs('not a number' as unknown as number)).toBe(2000)
  })

  it('truncates a fractional value to an integer before clamping', () => {
    expect(sanitizeIntervalMs(1500.9)).toBe(1500)
  })
})
