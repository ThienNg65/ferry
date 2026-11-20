import { PassThrough } from 'stream'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { handle, handlers, onSend, sendHandlers } from '../main/ipc/envelope'
import { SshError } from '../main/ssh/errors'
import { decodeB64Deep, encodeLine, serve, type SidecarHooks } from './protocol'

function harness(): { input: PassThrough; out: unknown[]; hooks: SidecarHooks & { init: ReturnType<typeof vi.fn>; shutdown: ReturnType<typeof vi.fn> } } {
  const input = new PassThrough()
  const out: unknown[] = []
  const hooks = { init: vi.fn(), shutdown: vi.fn(async () => {}) }
  serve(input, (line) => out.push(JSON.parse(line)), hooks)
  return { input, out, hooks }
}

const send = (input: PassThrough, value: unknown): boolean => input.write(`${JSON.stringify(value)}\n`)
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 20))

describe('sidecar protocol', () => {
  beforeEach(() => {
    handlers.clear()
    sendHandlers.clear()
  })

  it('passes the init line to the init hook', async () => {
    const { input, hooks } = harness()
    send(input, { type: 'init', key: 'a2V5', dataDir: 'C:\\data' })
    await settle()
    expect(hooks.init).toHaveBeenCalledWith({ type: 'init', key: 'a2V5', dataDir: 'C:\\data' })
  })

  it('answers overlapping requests by id, in completion order', async () => {
    let releaseSlow: () => void = () => {}
    handle('sites:list', () => new Promise((resolve) => (releaseSlow = () => resolve('slow'))))
    handle('bookmarks:list', () => 'fast')
    const { input, out } = harness()
    send(input, { id: 1, channel: 'sites:list', args: [] })
    send(input, { id: 2, channel: 'bookmarks:list', args: [] })
    await settle()
    expect(out).toEqual([{ id: 2, result: { ok: true, data: 'fast' } }])
    releaseSlow()
    await settle()
    expect(out[1]).toEqual({ id: 1, result: { ok: true, data: 'slow' } })
  })

  it('routes fire-and-forget send messages to sendHandlers', async () => {
    const received: unknown[] = []
    onSend('terminal:input', (_e, payload) => received.push(payload))
    const { input } = harness()
    send(input, { type: 'send', channel: 'terminal:input', payload: { terminalId: 't1', data: 'ls\n' } })
    await settle()
    expect(received).toEqual([{ terminalId: 't1', data: 'ls\n' }])
  })

  it('passes args through and keeps SshError code and hostKey', async () => {
    handle('session:open', (host, port) => {
      throw new SshError('HOST_KEY_MISMATCH', `changed ${host}`, false, { host: host as string, port: port as number })
    })
    const { input, out } = harness()
    send(input, { id: 7, channel: 'session:open', args: ['h', 22] })
    await settle()
    expect(out).toEqual([
      { id: 7, result: { ok: false, code: 'HOST_KEY_MISMATCH', message: 'changed h', hostKey: { host: 'h', port: 22 } } }
    ])
  })

  it('answers an unknown channel with UNKNOWN instead of hanging', async () => {
    const { input, out } = harness()
    send(input, { id: 3, channel: 'window:close', args: [] })
    await settle()
    expect(out).toEqual([{ id: 3, result: { ok: false, code: 'UNKNOWN', message: 'IPC channel not handled by sidecar: window:close' } }])
  })

  it('ignores a malformed line and keeps serving', async () => {
    handle('sites:list', () => [])
    const { input, out } = harness()
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    input.write('{not json\n')
    send(input, { id: 4, channel: 'sites:list', args: [] })
    await settle()
    expect(out).toEqual([{ id: 4, result: { ok: true, data: [] } }])
    error.mockRestore()
  })

  it('shuts down once on a shutdown line followed by stdin EOF', async () => {
    const { input, hooks } = harness()
    send(input, { type: 'shutdown' })
    input.end()
    await settle()
    expect(hooks.shutdown).toHaveBeenCalledTimes(1)
  })

  it('shuts down on stdin EOF alone', async () => {
    const { input, hooks } = harness()
    input.end()
    await settle()
    expect(hooks.shutdown).toHaveBeenCalledTimes(1)
  })

  it('ignores valid JSON null lines and catches throwing send handlers without crashing', async () => {
    handle('sites:list', () => [])
    onSend('terminal:input', () => {
      throw new Error('boom')
    })
    const { input, out } = harness()
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    input.write('null\n')
    send(input, { type: 'send', channel: 'terminal:input', payload: { terminalId: 't1', data: 'x' } })
    send(input, { id: 9, channel: 'sites:list', args: [] })
    await settle()
    expect(out).toEqual([{ id: 9, result: { ok: true, data: [] } }])
    errorSpy.mockRestore()
  })
})

describe('encodeLine', () => {
  it('encodes Buffer and Uint8Array payloads as base64', () => {
    const bytes = new Uint8Array([0xff, 0x00, 0x1b])
    expect(JSON.parse(encodeLine({ event: 'terminal:data', payload: { terminalId: 't', data: Buffer.from(bytes) } }))).toEqual({
      event: 'terminal:data',
      payload: { terminalId: 't', data: { __b64: '/wAb' } }
    })
    expect(JSON.parse(encodeLine({ data: bytes }))).toEqual({ data: { __b64: '/wAb' } })
  })

  it('encodes only the viewed slice of a typed array', () => {
    const backing = new Uint8Array([1, 2, 0xff, 0x00, 0x1b, 9])
    expect(JSON.parse(encodeLine({ data: backing.subarray(2, 5) }))).toEqual({ data: { __b64: '/wAb' } })
  })

  it('emits a single line', () => {
    expect(encodeLine({ text: 'a\nb' })).not.toContain('\n')
  })

  it('decodes nested { __b64 } markers back into Buffers', () => {
    const decoded = decodeB64Deep({ entries: [{ data: { __b64: '/wAb' } }] }) as { entries: [{ data: Buffer }] }
    expect(Buffer.isBuffer(decoded.entries[0].data)).toBe(true)
    expect(Array.from(decoded.entries[0].data)).toEqual([0xff, 0x00, 0x1b])
  })

  it('ignores __proto__ keys during decodeB64Deep', () => {
    const raw = JSON.parse('{"__proto__":{"polluted":true},"safe":1}') as unknown
    const decoded = decodeB64Deep(raw) as Record<string, unknown>
    expect(decoded.safe).toBe(1)
    expect((decoded as { polluted?: boolean }).polluted).toBeUndefined()
  })
})
