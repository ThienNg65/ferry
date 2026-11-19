import { reactive } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { INVOKE_CHANNELS } from '@shared/contract'
import { invoke } from './api'

describe('api invoke toCloneable', () => {
  it('preserves Uint8Array payloads while stripping Vue reactive proxies', async () => {
    setActivePinia(createPinia())
    const invokeSpy = vi.fn(async (_channel: string, ..._args: unknown[]) => ({ ok: true, data: [] }))
    Object.assign(globalThis, {
      window: {
        api: {
          invoke: invokeSpy,
          on: vi.fn(),
          off: vi.fn(),
          send: vi.fn()
        }
      }
    })

    const payload = reactive({
      entries: [{ relativePath: 'a.bin', isDir: false, data: new Uint8Array([1, 2, 255]) }]
    })
    await invoke(INVOKE_CHANNELS.fsLocalStageDrop, payload)

    expect(invokeSpy).toHaveBeenCalledOnce()
    const forwarded = invokeSpy.mock.calls[0]?.[1] as unknown as { entries: Array<{ data: unknown }> }
    expect(forwarded.entries[0].data).toBeInstanceOf(Uint8Array)
    expect(Array.from(forwarded.entries[0].data as Uint8Array)).toEqual([1, 2, 255])
  })
})
