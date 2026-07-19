import { describe, expect, it, vi } from 'vitest'
import type { ProxyConfig } from '../../shared/contract'

vi.mock('electron', () => ({ BrowserWindow: { getAllWindows: () => [] } }))

const FAKE_DEFAULT_PROXY: ProxyConfig = { type: 'socks5', host: 'default.proxy.example', port: 1080 }

vi.mock('../app/AppSettingsStore', () => ({
  AppSettingsStore: {
    getInstance: () => ({
      getDecryptedDefaultProxy: () => FAKE_DEFAULT_PROXY
    })
  }
}))

const CUSTOM_PROXY: ProxyConfig = { type: 'http', host: 'custom.proxy.example', port: 8080 }

describe('resolveEffectiveProxy', () => {
  it('returns undefined (direct connection) for proxyMode "none", even if an app-wide default is set', async () => {
    const { resolveEffectiveProxy } = await import('./SessionManager')
    expect(resolveEffectiveProxy('none', CUSTOM_PROXY)).toBeUndefined()
    expect(resolveEffectiveProxy('none', undefined)).toBeUndefined()
  })

  it('returns the site\'s own proxy for proxyMode "custom"', async () => {
    const { resolveEffectiveProxy } = await import('./SessionManager')
    expect(resolveEffectiveProxy('custom', CUSTOM_PROXY)).toBe(CUSTOM_PROXY)
  })

  it('falls back to the app-wide default for proxyMode "inherit"', async () => {
    const { resolveEffectiveProxy } = await import('./SessionManager')
    expect(resolveEffectiveProxy('inherit', CUSTOM_PROXY)).toBe(FAKE_DEFAULT_PROXY)
  })

  it('falls back to the app-wide default when proxyMode is absent (sites saved before this feature existed)', async () => {
    const { resolveEffectiveProxy } = await import('./SessionManager')
    expect(resolveEffectiveProxy(undefined, undefined)).toBe(FAKE_DEFAULT_PROXY)
  })
})
