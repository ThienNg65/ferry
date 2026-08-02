import { EventEmitter } from 'events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EVENT_CHANNELS } from '../../shared/contract'

// TerminalManager broadcasts via BrowserWindow.getAllWindows() — vitest runs
// outside a real Electron process, so mock only that (same pattern as
// TailManager.test.ts).
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

/** Minimal stand-in for ssh2's ClientChannel — just the surface TerminalManager touches. */
class FakeStream extends EventEmitter {
  write = vi.fn()
  end = vi.fn()
  setWindow = vi.fn()
}

let openShellImpl: (opts: { cols: number; rows: number }) => Promise<FakeStream> = async () => new FakeStream()
let cwdImpl: (sessionId: string) => string = () => '.'

vi.mock('../ssh/SessionManager', () => ({
  SessionManager: {
    getInstance: () => ({
      shell: (_sessionId: string) => ({
        openShell: (opts: { cols: number; rows: number }) => openShellImpl(opts)
      }),
      cwd: (sessionId: string) => cwdImpl(sessionId)
    })
  }
}))

function dataEvents(): unknown[] {
  return sent.filter((s) => s.channel === EVENT_CHANNELS.terminalData).map((s) => s.evt)
}
function exitEvents(): unknown[] {
  return sent.filter((s) => s.channel === EVENT_CHANNELS.terminalExit).map((s) => s.evt)
}

describe('TerminalManager', () => {
  let TerminalManager: typeof import('./TerminalManager').TerminalManager

  beforeEach(async () => {
    vi.resetModules()
    sent.length = 0
    openShellImpl = async () => new FakeStream()
    cwdImpl = () => '.'
    ;({ TerminalManager } = await import('./TerminalManager'))
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('opens a shell, cds into the configured remote start path, and streams data', async () => {
    let stream: FakeStream | undefined
    openShellImpl = async () => {
      stream = new FakeStream()
      return stream
    }
    cwdImpl = () => '/home/user/project'
    const manager = TerminalManager.getInstance()

    await manager.open('term-1', 'session-1', 80, 24)

    expect(stream).toBeDefined()
    expect(stream!.write).toHaveBeenCalledWith("cd '/home/user/project'\n")

    stream!.emit('data', Buffer.from('hello'))
    expect(dataEvents()).toEqual([{ terminalId: 'term-1', data: new Uint8Array(Buffer.from('hello')) }])
  })

  it('skips the cd when cwd is "." (no configured start path)', async () => {
    let stream: FakeStream | undefined
    openShellImpl = async () => {
      stream = new FakeStream()
      return stream
    }
    cwdImpl = () => '.'
    const manager = TerminalManager.getInstance()

    await manager.open('term-1', 'session-1', 80, 24)

    expect(stream!.write).not.toHaveBeenCalled()
  })

  it('write() sends keystrokes to the shell stream', async () => {
    let stream: FakeStream | undefined
    openShellImpl = async () => {
      stream = new FakeStream()
      return stream
    }
    const manager = TerminalManager.getInstance()
    await manager.open('term-1', 'session-1', 80, 24)

    manager.write('term-1', 'ls -la\n')

    expect(stream!.write).toHaveBeenCalledWith('ls -la\n')
  })

  it('write()/resize() on an unknown terminalId are no-ops', () => {
    const manager = TerminalManager.getInstance()
    expect(() => manager.write('nope', 'x')).not.toThrow()
    expect(() => manager.resize('nope', 80, 24)).not.toThrow()
  })

  it('resize() forwards to setWindow as (rows, cols, 0, 0) per ssh2 convention', async () => {
    let stream: FakeStream | undefined
    openShellImpl = async () => {
      stream = new FakeStream()
      return stream
    }
    const manager = TerminalManager.getInstance()
    await manager.open('term-1', 'session-1', 80, 24)

    manager.resize('term-1', 100, 40)

    expect(stream!.setWindow).toHaveBeenCalledWith(40, 100, 0, 0)
  })

  it('close() ends the stream and removes the entry (subsequent write() is a no-op)', async () => {
    let stream: FakeStream | undefined
    openShellImpl = async () => {
      stream = new FakeStream()
      return stream
    }
    const manager = TerminalManager.getInstance()
    await manager.open('term-1', 'session-1', 80, 24)

    manager.close('term-1')

    expect(stream!.end).toHaveBeenCalledOnce()
    manager.write('term-1', 'x')
    expect(stream!.write).not.toHaveBeenCalled()
  })

  it('close() is safe to call on an already-closed or unknown terminal', async () => {
    const manager = TerminalManager.getInstance()
    expect(() => manager.close('never-opened')).not.toThrow()

    let stream: FakeStream | undefined
    openShellImpl = async () => {
      stream = new FakeStream()
      return stream
    }
    await manager.open('term-1', 'session-1', 80, 24)
    manager.close('term-1')
    expect(() => manager.close('term-1')).not.toThrow()
    expect(stream!.end).toHaveBeenCalledOnce() // not called again on the second close()
  })

  it('broadcasts terminal:exit with the exit code captured before the stream closed', async () => {
    let stream: FakeStream | undefined
    openShellImpl = async () => {
      stream = new FakeStream()
      return stream
    }
    const manager = TerminalManager.getInstance()
    await manager.open('term-1', 'session-1', 80, 24)

    stream!.emit('exit', 137)
    stream!.emit('close')

    expect(exitEvents()).toEqual([{ terminalId: 'term-1', exitCode: 137 }])
  })

  it('a stream closing on its own removes it from the manager (write() afterwards is a no-op)', async () => {
    let stream: FakeStream | undefined
    openShellImpl = async () => {
      stream = new FakeStream()
      return stream
    }
    const manager = TerminalManager.getInstance()
    await manager.open('term-1', 'session-1', 80, 24)

    stream!.emit('close')

    manager.write('term-1', 'x')
    expect(stream!.write).not.toHaveBeenCalled()
  })

  it('closeAllForSession closes every terminal bound to that session and leaves others open', async () => {
    const created: FakeStream[] = []
    openShellImpl = async () => {
      const s = new FakeStream()
      created.push(s)
      return s
    }
    const manager = TerminalManager.getInstance()

    await manager.open('term-a', 'session-1', 80, 24)
    await manager.open('term-b', 'session-1', 80, 24)
    await manager.open('term-c', 'session-2', 80, 24)

    manager.closeAllForSession('session-1')

    expect(created[0].end).toHaveBeenCalledOnce()
    expect(created[1].end).toHaveBeenCalledOnce()
    expect(created[2].end).not.toHaveBeenCalled()
  })

  // TailManager and MonitorManager both defensively tear down any prior entry
  // for a key before installing a new one (see MonitorManager.start(), which
  // calls stop() first). TerminalManager.open() currently does NOT do this —
  // it unconditionally `this.terminals.set(terminalId, entry)`s, so a
  // (normally unreachable, since every real open() call is given a
  // freshly-minted UUID by the caller) same-terminalId collision silently
  // supersedes the map entry without ending the superseded stream. This test
  // documents that actual current behavior rather than a defensive cleanup
  // that doesn't exist in the source yet.
  it('open() called twice with the same terminalId overwrites the entry without ending the superseded stream', async () => {
    const created: FakeStream[] = []
    openShellImpl = async () => {
      const s = new FakeStream()
      created.push(s)
      return s
    }
    const manager = TerminalManager.getInstance()

    await manager.open('dup', 'session-1', 80, 24)
    await manager.open('dup', 'session-1', 80, 24)

    expect(created).toHaveLength(2)
    expect(created[0].end).not.toHaveBeenCalled()

    manager.write('dup', 'x')
    expect(created[1].write).toHaveBeenCalledWith('x')
    expect(created[0].write).not.toHaveBeenCalledWith('x')
  })
})
