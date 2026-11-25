import { describe, expect, it } from 'vitest'
import { parseSshConfig, scanPuttySessions, scanWinScpSessions } from './SessionImporter'

// `reg query "<key>"`'s echoed header line uses whatever alias was passed
// (the code queries the short HKCU alias for the root), but every child
// subkey path it prints — at any depth — always comes back in the
// fully-qualified HKEY_CURRENT_USER form (see regQuery.ts's own doc comment).
// The two constants below deliberately differ to reproduce that exactly —
// using HKEY_CURRENT_USER for the root too, as an earlier draft of this test
// did, silently made every case pass vacuously (root lookup always missed).
const QUERY_ROOT = 'HKCU\\Software\\Martin Prikryl\\WinSCP 2\\Sessions'
const FULL_ROOT = 'HKEY_CURRENT_USER\\Software\\Martin Prikryl\\WinSCP 2\\Sessions'

/** Builds a fake `reg query "<key>"` response: an echoed header, this key's own values (if any), then its direct child subkey paths — matching real `reg.exe` output shape (see regQuery.test.ts's fixtures). `childPrefix` defaults to `headerKey` (true for every node except the root, where the two forms diverge — see above). */
function fakeRegOutput(
  headerKey: string,
  values: Record<string, string>,
  childNames: string[],
  childPrefix: string = headerKey
): string {
  const lines = [headerKey, '']
  for (const [name, value] of Object.entries(values)) {
    lines.push(`    ${name}    REG_SZ    ${value}`)
  }
  if (Object.keys(values).length > 0) {
    lines.push('')
  }
  for (const child of childNames) {
    lines.push(`${childPrefix}\\${child}`)
  }
  lines.push('')
  return lines.join('\r\n')
}

/** A fake registry tree with a nested folder group, a folder group containing both a sub-session and a further-nested group, and a plain top-level session — the exact shape the previous flat implementation dropped. */
function buildFakeTree(): Map<string, string> {
  const tree = new Map<string, string>()
  tree.set(QUERY_ROOT, fakeRegOutput(QUERY_ROOT, {}, ['Work', 'standalone'], FULL_ROOT))
  tree.set(`${FULL_ROOT}\\Work`, fakeRegOutput(`${FULL_ROOT}\\Work`, {}, ['db1', 'Nested']))
  tree.set(
    `${FULL_ROOT}\\Work\\db1`,
    fakeRegOutput(`${FULL_ROOT}\\Work\\db1`, { HostName: 'db1.example.com', PortNumber: '0x16', UserName: 'alice' }, [])
  )
  tree.set(`${FULL_ROOT}\\Work\\Nested`, fakeRegOutput(`${FULL_ROOT}\\Work\\Nested`, {}, ['deep1']))
  tree.set(
    `${FULL_ROOT}\\Work\\Nested\\deep1`,
    fakeRegOutput(`${FULL_ROOT}\\Work\\Nested\\deep1`, { HostName: 'deep1.example.com', UserName: 'bob' }, [])
  )
  tree.set(
    `${FULL_ROOT}\\standalone`,
    fakeRegOutput(`${FULL_ROOT}\\standalone`, { HostName: 'standalone.example.com', UserName: 'carol' }, [])
  )
  return tree
}

describe('scanWinScpSessions', () => {
  it('recurses into nested folder groups instead of dropping everything under them', async () => {
    const tree = buildFakeTree()
    const queryFn = async (key: string): Promise<string | null> => tree.get(key) ?? null

    const candidates = await scanWinScpSessions(queryFn)

    expect(candidates.map((c) => c.name).sort()).toEqual(['Work/Nested/deep1', 'Work/db1', 'standalone'])
    const deep1 = candidates.find((c) => c.name === 'Work/Nested/deep1')
    expect(deep1?.host).toBe('deep1.example.com')
    expect(deep1?.username).toBe('bob')
  })

  it('emits a candidate for a node that has both its own HostName and nested children', async () => {
    const tree = buildFakeTree()
    // Give the "Work" folder-group node its own HostName too — a session and a
    // folder-group are not mutually exclusive in WinSCP's registry shape.
    tree.set(
      `${FULL_ROOT}\\Work`,
      fakeRegOutput(`${FULL_ROOT}\\Work`, { HostName: 'work-group-itself.example.com' }, ['db1', 'Nested'])
    )
    const queryFn = async (key: string): Promise<string | null> => tree.get(key) ?? null

    const candidates = await scanWinScpSessions(queryFn)

    expect(candidates.map((c) => c.name).sort()).toEqual(['Work', 'Work/Nested/deep1', 'Work/db1', 'standalone'])
  })

  it('returns an empty array when the root key does not exist', async () => {
    const candidates = await scanWinScpSessions(async () => null)
    expect(candidates).toEqual([])
  })

  it('does not double the ancestor path when a nested child key already encodes its full path', async () => {
    // On some real WinSCP installs, a nested child key's own registry name
    // already carries its full path from the Sessions root (e.g. `Work%2Fdb1`
    // under the `Work` folder-group), not just the segment relative to its
    // immediate parent — this reproduces that shape.
    const tree = new Map<string, string>()
    tree.set(QUERY_ROOT, fakeRegOutput(QUERY_ROOT, {}, ['Work'], FULL_ROOT))
    tree.set(`${FULL_ROOT}\\Work`, fakeRegOutput(`${FULL_ROOT}\\Work`, {}, ['Work%2Fdb1']))
    tree.set(
      `${FULL_ROOT}\\Work\\Work%2Fdb1`,
      fakeRegOutput(`${FULL_ROOT}\\Work\\Work%2Fdb1`, { HostName: 'db1.example.com', UserName: 'alice' }, [])
    )
    const queryFn = async (key: string): Promise<string | null> => tree.get(key) ?? null

    const candidates = await scanWinScpSessions(queryFn)

    expect(candidates.map((c) => c.name)).toEqual(['Work/db1'])
  })

  it('falls back to defaultUser when UserName is missing or empty', async () => {
    const tree = new Map<string, string>()
    tree.set(QUERY_ROOT, fakeRegOutput(QUERY_ROOT, {}, ['no-user', 'blank-user'], FULL_ROOT))
    tree.set(
      `${FULL_ROOT}\\no-user`,
      fakeRegOutput(`${FULL_ROOT}\\no-user`, { HostName: 'nouser.example.com' }, [])
    )
    tree.set(
      `${FULL_ROOT}\\blank-user`,
      fakeRegOutput(`${FULL_ROOT}\\blank-user`, { HostName: 'blankuser.example.com', UserName: '   ' }, [])
    )
    const queryFn = async (key: string): Promise<string | null> => tree.get(key) ?? null

    const candidates = await scanWinScpSessions(queryFn, 'fallback-user')

    expect(candidates.find((c) => c.name === 'no-user')?.username).toBe('fallback-user')
    expect(candidates.find((c) => c.name === 'blank-user')?.username).toBe('fallback-user')
  })
})

describe('scanPuttySessions', () => {
  const PUTTY_QUERY_ROOT = 'HKCU\\Software\\SimonTatham\\PuTTY\\Sessions'
  const PUTTY_FULL_ROOT = 'HKEY_CURRENT_USER\\Software\\SimonTatham\\PuTTY\\Sessions'

  it('falls back to defaultUser when UserName is missing or empty and preserves explicit UserName', async () => {
    const tree = new Map<string, string>()
    tree.set(
      PUTTY_QUERY_ROOT,
      fakeRegOutput(PUTTY_QUERY_ROOT, {}, ['Default%20Settings', 'prod', 'no-user', 'blank-user'], PUTTY_FULL_ROOT)
    )
    tree.set(
      `${PUTTY_FULL_ROOT}\\Default%20Settings`,
      fakeRegOutput(`${PUTTY_FULL_ROOT}\\Default%20Settings`, { HostName: 'ignored.example.com' }, [])
    )
    tree.set(
      `${PUTTY_FULL_ROOT}\\prod`,
      fakeRegOutput(`${PUTTY_FULL_ROOT}\\prod`, { HostName: 'prod.example.com', UserName: 'deploy' }, [])
    )
    tree.set(
      `${PUTTY_FULL_ROOT}\\no-user`,
      fakeRegOutput(`${PUTTY_FULL_ROOT}\\no-user`, { HostName: 'nouser.example.com' }, [])
    )
    tree.set(
      `${PUTTY_FULL_ROOT}\\blank-user`,
      fakeRegOutput(`${PUTTY_FULL_ROOT}\\blank-user`, { HostName: 'blankuser.example.com', UserName: '  ' }, [])
    )
    const queryFn = async (key: string): Promise<string | null> => tree.get(key) ?? null

    const candidates = await scanPuttySessions(queryFn, 'fallback-user')

    expect(candidates.map((c) => c.name)).toEqual(['prod', 'no-user', 'blank-user'])
    expect(candidates.find((c) => c.name === 'prod')?.username).toBe('deploy')
    expect(candidates.find((c) => c.name === 'no-user')?.username).toBe('fallback-user')
    expect(candidates.find((c) => c.name === 'blank-user')?.username).toBe('fallback-user')
  })
})

describe('parseSshConfig', () => {
  const config = [
    '# comment',
    'Host bastion',
    '  HostName bastion.example.com',
    '  User jump',
    '  IdentityFile ~/.ssh/bastion_key',
    '',
    'Host app db',
    '  HostName=10.0.0.5',
    '  Port 2222',
    '  User deploy',
    '  ProxyJump bastion',
    '',
    'Host *',
    '  User ignored',
    '',
    'Host web-*.example.com',
    '  User wild',
    '',
    'Host direct',
    '  ProxyJump me@other.example.com:2200'
  ].join('\n')

  it('parses concrete hosts, skips wildcards, and expands ~ in IdentityFile', () => {
    const out = parseSshConfig(config, '/home/me', 'me')
    expect(out.map((c) => c.name)).toEqual(['bastion', 'app', 'db', 'direct'])
    expect(out[0]).toMatchObject({ host: 'bastion.example.com', port: 22, username: 'jump' })
    expect(out[0].privateKeyPath?.replace(/\\/g, '/')).toBe('/home/me/.ssh/bastion_key')
  })

  it('maps a multi-alias Host and ProxyJump onto a jump-host chain', () => {
    const out = parseSshConfig(config, '/home/me', 'me')
    expect(out[1]).toMatchObject({ host: '10.0.0.5', port: 2222, username: 'deploy' })
    expect(out[1].jumpHosts).toHaveLength(1)
    expect(out[1].jumpHosts?.[0]).toMatchObject({ host: 'bastion.example.com', username: 'jump', authMethod: 'privateKey' })
    expect(out[3].jumpHosts?.[0]).toMatchObject({ host: 'other.example.com', port: 2200, username: 'me' })
  })
})


describe('parseSshConfig wildcard inheritance', () => {
  it('matches OpenSSH global defaults, inline comments, quoted paths and case-sensitive Host patterns', () => {
    const out = parseSshConfig([
      'User global # first value wins',
      'Host prod* # not an alias',
      '  Port 2222 # team port',
      '  IdentityFile "~/.ssh/test # space" # team key',
      'Host Prod-East "prod-west"',
      '  HostName example.org'
    ].join('\n'), '/home/me', 'local')
    expect(out.map(({ name, username, port }) => ({ name, username, port }))).toEqual([
      { name: 'Prod-East', username: 'global', port: 22 },
      { name: 'prod-west', username: 'global', port: 2222 }
    ])
    expect(out[1].privateKeyPath?.replace(/\\/g, '/')).toBe('/home/me/.ssh/test # space')
  })
  it('preserves embedded hash characters and recognizes a separate comment', () => {
    const out = parseSshConfig([
      'Host work',
      '  User ops#work # user',
      '  IdentityFile ~/.ssh/id#work # key'
    ].join('\n'), '/home/me', 'local')
    expect(out[0].username).toBe('ops#work')
    expect(out[0].privateKeyPath?.replace(/\\/g, '/')).toBe('/home/me/.ssh/id#work')
  })

  it('inherits global defaults including jump host and identity file', () => {
    const out = parseSshConfig([
      'Host *',
      ' User deploy',
      ' Port 2222',
      ' IdentityFile ~/.ssh/team_key',
      ' ProxyJump gateway.example.com',
      'Host production',
      ' HostName prod.example.com'
    ].join('\n'), '/home/alice', 'alice')
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({
      name: 'production', host: 'prod.example.com', username: 'deploy', port: 2222,
      jumpHosts: [{ host: 'gateway.example.com', port: 22, username: 'alice' }]
    })
    expect(out[0].privateKeyPath?.replace(/\\/g, '/')).toBe('/home/alice/.ssh/team_key')
  })

  it('respects earlier values, question-mark patterns, and negated exclusions', () => {
    const out = parseSshConfig([
      'Host prod1',
      ' User first',
      'Host prod? !prod2',
      ' Port 2200',
      ' User second',
      'Host prod1 prod2',
      ' HostName shared.example.com',
      'Host *',
      ' Port 2222',
      ' User fallback'
    ].join('\n'), '/home/me', 'local')
    expect(out.map((c) => c.name)).toEqual(['prod1', 'prod2'])
    expect(out[0]).toMatchObject({ username: 'first', port: 2200 })
    expect(out[1]).toMatchObject({ username: 'fallback', port: 2222 })
  })

  it('does not apply directives from unsupported Match sections', () => {
    const out = parseSshConfig('Host one\n User valid\nMatch all\n User invalid\nHost two\n HostName two.example', '/home/me', 'local')
    expect(out.map((c) => c.username)).toEqual(['valid', 'local'])
  })
})
