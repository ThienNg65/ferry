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
  chat: vi.fn(),
  cancel: vi.fn()
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

  it('forwards v2 workspaceSignal + requestId on chat and wires companion:ai:cancel', async () => {
    aiServiceMock.chat.mockResolvedValue({ ok: true, text: 'ok' })
    aiServiceMock.cancel.mockReturnValue(true)

    const chatRes = await invoke(INVOKE_CHANNELS.companionAiChat, {
      requestId: 'req-1',
      prompt: 'Inspect host',
      workspaceSignal: {
        siteName: 'prod-box',
        siteEnvironment: 'prod',
        remoteOs: 'Ubuntu 22.04',
        remoteShell: '/bin/bash',
        remoteCwd: '/var/log',
        terminalTail: 'last lines',
        sftpSummary: '2 files',
        lastTransferError: 'EACCES',
        logBasename: 'error.log'
      },
      context: { appVersion: '1.5.0', isConnected: true, theme: 'dark' }
    })
    expect(chatRes).toMatchObject({ ok: true })
    expect(aiServiceMock.chat).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: 'req-1',
        workspaceSignal: expect.objectContaining({
          siteName: 'prod-box',
          siteEnvironment: 'prod',
          remoteOs: 'Ubuntu 22.04',
          remoteShell: '/bin/bash',
          remoteCwd: '/var/log',
          terminalTail: 'last lines',
          sftpSummary: '2 files',
          lastTransferError: 'EACCES',
          logBasename: 'error.log'
        })
      })
    )

    const cancelRes = await invoke(INVOKE_CHANNELS.companionAiCancel, { requestId: 'req-1' })
    expect(cancelRes).toEqual({ ok: true, data: { cancelled: true } })
    expect(aiServiceMock.cancel).toHaveBeenCalledWith('req-1')

    expect(await invoke(INVOKE_CHANNELS.companionAiCancel, 'bad')).toMatchObject({ ok: false, code: 'VALIDATION' })
  })
})
