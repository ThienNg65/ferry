import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { EVENT_CHANNELS, INVOKE_CHANNELS, SEND_CHANNELS } from '@shared/contract'

const eventListeners = new Map<string, Set<(payload: unknown) => void>>()
const writtenChunks: string[] = []
const sentMessages: Array<{ channel: string; payload: unknown }> = []
const onDataCallbacks: Array<(data: string) => void> = []
const pendingWriteCallbacks: Array<() => void> = []
let deferWriteCallbacks = false
let resolveOpen: ((res: { terminalId: string }) => void) | null = null

const mockUiState = {
  terminalScrollback: 5000,
  terminalAppearance: { fontFamily: 'monospace', fontSize: 14, lineHeight: 1, theme: {} },
  terminalPredictiveEcho: true
}

interface FakeMarker {
  id: number
  line: number
  isDisposed: boolean
  onDispose: (cb: () => void) => { dispose: () => void }
  dispose: () => void
}

function createFakeBuffer(cols = 80, rows = 24, scrollback = 5000) {
  const lines: string[] = [' '.repeat(cols)]
  const markers: FakeMarker[] = []
  let nextMarkerId = 1
  let baseY = 0
  let cursorX = 0
  let cursorY = 0
  let wrapPending = false

  function ensureRow(absRow: number) {
    while (lines.length <= absRow) {
      lines.push(' '.repeat(cols))
    }
  }

  function trimMarkers(count: number) {
    for (let i = markers.length - 1; i >= 0; i--) {
      const m = markers[i]
      m.line -= count
      if (m.line < 0) {
        m.dispose()
      }
    }
  }

  function lineFeed() {
    if (cursorY + 1 < rows) {
      cursorY += 1
      ensureRow(baseY + cursorY)
      return
    }
    ensureRow(baseY + cursorY)
    lines.push(' '.repeat(cols))
    if (baseY < scrollback) {
      baseY += 1
    } else {
      lines.shift()
      trimMarkers(1)
    }
  }

  function registerMarker(offset = 0): FakeMarker {
    const disposeListeners = new Set<() => void>()
    const marker: FakeMarker = {
      id: nextMarkerId++,
      line: baseY + cursorY + offset,
      isDisposed: false,
      onDispose(cb) {
        disposeListeners.add(cb)
        return {
          dispose() {
            disposeListeners.delete(cb)
          }
        }
      },
      dispose() {
        if (marker.isDisposed) return
        marker.isDisposed = true
        marker.line = -1
        const idx = markers.indexOf(marker)
        if (idx >= 0) markers.splice(idx, 1)
        for (const cb of disposeListeners) cb()
      }
    }
    markers.push(marker)
    return marker
  }

  function resize(newCols: number, newRows: number) {
    cols = newCols
    rows = newRows
    for (let i = 0; i < lines.length; i++) {
      lines[i] = lines[i].padEnd(cols, ' ').slice(0, cols)
    }
    cursorX = Math.min(cursorX, cols)
    cursorY = Math.min(cursorY, rows - 1)
    wrapPending = false
  }

  function apply(seq: string) {
    let i = 0
    while (i < seq.length) {
      const ch = seq[i]
      if (ch === '\x1b' && seq[i + 1] === ']') {
        const oscMatch = /^\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/.exec(seq.slice(i))
        if (oscMatch) {
          i += oscMatch[0].length
          continue
        }
      }
      if (ch === '\x1b' && seq[i + 1] === '[') {
        const match = /^\x1b\[([0-9;?]*)([A-Za-z])/.exec(seq.slice(i))
        if (match) {
          const params = match[1]
          const cmd = match[2]
          const n = params === '' ? 1 : Number.parseInt(params, 10)
          if (cmd !== 'm') wrapPending = false
          if (cmd === 'A') {
            cursorY = Math.max(0, cursorY - n)
            if (cursorX >= cols) cursorX = cols - 1
          } else if (cmd === 'B') {
            cursorY = Math.min(rows - 1, cursorY + n)
            ensureRow(baseY + cursorY)
            if (cursorX >= cols) cursorX = cols - 1
          } else if (cmd === 'G') {
            cursorX = Math.max(0, Math.min(cols - 1, n - 1))
          } else if (cmd === 'K') {
            ensureRow(baseY + cursorY)
            const mode = params === '' ? 0 : n
            const row = lines[baseY + cursorY].split('')
            const start = mode === 2 ? 0 : cursorX
            for (let c = start; c < cols; c++) row[c] = ' '
            lines[baseY + cursorY] = row.join('')
          }
          i += match[0].length
          continue
        }
      }
      if (ch === '\b') {
        wrapPending = false
        if (cursorX >= cols) cursorX = cols - 1
        if (cursorX > 0) cursorX -= 1
        i++
        continue
      }
      if (ch === '\r') {
        wrapPending = false
        cursorX = 0
        i++
        continue
      }
      if (ch === '\n') {
        wrapPending = false
        lineFeed()
        i++
        continue
      }
      if (wrapPending || cursorX >= cols) {
        lineFeed()
        cursorX = 0
        wrapPending = false
      }
      ensureRow(baseY + cursorY)
      const row = lines[baseY + cursorY].split('')
      row[cursorX] = ch
      lines[baseY + cursorY] = row.join('')
      cursorX += 1
      if (cursorX >= cols) wrapPending = true
      i++
    }
  }

  const active = {
    type: 'normal' as const,
    get baseY() {
      return baseY
    },
    get cursorY() {
      return cursorY
    },
    get cursorX() {
      return cursorX
    },
    getLine(y: number) {
      if (y < 0 || y >= lines.length) return undefined
      const row = lines[y]
      return {
        isWrapped: false,
        length: row.length,
        translateToString(trimRight = false) {
          return trimRight ? row.replace(/\s+$/, '') : row
        },
        getCell(x: number) {
          if (x < 0 || x >= row.length) return undefined
          const ch = row[x]
          return {
            getChars: () => (ch === ' ' ? '' : ch),
            getWidth: () => 1,
            getCode: () => ch.codePointAt(0) ?? 0
          }
        }
      }
    }
  }

  return { active, apply, registerMarker, resize }
}

vi.mock('../../api', () => ({
  invoke: vi.fn((channel: string) => {
    if (channel === INVOKE_CHANNELS.terminalOpen) {
      return new Promise((resolve) => {
        resolveOpen = resolve as (res: { terminalId: string }) => void
      })
    }
    return Promise.resolve(undefined)
  }),
  onEvent: vi.fn((channel: string, cb: (payload: unknown) => void) => {
    let set = eventListeners.get(channel)
    if (!set) {
      set = new Set()
      eventListeners.set(channel, set)
    }
    set.add(cb)
    return () => set.delete(cb)
  })
}))

vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    cols = 80
    rows = 24
    options: Record<string, unknown> = {}
    private fakeBuffer: ReturnType<typeof createFakeBuffer>
    buffer: { active: ReturnType<typeof createFakeBuffer>['active'] }
    constructor(options?: { cols?: number; rows?: number; scrollback?: number }) {
      this.cols = options?.cols ?? 80
      this.rows = options?.rows ?? 24
      this.options = { ...(options ?? {}) }
      this.fakeBuffer = createFakeBuffer(this.cols, this.rows, options?.scrollback ?? 5000)
      this.buffer = { active: this.fakeBuffer.active }
    }
    registerMarker(offset = 0) {
      return this.fakeBuffer.registerMarker(offset)
    }
    resize(cols: number, rows: number) {
      this.cols = cols
      this.rows = rows
      this.fakeBuffer.resize(cols, rows)
    }
    loadAddon() {}
    onData(cb: (data: string) => void) {
      onDataCallbacks.push(cb)
      return { dispose() {} }
    }
    onResize() {
      return { dispose() {} }
    }
    attachCustomKeyEventHandler() {}
    write(data: string | Uint8Array, cb?: () => void) {
      const text = typeof data === 'string' ? data : Buffer.from(data).toString('utf8')
      writtenChunks.push(text)
      if (deferWriteCallbacks && cb) {
        pendingWriteCallbacks.push(() => {
          this.fakeBuffer.apply(text)
          cb()
        })
        return
      }
      this.fakeBuffer.apply(text)
      cb?.()
    }
    focus() {}
    dispose() {}
    hasSelection() { return false }
    clearTextureAtlas() {}
  }
}))

vi.mock('@xterm/addon-fit', () => ({ FitAddon: class { fit() {} } }))
vi.mock('@xterm/addon-search', () => ({ SearchAddon: class {} }))
vi.mock('@xterm/addon-webgl', () => ({ WebglAddon: class { onContextLoss() {} } }))
vi.mock('../ui.store', () => ({
  useUiStore: () => mockUiState
}))

function emitTerminalData(terminalId: string, data: string | Uint8Array): void {
  for (const cb of eventListeners.get(EVENT_CHANNELS.terminalData) ?? []) {
    cb({ terminalId, data })
  }
}

function typeKeystrokes(data: string): void {
  const cb = onDataCallbacks[onDataCallbacks.length - 1]
  if (!cb) {
    throw new Error('Expected terminal onData callback to be registered')
  }
  cb(data)
}

describe('terminalStreams.store', () => {
  beforeEach(() => {
    vi.resetModules()
    eventListeners.clear()
    writtenChunks.length = 0
    sentMessages.length = 0
    onDataCallbacks.length = 0
    pendingWriteCallbacks.length = 0
    deferWriteCallbacks = false
    resolveOpen = null
    mockUiState.terminalScrollback = 5000
    mockUiState.terminalPredictiveEcho = true
    vi.stubGlobal('window', {
      api: {
        send: vi.fn((channel: string, payload: unknown) => {
          sentMessages.push({ channel, payload })
        })
      }
    })
    setActivePinia(createPinia())
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('buffers early terminal:data arriving while terminal:open is in flight and replays it', async () => {
    const { useTerminalStreamsStore } = await import('../terminalStreams.store')
    const store = useTerminalStreamsStore()

    const openPromise = store.ensureTerminal('sess-1')
    expect(resolveOpen).not.toBeNull()

    // Early prompt arrives before terminal:open resolves
    emitTerminalData('term-early', 'user@host:~$ ')
    expect(writtenChunks).toEqual([])

    resolveOpen!({ terminalId: 'term-early' })
    await openPromise

    expect(writtenChunks).toEqual(['user@host:~$ '])
  })

  it('predicts_keystrokes_immediately_while_sending_ssh_input_and_counts_only_server_ack_bytes', async () => {
    const { useTerminalStreamsStore } = await import('../terminalStreams.store')
    const store = useTerminalStreamsStore()

    const openPromise = store.ensureTerminal('sess-1')
    resolveOpen!({ terminalId: 'term-1' })
    await openPromise

    emitTerminalData('term-1', 'user@host:~$ ')
    const unackedBeforeTyping = store.getInstance('sess-1')?.unacked ?? 0
    expect(unackedBeforeTyping).toBe('user@host:~$ '.length)
    writtenChunks.length = 0
    sentMessages.length = 0

    typeKeystrokes('a')
    typeKeystrokes('b')

    expect(sentMessages).toEqual([
      { channel: SEND_CHANNELS.terminalInput, payload: { terminalId: 'term-1', data: 'a' } },
      { channel: SEND_CHANNELS.terminalInput, payload: { terminalId: 'term-1', data: 'b' } }
    ])
    expect(writtenChunks).toEqual(['a', 'b'])

    emitTerminalData('term-1', 'ab')
    expect(store.getInstance('sess-1')?.unacked).toBe(unackedBeforeTyping + 2)

    // Cross the 100 KiB ACK batch threshold and confirm rewind/echo bytes were never counted
    const remainingBatch = 100 * 1024 - (unackedBeforeTyping + 2)
    emitTerminalData('term-1', 'z'.repeat(remainingBatch))
    expect(sentMessages).toContainEqual({
      channel: SEND_CHANNELS.terminalAck,
      payload: { terminalId: 'term-1', bytes: 100 * 1024 }
    })
  })

  it('flushes_predictions_before_resize_and_disables_when_setting_off', async () => {
    const { useTerminalStreamsStore } = await import('../terminalStreams.store')
    const store = useTerminalStreamsStore()

    const openPromise = store.ensureTerminal('sess-1')
    resolveOpen!({ terminalId: 'term-1' })
    await openPromise

    typeKeystrokes('a')
    typeKeystrokes('b')
    writtenChunks.length = 0

    await store.flushPredictions('sess-1')
    expect(writtenChunks.length).toBe(1)
    expect(writtenChunks[0]).toContain('\x1b[K')

    mockUiState.terminalPredictiveEcho = false
    store.syncPredictiveEchoSetting()
    writtenChunks.length = 0
    sentMessages.length = 0

    typeKeystrokes('c')
    expect(sentMessages).toEqual([
      { channel: SEND_CHANNELS.terminalInput, payload: { terminalId: 'term-1', data: 'c' } }
    ])
    expect(writtenChunks).toEqual([])
  })

  it('applies_underline_after_100ms_if_unconfirmed', async () => {
    vi.useFakeTimers()
    const { useTerminalStreamsStore } = await import('../terminalStreams.store')
    const store = useTerminalStreamsStore()

    const openPromise = store.ensureTerminal('sess-1')
    resolveOpen!({ terminalId: 'term-1' })
    await openPromise

    typeKeystrokes('x')
    expect(writtenChunks).toEqual(['x'])

    vi.advanceTimersByTime(99)
    expect(writtenChunks.some((chunk) => chunk.includes('\x1b[4mx\x1b[24m'))).toBe(false)

    vi.advanceTimersByTime(1)
    expect(writtenChunks.some((chunk) => chunk.includes('\x1b[4mx\x1b[24m'))).toBe(true)
  })

  it('clears pending predictions and cancels underline timer when syncPredictiveEchoSetting turns off or session disposes', async () => {
    vi.useFakeTimers()
    const { useTerminalStreamsStore } = await import('../terminalStreams.store')
    const store = useTerminalStreamsStore()

    const openPromise = store.ensureTerminal('sess-1')
    resolveOpen!({ terminalId: 'term-1' })
    await openPromise

    typeKeystrokes('q')
    mockUiState.terminalPredictiveEcho = false
    store.syncPredictiveEchoSetting()
    expect(writtenChunks.some((chunk) => chunk.includes('\x1b[K'))).toBe(true)

    writtenChunks.length = 0
    vi.advanceTimersByTime(150)
    expect(writtenChunks).toEqual([])

    mockUiState.terminalPredictiveEcho = true
    typeKeystrokes('w')
    await store.disposeForSession('sess-1')
    writtenChunks.length = 0
    vi.advanceTimersByTime(150)
    expect(writtenChunks).toEqual([])
  })

  it('resets predictor and routes input to restarted terminalId after restart', async () => {
    vi.useFakeTimers()
    const { useTerminalStreamsStore } = await import('../terminalStreams.store')
    const store = useTerminalStreamsStore()

    const openPromise = store.ensureTerminal('sess-1')
    resolveOpen!({ terminalId: 'term-1' })
    await openPromise

    typeKeystrokes('a')
    const restartPromise = store.restart('sess-1')
    resolveOpen!({ terminalId: 'term-2' })
    await restartPromise

    writtenChunks.length = 0
    sentMessages.length = 0
    vi.advanceTimersByTime(150)
    expect(writtenChunks).toEqual([])

    typeKeystrokes('b')
    expect(sentMessages).toEqual([
      { channel: SEND_CHANNELS.terminalInput, payload: { terminalId: 'term-2', data: 'b' } }
    ])
    expect(writtenChunks).toEqual(['b'])
  })

  it('rewinds predictions before Uint8Array server writes and counts only payload length', async () => {
    const { useTerminalStreamsStore } = await import('../terminalStreams.store')
    const store = useTerminalStreamsStore()

    const openPromise = store.ensureTerminal('sess-1')
    resolveOpen!({ terminalId: 'term-1' })
    await openPromise

    typeKeystrokes('a')
    writtenChunks.length = 0

    const bytes = new TextEncoder().encode('a')
    emitTerminalData('term-1', bytes)

    expect(writtenChunks).toEqual(['\x1b[0m\x1b[1G\x1b[Ka'])
    expect(store.getInstance('sess-1')?.unacked).toBe(1)
    expect(store.getInstance('sess-1')?.predictor.getSnapshot().pendingCount).toBe(0)
  })

  it('ignores in-flight term.write callbacks from before restart without corrupting pendingServerWrites', async () => {
    const { useTerminalStreamsStore } = await import('../terminalStreams.store')
    const store = useTerminalStreamsStore()

    const openPromise = store.ensureTerminal('sess-1')
    resolveOpen!({ terminalId: 'term-1' })
    await openPromise

    emitTerminalData('term-1', 'user@host:~$ ')

    // Defer term-1's server write callback so it stays in flight across restart()
    deferWriteCallbacks = true
    emitTerminalData('term-1', 'ls')
    expect(pendingWriteCallbacks).toHaveLength(1)
    expect(store.getInstance('sess-1')?.predictor.getSnapshot().pendingServerWrites).toBe(1)

    const restartPromise = store.restart('sess-1')
    resolveOpen!({ terminalId: 'term-2' })
    await restartPromise

    expect(store.getInstance('sess-1')?.predictor.getSnapshot().pendingServerWrites).toBe(0)

    // Queue a new write on term-2, then resolve the stale term-1 callback first
    emitTerminalData('term-2', 'user@host:~$ ')
    expect(pendingWriteCallbacks).toHaveLength(2)
    expect(store.getInstance('sess-1')?.predictor.getSnapshot().pendingServerWrites).toBe(1)

    // Resolving stale term-1 callback must not decrement term-2's pendingServerWrites
    pendingWriteCallbacks.shift()!()
    expect(store.getInstance('sess-1')?.predictor.getSnapshot().pendingServerWrites).toBe(1)
    expect(store.getInstance('sess-1')?.unacked).toBe(0)

    // Resolving term-2's callback completes cleanly and subsequent keystrokes predict at 0ms
    pendingWriteCallbacks.shift()!()
    expect(store.getInstance('sess-1')?.predictor.getSnapshot().pendingServerWrites).toBe(0)

    deferWriteCallbacks = false
    writtenChunks.length = 0
    typeKeystrokes('a')
    expect(writtenChunks).toEqual(['a'])
  })

  it('skips predictor hooks while terminalPredictiveEcho is false and discards stale pre-disable callbacks', async () => {
    const { useTerminalStreamsStore } = await import('../terminalStreams.store')
    const store = useTerminalStreamsStore()

    const openPromise = store.ensureTerminal('sess-1')
    resolveOpen!({ terminalId: 'term-1' })
    await openPromise

    const inst = store.getInstance('sess-1')!
    const beforeSpy = vi.spyOn(inst.predictor, 'beforeServerWrite')
    const afterSpy = vi.spyOn(inst.predictor, 'afterServerWrite')

    // Disable predictive echo: server password prompt arriving while disabled must not update predictor mode/state
    mockUiState.terminalPredictiveEcho = false
    store.syncPredictiveEchoSetting()

    emitTerminalData('term-1', 'Password: ')
    expect(beforeSpy).not.toHaveBeenCalled()
    expect(afterSpy).not.toHaveBeenCalled()
    expect(inst.predictor.getSnapshot().mode).toBe('active')
    expect(inst.unacked).toBe('Password: '.length)

    // Re-enable and verify typing predicts immediately with no stale paused_password state
    mockUiState.terminalPredictiveEcho = true
    store.syncPredictiveEchoSetting()
    writtenChunks.length = 0
    typeKeystrokes('a')
    expect(writtenChunks).toEqual(['a'])

    // Verify in-flight callback started while enabled is ignored after disabling, while ACK still counts bytes
    emitTerminalData('term-1', 'a')
    deferWriteCallbacks = true
    emitTerminalData('term-1', 'bc')
    expect(pendingWriteCallbacks).toHaveLength(1)

    mockUiState.terminalPredictiveEcho = false
    store.syncPredictiveEchoSetting()
    const unackedBeforeCb = inst.unacked

    afterSpy.mockClear()
    pendingWriteCallbacks.shift()!()
    expect(afterSpy).not.toHaveBeenCalled()
    expect(inst.unacked).toBe(unackedBeforeCb + 'bc'.length)

    // Re-enable once more: predictor stays clean (pendingServerWrites === 0) and predicts immediately
    deferWriteCallbacks = false
    mockUiState.terminalPredictiveEcho = true
    store.syncPredictiveEchoSetting()
    writtenChunks.length = 0
    typeKeystrokes('z')
    expect(inst.predictor.getSnapshot().pendingServerWrites).toBe(0)
    expect(writtenChunks).toEqual(['z'])
  })

  it('flushPredictions waits for rewind term.write callback before resolving and bumps writeGeneration', async () => {
    const { useTerminalStreamsStore } = await import('../terminalStreams.store')
    const store = useTerminalStreamsStore()

    const openPromise = store.ensureTerminal('sess-1')
    resolveOpen!({ terminalId: 'term-1' })
    await openPromise

    const inst = store.getInstance('sess-1')!

    // No active predictions -> resolves immediately without writing or bumping writeGeneration
    const emptyGenBefore = inst.writeGeneration
    writtenChunks.length = 0
    await store.flushPredictions('sess-1')
    expect(writtenChunks).toEqual([])
    expect(inst.writeGeneration).toBe(emptyGenBefore)

    // With active predictions -> defers resolution until rewind write callback fires and bumps writeGeneration
    typeKeystrokes('a')
    typeKeystrokes('b')
    deferWriteCallbacks = true
    writtenChunks.length = 0
    const genBeforeFlush = inst.writeGeneration

    let resolved = false
    const flushPromise = store.flushPredictions('sess-1').then(() => {
      resolved = true
    })

    expect(inst.writeGeneration).toBe(genBeforeFlush + 1)
    expect(writtenChunks.length).toBe(1)
    expect(writtenChunks[0]).toContain('\x1b[K')
    expect(pendingWriteCallbacks).toHaveLength(1)

    await Promise.resolve()
    expect(resolved).toBe(false)

    pendingWriteCallbacks.shift()!()
    await flushPromise
    expect(resolved).toBe(true)
  })

  it('re-arms underlineTimer briefly when OS timer fires slightly before 100ms', async () => {
    vi.useFakeTimers()
    let mockNow = 1000
    vi.spyOn(Date, 'now').mockImplementation(() => mockNow)

    const { useTerminalStreamsStore } = await import('../terminalStreams.store')
    const store = useTerminalStreamsStore()

    const openPromise = store.ensureTerminal('sess-1')
    resolveOpen!({ terminalId: 'term-1' })
    await openPromise

    typeKeystrokes('k')
    expect(writtenChunks).toEqual(['k'])

    // Simulate OS timer alignment firing the 100ms timeout 1ms early (elapsed = 99ms)
    mockNow = 1099
    vi.advanceTimersByTime(100)
    expect(writtenChunks.some((chunk) => chunk.includes('\x1b[4mk\x1b[24m'))).toBe(false)

    // Short 10ms retry timer applies underline once elapsed >= 100ms
    mockNow = 1109
    vi.advanceTimersByTime(10)
    expect(writtenChunks.some((chunk) => chunk.includes('\x1b[4mk\x1b[24m'))).toBe(true)
  })

  it('clears awaitingNewlineConfirm when Enter output scrolls at saturated scrollback to a longer prompt', async () => {
    mockUiState.terminalScrollback = 5
    const { useTerminalStreamsStore } = await import('../terminalStreams.store')
    const store = useTerminalStreamsStore()

    const openPromise = store.ensureTerminal('sess-1')
    resolveOpen!({ terminalId: 'term-1' })
    await openPromise

    const inst = store.getInstance('sess-1')!
    const fillLines = Array.from({ length: 30 }, (_, i) => `line-${i}`).join('\r\n')
    emitTerminalData('term-1', `${fillLines}\r\n$ `)
    expect(inst.term.buffer.active.baseY).toBe(5)
    expect(inst.term.buffer.active.cursorY).toBe(23)
    expect(inst.term.buffer.active.cursorX).toBe(2)

    typeKeystrokes('l')
    typeKeystrokes('s')
    typeKeystrokes('\r')

    // Chunk 1 echoes command before newline; predictor stays in awaitingNewlineConfirm
    emitTerminalData('term-1', 'ls')
    expect(inst.predictor.getSnapshot().pendingCount).toBe(0)
    expect(inst.predictor.getSnapshot().predictionsRendered).toBe(false)
    writtenChunks.length = 0
    typeKeystrokes('x')
    expect(writtenChunks).toEqual([])

    // Chunk 2 scrolls saturated scrollback and lands on a longer prompt at same (baseY, cursorY)
    emitTerminalData('term-1', '\r\nout1\r\nout2\r\nuser@host:~/longer-prompt$ ')
    expect(inst.term.buffer.active.baseY).toBe(5)
    expect(inst.term.buffer.active.cursorY).toBe(23)

    writtenChunks.length = 0
    typeKeystrokes('p')
    expect(writtenChunks).toEqual(['p'])
    expect(inst.predictor.getSnapshot().pendingCount).toBe(1)
  })

  it('rewinds and reconciles wrapped predictions cleanly when bottom-row typing scrolls saturated scrollback', async () => {
    mockUiState.terminalScrollback = 5
    const { useTerminalStreamsStore } = await import('../terminalStreams.store')
    const store = useTerminalStreamsStore()

    const openPromise = store.ensureTerminal('sess-1')
    resolveOpen!({ terminalId: 'term-1' })
    await openPromise

    const inst = store.getInstance('sess-1')!
    inst.term.resize(10, 6)

    const fillLines = Array.from({ length: 12 }, (_, i) => `L${i}`).join('\r\n')
    emitTerminalData('term-1', `${fillLines}\r\n01234567`)
    expect(inst.term.buffer.active.baseY).toBe(5)
    expect(inst.term.buffer.active.cursorY).toBe(5)
    expect(inst.term.buffer.active.cursorX).toBe(8)

    typeKeystrokes('abcd')
    expect(inst.term.buffer.active.baseY).toBe(5)
    expect(inst.term.buffer.active.cursorY).toBe(5)
    expect(inst.term.buffer.active.cursorX).toBe(2)
    expect(inst.term.buffer.active.getLine(9)?.translateToString(true)).toBe('01234567ab')
    expect(inst.term.buffer.active.getLine(10)?.translateToString(true)).toBe('cd')

    // Partial echo 'ab' triggers rewind across the scrolled row and keeps 'cd' rendered
    emitTerminalData('term-1', 'ab')
    expect(inst.predictor.getSnapshot().mode).toBe('active')
    expect(inst.predictor.getSnapshot().pendingCount).toBe(2)
    expect(inst.predictor.getSnapshot().predictionsRendered).toBe(true)
    expect(inst.term.buffer.active.getLine(9)?.translateToString(true)).toBe('01234567ab')
    expect(inst.term.buffer.active.getLine(10)?.translateToString(true)).toBe('cd')

    // Final echo 'cd' reconciles without dropping the tail
    emitTerminalData('term-1', 'cd')
    expect(inst.predictor.getSnapshot().mode).toBe('active')
    expect(inst.predictor.getSnapshot().pendingCount).toBe(0)
    expect(inst.predictor.getSnapshot().predictionsRendered).toBe(false)
    expect(inst.term.buffer.active.getLine(9)?.translateToString(true)).toBe('01234567ab')
    expect(inst.term.buffer.active.getLine(10)?.translateToString(true)).toBe('cd')
    expect(inst.term.buffer.active.cursorY).toBe(5)
    expect(inst.term.buffer.active.cursorX).toBe(2)
  })

  it('terminalExit emits rewind prefix before exit message, cancels underlineTimer, and resets predictor', async () => {
    vi.useFakeTimers()
    const { useTerminalStreamsStore } = await import('../terminalStreams.store')
    const store = useTerminalStreamsStore()

    const openPromise = store.ensureTerminal('sess-1')
    resolveOpen!({ terminalId: 'term-1' })
    await openPromise

    const inst = store.getInstance('sess-1')!
    emitTerminalData('term-1', '$ ')
    typeKeystrokes('l')
    typeKeystrokes('s')
    expect(inst.predictor.getSnapshot().pendingCount).toBe(2)
    expect(inst.predictor.getSnapshot().predictionsRendered).toBe(true)

    writtenChunks.length = 0
    const genBeforeExit = inst.writeGeneration
    for (const cb of eventListeners.get(EVENT_CHANNELS.terminalExit) ?? []) {
      cb({ terminalId: 'term-1' })
    }

    expect(writtenChunks).toHaveLength(1)
    expect(writtenChunks[0]).toMatch(/^\x1b\[0m\x1b\[3G\x1b\[K\r\n\[Process exited\]\r\n$/)
    expect(inst.writeGeneration).toBe(genBeforeExit + 1)
    expect(inst.predictor.getSnapshot()).toEqual({
      mode: 'active',
      pendingCount: 0,
      underlined: false,
      predictionsRendered: false,
      pendingServerWrites: 0
    })
    expect(store.exitedSessionIds).toContain('sess-1')

    writtenChunks.length = 0
    vi.advanceTimersByTime(150)
    expect(writtenChunks).toEqual([])
  })
})
