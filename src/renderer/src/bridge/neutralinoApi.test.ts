import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it, vi } from 'vitest'
import { EVENT_CHANNELS, INVOKE_CHANNELS, SEND_CHANNELS, ok } from '../../../shared/contract'
import { createNeutralinoApi, decodeB64Deep, encodeB64Deep, type NeutralinoTransport } from './neutralinoApi'

function createFakeTransport(connectedExtensions: string[] = ['js.ferry.sidecar']): {
  transport: NeutralinoTransport
  emit: (event: string, detail: unknown) => void
  dispatched: Array<{ extensionId: string; event: string; data: unknown }>
} {
  const eventHandlers = new Map<string, Set<(detail: unknown) => void>>()
  const dispatched: Array<{ extensionId: string; event: string; data: unknown }> = []

  const transport: NeutralinoTransport = {
    init: vi.fn(),
    onEvent: (event, handler) => {
      let set = eventHandlers.get(event)
      if (!set) {
        set = new Set()
        eventHandlers.set(event, set)
      }
      set.add(handler)
      return () => set.delete(handler)
    },
    dispatchExtension: vi.fn(async (extensionId, event, data) => {
      dispatched.push({ extensionId, event, data })
    }),
    getExtensionStats: vi.fn(async () => ({
      loaded: ['js.ferry.sidecar'],
      connected: connectedExtensions
    })),
    minimizeWindow: vi.fn(async () => {}),
    maximizeWindow: vi.fn(async () => {}),
    unmaximizeWindow: vi.fn(async () => {}),
    isWindowMaximized: vi.fn(async () => false),
    getWindowPosition: vi.fn(async () => ({ x: 100, y: 80 })),
    getWindowSize: vi.fn(async () => ({ width: 1280, height: 800 })),
    setWindowSize: vi.fn(async () => {}),
    moveWindow: vi.fn(async () => {}),
    exitApp: vi.fn(async () => {}),
    showOpenDialog: vi.fn(async () => ['C:\\tmp\\picked.json']),
    showFolderDialog: vi.fn(async () => 'C:\\tmp\\folder'),
    showSaveDialog: vi.fn(async () => 'C:\\tmp\\save.key'),
    readClipboardText: vi.fn(async () => 'pasted text'),
    getKnownPath: vi.fn(async () => 'C:\\Users\\test\\Downloads'),
    logDebug: vi.fn(async () => {}),
    getAppVersion: vi.fn(() => '0.22.0')
  }

  return {
    transport,
    dispatched,
    emit: (event, detail) => {
      for (const h of [...(eventHandlers.get(event) ?? [])]) {
        h(detail)
      }
    }
  }
}

describe('neutralinoApi', () => {
  it('enforces invoke, send, and on channel whitelists', async () => {
    const { transport } = createFakeTransport()
    const api = createNeutralinoApi(transport)

    await expect(api.invoke('evil:channel')).rejects.toThrow('Blocked invoke on non-whitelisted channel: evil:channel')
    expect(() => api.send('evil:send')).toThrow('Blocked send on non-whitelisted channel: evil:send')
    expect(() => api.on('evil:event', () => {})).toThrow('Blocked listener on non-whitelisted channel: evil:event')
  })

  it('routes host channels through Neutralino transport with IpcResult envelopes', async () => {
    const { transport } = createFakeTransport()
    const api = createNeutralinoApi(transport)

    expect(await api.invoke(INVOKE_CHANNELS.systemGetAppVersion)).toEqual(ok({ version: '0.22.0' }))
    expect(await api.invoke(INVOKE_CHANNELS.systemGetDownloadsPath)).toEqual(
      ok({ path: 'C:\\Users\\test\\Downloads' })
    )
    expect(await api.invoke(INVOKE_CHANNELS.systemClipboardReadText)).toEqual(ok({ text: 'pasted text' }))
    expect(await api.invoke(INVOKE_CHANNELS.dialogPickFile)).toEqual(ok('C:\\tmp\\picked.json'))
    expect(await api.invoke(INVOKE_CHANNELS.dialogPickFolder)).toEqual(ok('C:\\tmp\\folder'))
    expect(await api.invoke(INVOKE_CHANNELS.dialogPickSaveFile, 'id_ed25519')).toEqual(ok('C:\\tmp\\save.key'))
    expect(transport.showSaveDialog).toHaveBeenCalledWith('Save file', { defaultPath: 'id_ed25519' })

    const windowEvents: unknown[] = []
    api.on(EVENT_CHANNELS.windowStateChange, (payload) => windowEvents.push(payload))
    expect(await api.invoke(INVOKE_CHANNELS.windowIsMaximized)).toEqual(ok({ isMaximized: false }))
    expect(await api.invoke(INVOKE_CHANNELS.windowMaximizeToggle)).toEqual(ok(undefined))
    expect(transport.maximizeWindow).toHaveBeenCalledTimes(1)
    expect(windowEvents).toEqual([{ isMaximized: true }])

    expect(await api.invoke(INVOKE_CHANNELS.windowMinimize)).toEqual(ok(undefined))
    expect(transport.minimizeWindow).toHaveBeenCalledTimes(1)
    expect(await api.invoke(INVOKE_CHANNELS.windowClose)).toEqual(ok(undefined))
    expect(transport.exitApp).toHaveBeenCalledTimes(1)
  })

  it('maximizes to screen work area and restores saved bounds without covering the taskbar', async () => {
    const { transport } = createFakeTransport()
    const api = createNeutralinoApi(transport)
    const events: unknown[] = []
    api.on(EVENT_CHANNELS.windowStateChange, (payload) => events.push(payload))

    vi.stubGlobal('window', {
      innerWidth: 1280,
      screen: { availLeft: 0, availTop: 0, availWidth: 1920, availHeight: 1032 }
    })

    try {
      await api.invoke(INVOKE_CHANNELS.windowMaximizeToggle)
      expect(transport.moveWindow).toHaveBeenCalledWith(0, 0)
      expect(transport.setWindowSize).toHaveBeenCalledWith({ width: 1920, height: 1032 })
      expect(transport.maximizeWindow).not.toHaveBeenCalled()
      expect(await api.invoke(INVOKE_CHANNELS.windowIsMaximized)).toEqual(ok({ isMaximized: true }))

      await api.invoke(INVOKE_CHANNELS.windowMaximizeToggle)
      expect(transport.moveWindow).toHaveBeenLastCalledWith(100, 80)
      expect(transport.setWindowSize).toHaveBeenLastCalledWith({ width: 1280, height: 800 })
      expect(await api.invoke(INVOKE_CHANNELS.windowIsMaximized)).toEqual(ok({ isMaximized: false }))
      expect(events).toEqual([{ isMaximized: true }, { isMaximized: false }])
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('does not double-scale maximize or restore dimensions on HiDPI displays', async () => {
    const { transport } = createFakeTransport()
    // Simulate Windows 125% DPI: getWindowSize returns physical px (1600x1000) while innerWidth is 1280.
    transport.getWindowSize = vi.fn().mockResolvedValue({ width: 1600, height: 1000 })
    const api = createNeutralinoApi(transport)

    vi.stubGlobal('window', {
      innerWidth: 1280,
      screen: { availLeft: 0, availTop: 0, availWidth: 1536, availHeight: 825 }
    })

    try {
      await api.invoke(INVOKE_CHANNELS.windowMaximizeToggle)
      expect(transport.moveWindow).toHaveBeenCalledWith(0, 0)
      expect(transport.setWindowSize).toHaveBeenCalledWith({ width: 1536, height: 825 })

      await api.invoke(INVOKE_CHANNELS.windowMaximizeToggle)
      expect(transport.moveWindow).toHaveBeenLastCalledWith(100, 80)
      expect(transport.setWindowSize).toHaveBeenLastCalledWith({ width: 1280, height: 800 })
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('correlates concurrent sidecar rpc_invoke calls, queues until ready, and decodes { __b64 } bytes', async () => {
    const { transport, emit, dispatched } = createFakeTransport([])
    const api = createNeutralinoApi(transport)

    const p1 = api.invoke(INVOKE_CHANNELS.settingsGet)
    const p2 = api.invoke(INVOKE_CHANNELS.fsRemoteReadFile, 's1', '/etc/hosts')

    // Queued until sidecar:ready fires.
    await Promise.resolve()
    expect(dispatched).toHaveLength(0)

    emit('sidecar:ready', { extensionId: 'js.ferry.sidecar' })
    await vi.waitFor(() => expect(dispatched).toHaveLength(2))

    const call1 = dispatched[0].data as { id: string; channel: string; args: unknown[] }
    const call2 = dispatched[1].data as { id: string; channel: string; args: unknown[] }
    expect(call1.channel).toBe(INVOKE_CHANNELS.settingsGet)
    expect(call2.channel).toBe(INVOKE_CHANNELS.fsRemoteReadFile)

    // Reply out of order and verify base64 payload restores to Uint8Array.
    emit('rpc_reply', {
      id: call2.id,
      result: ok({ content: { __b64: Buffer.from('hello').toString('base64') } })
    })
    emit('rpc_reply', {
      id: call1.id,
      result: ok({ theme: 'dark' })
    })

    const r2 = (await p2) as { ok: true; data: { content: Uint8Array } }
    expect(r2.ok).toBe(true)
    expect(r2.data.content).toBeInstanceOf(Uint8Array)
    expect(Array.from(r2.data.content)).toEqual(Array.from(Buffer.from('hello')))
    expect(await p1).toEqual(ok({ theme: 'dark' }))
  })

  it('dispatches send channels and broadcasts rpc_event payloads with unsubscribe support', async () => {
    const { transport, emit, dispatched } = createFakeTransport()
    const api = createNeutralinoApi(transport)

    const received: unknown[] = []
    const offFn = (payload: unknown) => received.push(['offFn', payload])
    const dispose = api.on(EVENT_CHANNELS.terminalData, (payload) => received.push(['dispose', payload]))
    api.on(EVENT_CHANNELS.terminalData, offFn)

    emit('rpc_event', {
      channel: EVENT_CHANNELS.terminalData,
      payload: { terminalId: 't1', data: { __b64: Buffer.from('ls\n').toString('base64') } }
    })
    expect(received).toHaveLength(2)

    dispose()
    api.off(EVENT_CHANNELS.terminalData, offFn)
    emit('rpc_event', {
      channel: EVENT_CHANNELS.terminalData,
      payload: { terminalId: 't1', data: 'ignored' }
    })
    expect(received).toHaveLength(2)

    api.send(SEND_CHANNELS.terminalInput, { terminalId: 't1', data: 'pwd\n' })
    await vi.waitFor(() => expect(dispatched).toHaveLength(1))
    expect(dispatched[0]).toEqual({
      extensionId: 'js.ferry.sidecar',
      event: 'rpc_send',
      data: { channel: SEND_CHANNELS.terminalInput, payload: { terminalId: 't1', data: 'pwd\n' } }
    })
  })

  it('picks a JSON backup via native dialog before forwarding sites:import-json to sidecar', async () => {
    const { transport, emit, dispatched } = createFakeTransport()
    const api = createNeutralinoApi(transport)

    const p = api.invoke(INVOKE_CHANNELS.sitesImportJson)
    await vi.waitFor(() => expect(dispatched).toHaveLength(1))
    expect(transport.showOpenDialog).toHaveBeenCalledWith('Import sites backup', {
      multiSelections: false,
      filters: [{ name: 'Ferry sites backup', extensions: ['json'] }]
    })
    const dispatchedCall = dispatched[0].data as { id: string; channel: string; args: unknown[] }
    expect(dispatchedCall.channel).toBe(INVOKE_CHANNELS.sitesImportJson)
    expect(dispatchedCall.args).toEqual(['C:\\tmp\\picked.json'])

    emit('rpc_reply', { id: dispatchedCall.id, result: ok({ imported: 2, skipped: 1 }) })
    expect(await p).toEqual(ok({ imported: 2, skipped: 1 }))

    // Canceled file picker returns ok(null) without invoking sidecar.
    ;(transport.showOpenDialog as ReturnType<typeof vi.fn>).mockResolvedValueOnce([])
    expect(await api.invoke(INVOKE_CHANNELS.sitesImportJson)).toEqual(ok(null))
    expect(dispatched).toHaveLength(1)
  })

  it('rejects in-flight invoke calls on sidecar disconnect and waits for sidecar:ready again', async () => {
    const { transport, emit, dispatched } = createFakeTransport()
    const api = createNeutralinoApi(transport)

    const inFlight = api.invoke(INVOKE_CHANNELS.settingsGet)
    await vi.waitFor(() => expect(dispatched).toHaveLength(1))

    ;(transport.getExtensionStats as ReturnType<typeof vi.fn>).mockResolvedValue({
      loaded: ['js.ferry.sidecar'],
      connected: []
    })
    emit('extClientDisconnect', 'js.ferry.sidecar')
    await expect(inFlight).rejects.toThrow('Sidecar disconnected before replying')

    const nextCall = api.invoke(INVOKE_CHANNELS.settingsGet)
    await Promise.resolve()
    expect(dispatched).toHaveLength(1)

    emit('sidecar:ready', { extensionId: 'js.ferry.sidecar' })
    await vi.waitFor(() => expect(dispatched).toHaveLength(2))
    const call2 = dispatched[1].data as { id: string }
    emit('rpc_reply', { id: call2.id, result: ok({ theme: 'light' }) })
    expect(await nextCall).toEqual(ok({ theme: 'light' }))
  })

  it('decodeB64Deep leaves normal objects untouched while decoding nested { __b64 }', () => {
    const input = { a: 1, b: [true, { __b64: Buffer.from('abc').toString('base64') }], c: { __b64: 123 } }
    const out = decodeB64Deep(input) as { a: number; b: [boolean, Uint8Array]; c: { __b64: number } }
    expect(out.a).toBe(1)
    expect(out.b[0]).toBe(true)
    expect(Array.from(out.b[1])).toEqual([97, 98, 99])
    expect(out.c).toEqual({ __b64: 123 })
  })

  it('encodeB64Deep encodes nested Uint8Arrays into { __b64 } markers', () => {
    const encoded = encodeB64Deep({ entries: [{ relativePath: 'a.bin', data: new Uint8Array([1, 2, 255]) }] })
    expect(encoded).toEqual({
      entries: [{ relativePath: 'a.bin', data: { __b64: Buffer.from([1, 2, 255]).toString('base64') } }]
    })
  })

  it('times out when sidecar never becomes ready or fails to reply within rpcTimeoutMs', async () => {
    vi.useFakeTimers()
    try {
      const { transport: coldTransport, emit: emitCold } = createFakeTransport([])
      const coldApi = createNeutralinoApi(coldTransport, { readyTimeoutMs: 500, rpcTimeoutMs: 500 })
      const readyPromise = coldApi.invoke(INVOKE_CHANNELS.settingsGet)
      const readyAssertion = expect(readyPromise).rejects.toThrow('Sidecar did not become ready within 500ms')
      await vi.advanceTimersByTimeAsync(500)
      await readyAssertion

      // Subsequent call succeeds once sidecar announces readiness, while slow RPC replies time out.
      emitCold('sidecar:ready', { extensionId: 'js.ferry.sidecar' })
      const slowCall = coldApi.invoke(INVOKE_CHANNELS.settingsGet)
      const rpcAssertion = expect(slowCall).rejects.toThrow('Sidecar RPC timed out after 500ms: settings:get')
      await vi.advanceTimersByTimeAsync(500)
      await rpcAssertion
    } finally {
      vi.useRealTimers()
    }
  })

  it('restricts neutralino.config.json nativeAllowList to explicit methods without shell execution or filesystem wildcards', () => {
    const configPath = join(process.cwd(), 'neutralino.config.json')
    const config = JSON.parse(readFileSync(configPath, 'utf8')) as { nativeAllowList: string[] }
    expect(config.nativeAllowList.length).toBeGreaterThan(0)
    for (const entry of config.nativeAllowList) {
      expect(entry).not.toContain('*')
      expect(entry).not.toMatch(/^filesystem\./)
    }
    expect(config.nativeAllowList).not.toContain('os.execCommand')
    expect(config.nativeAllowList).not.toContain('os.spawnProcess')
    expect(config.nativeAllowList).not.toContain('app.killProcess')
  })
})
