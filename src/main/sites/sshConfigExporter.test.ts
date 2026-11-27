import { describe, expect, it } from 'vitest'
import { parseSshConfig } from './SessionImporter'
import { formatSitesAsSshConfig, formatSshConfigValue, sanitizeHostAlias } from './sshConfigExporter'

describe('sshConfigExporter', () => {
  it('serializes standard OpenSSH fields and omits default port 22', () => {
    const result = formatSitesAsSshConfig(
      [
        {
          name: 'prod-web',
          host: '10.0.1.10',
          port: 22,
          username: 'deploy',
          authMethod: 'privateKey',
          privateKeyPath: '/home/me/.ssh/id_ed25519'
        },
        {
          name: 'staging-db',
          host: 'db.staging.internal',
          port: 2222,
          username: 'postgres',
          authMethod: 'agent'
        }
      ],
      { includeHeader: false }
    )

    expect(result.exportedCount).toBe(2)
    expect(result.skippedCount).toBe(0)
    expect(result.content).toBe(
      [
        'Host prod-web',
        '  HostName 10.0.1.10',
        '  User deploy',
        '  IdentityFile /home/me/.ssh/id_ed25519',
        '',
        'Host staging-db',
        '  HostName db.staging.internal',
        '  Port 2222',
        '  User postgres',
        ''
      ].join('\n')
    )
  })

  it('never writes passwords or passphrases into the exported config', () => {
    const siteWithSecrets = {
      name: 'secret-box',
      host: 'secret.example.com',
      port: 22,
      username: 'admin',
      authMethod: 'password' as const,
      password: 'SUPER_SECRET_PASSWORD_123',
      passphrase: 'SUPER_SECRET_PASSPHRASE_456',
      privateKeyPath: '/should/not/emit/for/password/auth'
    }

    const { content } = formatSitesAsSshConfig([siteWithSecrets])
    expect(content).toContain('# Exported from Ferry')
    expect(content).not.toContain('SUPER_SECRET_PASSWORD_123')
    expect(content).not.toContain('SUPER_SECRET_PASSPHRASE_456')
    expect(content).not.toContain('IdentityFile')
  })

  it('quotes paths containing spaces, #, or = and sanitizes wildcard, negated (!), and = aliases', () => {
    expect(sanitizeHostAlias('!prod * west?', '10.0.0.1')).toBe('prod-west')
    expect(sanitizeHostAlias('* !prod', '10.0.0.1')).toBe('prod')
    expect(sanitizeHostAlias('=prod', '10.0.0.1')).toBe('prod')
    expect(sanitizeHostAlias('!*?=', '10.0.0.1')).toBe('10.0.0.1')
    expect(sanitizeHostAlias('!*?=', '===')).toBe('host')
    expect(formatSshConfigValue('C:\\Users\\Alice Smith\\.ssh\\id #1')).toBe(
      '"C:\\Users\\Alice Smith\\.ssh\\id #1"'
    )

    const { content } = formatSitesAsSshConfig(
      [
        {
          name: 'My Server #1',
          host: 'one.example.com',
          port: 22,
          username: 'alice',
          authMethod: 'privateKey',
          privateKeyPath: 'C:\\Users\\Alice Smith\\.ssh\\id #1'
        },
        {
          name: 'My Server #1',
          host: 'two.example.com',
          port: 2200,
          username: 'bob',
          authMethod: 'agent'
        },
        {
          name: '* !prod',
          host: 'three.example.com',
          port: 22,
          username: 'carol',
          authMethod: 'agent'
        },
        {
          name: '=staging',
          host: 'four.example.com',
          port: 22,
          username: 'dave',
          authMethod: 'agent'
        }
      ],
      { includeHeader: false }
    )

    expect(content).toContain('Host My-Server-1\n')
    expect(content).toContain('Host My-Server-1-2\n')
    expect(content).toContain('Host prod\n')
    expect(content).toContain('Host staging\n')
    expect(content).toContain('IdentityFile "C:\\Users\\Alice Smith\\.ssh\\id #1"')

    const imported = parseSshConfig(content, '/home/me', 'local')
    expect(imported.map((s) => s.name)).toEqual(['My-Server-1', 'My-Server-1-2', 'prod', 'staging'])
  })

  it('strips newlines and control characters so every output line uses only allowlisted directives', () => {
    const { content } = formatSitesAsSshConfig(
      [
        {
          name: 'evil\nProxyCommand calc.exe',
          host: 'example.com\nForwardAgent yes',
          port: 22,
          username: 'user\r\nLocalCommand evil',
          authMethod: 'privateKey',
          privateKeyPath: '/home/me/.ssh/key\nPermitLocalCommand yes',
          jumpHosts: [
            {
              host: 'jump.example.com\nRemoteCommand evil',
              port: 22,
              username: 'jump\nProxyCommand bad',
              authMethod: 'privateKey',
              privateKeyPath: '/home/me/.ssh/jump_key\nMatch all'
            }
          ]
        }
      ],
      { includeHeader: false }
    )

    const nonEmptyLines = content.split('\n').filter((line) => line.length > 0)
    expect(nonEmptyLines.length).toBeGreaterThan(0)
    for (const line of nonEmptyLines) {
      expect(line).toMatch(/^(Host |  (HostName|Port|User|IdentityFile|ProxyJump) )/)
    }
  })

  it('formats multi-hop ProxyJump chains including IPv6 hosts, avoids bracketing host:port, and skips empty hosts', () => {
    const result = formatSitesAsSshConfig(
      [
        { name: 'blank', host: '   ', port: 22, username: 'nobody' },
        {
          name: 'internal-app',
          host: 'app.internal',
          port: 22,
          username: 'appuser',
          authMethod: 'agent',
          jumpHosts: [
            { host: 'bastion.example.com', port: 22, username: 'jump1' },
            { host: '2001:db8::10', port: 2222, username: 'jump2' },
            { host: 'relay.example.com:2202', username: 'jump3' }
          ]
        }
      ],
      { includeHeader: false }
    )

    expect(result.exportedCount).toBe(1)
    expect(result.skippedCount).toBe(1)
    expect(result.content).toContain(
      '  ProxyJump jump1@bastion.example.com,jump2@[2001:db8::10]:2222,jump3@relay.example.com:2202\n'
    )
  })

  it('emits named jump-host Host blocks when hops specify privateKeyPath and deduplicates shared bastions', () => {
    const result = formatSitesAsSshConfig(
      [
        {
          name: 'app-1',
          host: '10.10.0.1',
          port: 22,
          username: 'deploy',
          authMethod: 'privateKey',
          privateKeyPath: '/home/me/.ssh/app_key',
          jumpHosts: [
            {
              host: 'bastion.example.com',
              port: 2200,
              username: 'jumpuser',
              authMethod: 'privateKey',
              privateKeyPath: '/home/me/.ssh/bastion key'
            },
            {
              host: 'inner-jump.internal',
              port: 22,
              username: 'inner'
            }
          ]
        },
        {
          name: 'app-2',
          host: '10.10.0.2',
          port: 22,
          username: 'deploy',
          authMethod: 'agent',
          jumpHosts: [
            {
              host: 'bastion.example.com',
              port: 2200,
              username: 'jumpuser',
              authMethod: 'privateKey',
              privateKeyPath: '/home/me/.ssh/bastion key'
            }
          ]
        }
      ],
      { includeHeader: false }
    )

    expect(result.exportedCount).toBe(2)
    expect(result.content).toContain(
      [
        'Host app-1-jump-1',
        '  HostName bastion.example.com',
        '  Port 2200',
        '  User jumpuser',
        '  IdentityFile "/home/me/.ssh/bastion key"'
      ].join('\n')
    )
    expect(result.content).toContain('  ProxyJump app-1-jump-1,inner@inner-jump.internal\n')
    expect(result.content).toContain('  ProxyJump app-1-jump-1\n')
    expect(result.content.match(/^Host app-1-jump-1$/gm)).toHaveLength(1)

    const imported = parseSshConfig(result.content, '/home/me', 'local')
    const app1 = imported.find((s) => s.name === 'app-1')
    expect(app1?.jumpHosts).toEqual([
      {
        host: 'bastion.example.com',
        port: 2200,
        username: 'jumpuser',
        authMethod: 'privateKey',
        privateKeyPath: '/home/me/.ssh/bastion key'
      },
      {
        host: 'inner-jump.internal',
        port: 22,
        username: 'inner',
        authMethod: 'password'
      }
    ])
  })

  it('escapes literal % in IdentityFile as %% and round-trips losslessly through parseSshConfig()', () => {
    const { content } = formatSitesAsSshConfig(
      [
        {
          name: 'pct-key-host',
          host: 'pct.example.com',
          port: 22,
          username: 'alice',
          authMethod: 'privateKey',
          privateKeyPath: '/home/me/.ssh/key%prod%1'
        }
      ],
      { includeHeader: false }
    )

    expect(content).toContain('  IdentityFile /home/me/.ssh/key%%prod%%1\n')
    const imported = parseSshConfig(content, '/home/me', 'local')
    expect(imported).toHaveLength(1)
    expect(imported[0].privateKeyPath?.replace(/\\/g, '/')).toBe('/home/me/.ssh/key%prod%1')
  })

  it('produces consistent single trailing newline for empty site lists', () => {
    const withHeader = formatSitesAsSshConfig([], { includeHeader: true })
    expect(withHeader.exportedCount).toBe(0)
    expect(withHeader.skippedCount).toBe(0)
    expect(withHeader.content).toBe('# Exported from Ferry (passwords and passphrases are never included)\n')

    const withoutHeader = formatSitesAsSshConfig([], { includeHeader: false })
    expect(withoutHeader.content).toBe('')
  })

  it('round-trips multi-hop ProxyJump and standard fields cleanly through Ferry parseSshConfig()', () => {
    const { content } = formatSitesAsSshConfig([
      {
        name: 'App Prod',
        host: 'app.example.com',
        port: 2222,
        username: 'deploy',
        authMethod: 'privateKey',
        privateKeyPath: '/home/me/.ssh/team key #1',
        jumpHosts: [
          { host: 'bastion.example.com', port: 2200, username: 'jumpuser' },
          { host: '2001:db8::5', port: 2222, username: 'hop2' }
        ]
      },
      {
        name: 'DB Staging',
        host: 'db.staging.example.com',
        port: 22,
        username: 'postgres',
        authMethod: 'agent'
      }
    ])

    const imported = parseSshConfig(content, '/home/me', 'local')
    expect(imported).toHaveLength(2)
    expect(imported[0]).toMatchObject({
      name: 'App-Prod',
      host: 'app.example.com',
      port: 2222,
      username: 'deploy',
      jumpHosts: [
        { host: 'bastion.example.com', port: 2200, username: 'jumpuser' },
        { host: '2001:db8::5', port: 2222, username: 'hop2' }
      ]
    })
    expect(imported[0].privateKeyPath?.replace(/\\/g, '/')).toBe('/home/me/.ssh/team key #1')
    expect(imported[1]).toMatchObject({
      name: 'DB-Staging',
      host: 'db.staging.example.com',
      port: 22,
      username: 'postgres'
    })
  })
})
