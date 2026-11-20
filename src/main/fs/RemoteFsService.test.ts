import { describe, expect, it, vi, beforeEach } from 'vitest'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Writable } from 'node:stream'
import { commitRemoteFile, listRemote, uploadForEdit, uploadForEditSudo } from './RemoteFsService'
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
      write(chunk, _encoding, callback) {
        chunks.push(Buffer.from(chunk))
        callback()
      }
    })
    const { sftp, shell } = setup(stream)
    try {
      await uploadForEdit('sess-1', localFile, '/srv/edit.txt')
      expect(Buffer.concat(chunks).toString()).toBe('updated contents')
      expect(sftp.ext_openssh_rename).toHaveBeenCalledTimes(1)
      expect(shell.unlink).not.toHaveBeenCalled()
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
