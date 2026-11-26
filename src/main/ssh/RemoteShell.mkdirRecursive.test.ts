import type { Client } from 'ssh2'
import { describe, expect, it, vi } from 'vitest'
import { SshError } from './errors'
import { RemoteShell } from './RemoteShell'

const directoryStats = {
  isDirectory: () => true
} as Awaited<ReturnType<RemoteShell['stat']>>

function createShell(): RemoteShell {
  const shell = new RemoteShell({} as Client)
  vi.spyOn(shell, 'exec').mockRejectedValue(new SshError('SSH_EXEC', 'Exec disabled'))
  return shell
}

describe('RemoteShell recursive mkdir SFTP fallback', () => {
  it('preserves the leading slash for every absolute path component', async () => {
    const shell = createShell()
    const stat = vi.spyOn(shell, 'stat').mockRejectedValue(new SshError('NOT_FOUND', 'Missing'))
    const mkdir = vi.spyOn(shell, 'mkdir').mockResolvedValue(undefined)

    await shell.mkdirRecursive('/srv/backups/project')

    expect(stat.mock.calls.map(([remotePath]) => remotePath)).toEqual([
      '/srv',
      '/srv/backups',
      '/srv/backups/project'
    ])
    expect(mkdir.mock.calls.map(([remotePath]) => remotePath)).toEqual([
      '/srv',
      '/srv/backups',
      '/srv/backups/project'
    ])
  })

  it('does not recreate existing absolute directories', async () => {
    const shell = createShell()
    const stat = vi.spyOn(shell, 'stat').mockResolvedValue(directoryStats)
    const mkdir = vi.spyOn(shell, 'mkdir').mockResolvedValue(undefined)

    await shell.mkdirRecursive('/srv/backups/project')

    expect(stat.mock.calls.map(([remotePath]) => remotePath)).toEqual([
      '/srv',
      '/srv/backups',
      '/srv/backups/project'
    ])
    expect(mkdir).not.toHaveBeenCalled()
  })

  it('keeps relative paths relative to the remote working directory', async () => {
    const shell = createShell()
    const stat = vi.spyOn(shell, 'stat').mockRejectedValue(new SshError('NOT_FOUND', 'Missing'))
    const mkdir = vi.spyOn(shell, 'mkdir').mockResolvedValue(undefined)

    await shell.mkdirRecursive('backups/project')

    expect(stat.mock.calls.map(([remotePath]) => remotePath)).toEqual([
      'backups',
      'backups/project'
    ])
    expect(mkdir.mock.calls.map(([remotePath]) => remotePath)).toEqual([
      'backups',
      'backups/project'
    ])
  })

  it.each(['/', '////'])('does not create or inspect components for root path %s', async (remotePath) => {
    const shell = createShell()
    const stat = vi.spyOn(shell, 'stat')
    const mkdir = vi.spyOn(shell, 'mkdir')

    await shell.mkdirRecursive(remotePath)

    expect(stat).not.toHaveBeenCalled()
    expect(mkdir).not.toHaveBeenCalled()
  })

  it('does not use SFTP when the shell mkdir succeeds', async () => {
    const shell = createShell()
    vi.mocked(shell.exec).mockResolvedValue({ stdout: '', stderr: '', code: 0 })
    const stat = vi.spyOn(shell, 'stat')
    const mkdir = vi.spyOn(shell, 'mkdir')

    await shell.mkdirRecursive('/srv/backups/project')

    expect(stat).not.toHaveBeenCalled()
    expect(mkdir).not.toHaveBeenCalled()
  })
})
