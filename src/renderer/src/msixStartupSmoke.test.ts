import { beforeEach, describe, expect, it, vi } from 'vitest'
import { INVOKE_CHANNELS } from '@shared/contract'
import { invoke } from './api'
import { reportMsixStartup } from './msixStartupSmoke'

vi.mock('./api', () => ({ invoke: vi.fn() }))

describe('MSIX startup report', () => {
  const invokeMock = vi.mocked(invoke)

  beforeEach(() => {
    invokeMock.mockReset()
  })

  it.each([{ sites: [] }, { sites: [{ name: 'Private site' }] }])('reports only the outcome of a successful sites:list', async ({ sites }) => {
    invokeMock.mockResolvedValueOnce(sites)

    await reportMsixStartup()

    expect(invokeMock.mock.calls).toEqual([
      [INVOKE_CHANNELS.sitesList],
      [INVOKE_CHANNELS.windowSetTitle, 'Ferry MSIX smoke: sites ready']
    ])
  })

  it('leaves the title alone until the sidecar responds', async () => {
    let complete!: (sites: []) => void
    invokeMock.mockReturnValueOnce(new Promise<[]>((resolve) => { complete = resolve }))
    const report = reportMsixStartup()

    expect(invokeMock.mock.calls).toEqual([[INVOKE_CHANNELS.sitesList]])
    complete([])
    await report
    expect(invokeMock).toHaveBeenLastCalledWith(INVOKE_CHANNELS.windowSetTitle, 'Ferry MSIX smoke: sites ready')
  })

  it.each(['Sidecar did not become ready', 'Sidecar RPC timed out'])('reports %s as a failure', async (message) => {
    invokeMock.mockRejectedValueOnce(new Error(message))

    await reportMsixStartup()

    expect(invokeMock).toHaveBeenLastCalledWith(INVOKE_CHANNELS.windowSetTitle, 'Ferry MSIX smoke: sites failed')
  })

  it.each([null, undefined, {}, '[]'])('rejects a malformed sites:list payload (%j)', async (response) => {
    invokeMock.mockResolvedValueOnce(response)

    await reportMsixStartup()

    expect(invokeMock).toHaveBeenLastCalledWith(INVOKE_CHANNELS.windowSetTitle, 'Ferry MSIX smoke: sites failed')
  })
})
