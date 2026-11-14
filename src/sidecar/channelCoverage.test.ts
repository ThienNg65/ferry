import { describe, expect, it, vi } from 'vitest'
import { HOST_INVOKE_CHANNELS, INVOKE_CHANNELS, SEND_CHANNELS } from '../shared/contract'

vi.mock('electron', () => {
  throw new Error('the sidecar module graph must not import electron')
})

const { handlers, sendHandlers } = await import('../main/ipc/envelope')
const { registerSidecarHandlers } = await import('../main/ipc/registerSidecar')

describe('sidecar channel coverage', () => {
  it('registers exactly the invoke and send channels the shell host does not own', () => {
    registerSidecarHandlers()
    const expected = Object.values(INVOKE_CHANNELS).filter((c) => !HOST_INVOKE_CHANNELS.includes(c))
    expect([...handlers.keys()].sort()).toEqual(expected.sort())
    expect([...sendHandlers.keys()].sort()).toEqual(Object.values(SEND_CHANNELS).sort())
  })

  it('lists no host channel twice and only real channels', () => {
    expect(new Set(HOST_INVOKE_CHANNELS).size).toBe(HOST_INVOKE_CHANNELS.length)
    for (const channel of HOST_INVOKE_CHANNELS) {
      expect(Object.values(INVOKE_CHANNELS)).toContain(channel)
    }
  })
})
