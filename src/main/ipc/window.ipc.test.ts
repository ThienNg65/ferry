import { beforeEach, describe, expect, it, vi } from 'vitest'
import { handlers } from './envelope'
import { INVOKE_CHANNELS, type IpcResult } from '../../shared/contract'

const registered = handlers as unknown as Map<string, (...args: unknown[]) => Promise<unknown>>

const windowsWindowMock = {
  getNativeDisplays: vi.fn(),
  isValidColorRef: vi.fn((val: unknown) => typeof val === 'number' && Number.isInteger(val) && val >= 0 && val <= 0xffffff),
  syncWindowsWindowTheme: vi.fn()
}

vi.mock('../host/windowsWindow', () => windowsWindowMock)

async function invoke(channel: string, ...args: unknown[]): Promise<IpcResult<unknown>> {
  const cb = registered.get(channel)
  if (!cb) throw new Error(`channel not registered: ${channel}`)
  return (await cb({}, ...args)) as IpcResult<unknown>
}

describe('window.ipc', () => {
  beforeEach(async () => {
    registered.clear()
    vi.clearAllMocks()
    const { registerWindowHandlers } = await import('./window.ipc')
    registerWindowHandlers()
  })

  it('window:syncTheme forwards valid theme and captionColor', async () => {
    windowsWindowMock.syncWindowsWindowTheme.mockReturnValueOnce(true)
    const result = await invoke(INVOKE_CHANNELS.windowSyncTheme, { theme: 'dark', captionColor: 0x112233 })
    expect(windowsWindowMock.syncWindowsWindowTheme).toHaveBeenCalledWith('dark', undefined, undefined, 0x112233)
    expect(result).toEqual({ ok: true, data: true })
  })

  it('window:syncTheme rejects invalid theme or captionColor with VALIDATION code', async () => {
    const badTheme = await invoke(INVOKE_CHANNELS.windowSyncTheme, { theme: 'neon' })
    expect(badTheme).toMatchObject({ ok: false, code: 'VALIDATION' })

    const badColor = await invoke(INVOKE_CHANNELS.windowSyncTheme, { theme: 'light', captionColor: -1 })
    expect(badColor).toMatchObject({ ok: false, code: 'VALIDATION' })

    expect(windowsWindowMock.syncWindowsWindowTheme).not.toHaveBeenCalled()
  })
})
