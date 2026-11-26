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
      authMethod: 'password',
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

  it('quotes paths containing spaces, #, or = and sanitizes wildcard/duplicate aliases', () => {
    expect(sanitizeHostAlias('!prod * west?', '10.0.0.1')).toBe('prod-west')
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
        }
      ],
      { includeHeader: false }
    )

    expect(content).toContain('Host My-Server-1\n')
    expect(content).toContain('Host My-Server-1-2\n')
    expect(content).toContain('IdentityFile "C:\\Users\\Alice Smith\\.ssh\\id #1"')
  })

  it('strips newlines and control characters to prevent directive injection', () => {
    const { content } = formatSitesAsSshConfig(
      [
        {
          name: 'evil\nProxyCommand calc.exe',
          host: 'example.com\nForwardAgent yes',
          port: 22,
          username: 'user\r\nLocalCommand evil',
          authMethod: 'privateKey',
          privateKeyPath: '/home/me/.ssh/key\nPermitLocalCommand yes'
        }
      ],
      { includeHeader: false }
    )

    expect(content).not.toContain('\nProxyCommand')
    expect(content).not.toContain('\nForwardAgent')
    expect(content).not.toContain('\nLocalCommand')
    expect(content).not.toContain('\nPermitLocalCommand')
  })

  it('formats multi-hop ProxyJump chains including IPv6 hosts and skips empty hosts', () => {
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
            { host: '2001:db8::10', port: 2222, username: 'jump2' }
          ]
        }
      ],
      { includeHeader: false }
    )

    expect(result.exportedCount).toBe(1)
    expect(result.skippedCount).toBe(1)
    expect(result.content).toContain('  ProxyJump jump1@bastion.example.com,jump2@[2001:db8::10]:2222\n')
  })

  it('round-trips cleanly through Ferry parseSshConfig()', () => {
    const { content } = formatSitesAsSshConfig([
      {
        name: 'App Prod',
        host: 'app.example.com',
        port: 2222,
        username: 'deploy',
        authMethod: 'privateKey',
        privateKeyPath: '/home/me/.ssh/team key #1',
        jumpHosts: [
          { host: 'bastion.example.com', port: 2200, username: 'jumpuser' }
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
      jumpHosts: [{ host: 'bastion.example.com', port: 2200, username: 'jumpuser' }]
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
