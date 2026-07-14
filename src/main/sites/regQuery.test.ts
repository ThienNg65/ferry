import { describe, expect, it } from 'vitest'
import { decodeSessionName, listRegSubkeyPaths, parseDword, parseRegValues } from './regQuery'

describe('listRegSubkeyPaths', () => {
  it('extracts child subkey paths, ignoring the echoed HKCU-alias header line', () => {
    const output = [
      'HKCU\\Software\\SimonTatham\\PuTTY\\Sessions',
      '',
      'HKEY_CURRENT_USER\\Software\\SimonTatham\\PuTTY\\Sessions\\Default%20Settings',
      'HKEY_CURRENT_USER\\Software\\SimonTatham\\PuTTY\\Sessions\\myserver',
      ''
    ].join('\r\n')
    expect(listRegSubkeyPaths(output)).toEqual([
      'HKEY_CURRENT_USER\\Software\\SimonTatham\\PuTTY\\Sessions\\Default%20Settings',
      'HKEY_CURRENT_USER\\Software\\SimonTatham\\PuTTY\\Sessions\\myserver'
    ])
  })

  it('ignores the header line even when queried via the short HKCU alias', () => {
    const output = ['HKCU\\Software\\SimonTatham\\PuTTY\\Sessions', '', 'HKEY_CURRENT_USER\\...\\Sessions\\onlyone'].join(
      '\r\n'
    )
    expect(listRegSubkeyPaths(output)).toEqual(['HKEY_CURRENT_USER\\...\\Sessions\\onlyone'])
  })

  it('returns an empty array when there are no subkeys', () => {
    expect(listRegSubkeyPaths('HKCU\\Software\\SimonTatham\\PuTTY\\Sessions\r\n\r\n')).toEqual([])
  })
})

describe('parseRegValues', () => {
  it('parses a typical reg query value listing', () => {
    const output = [
      'HKEY_CURRENT_USER\\Software\\SimonTatham\\PuTTY\\Sessions\\myserver',
      '    HostName    REG_SZ    myserver.example.com',
      '    PortNumber    REG_DWORD    0x16',
      '    UserName    REG_SZ    ferrytest',
      '    PublicKeyFile    REG_SZ    C:\\Users\\me\\.ssh\\id_rsa.ppk',
      ''
    ].join('\r\n')
    const values = parseRegValues(output)
    expect(values.get('HostName')).toBe('myserver.example.com')
    expect(values.get('PortNumber')).toBe('0x16')
    expect(values.get('UserName')).toBe('ferrytest')
    expect(values.get('PublicKeyFile')).toBe('C:\\Users\\me\\.ssh\\id_rsa.ppk')
  })

  it('ignores the header line and blank lines', () => {
    const output = 'HKEY_CURRENT_USER\\Software\\Martin Prikryl\\WinSCP 2\\Sessions\\prod\r\n\r\n    HostName    REG_SZ    prod.example.com\r\n'
    const values = parseRegValues(output)
    expect(values.size).toBe(1)
    expect(values.get('HostName')).toBe('prod.example.com')
  })

  it('returns an empty map for a key with no values', () => {
    expect(parseRegValues('HKEY_CURRENT_USER\\Software\\Foo\r\n\r\n').size).toBe(0)
  })
})

describe('decodeSessionName', () => {
  it('percent-decodes reserved characters', () => {
    expect(decodeSessionName('Default%20Settings')).toBe('Default Settings')
    expect(decodeSessionName('prod%2Fserver')).toBe('prod/server')
  })

  it('falls back to the raw name if it is not validly percent-encoded', () => {
    expect(decodeSessionName('not%a-real-escape')).toBe('not%a-real-escape')
  })

  it('leaves an already-plain name untouched', () => {
    expect(decodeSessionName('myserver')).toBe('myserver')
  })
})

describe('parseDword', () => {
  it('parses a hex REG_DWORD value with the 0x prefix', () => {
    expect(parseDword('0x16', 22)).toBe(22)
    expect(parseDword('0x50', 22)).toBe(80)
  })

  it('falls back when the value is missing', () => {
    expect(parseDword(undefined, 22)).toBe(22)
  })

  it('falls back when the value is not a valid positive number', () => {
    expect(parseDword('not-a-number', 22)).toBe(22)
    expect(parseDword('0x0', 22)).toBe(22)
  })
})
