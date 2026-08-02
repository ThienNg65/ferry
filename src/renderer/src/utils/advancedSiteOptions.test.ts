import { describe, expect, it } from 'vitest'
import { shouldExpandAdvanced } from './advancedSiteOptions'

const baseHop = {
  host: 'bastion.example.com',
  port: 22,
  username: 'jump-user',
  authMethod: 'password' as const,
  hasPassword: true,
  hasPassphrase: false
}

describe('shouldExpandAdvanced', () => {
  it('is false for a brand new site (no site object yet)', () => {
    expect(shouldExpandAdvanced(null)).toBe(false)
    expect(shouldExpandAdvanced(undefined)).toBe(false)
  })

  it('is false for a site with no jump hosts and no custom proxy', () => {
    expect(shouldExpandAdvanced({ jumpHosts: [], proxyMode: 'inherit' })).toBe(false)
    expect(shouldExpandAdvanced({ jumpHosts: undefined, proxyMode: 'none' })).toBe(false)
    expect(shouldExpandAdvanced({ jumpHosts: undefined, proxyMode: undefined })).toBe(false)
  })

  it('is true when the site already has at least one jump host', () => {
    expect(shouldExpandAdvanced({ jumpHosts: [baseHop], proxyMode: 'inherit' })).toBe(true)
  })

  it('is true when the site uses a custom proxy', () => {
    expect(shouldExpandAdvanced({ jumpHosts: [], proxyMode: 'custom' })).toBe(true)
  })
})
