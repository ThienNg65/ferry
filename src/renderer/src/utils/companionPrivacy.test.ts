import { describe, expect, it } from 'vitest'
import { buildGitHubIssueDraft, PUBLIC_ISSUE_TRACKER_URL, redactSensitiveText } from './companionPrivacy'

describe('companionPrivacy', () => {
  it('redacts credentials, tokens, SSH hosts, IPs, private keys, and local user paths', () => {
    const raw = [
      'Connected to admin@prod.internal.example.com at 10.24.5.19:22 and 2001:db8::1',
      'password=superSecret123 token=ghp_1234567890abcdef1234567890',
      'File: C:\\Users\\alice\\Documents\\key.pem and /home/bob/.ssh/id_ed25519',
      '-----BEGIN OPENSSH PRIVATE KEY-----\nabc123\n-----END OPENSSH PRIVATE KEY-----'
    ].join('\n')

    const result = redactSensitiveText(raw)
    expect(result.redactionCount).toBeGreaterThanOrEqual(7)
    expect(result.text).not.toContain('superSecret123')
    expect(result.text).not.toContain('ghp_1234567890abcdef1234567890')
    expect(result.text).not.toContain('admin@prod.internal.example.com')
    expect(result.text).not.toContain('10.24.5.19')
    expect(result.text).not.toContain('2001:db8::1')
    expect(result.text).not.toContain('alice')
    expect(result.text).not.toContain('bob')
    expect(result.text).not.toContain('abc123')
  })

  it('builds a prefilled ferry-release GitHub issue URL with redacted content and opt-in diagnostics', () => {
    const draft = buildGitHubIssueDraft(
      {
        category: 'bug',
        title: 'Transfer failed on 192.168.1.50',
        details: 'Uploaded from C:\\Users\\thien\\app.zip',
        expected: 'Upload succeeds',
        actual: 'Permission denied',
        includeDiagnostics: false
      },
      {
        appVersion: '1.3.1',
        platform: 'Windows',
        dockPosition: 'bottom',
        theme: 'dark',
        lastErrorSummary: 'secret=do-not-include'
      }
    )

    expect(draft.url.startsWith(PUBLIC_ISSUE_TRACKER_URL)).toBe(true)
    expect(draft.title).toBe('[Bug] Transfer failed on [REDACTED_IP]')
    expect(draft.markdown).not.toContain('thien')
    expect(draft.markdown).not.toContain('do-not-include')
    expect(draft.truncatedForUrl).toBe(false)
  })

  it('truncates URL body safely when draft exceeds URL limit', () => {
    const draft = buildGitHubIssueDraft(
      {
        category: 'feedback',
        title: 'Long feedback',
        details: 'a'.repeat(7000),
        expected: '',
        actual: '',
        includeDiagnostics: false
      },
      { appVersion: '1.3.1', platform: 'Windows' }
    )
    expect(draft.truncatedForUrl).toBe(true)
    expect(draft.url.length).toBeLessThan(1000)
  })

  it('redacts snake_case credentials, padded Bearer/Basic headers, user@IP, ::1 IPv6, and case/slash Windows user paths', () => {
    const input = [
      'client_secret=supersecret123 access_token=tok_123456',
      'Authorization: Bearer abcdefg= Basic dXNlcjpwYXNz==',
      'ssh alice@10.0.0.1 and [::1]:22',
      'key at C:\\users\\alice\\id_rsa and C:/Users/alice/.ssh/config'
    ].join('\n')
    const out = redactSensitiveText(input)
    expect(out.text).not.toContain('supersecret123')
    expect(out.text).not.toContain('tok_123456')
    expect(out.text).not.toContain('abcdefg=')
    expect(out.text).not.toContain('dXNlcjpwYXNz==')
    expect(out.text).not.toContain('alice@10.0.0.1')
    expect(out.text).not.toContain('::1')
    expect(out.text).not.toContain('alice')
  })

  it('redacts natural-language credentials and common provider token formats', () => {
    const providerTokens = {
      openAi: ['sk-', 'proj-', 'abcdefghijklmnopqrstuvwxyz123456'].join(''),
      anthropic: ['sk-', 'ant-api03-', 'abcdefghijklmnopqrstuvwxyz123456'].join(''),
      google: ['AIza', 'SyDabcdefghijklmnopqrstuvwxyz1234567890'].join(''),
      slack: ['xoxb-', '1234567890-', '1234567890'].join(''),
      stripe: ['sk', '_live_', '1234567890abcdefghijklmnop'].join(''),
      googleOAuth: ['ya29.', 'abcdefghijklmnopqrstuvwxyz123456'].join('')
    }
    const input = [
      'my password is hunter2',
      'the API key is ' + providerTokens.openAi,
      'secret was "a long private value"',
      ...Object.values(providerTokens)
    ].join('\n')

    const out = redactSensitiveText(input)
    expect(out.text).toContain('my password is [REDACTED]')
    expect(out.text).toContain('secret was [REDACTED]')
    for (const secret of [
      'hunter2',
      'a long private value',
      ...Object.values(providerTokens)
    ]) {
      expect(out.text).not.toContain(secret)
    }
    expect(out.categories).toContain('credential')
    expect(out.categories).toContain('auth token')
  })

  it('redacts bare hostnames and absolute Windows, UNC, and POSIX paths without changing ordinary prose or URLs', () => {
    const input = [
      'Connect to prod.internal.example.com and db-01.',
      'Windows: D:\\Secrets\\customer-prod\\ssh_config',
      'UNC: \\\\fileserver\\finance\\backup',
      'POSIX: /etc/ssh/sshd_config',
      'Ordinary prose: production database and server are healthy.',
      'Documentation URL: https://api.github.com/docs/ssh/config'
    ].join('\n')

    const out = redactSensitiveText(input)
    for (const sensitiveValue of [
      'prod.internal.example.com',
      'db-01',
      'D:\\Secrets\\customer-prod\\ssh_config',
      '\\\\fileserver\\finance\\backup',
      '/etc/ssh/sshd_config'
    ]) {
      expect(out.text).not.toContain(sensitiveValue)
    }
    expect(out.text).toContain('production database')
    expect(out.text).toContain('server are healthy')
    expect(out.text).toContain('https://api.github.com/docs/ssh/config')
    expect(out.categories).toContain('hostname')
    expect(out.categories).toContain('absolute path')
  })

  it('redacts sensitive values across every public issue field and optional diagnostics', () => {
    const providerToken = ['sk-', 'proj-', 'abcdefghijklmnopqrstuvwxyz123456'].join('')
    const slackToken = ['xoxb-', '1234567890-', '1234567890'].join('')
    const draft = buildGitHubIssueDraft(
      {
        category: 'bug',
        title: 'Cannot connect to db-01',
        details: 'Host prod.internal.example.com; password is hunter2; config D:\\Secrets\\customer-prod\\ssh_config',
        expected: 'Read /etc/ssh/sshd_config',
        actual: 'The API key is ' + providerToken,
        includeDiagnostics: true
      },
      {
        appVersion: '1.3.2',
        platform: 'Windows',
        lastErrorSummary: 'UNC path \\\\fileserver\\finance\\backup failed with ' + slackToken
      }
    )
    const params = new URL(draft.url).searchParams
    const serialized = [draft.title, draft.markdown, params.get('title'), params.get('body')].join('\n')

    for (const sensitiveValue of [
      'db-01',
      'prod.internal.example.com',
      'hunter2',
      'D:\\Secrets\\customer-prod\\ssh_config',
      '/etc/ssh/sshd_config',
      providerToken,
      '\\\\fileserver\\finance\\backup',
      slackToken
    ]) {
      expect(serialized).not.toContain(sensitiveValue)
    }
  })

})
