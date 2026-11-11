import { describe, expect, it } from 'vitest'
import { parseSitesBackup } from './sitesBackup'

const validSite = { name: 'a', host: 'h.example.com', port: 22, username: 'u', authMethod: 'password', hasPassword: true }

describe('parseSitesBackup', () => {
  it('accepts an exported backup and drops secrets and unknown fields', () => {
    const out = parseSitesBackup(JSON.stringify({ schemaVersion: 1, sites: [{ ...validSite, id: 'x', environment: 'prod' }] }))
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ name: 'a', host: 'h.example.com', environment: 'prod' })
    expect(out[0]).not.toHaveProperty('id')
    expect(out[0]).not.toHaveProperty('hasPassword')
  })

  it('rejects wrong schema versions and invalid JSON', () => {
    expect(() => parseSitesBackup('nope')).toThrow(/valid JSON/)
    expect(() => parseSitesBackup(JSON.stringify({ schemaVersion: 2, sites: [] }))).toThrow(/schemaVersion 1/)
  })

  it('rejects bad fields with the site number in the message', () => {
    const bad = (patch: object): string =>
      (() => {
        try {
          parseSitesBackup(JSON.stringify({ schemaVersion: 1, sites: [validSite, { ...validSite, ...patch }] }))
          return ''
        } catch (e) {
          return (e as Error).message
        }
      })()
    expect(bad({ port: 70000 })).toMatch(/Site 2: "port"/)
    expect(bad({ authMethod: 'telnet' })).toMatch(/authMethod/)
    expect(bad({ host: '' })).toMatch(/Missing "host"/)
    expect(bad({ environment: 'qa' })).toMatch(/environment/)
    expect(bad({ jumpHosts: [{ host: 'j', port: 0, username: 'u', authMethod: 'password' }] })).toMatch(/jumpHosts.port/)
    expect(bad({ proxyMode: 'custom' })).toMatch(/proxy/)
  })
})
