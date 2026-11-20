import { describe, expect, it } from 'vitest'
import { buildChmodCommand, buildChownCommand } from './permissionCommands'

describe('buildChmodCommand', () => {
  it('builds a plain and a recursive command with the path escaped', () => {
    expect(buildChmodCommand('/srv/a b', '755', false)).toBe("chmod 755 -- '/srv/a b'")
    expect(buildChmodCommand('/srv/x', '0644', true)).toBe("chmod -R 0644 -- '/srv/x'")
  })

  it('rejects modes that are not 3-4 octal digits', () => {
    for (const bad of ['', '75', '75555', '789', '755; rm -rf /', 'u+x']) {
      expect(() => buildChmodCommand('/x', bad, false)).toThrow(/Invalid permission mode/)
    }
  })
})

describe('buildChownCommand', () => {
  it('accepts owner, group, or both', () => {
    expect(buildChownCommand('/x', 'deploy', 'www-data', false)).toBe("chown deploy:www-data -- '/x'")
    expect(buildChownCommand('/x', '', 'staff', true)).toBe("chown -R :staff -- '/x'")
    expect(buildChownCommand('/x', 'bob', '', false)).toBe("chown bob -- '/x'")
    expect(buildChownCommand('/x', '1000', '1000', false)).toBe("chown 1000:1000 -- '/x'")
  })

  it('rejects empty and unsafe names', () => {
    expect(() => buildChownCommand('/x', '', '', false)).toThrow()
    for (const bad of ['a b', 'a;b', '$(id)', '-rf', '1abc', 'a:b']) {
      expect(() => buildChownCommand('/x', bad, '', false)).toThrow(/Invalid owner/)
    }
  })
})
