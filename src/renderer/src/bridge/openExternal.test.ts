// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { openExternal } from './neutralinoApi'

function setup() {
  const nativeOpen = vi.fn(async (_url: string) => {})
  const windowOpen = vi.spyOn(window, 'open').mockImplementation(() => null)

  Object.defineProperty(window, 'webkit', {
    configurable: true,
    value: { messageHandlers: { ferry: { postMessage: vi.fn() } } }
  })
  window.api = { openExternal: nativeOpen } as unknown as typeof window.api

  return { nativeOpen, windowOpen }
}

afterEach(() => {
  vi.restoreAllMocks()
  Reflect.deleteProperty(window, 'webkit')
  Reflect.deleteProperty(window, 'api')
})

describe('openExternal', () => {
  it('routes HTTPS links through the WKWebView native opener', async () => {
    const { nativeOpen, windowOpen } = setup()

    await openExternal('https://example.com/path')

    expect(nativeOpen).toHaveBeenCalledWith('https://example.com/path')
    expect(windowOpen).not.toHaveBeenCalled()
  })

  it.each(['http://example.com', 'javascript:alert(1)', 'file:///tmp/file.txt', 'not a URL'])(
    'blocks non-HTTPS or invalid URLs: %s',
    async (url) => {
      const { nativeOpen, windowOpen } = setup()

      await openExternal(url)

      expect(nativeOpen).not.toHaveBeenCalled()
      expect(windowOpen).not.toHaveBeenCalled()
    }
  )
})
