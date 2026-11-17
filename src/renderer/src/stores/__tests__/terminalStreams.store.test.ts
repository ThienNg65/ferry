import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { EVENT_CHANNELS, INVOKE_CHANNELS, SEND_CHANNELS } from '@shared/contract'

const eventListeners = new Map<string, Set<(payload: unknown) => void>>()
const writtenChunks: string[] = []
const sentMessages: Array<{ channel: string; payload: unknown }> = []
const onDataCallbacks: Array<(data: string) => void> = []
let resolveOpen: ((res: { terminalId: string }) => void) | null = null

const mockUiState = {
  terminalScrollback: 5000,
  terminalAppearance: { fontFamily: 'monospace', fontSize: 14, lineHeight: 1, theme: {} },
  terminalPredictiveEcho: true
}

function createFakeBuffer(cols = 80) {
  const lines: string[] = [' '.repeat(cols)]
  let cursorX = 0
  let cursorY = 0
  let wrapPending = false

  function ensureRow(y: number) {
    while (lines.length <= y) {
      lines.push(' '.repeat(cols))
    }
  }

  function apply(seq: string) {
    let i = 0
    while (i < seq.length) {
      const ch = seq[i]
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
            cursorY += n
            ensureRow(cursorY)
            if (cursorX >= cols) cursorX = cols - 1
          } else if (cmd === 'G') {
            cursorX = Math.max(0, Math.min(cols - 1, n - 1))
          } else if (cmd === 'K') {
            ensureRow(cursorY)
            const mode = params === '' ? 0 : n
            const row = lines[cursorY].split('')
            const start = mode === 2 ? 0 : cursorX
            for (let c = start; c < cols; c++) row[c] = ' '
            lines[cursorY] = row.join('')
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
        cursorY += 1
        ensureRow(cursorY)
        i++
        continue
      }
      if (wrapPending || cursorX >= cols) {
        cursorY += 1
        cursorX = 0
        wrapPending = false
      }
      ensureRow(cursorY)
      const row = lines[cursorY].split('')
      row[cursorX] = ch
      lines[cursorY] = row.join('')
      cursorX += 1
      if (cursorX >= cols) wrapPending = true
      i++
    }
  }

  const active = {
    type: 'normal' as const,
    baseY: 0,
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

  return { active, apply }
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
    private fakeBuffer = createFakeBuffer(80)
    buffer = { active: this.fakeBuffer.active }
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
    resolveOpen = null
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

    store.flushPredictions('sess-1')
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
})
