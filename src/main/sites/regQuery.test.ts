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
    expect(listRegSubkeyPaths(output, 'HKCU\\Software\\SimonTatham\\PuTTY\\Sessions')).toEqual([
      'HKEY_CURRENT_USER\\Software\\SimonTatham\\PuTTY\\Sessions\\Default%20Settings',
      'HKEY_CURRENT_USER\\Software\\SimonTatham\\PuTTY\\Sessions\\myserver'
    ])
  })

  it('ignores the header line even when queried via the short HKCU alias', () => {
    const output = [
      'HKCU\\Software\\SimonTatham\\PuTTY\\Sessions',
      '',
      'HKEY_CURRENT_USER\\Software\\SimonTatham\\PuTTY\\Sessions\\onlyone'
    ].join('\r\n')
    expect(listRegSubkeyPaths(output, 'HKCU\\Software\\SimonTatham\\PuTTY\\Sessions')).toEqual([
      'HKEY_CURRENT_USER\\Software\\SimonTatham\\PuTTY\\Sessions\\onlyone'
    ])
  })

  it('returns an empty array when there are no subkeys', () => {
    expect(
      listRegSubkeyPaths('HKCU\\Software\\SimonTatham\\PuTTY\\Sessions\r\n\r\n', 'HKCU\\Software\\SimonTatham\\PuTTY\\Sessions')
    ).toEqual([])
  })

  it('does not mistake its own echoed header for a child when queried by its full hive-qualified path (recursion case)', () => {
    // Recursing into a folder-group queries the already-fully-qualified path
    // returned by a previous call, so the echoed header here is ALSO a
    // HKEY_CURRENT_USER\... string — matching by prefix alone would treat
    // this key as its own child and recurse forever.
    const output = [
      'HKEY_CURRENT_USER\\Software\\Martin Prikryl\\WinSCP 2\\Sessions\\Work',
      '',
      'HKEY_CURRENT_USER\\Software\\Martin Prikryl\\WinSCP 2\\Sessions\\Work\\db1',
      ''
    ].join('\r\n')
    expect(
      listRegSubkeyPaths(output, 'HKEY_CURRENT_USER\\Software\\Martin Prikryl\\WinSCP 2\\Sessions\\Work')
    ).toEqual(['HKEY_CURRENT_USER\\Software\\Martin Prikryl\\WinSCP 2\\Sessions\\Work\\db1'])
  })

  it('does not mistake its own header for a child on real reg.exe output, which leads with a blank line (not the header)', () => {
    // Captured verbatim (via execFile, no shell) from a real Windows machine:
    // line 0 is blank, the header is line 1 — NOT line 0 as previously assumed.
    // A positional "skip line 0" strips the blank line and leaves the header
    // intact, where it then matches its own HKEY_ prefix filter and gets
    // misidentified as a child of itself (the actual bug a user hit in
    // production: imported WinSCP session names came out self-concatenated,
    // e.g. "fintech@10.123.1.68/fintech@10.123.1.68").
    const leafOutput = [
      '',
      'HKEY_CURRENT_USER\\Software\\Martin Prikryl\\WinSCP 2\\Sessions\\fintech@10.123.1.68',
      '    HostName    REG_SZ    10.123.1.68',
      '    UserName    REG_SZ    fintech',
      '    Password    REG_SZ    A35C4056',
      '',
      ''
    ].join('\r\n')
    expect(
      listRegSubkeyPaths(leafOutput, 'HKEY_CURRENT_USER\\Software\\Martin Prikryl\\WinSCP 2\\Sessions\\fintech@10.123.1.68')
    ).toEqual([])

    // The root query (only subkeys, no values of its own) omits the header
    // line entirely — just a leading blank line, then children, then a
    // trailing blank line.
    const rootOutput = [
      '',
      'HKEY_CURRENT_USER\\Software\\Martin Prikryl\\WinSCP 2\\Sessions\\fintech@10.123.1.68',
      'HKEY_CURRENT_USER\\Software\\Martin Prikryl\\WinSCP 2\\Sessions\\nvtthien@172.19.70.246',
      ''
    ].join('\r\n')
    expect(listRegSubkeyPaths(rootOutput, 'HKCU\\Software\\Martin Prikryl\\WinSCP 2\\Sessions')).toEqual([
      'HKEY_CURRENT_USER\\Software\\Martin Prikryl\\WinSCP 2\\Sessions\\fintech@10.123.1.68',
      'HKEY_CURRENT_USER\\Software\\Martin Prikryl\\WinSCP 2\\Sessions\\nvtthien@172.19.70.246'
    ])
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
