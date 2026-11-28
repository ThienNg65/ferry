import { EventEmitter } from 'node:events'
import type { Client, ClientChannel } from 'ssh2'
import { describe, expect, it, vi } from 'vitest'
import { MAX_BUFFERED_LINE_BYTES, TRUNCATED_LINE_SUFFIX } from './BoundedLineBuffer'
import { SshError } from './errors'
import { RemoteShell } from './RemoteShell'

class MockChannel extends EventEmitter {
  readonly stderr = new EventEmitter()

  end(_input?: Buffer): void {
    this.emit('finish')
  }

  destroy(): void {
    this.emit('close')
  }
}

function createHarness(): { shell: RemoteShell; channel: MockChannel } {
  const channel = new MockChannel()
  const client = {
    exec: (_command: string, callback: (error: Error | undefined, stream: ClientChannel) => void): void => {
      callback(undefined, channel as unknown as ClientChannel)
    }
  } as unknown as Client

  return { shell: new RemoteShell(client), channel }
}

function createSftpHarness() {
  const directoryStats = {
    isDirectory: () => true,
    isSymbolicLink: () => false
  }
  const sftp = Object.assign(new EventEmitter(), {
    lstat: vi.fn((_remotePath: string, callback: (error: Error | null, stats: unknown) => void) =>
      callback(null, directoryStats)
    ),
    realpath: vi.fn((_remotePath: string, callback: (error: Error | null, resolvedPath: string) => void) =>
      callback(null, '/tmp/target')
    ),
    readdir: vi.fn((_remotePath: string, callback: (error: Error | null, entries: unknown[]) => void) =>
      callback(null, [])
    ),
    unlink: vi.fn((_remotePath: string, callback: (error: Error | null) => void) => callback(null)),
    rmdir: vi.fn((_remotePath: string, callback: (error: Error | null) => void) => callback(null))
  })
  const client = {
    sftp: (callback: (error: Error | null, wrapper: unknown) => void) => callback(null, sftp)
  } as unknown as Client

  return { shell: new RemoteShell(client), sftp }
}

function encodeShellTarget(value: string): string {
  return Array.from(Buffer.from(value, 'utf8'), (byte) =>
    `\\${byte.toString(8).padStart(3, '0')}`
  ).join('')
}

function encodedTargetAssignment(value: string): string {
  return `target=$(printf %b "${encodeShellTarget(value)}"; printf .)`
}

function splitBuffer(value: string, split: number): [Buffer, Buffer] {
  const bytes = Buffer.from(value)
  return [bytes.subarray(0, split), bytes.subarray(split)]
}

const utf8Cases = ['é', '€', '😀'].flatMap((value) => {
  const byteLength = Buffer.byteLength(value)
  return Array.from({ length: byteLength - 1 }, (_, index) => ({
    value,
    split: index + 1
  }))
})

describe('RemoteShell UTF-8 output', () => {
  it.each(utf8Cases)('exec preserves split UTF-8 for $value at byte $split', async ({ value, split }) => {
    const { shell, channel } = createHarness()
    const execution = shell.exec('printf output')
    const [first, second] = splitBuffer(value, split)

    channel.emit('data', first)
    channel.emit('data', second)
    channel.stderr.emit('data', first)
    channel.stderr.emit('data', second)
    channel.emit('close', 0)

    await expect(execution).resolves.toEqual({ stdout: value, stderr: value, code: 0 })
  })

  it.each(utf8Cases)('execWithStdin preserves split UTF-8 for $value at byte $split', async ({ value, split }) => {
    const { shell, channel } = createHarness()
    const execution = shell.execWithStdin('cat', Buffer.from('input'))
    const [first, second] = splitBuffer(value, split)

    channel.stderr.emit('data', first)
    channel.stderr.emit('data', second)
    channel.emit('close', 0)

    await expect(execution).resolves.toEqual({
      stdout: Buffer.alloc(0),
      stderr: value,
      code: 0
    })
  })

  it.each(utf8Cases)('execLines preserves split UTF-8 for $value at byte $split', async ({ value, split }) => {
    const { shell, channel } = createHarness()
    const lines: string[] = []
    const stderr: string[] = []
    const stdoutText = 'before' + value + 'after\n'
    const stderrText = 'error' + value + 'end'
    const [stdoutFirst, stdoutSecond] = splitBuffer(stdoutText, Buffer.byteLength('before') + split)
    const [stderrFirst, stderrSecond] = splitBuffer(stderrText, Buffer.byteLength('error') + split)
    const execution = shell.execLines('tail -f output', {
      timeoutMs: null,
      onLine: (line) => lines.push(line),
      onStderr: (chunk) => stderr.push(chunk)
    })

    channel.emit('data', stdoutFirst)
    channel.emit('data', stdoutSecond)
    channel.stderr.emit('data', stderrFirst)
    channel.stderr.emit('data', stderrSecond)
    channel.emit('close', 0)

    await expect(execution).resolves.toBe(0)
    expect(lines).toEqual(['before' + value + 'after'])
    expect(stderr.join('')).toBe(stderrText)
  })

  it('bounds chunked unterminated stdout lines and resumes after the next newline', async () => {
    const { shell, channel } = createHarness()
    const lines: string[] = []
    const execution = shell.execLines('tail -f output', {
      timeoutMs: null,
      onLine: (line) => lines.push(line)
    })
    const chunk = 'x'.repeat(16 * 1024)

    for (let index = 0; index < 5; index++) {
      channel.emit('data', Buffer.from(chunk))
    }
    expect(lines).toEqual([])

    channel.emit('data', Buffer.from('\nnext line\n'))
    channel.emit('close', 0)

    await expect(execution).resolves.toBe(0)
    expect(lines).toEqual([
      'x'.repeat(MAX_BUFFERED_LINE_BYTES) + TRUNCATED_LINE_SUFFIX,
      'next line'
    ])
  })

  it('cancels cleanly when aborted mid-way through an oversized unterminated line', async () => {
    const { shell, channel } = createHarness()
    const controller = new AbortController()
    const lines: string[] = []
    const execution = shell.execLines('tail -f output', {
      timeoutMs: null,
      signal: controller.signal,
      onLine: (line) => lines.push(line)
    })

    const chunk = Buffer.from('x'.repeat(32 * 1024))
    channel.emit('data', chunk)
    channel.emit('data', chunk)
    channel.emit('data', chunk)
    controller.abort()

    await expect(execution).rejects.toMatchObject({ code: 'CANCELLED' })
    expect(lines).toEqual([])
  })

  it('flushes incomplete UTF-8 sequences consistently when each command closes', async () => {
    const incomplete = Buffer.from([0xe2])

    const buffered = createHarness()
    const bufferedExecution = buffered.shell.exec('printf output')
    buffered.channel.emit('data', incomplete)
    buffered.channel.stderr.emit('data', incomplete)
    buffered.channel.emit('close', 0)
    await expect(bufferedExecution).resolves.toEqual({ stdout: '�', stderr: '�', code: 0 })

    const withStdin = createHarness()
    const stdinExecution = withStdin.shell.execWithStdin('cat', Buffer.from('input'))
    withStdin.channel.stderr.emit('data', incomplete)
    withStdin.channel.emit('close', 0)
    await expect(stdinExecution).resolves.toEqual({
      stdout: Buffer.alloc(0),
      stderr: '�',
      code: 0
    })

    const streamed = createHarness()
    const lines: string[] = []
    const stderr: string[] = []
    const streamExecution = streamed.shell.execLines('tail -f output', {
      timeoutMs: null,
      onLine: (line) => lines.push(line),
      onStderr: (chunk) => stderr.push(chunk)
    })
    streamed.channel.emit('data', incomplete)
    streamed.channel.stderr.emit('data', incomplete)
    streamed.channel.emit('close', 0)
    await expect(streamExecution).resolves.toBe(0)
    expect(lines).toEqual(['�'])
    expect(stderr.join('')).toBe('�')
  })
})

describe('RemoteShell recursive delete', () => {
  const rootAliases = [
    { remotePath: '/', remoteCwd: '/home/user' },
    { remotePath: '//', remoteCwd: '/home/user' },
    { remotePath: '///', remoteCwd: '/home/user' },
    { remotePath: '/./', remoteCwd: '/home/user' },
    { remotePath: '/..', remoteCwd: '/home/user' },
    { remotePath: '/*', remoteCwd: '/home/user' },
    { remotePath: '.', remoteCwd: '/' },
    { remotePath: '../..', remoteCwd: '/home/user' }
  ]

  it.each(rootAliases)(
    'rejects root alias "$remotePath" before starting shell or SFTP deletion',
    async ({ remotePath, remoteCwd }) => {
      const { shell, sftp } = createSftpHarness()
      const exec = vi.spyOn(shell, 'exec').mockResolvedValue({ stdout: '', stderr: '', code: 0 })

      await expect(shell.deleteRecursive(remotePath, remoteCwd)).rejects.toMatchObject({ code: 'VALIDATION' })

      expect(exec).not.toHaveBeenCalled()
      expect(sftp.lstat).not.toHaveBeenCalled()
      expect(sftp.readdir).not.toHaveBeenCalled()
      expect(sftp.unlink).not.toHaveBeenCalled()
      expect(sftp.rmdir).not.toHaveBeenCalled()
    }
  )

  it.each(rootAliases)(
    'independently rejects root alias "$remotePath" in the SFTP fallback',
    async ({ remotePath, remoteCwd }) => {
      const { shell, sftp } = createSftpHarness()
      const fallback = (shell as unknown as {
        deleteRecursiveSftp: (path: string, cwd?: string) => Promise<void>
      }).deleteRecursiveSftp

      await expect(fallback.call(shell, remotePath, remoteCwd)).rejects.toMatchObject({ code: 'VALIDATION' })

      expect(sftp.readdir).not.toHaveBeenCalled()
      expect(sftp.unlink).not.toHaveBeenCalled()
      expect(sftp.rmdir).not.toHaveBeenCalled()
    }
  )

  it('rejects parent-directory operands before starting shell deletion', async () => {
    const { shell } = createHarness()
    const exec = vi.spyOn(shell, 'exec').mockResolvedValue({ stdout: '', stderr: '', code: 0 })
    const fallback = vi.spyOn(
      shell as unknown as { deleteRecursiveSftp: (path: string, cwd?: string) => Promise<void> },
      'deleteRecursiveSftp'
    ).mockResolvedValue(undefined)

    await expect(shell.deleteRecursive('link/..', '/home/user')).rejects.toMatchObject({ code: 'VALIDATION' })

    expect(exec).not.toHaveBeenCalled()
    expect(fallback).not.toHaveBeenCalled()
  })

  it('rejects a directory canonicalized to root by the shell preflight', async () => {
    const { shell } = createHarness()
    const exec = vi.spyOn(shell, 'exec').mockResolvedValue({ stdout: '', stderr: '', code: 73 })
    const fallback = vi.spyOn(
      shell as unknown as { deleteRecursiveSftp: (path: string, cwd?: string) => Promise<void> },
      'deleteRecursiveSftp'
    ).mockResolvedValue(undefined)

    await expect(shell.deleteRecursive('/tmp/root-alias')).rejects.toMatchObject({ code: 'VALIDATION' })

    const command = exec.mock.calls[0][0]
    expect(command.startsWith("/bin/sh -c '")).toBe(true)
    expect(command).toContain('canonical=$(CDPATH= cd -P "$target"')
    expect(command).toContain('CDPATH= cd -P "$target"')
    expect(command).toContain('[ "$canonical" != "/" ] || exit 73')
    expect(command).toContain('rm -rf -- "$target"')
    expect(fallback).not.toHaveBeenCalled()
  })

  it('rejects a directory whose SFTP canonical path is root before traversal', async () => {
    const { shell, sftp } = createSftpHarness()
    const directoryStats = { isDirectory: () => true, isSymbolicLink: () => false }
    sftp.lstat.mockImplementation((_path, callback) => callback(null, directoryStats))
    sftp.realpath.mockImplementation((_path, callback) => callback(null, '/'))
    const fallback = (shell as unknown as {
      deleteRecursiveSftp: (path: string, cwd?: string) => Promise<void>
    }).deleteRecursiveSftp

    await expect(fallback.call(shell, '/tmp/root-alias')).rejects.toMatchObject({ code: 'VALIDATION' })

    expect(sftp.lstat).toHaveBeenCalledWith('/tmp/root-alias', expect.any(Function))
    expect(sftp.realpath).toHaveBeenCalledWith('/tmp/root-alias', expect.any(Function))
    expect(sftp.readdir).not.toHaveBeenCalled()
    expect(sftp.unlink).not.toHaveBeenCalled()
    expect(sftp.rmdir).not.toHaveBeenCalled()
  })

  it.each(['SSH_TIMEOUT', 'CANCELLED'] as const)(
    'rethrows %s without starting the SFTP fallback',
    async (code) => {
      const { shell } = createSftpHarness()
      vi.spyOn(shell, 'exec').mockRejectedValue(new SshError(code, 'Command interrupted'))
      const fallback = vi.spyOn(
        shell as unknown as { deleteRecursiveSftp: (remotePath: string, remoteCwd?: string) => Promise<void> },
        'deleteRecursiveSftp'
      ).mockResolvedValue(undefined)

      await expect(shell.deleteRecursive('/tmp/target', '/home/user')).rejects.toMatchObject({ code })
      expect(fallback).not.toHaveBeenCalled()
    }
  )

  it('keeps shell deletion available when the SFTP subsystem is unavailable', async () => {
    const { shell } = createHarness()
    const exec = vi.spyOn(shell, 'exec').mockResolvedValue({ stdout: '', stderr: '', code: 0 })

    await expect(shell.deleteRecursive('/tmp/target')).resolves.toBeUndefined()

    expect(exec).toHaveBeenCalledTimes(1)
    expect(exec.mock.calls[0][0]).toContain('rm -rf -- "$target"')
  })

  it.each(['.', './', '..', '../', '/home/user/.', '/home/user/..'])(
    'rejects current or parent directory target "%s" before shell or SFTP deletion',
    async (remotePath) => {
      const { shell, sftp } = createSftpHarness()
      const exec = vi.spyOn(shell, 'exec').mockResolvedValue({ stdout: '', stderr: '', code: 0 })

      await expect(shell.deleteRecursive(remotePath, '/home/user')).rejects.toMatchObject({ code: 'VALIDATION' })

      expect(exec).not.toHaveBeenCalled()
      expect(sftp.lstat).not.toHaveBeenCalled()
      expect(sftp.readdir).not.toHaveBeenCalled()
      expect(sftp.unlink).not.toHaveBeenCalled()
      expect(sftp.rmdir).not.toHaveBeenCalled()
    }
  )

  it.each(['.', '..', '/home/user/.', '/home/user/..'])(
    'independently rejects current or parent directory target "%s" in the SFTP fallback',
    async (remotePath) => {
      const { shell, sftp } = createSftpHarness()
      const fallback = (shell as unknown as {
        deleteRecursiveSftp: (path: string, cwd?: string) => Promise<void>
      }).deleteRecursiveSftp

      await expect(fallback.call(shell, remotePath, '/home/user')).rejects.toMatchObject({ code: 'VALIDATION' })

      expect(sftp.lstat).not.toHaveBeenCalled()
      expect(sftp.readdir).not.toHaveBeenCalled()
      expect(sftp.unlink).not.toHaveBeenCalled()
      expect(sftp.rmdir).not.toHaveBeenCalled()
    }
  )

  it('rejects whitespace-only delete targets before execution', async () => {
    const { shell } = createHarness()
    const exec = vi.spyOn(shell, 'exec').mockResolvedValue({ stdout: '', stderr: '', code: 0 })

    await expect(shell.deleteRecursive('   ', '/home/user')).rejects.toMatchObject({ code: 'VALIDATION' })

    expect(exec).not.toHaveBeenCalled()
  })

  it('preserves trailing whitespace in valid delete target names', async () => {
    const { shell } = createHarness()
    const exec = vi.spyOn(shell, 'exec').mockResolvedValue({ stdout: '', stderr: '', code: 0 })

    await expect(shell.deleteRecursive('/tmp/report ', '/home/user')).resolves.toBeUndefined()

    expect(exec.mock.calls[0][0]).toContain(encodedTargetAssignment('/tmp/report '))
  })

  it('runs the preflight in POSIX sh without exposing shell-special path bytes', async () => {
    const { shell } = createHarness()
    const remotePath = "/tmp/report '$(touch /tmp/unsafe)\n"
    const exec = vi.spyOn(shell, 'exec').mockResolvedValue({ stdout: '', stderr: '', code: 0 })

    await expect(shell.deleteRecursive(remotePath)).resolves.toBeUndefined()

    const command = exec.mock.calls[0][0]
    expect(command.startsWith("/bin/sh -c '")).toBe(true)
    expect(command.endsWith("'")).toBe(true)
    const script = command.slice("/bin/sh -c '".length, -1)
    expect(script).not.toContain("'")
    expect(command).toContain(encodedTargetAssignment(remotePath))
  })

  it('rejects NUL bytes before starting shell deletion', async () => {
    const { shell } = createHarness()
    const exec = vi.spyOn(shell, 'exec').mockResolvedValue({ stdout: '', stderr: '', code: 0 })

    await expect(shell.deleteRecursive('/tmp/report\0backup')).rejects.toMatchObject({ code: 'VALIDATION' })
    expect(exec).not.toHaveBeenCalled()
  })

  it('keeps a final symlink as a leaf in the shell deletion path', async () => {
    const { shell } = createHarness()
    const exec = vi.spyOn(shell, 'exec').mockResolvedValue({ stdout: '', stderr: '', code: 0 })

    await expect(shell.deleteRecursive('/tmp/link/', '/home/user')).resolves.toBeUndefined()

    const command = exec.mock.calls[0][0]
    expect(command).toContain(encodedTargetAssignment('/tmp/link/'))
    expect(command).toContain('target_entry=$target')
    expect(command).toContain('[ -L "$target_entry" ] || [ -d "$target_entry" ]')
    expect(command).toContain('target=$target_entry')
    expect(command).toContain('[ -L "$target" ]')
  })

  it('rejects a trailing slash on a regular file before shell deletion', async () => {
    const { shell } = createHarness()
    const exec = vi.spyOn(shell, 'exec').mockResolvedValue({ stdout: '', stderr: '', code: 75 })
    const fallback = vi.spyOn(
      shell as unknown as { deleteRecursiveSftp: (path: string, cwd?: string) => Promise<void> },
      'deleteRecursiveSftp'
    ).mockResolvedValue(undefined)

    await expect(shell.deleteRecursive('/tmp/report/')).rejects.toMatchObject({ code: 'VALIDATION' })

    const command = exec.mock.calls[0][0]
    expect(command).toContain(encodedTargetAssignment('/tmp/report/'))
    expect(command).toContain('elif [ -e "$target_entry" ]; then')
    expect(command.indexOf('exit 75')).toBeLessThan(command.indexOf('rm -rf -- "$target"'))
    expect(fallback).not.toHaveBeenCalled()
  })

  it('falls back to SFTP when exec is unavailable', async () => {
    const { shell, sftp } = createSftpHarness()
    vi.spyOn(shell, 'exec').mockRejectedValue(new SshError('SSH_EXEC', 'Exec disabled'))

    await expect(shell.deleteRecursive('/tmp/target', '/home/user')).resolves.toBeUndefined()

    expect(sftp.readdir).toHaveBeenCalledWith('/tmp/target', expect.any(Function))
    expect(sftp.rmdir).toHaveBeenCalledWith('/tmp/target', expect.any(Function))
  })

  it('rejects a trailing slash on a regular file in the SFTP fallback', async () => {
    const { shell, sftp } = createSftpHarness()
    const fileStats = { isDirectory: () => false, isSymbolicLink: () => false }
    sftp.lstat.mockImplementation((_path, callback) => callback(null, fileStats))
    const fallback = (shell as unknown as {
      deleteRecursiveSftp: (path: string, cwd?: string) => Promise<void>
    }).deleteRecursiveSftp

    await expect(fallback.call(shell, '/tmp/report/')).rejects.toMatchObject({ code: 'VALIDATION' })

    expect(sftp.lstat).toHaveBeenCalledWith('/tmp/report', expect.any(Function))
    expect(sftp.unlink).not.toHaveBeenCalled()
    expect(sftp.readdir).not.toHaveBeenCalled()
    expect(sftp.rmdir).not.toHaveBeenCalled()
  })

  it('normalizes trailing separators only after identifying a directory in the SFTP fallback', async () => {
    const { shell, sftp } = createSftpHarness()
    const fallback = (shell as unknown as {
      deleteRecursiveSftp: (path: string, cwd?: string) => Promise<void>
    }).deleteRecursiveSftp

    await expect(fallback.call(shell, '/tmp/target/')).resolves.toBeUndefined()

    expect(sftp.lstat).toHaveBeenCalledWith('/tmp/target', expect.any(Function))
    expect(sftp.realpath).toHaveBeenCalledWith('/tmp/target', expect.any(Function))
    expect(sftp.readdir).toHaveBeenCalledWith('/tmp/target', expect.any(Function))
    expect(sftp.rmdir).toHaveBeenCalledWith('/tmp/target', expect.any(Function))
  })

  it('deletes regular files through the SFTP fallback', async () => {
    const { shell, sftp } = createSftpHarness()
    const fileStats = { isDirectory: () => false, isSymbolicLink: () => false }
    sftp.lstat.mockImplementation((_path, callback) => callback(null, fileStats))
    vi.spyOn(shell, 'exec').mockRejectedValue(new SshError('SSH_EXEC', 'Exec disabled'))

    await expect(shell.deleteRecursive('/tmp/file.txt', '/home/user')).resolves.toBeUndefined()

    expect(sftp.unlink).toHaveBeenCalledWith('/tmp/file.txt', expect.any(Function))
    expect(sftp.realpath).not.toHaveBeenCalled()
    expect(sftp.readdir).not.toHaveBeenCalled()
    expect(sftp.rmdir).not.toHaveBeenCalled()
  })

  it('does not resolve the SFTP cwd for an absolute file fallback target', async () => {
    const { shell, sftp } = createSftpHarness()
    const fileStats = { isDirectory: () => false, isSymbolicLink: () => false }
    sftp.lstat.mockImplementation((_path, callback) => callback(null, fileStats))
    vi.spyOn(shell, 'exec').mockRejectedValue(new SshError('SSH_EXEC', 'Exec disabled'))

    await expect(shell.deleteRecursive('/tmp/file.txt')).resolves.toBeUndefined()

    expect(sftp.realpath).not.toHaveBeenCalled()
    expect(sftp.unlink).toHaveBeenCalledWith('/tmp/file.txt', expect.any(Function))
  })

  it('preserves trailing whitespace in SFTP fallback target names', async () => {
    const { shell, sftp } = createSftpHarness()
    const fileStats = { isDirectory: () => false, isSymbolicLink: () => false }
    sftp.lstat.mockImplementation((_path, callback) => callback(null, fileStats))
    vi.spyOn(shell, 'exec').mockRejectedValue(new SshError('SSH_EXEC', 'Exec disabled'))

    await expect(shell.deleteRecursive('/tmp/report ', '/home/user')).resolves.toBeUndefined()

    expect(sftp.lstat).toHaveBeenCalledWith('/tmp/report ', expect.any(Function))
    expect(sftp.unlink).toHaveBeenCalledWith('/tmp/report ', expect.any(Function))
  })

  it.each(['/tmp/link', '/tmp/link/'])(
    'deletes symlink path "%s" as a leaf without resolving its target',
    async (remotePath) => {
      const { shell, sftp } = createSftpHarness()
      const symlinkStats = { isDirectory: () => false, isSymbolicLink: () => true }
      sftp.lstat.mockImplementation((_path, callback) => callback(null, symlinkStats))
      vi.spyOn(shell, 'exec').mockRejectedValue(new SshError('SSH_EXEC', 'Exec disabled'))

      await expect(shell.deleteRecursive(remotePath, '/home/user')).resolves.toBeUndefined()

      expect(sftp.lstat).toHaveBeenCalledWith('/tmp/link', expect.any(Function))
      expect(sftp.realpath).not.toHaveBeenCalled()
      expect(sftp.unlink).toHaveBeenCalledWith('/tmp/link', expect.any(Function))
      expect(sftp.readdir).not.toHaveBeenCalled()
      expect(sftp.rmdir).not.toHaveBeenCalled()
    }
  )
})
