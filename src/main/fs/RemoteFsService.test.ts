import { describe, expect, it, vi, beforeEach } from 'vitest'
import { listRemote } from './RemoteFsService'
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
