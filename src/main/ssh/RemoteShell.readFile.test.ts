import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import type { Client, SFTPWrapper, Stats } from 'ssh2'
import { describe, expect, it, vi } from 'vitest'
import { RemoteShell } from './RemoteShell'

function createHarness(size: number) {
  const stream = new PassThrough()
  const sftp = Object.assign(new EventEmitter(), {
    createReadStream: vi.fn(() => stream)
  }) as unknown as SFTPWrapper
  const client = {
    sftp: (callback: (error: Error | undefined, wrapper: SFTPWrapper) => void) => callback(undefined, sftp)
  } as unknown as Client
  const shell = new RemoteShell(client)
  vi.spyOn(shell, 'stat').mockResolvedValue({ size } as Stats)
  return { shell, stream, sftp }
}

function createPendingStatHarness() {
  let complete: ((error: Error | undefined, stats: Stats) => void) | undefined
  const sftp = Object.assign(new EventEmitter(), {
    stat: vi.fn((_path: string, callback: (error: Error | undefined, stats: Stats) => void) => {
      complete = callback
    })
  }) as unknown as SFTPWrapper
  const client = {
    sftp: (callback: (error: Error | undefined, wrapper: SFTPWrapper) => void) => callback(undefined, sftp)
  } as unknown as Client

  return {
    shell: new RemoteShell(client),
    sftp,
    completeStat: (stats: Stats): void => complete?.(undefined, stats)
  }
}

describe('RemoteShell.stat cancellation', () => {
  it('rejects a pending stat immediately when its signal aborts', async () => {
    const { shell, sftp, completeStat } = createPendingStatHarness()
    const controller = new AbortController()
    const result = shell.stat('/srv/file.txt', { signal: controller.signal })

    await vi.waitFor(() => expect(sftp.stat).toHaveBeenCalledTimes(1))
    controller.abort()

    await expect(result).rejects.toMatchObject({ code: 'CANCELLED' })
    completeStat({ size: 5 } as Stats)
  })
})

describe('RemoteShell.readFile', () => {
  it('returns the complete preview only after the stream ends', async () => {
    const { shell, stream, sftp } = createHarness(5)
    const result = shell.readFile('/srv/file.txt', 1_024)

    stream.end('hello')

    await expect(result).resolves.toEqual({
      content: 'hello',
      truncated: false,
      size: 5
    })
    expect(sftp.createReadStream).toHaveBeenCalledWith('/srv/file.txt', { start: 0, end: 4 })
  })

  it('rejects a premature close instead of returning partial preview content', async () => {
    const { shell, stream, sftp } = createHarness(10)
    const result = shell.readFile('/srv/file.txt', 1_024)
    await vi.waitFor(() => expect(sftp.createReadStream).toHaveBeenCalledTimes(1))
    stream.write('partial')
    stream.destroy()

    await expect(result).rejects.toMatchObject({ code: 'SFTP' })
  })

  it('rejects a stream that ends before the stat-reported size', async () => {
    const { shell, stream, sftp } = createHarness(10)
    const result = shell.readFile('/srv/file.txt', 1_024)
    await vi.waitFor(() => expect(sftp.createReadStream).toHaveBeenCalledTimes(1))
    stream.end('short')

    await expect(result).rejects.toThrow('expected 10 bytes but received 5')
  })

  it('marks a preview truncated when the remote file exceeds the byte limit', async () => {
    const { shell, stream } = createHarness(10)
    const result = shell.readFile('/srv/file.txt', 5)
    stream.end('hello')

    await expect(result).resolves.toEqual({
      content: 'hello',
      truncated: true,
      size: 10
    })
  })
})
