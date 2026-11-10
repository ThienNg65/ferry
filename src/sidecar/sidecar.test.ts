import { randomBytes } from 'crypto'
import { PassThrough } from 'stream'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const calls: string[] = []

vi.mock('../main/ipc/registerSidecar', () => ({ registerSidecarHandlers: () => calls.push('register') }))
vi.mock('../main/history/HistoryRecorder', () => ({ initHistoryRecorder: () => calls.push('history-recorder') }))
vi.mock('../main/history/HistoryStore', () => ({
  HistoryStore: { getInstance: () => ({ flush: () => calls.push('history-flush') }) }
}))
vi.mock('../main/edit/EditSessionManager', () => ({
  EditSessionManager: { getInstance: () => ({ disposeAll: async () => calls.push('edit-dispose') }) }
}))
vi.mock('../main/app/AppSettingsStore', () => ({
  AppSettingsStore: { getInstance: () => ({ get: () => ({ bandwidthLimitKBps: 512 }) }) }
}))
vi.mock('../main/transfer/TransferQueue', () => ({
  TransferQueue: { getInstance: () => ({ setBandwidthLimitKBps: (limit: number) => calls.push(`bandwidth:${limit}`) }) }
}))
vi.mock('../main/ssh/KnownHostsStore', () => ({
  KnownHostsStore: { getInstance: () => calls.push('known-hosts') }
}))

const { startSidecar } = await import('./sidecar')
const { host } = await import('../main/host/host')

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 20))

describe('startSidecar', () => {
  beforeEach(() => {
    calls.length = 0
  })

  it('installs the node host and starts background services only after init', async () => {
    const input = new PassThrough()
    const out: string[] = []
    startSidecar(input, (line) => out.push(line), () => {})
    expect(calls).toEqual(['register'])

    const key = randomBytes(32)
    input.write(`${JSON.stringify({ type: 'init', key: key.toString('base64'), dataDir: 'D:\\ferry-data' })}\n`)
    await settle()

    expect(calls).toEqual(['register', 'history-recorder', 'bandwidth:512', 'known-hosts'])
    expect(host().dataDir).toBe('D:\\ferry-data')
    expect(host().decrypt(host().encrypt('pw'))).toBe('pw')
    host().broadcast('tail:line', { tailId: 't', line: 'x' })
    expect(JSON.parse(out[0])).toEqual({ event: 'tail:line', payload: { tailId: 't', line: 'x' } })
  })

  it('flushes history and disposes edits before exiting on shutdown', async () => {
    const input = new PassThrough()
    const exit = vi.fn((code: number) => calls.push(`exit:${code}`))
    startSidecar(input, () => {}, exit)
    input.write(`${JSON.stringify({ type: 'init', key: randomBytes(32).toString('base64'), dataDir: 'D:\\d' })}\n`)
    input.write(`${JSON.stringify({ type: 'shutdown' })}\n`)
    await settle()
    expect(calls.slice(-3)).toEqual(['history-flush', 'edit-dispose', 'exit:0'])
  })

  it('exits without touching stores when stdin closes before init', async () => {
    const input = new PassThrough()
    startSidecar(input, () => {}, (code) => calls.push(`exit:${code}`))
    input.end()
    await settle()
    expect(calls).toEqual(['register', 'exit:0'])
  })
})
