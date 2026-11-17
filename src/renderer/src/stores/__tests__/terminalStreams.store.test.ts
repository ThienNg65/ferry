import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { EVENT_CHANNELS, INVOKE_CHANNELS } from '@shared/contract'

const eventListeners = new Map<string, Set<(payload: unknown) => void>>()
const writtenChunks: string[] = []
let resolveOpen: ((res: { terminalId: string }) => void) | null = null

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
    loadAddon() {}
    onData() {}
    attachCustomKeyEventHandler() {}
    write(data: string | Uint8Array, cb?: () => void) {
      writtenChunks.push(typeof data === 'string' ? data : Buffer.from(data).toString('utf8'))
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
  useUiStore: () => ({
    terminalScrollback: 5000,
    terminalAppearance: { fontFamily: 'monospace', fontSize: 14, lineHeight: 1, theme: {} }
  })
}))

describe('terminalStreams.store', () => {
  beforeEach(() => {
    vi.resetModules()
    eventListeners.clear()
    writtenChunks.length = 0
    resolveOpen = null
    setActivePinia(createPinia())
  })

  it('buffers early terminal:data arriving while terminal:open is in flight and replays it', async () => {
    const { useTerminalStreamsStore } = await import('../terminalStreams.store')
    const store = useTerminalStreamsStore()

    const openPromise = store.ensureTerminal('sess-1')
    expect(resolveOpen).not.toBeNull()

    // Early prompt arrives before terminal:open resolves
    for (const cb of eventListeners.get(EVENT_CHANNELS.terminalData) ?? []) {
      cb({ terminalId: 'term-early', data: 'user@host:~$ ' })
    }
    expect(writtenChunks).toEqual([])

    resolveOpen!({ terminalId: 'term-early' })
    await openPromise

    expect(writtenChunks).toEqual(['user@host:~$ '])
  })
})
