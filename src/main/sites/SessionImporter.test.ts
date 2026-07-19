import { describe, expect, it } from 'vitest'
import { scanWinScpSessions } from './SessionImporter'

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
})
