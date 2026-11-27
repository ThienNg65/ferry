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
      'password is x',
      'the API key is ' + providerTokens.openAi,
      'secret was "a long private value"',
      ...Object.values(providerTokens)
    ].join('\n')

    const out = redactSensitiveText(input)
    expect(out.text).toContain('my password is [REDACTED]')
    expect(out.text).toContain('password is [REDACTED]')
    expect(out.text).not.toContain('password is x')
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

  it('redacts JSON-quoted secrets, special-char passwords, truncated PEMs, quoted POSIX paths without false-positive timestamps/versions', () => {
    const out = redactSensitiveText(
      '2026-11-25 12:34:56 ferry-v1.3.1 utf-8 sha-256 {"password": "hunter2"} my password is P@ssw0rd!123 "/Users/alice/My Documents/id_rsa"\n-----BEGIN OPENSSH PRIVATE KEY-----\nAAAAb3BlbnNzaC1rZXktdjE='
    )
    expect(out.text).toContain('12:34:56')
    expect(out.text).toContain('utf-8')
    expect(out.text).toContain('sha-256')
    expect(out.text).not.toContain('hunter2')
    expect(out.text).not.toContain('P@ssw0rd!123')
    expect(out.text).not.toContain('Documents/id_rsa')
    expect(out.text).not.toContain('AAAAb3BlbnNzaC1rZXktdjE=')
  })

  it('fixes strict-mode leaks for multi-hyphen hostnames, space-containing paths, env secrets, JWTs, and DB URLs', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV'
    const raw = [
      'Hosts: prod-web-01, us-east-1, prod-api-02',
      'Paths: C:\\Program Files\\My App\\secret.key and C:\\Users\\John Doe\\.ssh\\id_rsa',
      'POSIX: /Users/John Doe/.ssh/id_rsa',
      'AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI DB_PASSWORD_HASH=hash999 TOKEN_VALUE=tok888 DB_PASS=mysecret',
      `JWT=${jwt}`,
      'DB: postgres://db.internal:5432/prod_db and redis://cache.internal:6379/0'
    ].join('\n')

    const out = redactSensitiveText(raw)
    for (const leaked of [
      'prod-web-01',
      'us-east-1',
      'prod-api-02',
      'Program Files',
      'My App',
      'secret.key',
      'John Doe',
      'wJalrXUtnFEMI',
      'hash999',
      'tok888',
      'mysecret',
      jwt,
      'postgres://db.internal:5432/prod_db',
      'redis://cache.internal:6379/0'
    ]) {
      expect(out.text).not.toContain(leaked)
    }
  })

  it('preserves safe OS paths, exception namespaces, and process names in diagnostic mode while redacting secrets and IPs', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.sig12345'
    const raw = [
      'Log /var/log/nginx/error.log and /etc/nginx/nginx.conf and /config/app.yml',
      'Exception: java.lang.OutOfMemoryError at com.acme.billing.InvoiceWorker.run',
      'Processes: worker-0 kworker-0 php-fpm8 nginx-1.24',
      'Secrets: AWS_SECRET_ACCESS_KEY=topsecret123 IP 10.24.5.19 user@prod.example.com',
      `Token ${jwt} and postgres://db.internal:5432/prod_db`,
      'Home key: C:\\Users\\John Doe\\.ssh\\id_rsa and /home/alice/.ssh/id_ed25519'
    ].join('\n')

    const out = redactSensitiveText(raw, { mode: 'diagnostic' })
    for (const preserved of [
      '/var/log/nginx/error.log',
      '/etc/nginx/nginx.conf',
      '/config/app.yml',
      'java.lang.OutOfMemoryError',
      'com.acme.billing.InvoiceWorker.run',
      'worker-0',
      'kworker-0',
      'php-fpm8',
      'nginx-1.24'
    ]) {
      expect(out.text).toContain(preserved)
    }
    for (const redacted of [
      'topsecret123',
      '10.24.5.19',
      'user@prod.example.com',
      jwt,
      'postgres://db.internal:5432/prod_db',
      'John Doe',
      '/home/alice/.ssh/id_ed25519'
    ]) {
      expect(out.text).not.toContain(redacted)
    }
  })

  it('redacts whitespace-separated CLI credential flags and curl -u passwords in diagnostic mode', () => {
    const raw =
      'Top: python3(pid=901,cpu=88.0%,rss=500MB cmd="python3 worker.py --password hunter2 --token tok_999 --api-key key123 -u admin:superpass --no-password --host db")'
    const out = redactSensitiveText(raw, { mode: 'diagnostic' })
    expect(out.text).toContain('--password [REDACTED]')
    expect(out.text).toContain('--token [REDACTED]')
    expect(out.text).toContain('--api-key [REDACTED]')
    expect(out.text).toContain('-u admin:[REDACTED]')
    expect(out.text).toContain('--no-password --host db"')
    for (const secret of ['hunter2', 'tok_999', 'key123', 'superpass']) {
      expect(out.text).not.toContain(secret)
    }
  })
})
