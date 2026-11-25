import { beforeEach, describe, expect, it, vi } from 'vitest'
import { INVOKE_CHANNELS, type IpcResult } from '../../shared/contract'
import { handlers } from './envelope'

const registered = handlers as unknown as Map<string, (...args: unknown[]) => Promise<unknown>>

const appSettingsMock = {
  getCompanionAiConfig: vi.fn(),
  setCompanionAiConfig: vi.fn(),
  setUiPref: vi.fn()
}

const aiServiceMock = {
  testConnection: vi.fn(),
  chat: vi.fn()
}

const releasesServiceMock = {
  getReleases: vi.fn()
}

vi.mock('../app/AppSettingsStore', () => ({
  AppSettingsStore: { getInstance: () => appSettingsMock }
}))

vi.mock('../companion/AiCompanionService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../companion/AiCompanionService')>()
  return {
    ...actual,
    AiCompanionService: { getInstance: () => aiServiceMock }
  }
})

vi.mock('../companion/ReleaseNotesService', () => ({
  ReleaseNotesService: { getInstance: () => releasesServiceMock }
}))

async function invoke(channel: string, ...args: unknown[]): Promise<IpcResult<unknown>> {
  const cb = registered.get(channel)
  if (!cb) throw new Error(`channel not registered: ${channel}`)
  return (await cb({}, ...args)) as IpcResult<unknown>
}

describe('companion.ipc & settingsSetUiPref', () => {
  beforeEach(async () => {
    registered.clear()
    vi.clearAllMocks()
    const { registerCompanionHandlers } = await import('./companion.ipc')
    const { registerSettingsHandlers } = await import('./settings.ipc')
    registerCompanionHandlers()
    registerSettingsHandlers()
  })

  it('rejects malformed companion payloads with VALIDATION code', async () => {
    expect(await invoke(INVOKE_CHANNELS.companionGetReleases, 'bad')).toMatchObject({ ok: false, code: 'VALIDATION' })
    expect(await invoke(INVOKE_CHANNELS.companionAiSetConfig, { provider: 'ollama' })).toMatchObject({
      ok: false,
      code: 'VALIDATION'
    })
    expect(
      await invoke(INVOKE_CHANNELS.companionAiSetConfig, {
        provider: 'ferry-pro',
        endpoint: 'http://proxy.example.com',
        model: 'gemini-4-hydrogen'
      })
    ).toMatchObject({ ok: false, code: 'VALIDATION' })
    expect(await invoke(INVOKE_CHANNELS.companionAiChat, { prompt: '   ' })).toMatchObject({
      ok: false,
      code: 'VALIDATION'
    })
  })

  it('allows large snippet/history payloads in settings:setUiPref while keeping 4096-char cap for standard keys', async () => {
    const bigSnippets = 'S'.repeat(10_000)
    const okRes = await invoke(INVOKE_CHANNELS.settingsSetUiPref, {
      key: 'ferry:ui:companionSnippets',
      value: bigSnippets
    })
    expect(okRes).toEqual({ ok: true, data: undefined })
    expect(appSettingsMock.setUiPref).toHaveBeenCalledWith('ferry:ui:companionSnippets', bigSnippets)

    const rejectedRes = await invoke(INVOKE_CHANNELS.settingsSetUiPref, {
      key: 'ferry:ui:theme',
      value: 'X'.repeat(5_000)
    })
    expect(rejectedRes).toMatchObject({ ok: false, code: 'VALIDATION' })
  })
})
