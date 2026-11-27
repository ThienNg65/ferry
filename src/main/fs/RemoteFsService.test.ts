import { describe, expect, it, vi, beforeEach } from 'vitest'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough, Writable } from 'node:stream'
import { commitRemoteFile, copyRemote, listRemote, readRemoteBufferForDiffSudo, renameRemote, uploadForEdit, uploadForEditSudo } from './RemoteFsService'
import { SshError } from '../ssh/errors'
import { SessionManager } from '../ssh/SessionManager'

vi.mock('../ssh/SessionManager', () => ({
  SessionManager: {
    getInstance: vi.fn()
  }
}))

describe('RemoteFsService.listRemote', () => {
  const mockShell = {
    exec: vi.fn(),
    realpath: vi.fn(),
    readdir: vi.fn(),
    readlink: vi.fn(),
    stat: vi.fn()
  }

  const mockManager = {
    cwd: vi.fn(() => '/home/user'),
    shell: vi.fn(() => mockShell),
    setCwd: vi.fn()
  }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(SessionManager.getInstance).mockReturnValue(mockManager as any)
  })

  it('uses exec result when exec command succeeds with valid json', async () => {
    mockShell.exec.mockResolvedValueOnce({
      code: 0,
      stdout: JSON.stringify({
        path: '/var/log',
        entries: [
          { name: 'test.log', path: '/var/log/test.log', isDir: false, size: 10, mtimeMs: 1000, permissions: '0644' }
        ]
      }),
      stderr: ''
    })

    const result = await listRemote('sess-1', '/var/log')
    expect(mockShell.exec).toHaveBeenCalled()
    expect(mockShell.readdir).not.toHaveBeenCalled()
    expect(result.path).toBe('/var/log')
    expect(result.entries).toHaveLength(1)
    expect(result.entries[0].name).toBe('test.log')
    expect(mockManager.setCwd).toHaveBeenCalledWith('sess-1', '/var/log')
  })

  it('falls back to SFTP readdir when exec fails with non-zero exit code', async () => {
    mockShell.exec.mockResolvedValueOnce({ code: 127, stdout: '', stderr: 'command not found' })
    mockShell.realpath.mockResolvedValueOnce('/var/log')
    mockShell.readdir.mockResolvedValueOnce([
      { filename: 'fallback.txt', isDirectory: false, isSymlink: false, size: 20, mtimeMs: 2000, permissions: '0644' }
    ])

    const result = await listRemote('sess-1', '/var/log')
    expect(mockShell.exec).toHaveBeenCalled()
    expect(mockShell.readdir).toHaveBeenCalledWith('/var/log')
    expect(result.entries[0].name).toBe('fallback.txt')
    expect(mockManager.setCwd).toHaveBeenCalledWith('sess-1', '/var/log')
  })

  it('falls back to SFTP when exec throws an error', async () => {
    mockShell.exec.mockRejectedValueOnce(new Error('Channel open failed'))
    mockShell.realpath.mockResolvedValueOnce('/home/user')
    mockShell.readdir.mockResolvedValueOnce([
      { filename: 'home.txt', isDirectory: false, isSymlink: false, size: 5, mtimeMs: 3000, permissions: '0644' }
    ])

    const result = await listRemote('sess-1')
    expect(mockShell.exec).toHaveBeenCalled()
    expect(mockShell.readdir).toHaveBeenCalledWith('/home/user')
    expect(result.entries[0].name).toBe('home.txt')
  })

  it('does not update session cwd when isPrefetch is true', async () => {
    mockShell.exec.mockResolvedValueOnce({
      code: 0,
      stdout: JSON.stringify({
        path: '/var/log/nginx',
        entries: []
      }),
      stderr: ''
    })

    await listRemote('sess-1', '/var/log/nginx', true)
    expect(mockManager.setCwd).not.toHaveBeenCalled()
  })
})

describe('RemoteFsService permission & sudo safety', () => {
  it('commitRemoteFile preserves 0000 permission mode when existing target has mode 0o100000', async () => {
    const sftp = {
      realpath: vi.fn((_p: string, cb: (err: Error | null, res: string) => void) => cb(null, '/srv/secret.txt')),
      ext_openssh_rename: vi.fn((_from: string, _to: string, cb: (err?: Error | null) => void) => cb(null))
    }
    const shell = {
      sftp: vi.fn(async () => sftp),
      stat: vi.fn(async () => ({ mode: 0o100000 })),
      chmod: vi.fn(async () => undefined)
    }

    await commitRemoteFile(shell as any, '/srv/secret.txt.part', '/srv/secret.txt')
    expect(shell.chmod).toHaveBeenCalledWith('/srv/secret.txt.part', '0000')
  })

  it('uploadForEditSudo aborts and removes temp file if chown --reference fails', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ferry-sudo-test-'))
    const localFile = join(dir, 'edit.txt')
    await writeFile(localFile, 'updated')

    const commands: string[] = []
    const shell = {
      execWithStdin: vi.fn(async (cmd: string) => {
        commands.push(cmd)
        if (cmd.includes('chown --reference')) {
          return { code: 1, stdout: Buffer.alloc(0), stderr: 'Operation not permitted' }
        }
        return { code: 0, stdout: Buffer.alloc(0), stderr: '' }
      })
    }
    vi.mocked(SessionManager.getInstance).mockReturnValue({ shell: () => shell } as any)

    try {
      await expect(uploadForEditSudo('sess-1', localFile, '/etc/service.conf')).rejects.toThrow('Operation not permitted')
      expect(commands.some((c) => c.includes('mv -f'))).toBe(false)
      expect(commands.some((c) => c.includes('rm -f'))).toBe(true)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe('RemoteFsService.uploadForEdit stream completion', () => {
  async function fixture() {
    const dir = await mkdtemp(join(tmpdir(), 'ferry-upload-test-'))
    const localFile = join(dir, 'edit.txt')
    await writeFile(localFile, 'updated contents')
    return { dir, localFile }
  }

  function setup(writeStream: Writable) {
    const sftp = {
      realpath: vi.fn((_path: string, cb: (error: Error | null, path: string) => void) => cb(null, '/srv/edit.txt')),
      createWriteStream: vi.fn(() => writeStream),
      ext_openssh_rename: vi.fn((_from: string, _to: string, cb: (error: Error | null) => void) => cb(null))
    }
    const shell = {
      sftp: vi.fn(async () => sftp),
      stat: vi.fn(async () => ({ mode: 0o100644, mtime: 0, size: 16 })),
      chmod: vi.fn(async () => undefined),
      unlink: vi.fn(async () => undefined)
    }
    vi.mocked(SessionManager.getInstance).mockReturnValue({ shell: () => shell } as any)
    return { shell, sftp }
  }

  it('rejects close before finish without replacing the original and cleans staging', async () => {
    const { dir, localFile } = await fixture()
    const stream = new Writable({
      write(_chunk, _encoding, _callback) {
        // Simulate a remote channel that closes before acknowledging the write.
        queueMicrotask(() => stream.destroy())
      }
    })
    const { shell, sftp } = setup(stream)
    try {
      await expect(uploadForEdit('sess-1', localFile, '/srv/edit.txt')).rejects.toThrow('closed before finishing')
      expect(sftp.ext_openssh_rename).not.toHaveBeenCalled()
      expect(shell.unlink).toHaveBeenCalledWith(expect.stringContaining('/srv/edit.txt.ferry-tmp-'))
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('commits only after a successful writable finish and close', async () => {
    const { dir, localFile } = await fixture()
    const chunks: Buffer[] = []
    const stream = new Writable({
      autoDestroy: false,
      write(chunk, _encoding, callback) {
        chunks.push(Buffer.from(chunk))
        callback()
      }
    })
    const { sftp, shell } = setup(stream)
    try {
      await uploadForEdit('sess-1', localFile, '/srv/edit.txt')
      expect(Buffer.concat(chunks).toString()).toBe('updated contents')
      expect(sftp.createWriteStream).toHaveBeenCalledWith(
        expect.stringContaining('/srv/edit.txt.ferry-tmp-'),
        { autoClose: false }
      )
      expect(sftp.ext_openssh_rename).toHaveBeenCalledTimes(1)
      expect(shell.unlink).not.toHaveBeenCalled()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('does not open the original for writing when staging is denied', async () => {
    const { dir, localFile } = await fixture()
    const stream = new Writable({
      write(_chunk, _encoding, callback) {
        callback(new Error('Permission denied'))
      }
    })
    const { sftp } = setup(stream)
    try {
      await expect(uploadForEdit('sess-1', localFile, '/srv/edit.txt')).rejects.toThrow('Permission denied')
      expect(sftp.createWriteStream).toHaveBeenCalledTimes(1)
      expect(sftp.createWriteStream).toHaveBeenCalledWith(
        expect.stringContaining('/srv/edit.txt.ferry-tmp-'),
        { autoClose: false }
      )
      expect(sftp.ext_openssh_rename).not.toHaveBeenCalled()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('rejects stream errors and does not commit', async () => {
    const { dir, localFile } = await fixture()
    const stream = new Writable({
      write(_chunk, _encoding, callback) {
        callback(new Error('channel lost'))
      }
    })
    const { sftp, shell } = setup(stream)
    try {
      await expect(uploadForEdit('sess-1', localFile, '/srv/edit.txt')).rejects.toThrow('channel lost')
      expect(sftp.ext_openssh_rename).not.toHaveBeenCalled()
      expect(shell.unlink).toHaveBeenCalledTimes(1)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe('RemoteFsService POSIX rename fallback', () => {
  it('commitRemoteFile falls back to backup-and-rename when the extension callback fails', async () => {
    const target = '/srv/target.txt'
    const sftp = {
      realpath: vi.fn((_path: string, callback: (error: Error | null, resolvedPath: string) => void) =>
        callback(null, target)
      ),
      ext_openssh_rename: vi.fn(
        (_from: string, _to: string, callback: (error: Error | null) => void) =>
          callback(new Error('Unsupported extension'))
      )
    }
    const shell = {
      sftp: vi.fn(async () => sftp),
      stat: vi.fn(async () => ({ mode: 0o100644 })),
      chmod: vi.fn(async (_path: string, _mode: string) => undefined),
      rename: vi.fn(async (_from: string, _to: string) => undefined),
      unlink: vi.fn(async (_path: string) => undefined)
    }

    await commitRemoteFile(shell as any, `${target}.part`, target)

    expect(sftp.ext_openssh_rename).toHaveBeenCalledTimes(1)
    expect(shell.rename).toHaveBeenNthCalledWith(1, target, expect.stringContaining(`${target}.ferry-bak-`))
    const backupPath = shell.rename.mock.calls[0][1]
    expect(shell.rename).toHaveBeenNthCalledWith(2, `${target}.part`, target)
    expect(shell.unlink).toHaveBeenCalledWith(backupPath)
  })

  it('uploadForEdit falls back to backup-and-rename when the extension callback fails', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ferry-posix-rename-test-'))
    const localFile = join(dir, 'edit.txt')
    const target = '/srv/edit.txt'
    await writeFile(localFile, 'updated contents')

    const stream = new Writable({
      autoDestroy: false,
      write(_chunk, _encoding, callback) {
        callback()
      }
    })
    const sftp = {
      realpath: vi.fn((_path: string, callback: (error: Error | null, resolvedPath: string) => void) =>
        callback(null, target)
      ),
      createWriteStream: vi.fn(() => stream),
      ext_openssh_rename: vi.fn(
        (_from: string, _to: string, callback: (error: Error | null) => void) =>
          callback(new Error('Unsupported extension'))
      )
    }
    const shell = {
      sftp: vi.fn(async () => sftp),
      stat: vi.fn(async () => ({ mode: 0o100644, mtime: 0, size: 16 })),
      chmod: vi.fn(async (_path: string, _mode: string) => undefined),
      rename: vi.fn(async (_from: string, _to: string) => undefined),
      unlink: vi.fn(async (_path: string) => undefined)
    }
    vi.mocked(SessionManager.getInstance).mockReturnValue({ shell: () => shell } as any)

    try {
      await uploadForEdit('sess-1', localFile, target)

      expect(sftp.ext_openssh_rename).toHaveBeenCalledTimes(1)
      expect(shell.rename).toHaveBeenNthCalledWith(1, target, expect.stringContaining(`${target}.ferry-bak-`))
      const backupPath = shell.rename.mock.calls[0][1]
      expect(shell.rename).toHaveBeenNthCalledWith(2, expect.stringContaining(`${target}.ferry-tmp-`), target)
      expect(shell.unlink).toHaveBeenCalledWith(backupPath)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('renameRemote falls back to backup-and-rename when the extension callback fails', async () => {
    const sourcePath = '/srv/source.txt'
    const target = '/srv/target.txt'
    const source = { isDirectory: () => false }
    const destination = { isDirectory: () => false }
    const sftp = {
      ext_openssh_rename: vi.fn(
        (_from: string, _to: string, callback: (error: Error | null) => void) =>
          callback(new Error('Unsupported extension'))
      )
    }
    const shell = {
      sftp: vi.fn(async () => sftp),
      lstat: vi.fn().mockResolvedValueOnce(destination).mockResolvedValueOnce(source),
      rename: vi.fn(async (_from: string, _to: string) => undefined),
      unlink: vi.fn(async (_path: string) => undefined)
    }
    vi.mocked(SessionManager.getInstance).mockReturnValue({ shell: () => shell } as any)

    await renameRemote('sess-1', sourcePath, target, true)

    expect(sftp.ext_openssh_rename).toHaveBeenCalledTimes(1)
    expect(shell.rename).toHaveBeenNthCalledWith(1, target, expect.stringContaining(`${target}.ferry-bak-`))
    const backupPath = shell.rename.mock.calls[0][1]
    expect(shell.rename).toHaveBeenNthCalledWith(2, sourcePath, target)
    expect(shell.unlink).toHaveBeenCalledWith(backupPath)
  })

  it('surfaces standard SFTP replacement errors after a POSIX rename callback failure', async () => {
    const target = '/srv/target.txt'
    const permissionError = new Error('Permission denied')
    const sftp = {
      realpath: vi.fn((_path: string, callback: (error: Error | null, resolvedPath: string) => void) =>
        callback(null, target)
      ),
      ext_openssh_rename: vi.fn(
        (_from: string, _to: string, callback: (error: Error | null) => void) =>
          callback(new Error('Unsupported extension'))
      )
    }
    const shell = {
      sftp: vi.fn(async () => sftp),
      stat: vi.fn(async () => ({ mode: 0o100644 })),
      chmod: vi.fn(async (_path: string, _mode: string) => undefined),
      rename: vi.fn(async (_from: string, _to: string) => {
        throw permissionError
      }),
      unlink: vi.fn(async (_path: string) => undefined)
    }

    await expect(commitRemoteFile(shell as any, `${target}.part`, target)).rejects.toBe(permissionError)
    expect(shell.rename).toHaveBeenCalledTimes(1)
  })

  it('readRemoteBufferForDiffSudo checks size via stat before reading and skips oversized files', async () => {
    const execWithStdin = vi.fn()
      .mockResolvedValueOnce({ code: 0, stdout: Buffer.from('regular file|11\n'), stderr: '' })
      .mockResolvedValueOnce({ code: 0, stdout: Buffer.from('root-secret'), stderr: '' })
      .mockResolvedValueOnce({ code: 0, stdout: Buffer.from('regular file|2000000\n'), stderr: '' })
      .mockResolvedValueOnce({ code: 0, stdout: Buffer.from('directory|4096\n'), stderr: '' })

    vi.mocked(SessionManager.getInstance).mockReturnValue({ shell: () => ({ execWithStdin }) } as any)

    const okRes = await readRemoteBufferForDiffSudo('sess-1', '/etc/shadow', 1024)
    expect(okRes).toEqual({ size: 11, isDir: false, buffer: Buffer.from('root-secret') })
    expect(execWithStdin).toHaveBeenNthCalledWith(1, "sudo -n stat -L -c '%F|%s' -- '/etc/shadow'", undefined, undefined)
    expect(execWithStdin).toHaveBeenNthCalledWith(2, "sudo -n cat -- '/etc/shadow'", undefined, undefined)

    const bigRes = await readRemoteBufferForDiffSudo('sess-1', '/var/log/huge.log', 1024)
    expect(bigRes).toEqual({ size: 2_000_000, isDir: false })
    expect(execWithStdin).toHaveBeenCalledTimes(3)

    const dirRes = await readRemoteBufferForDiffSudo('sess-1', '/etc/ssl', 1024)
    expect(dirRes).toEqual({ size: 4096, isDir: true })
  })
})

describe('RemoteFsService.copyRemote', () => {
  const dirStat = { isDirectory: () => true, isSymbolicLink: () => false }
  const fileStat = { isDirectory: () => false, isSymbolicLink: () => false }

  it('uses SFTP ext_copy_data for regular files when supported', async () => {
    const sftp = {
      open: vi.fn((_p: string, flags: string, cb: (err: Error | null, h: Buffer) => void) =>
        cb(null, Buffer.from(flags))
      ),
      close: vi.fn((_h: Buffer, cb: () => void) => cb()),
      ext_copy_data: vi.fn((_s: Buffer, _so: number, _l: number, _d: Buffer, _do: number, cb: (err?: Error | null) => void) =>
        cb(null)
      )
    }
    const shell = {
      sftp: vi.fn(async () => sftp),
      stat: vi.fn(async () => dirStat),
      readdir: vi.fn(async () => []),
      lstat: vi.fn(async (p: string) => {
        if (p === '/srv/src/app.log') return fileStat
        throw new SshError('NOT_FOUND', 'missing')
      }),
      exec: vi.fn()
    }
    vi.mocked(SessionManager.getInstance).mockReturnValue({ shell: () => shell } as any)

    const res = await copyRemote('sess-1', ['/srv/src/app.log'], '/srv/dest')
    expect(res.failures).toEqual([])
    expect(res.copied).toEqual([{ sourcePath: '/srv/src/app.log', targetPath: '/srv/dest/app.log' }])
    expect(sftp.ext_copy_data).toHaveBeenCalledTimes(1)
    expect(shell.exec).not.toHaveBeenCalled()
  })

  it('falls back to shell-escaped cp -Rp -- when ext_copy_data fails or for folders, and avoids collisions', async () => {
    const sftp = {
      open: vi.fn((_p: string, flags: string, cb: (err: Error | null, h: Buffer) => void) =>
        cb(null, Buffer.from(flags))
      ),
      close: vi.fn((_h: Buffer, cb: () => void) => cb()),
      unlink: vi.fn((_p: string, cb: () => void) => cb()),
      ext_copy_data: vi.fn((_s: Buffer, _so: number, _l: number, _d: Buffer, _do: number, cb: (err?: Error | null) => void) =>
        cb(new Error('EOPNOTSUPP'))
      )
    }
    const shell = {
      sftp: vi.fn(async () => sftp),
      stat: vi.fn(async () => dirStat),
      unlink: vi.fn(async () => undefined),
      readdir: vi.fn(async () => [{ filename: 'notes.txt' }, { filename: 'my folder' }]),
      lstat: vi.fn(async (p: string) => {
        if (p === '/srv/dir/notes.txt') return fileStat
        if (p === '/srv/dir/my folder') return dirStat
        throw new SshError('NOT_FOUND', 'missing')
      }),
      exec: vi.fn(async () => ({ code: 0, stdout: '', stderr: '' }))
    }
    vi.mocked(SessionManager.getInstance).mockReturnValue({ shell: () => shell } as any)

    const res = await copyRemote('sess-1', ['/srv/dir/notes.txt', '/srv/dir/my folder'], '/srv/dir')
    expect(res.failures).toEqual([])
    expect(res.copied).toEqual([
      { sourcePath: '/srv/dir/notes.txt', targetPath: '/srv/dir/notes (1).txt' },
      { sourcePath: '/srv/dir/my folder', targetPath: '/srv/dir/my folder (1)' }
    ])
    expect(shell.exec).toHaveBeenCalledWith(
      "cp -Rp -- '/srv/dir/notes.txt' '/srv/dir/notes (1).txt'",
      expect.any(Object)
    )
    expect(shell.exec).toHaveBeenCalledWith(
      "cp -Rp -- '/srv/dir/my folder' '/srv/dir/my folder (1)'",
      expect.any(Object)
    )
  })

  it('falls back to recursive SFTP stream copy when exec is unavailable', async () => {
    const chunks: Buffer[] = []
    const sftp = {
      createReadStream: vi.fn(() => {
        const pt = new PassThrough()
        pt.end('stream-body')
        return pt
      }),
      createWriteStream: vi.fn(() => {
        const ws = new Writable({
          write(chunk, _enc, cb) {
            chunks.push(Buffer.from(chunk))
            cb()
          }
        })
        ws.destroy = function (this: Writable) {
          queueMicrotask(() => this.emit('close'))
          return this
        }
        return ws
      })
    }
    const shell = {
      sftp: vi.fn(async () => sftp),
      stat: vi.fn(async () => dirStat),
      mkdir: vi.fn(async () => undefined),
      readdir: vi.fn(async (p: string) => {
        if (p === '/srv/dest') return []
        if (p === '/srv/src/bundle') return [{ filename: 'data.bin', isDirectory: false, isSymlink: false }]
        return []
      }),
      lstat: vi.fn(async (p: string) => {
        if (p === '/srv/src/bundle') return dirStat
        if (p === '/srv/src/bundle/data.bin') return fileStat
        throw new SshError('NOT_FOUND', 'missing')
      }),
      exec: vi.fn(async () => ({ code: 127, stdout: '', stderr: 'exec disabled' }))
    }
    vi.mocked(SessionManager.getInstance).mockReturnValue({ shell: () => shell } as any)

    const res = await copyRemote('sess-1', ['/srv/src/bundle'], '/srv/dest')
    expect(res.failures).toEqual([])
    expect(res.copied).toEqual([{ sourcePath: '/srv/src/bundle', targetPath: '/srv/dest/bundle' }])
    expect(shell.mkdir).toHaveBeenCalledWith('/srv/dest/bundle')
    expect(Buffer.concat(chunks).toString('utf8')).toBe('stream-body')
  })

  it('rejects copying a remote folder into itself or a descendant', async () => {
    const shell = {
      sftp: vi.fn(),
      stat: vi.fn(async () => dirStat),
      readdir: vi.fn(async () => []),
      lstat: vi.fn(async () => dirStat),
      exec: vi.fn()
    }
    vi.mocked(SessionManager.getInstance).mockReturnValue({ shell: () => shell } as any)

    const res = await copyRemote('sess-1', ['/srv/app'], '/srv/app/sub')
    expect(res.copied).toEqual([])
    expect(res.failures[0].error).toMatch(/itself or one of its subdirectories/i)
    expect(shell.exec).not.toHaveBeenCalled()
  })

  it('propagates SSH_TIMEOUT and non-126/127 cp errors without running SFTP fallback on partial files', async () => {
    const sftp = { ext_copy_data: undefined }
    const shell = {
      sftp: vi.fn(async () => sftp),
      stat: vi.fn(async () => dirStat),
      mkdir: vi.fn(async () => undefined),
      readdir: vi.fn(async () => []),
      lstat: vi.fn(async (p: string) => {
        if (p === '/srv/src/big') return dirStat
        throw new SshError('NOT_FOUND', 'missing')
      }),
      exec: vi.fn().mockRejectedValueOnce(new SshError('SSH_TIMEOUT', 'Command timed out after 120000ms', true))
    }
    vi.mocked(SessionManager.getInstance).mockReturnValue({ shell: () => shell } as any)

    const timeoutRes = await copyRemote('sess-1', ['/srv/src/big'], '/srv/dest')
    expect(timeoutRes.copied).toEqual([])
    expect(timeoutRes.failures[0].error).toMatch(/timed out/i)
    expect(shell.mkdir).not.toHaveBeenCalled()

    shell.exec.mockResolvedValueOnce({ code: 1, stdout: '', stderr: 'cp: No space left on device' })
    const cpFailRes = await copyRemote('sess-1', ['/srv/src/big'], '/srv/dest')
    expect(cpFailRes.copied).toEqual([])
    expect(cpFailRes.failures[0].error).toBe('cp: No space left on device')
    expect(shell.mkdir).not.toHaveBeenCalled()
  })

  it('closes handles before unlinking on ext_copy_data failure and probes ext_copy_data only once per batch', async () => {
    const events: string[] = []
    const sftp = {
      open: vi.fn((_p: string, flags: string, cb: (err: Error | null, h: Buffer) => void) =>
        cb(null, Buffer.from(flags))
      ),
      close: vi.fn((h: Buffer, cb: () => void) => {
        events.push(`close:${h.toString()}`)
        cb()
      }),
      ext_copy_data: vi.fn((_s: Buffer, _so: number, _l: number, _d: Buffer, _do: number, cb: (err?: Error | null) => void) =>
        cb(new Error('EOPNOTSUPP'))
      )
    }
    const shell = {
      sftp: vi.fn(async () => sftp),
      stat: vi.fn(async () => dirStat),
      unlink: vi.fn(async (p: string) => {
        events.push(`unlink:${p}`)
      }),
      readdir: vi.fn(async () => []),
      lstat: vi.fn(async (p: string) => {
        if (p === '/srv/src/a.txt' || p === '/srv/src/b.txt') return fileStat
        throw new SshError('NOT_FOUND', 'missing')
      }),
      exec: vi.fn(async () => ({ code: 0, stdout: '', stderr: '' }))
    }
    vi.mocked(SessionManager.getInstance).mockReturnValue({ shell: () => shell } as any)

    const res = await copyRemote('sess-1', ['/srv/src/a.txt', '/srv/src/b.txt'], '/srv/dest')
    expect(res.failures).toEqual([])
    expect(res.copied).toHaveLength(2)
    expect(sftp.ext_copy_data).toHaveBeenCalledTimes(1)
    const closeIdx = events.indexOf('close:wx')
    const unlinkIdx = events.indexOf('unlink:/srv/dest/a.txt')
    expect(closeIdx).toBeGreaterThanOrEqual(0)
    expect(unlinkIdx).toBeGreaterThan(closeIdx)
  })

  it('normalizes double slashes and .. segments before root and self-copy checks', async () => {
    const shell = {
      sftp: vi.fn(),
      stat: vi.fn(async () => dirStat),
      readdir: vi.fn(async () => []),
      lstat: vi.fn(async () => dirStat),
      exec: vi.fn()
    }
    vi.mocked(SessionManager.getInstance).mockReturnValue({ shell: () => shell } as any)

    const res = await copyRemote('sess-1', ['/srv/app', '/a/..', 'relative/path'], '/srv//app/sub/')
    expect(res.copied).toEqual([])
    expect(res.failures).toHaveLength(3)
    expect(res.failures[0].error).toMatch(/itself or one of its subdirectories/i)
    expect(res.failures[1].error).toMatch(/Refusing to copy/i)
    expect(res.failures[2].error).toMatch(/Refusing to copy/i)
    expect(shell.exec).not.toHaveBeenCalled()
  })
})
