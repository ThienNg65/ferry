import { describe, expect, it } from 'vitest'
import { buildRemoteListCommand, parseRemoteListOutput } from './remoteExecList'

describe('remoteExecList', () => {
  it('generates a command targeting the requested path', () => {
    const cmd = buildRemoteListCommand('/var/log')
    expect(cmd).toContain("'/var/log'")
  })

  it('fails the fast listing instead of silently skipping entries with unreadable metadata', () => {
    const cmd = buildRemoteListCommand('/restricted')
    // The remote command must fail nonzero so listRemoteExec retries through SFTP.
    expect(cmd).toContain('except OSError:')
    expect(cmd).toContain('sys.exit(3)')
    expect(cmd).not.toMatch(/except OSError:\\n\\s+continue/)
  })

  it('parses valid JSON output with files, directories, and symlinks', () => {
    const sampleOutput = JSON.stringify({
      path: '/var/log',
      entries: [
        {
          name: 'nginx',
          path: '/var/log/nginx',
          isDir: true,
          size: 0,
          mtimeMs: 1700000000000,
          permissions: '0755',
          isSymlink: false,
          symlinkTarget: null,
          symlinkBroken: false
        },
        {
          name: 'syslog',
          path: '/var/log/syslog',
          isDir: false,
          size: 1024,
          mtimeMs: 1700000005000,
          permissions: '0640',
          isSymlink: false,
          symlinkTarget: null,
          symlinkBroken: false
        },
        {
          name: 'current_log',
          path: '/var/log/current_log',
          isDir: false,
          size: 512,
          mtimeMs: 1700000006000,
          permissions: '0777',
          isSymlink: true,
          symlinkTarget: '/var/log/syslog',
          symlinkBroken: false
        }
      ]
    })
    const result = parseRemoteListOutput(sampleOutput)
    expect(result).not.toBeNull()
    expect(result?.path).toBe('/var/log')
    expect(result?.entries).toHaveLength(3)
    expect(result?.entries[0].isDir).toBe(true)
    expect(result?.entries[0].permissions).toBe('0755')
    expect(result?.entries[1].size).toBe(1024)
    expect(result?.entries[2].isSymlink).toBe(true)
    expect(result?.entries[2].symlinkTarget).toBe('/var/log/syslog')
    expect(result?.entries[2].symlinkBroken).toBeFalsy()
  })

  it('handles broken symlinks without failing', () => {
    const sampleOutput = JSON.stringify({
      path: '/tmp',
      entries: [
        {
          name: 'dead_link',
          path: '/tmp/dead_link',
          isDir: false,
          size: 0,
          mtimeMs: 0,
          permissions: '0777',
          isSymlink: true,
          symlinkTarget: '/non/existent',
          symlinkBroken: true
        }
      ]
    })
    const result = parseRemoteListOutput(sampleOutput)
    expect(result?.entries[0].symlinkBroken).toBe(true)
    expect(result?.entries[0].isDir).toBe(false)
  })

  it('formats modifiedAt as ISO string if mtimeMs is valid, or null', () => {
    const sampleOutput = JSON.stringify({
      path: '/tmp',
      entries: [
        {
          name: 'a.txt',
          path: '/tmp/a.txt',
          isDir: false,
          size: 10,
          mtimeMs: 1700000000000,
          permissions: '0644',
          isSymlink: false
        },
        {
          name: 'b.txt',
          path: '/tmp/b.txt',
          isDir: false,
          size: 10,
          mtimeMs: 0,
          permissions: '0644',
          isSymlink: false
        }
      ]
    })
    const result = parseRemoteListOutput(sampleOutput)
    expect(result?.entries[0].modifiedAt).toBe(new Date(1700000000000).toISOString())
    expect(result?.entries[1].modifiedAt).toBeNull()
  })

  it('returns null on invalid or non-JSON output', () => {
    expect(parseRemoteListOutput('sh: python3: command not found')).toBeNull()
    expect(parseRemoteListOutput('')).toBeNull()
    expect(parseRemoteListOutput('{ invalid json')).toBeNull()
  })

  it('tolerates MOTD banners and shell greetings surrounding JSON output', () => {
    const raw = `Welcome to Ubuntu 22.04 LTS (GNU/Linux 5.15.0-generic x86_64)
Last login: Mon Nov 10 04:00:00 2026 from 10.0.0.1
{"path": "/home/user", "entries": [{"name": "file.txt", "path": "/home/user/file.txt", "isDir": false, "size": 12, "mtimeMs": 1000, "permissions": "0644", "isSymlink": false}]}
`
    const result = parseRemoteListOutput(raw)
    expect(result).not.toBeNull()
    expect(result?.path).toBe('/home/user')
    expect(result?.entries).toHaveLength(1)
  })
})
