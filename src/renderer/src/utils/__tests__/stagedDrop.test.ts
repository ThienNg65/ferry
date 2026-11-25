import { describe, expect, it, vi } from 'vitest'
import type { FileEntry } from '@shared/contract'
import { combineOsDropEntries, moveAndCleanupStagedDrop } from '../stagedDrop'

function entry(name: string, path: string): FileEntry {
  return { name, path, isDir: false, isSymlink: false, size: 1, modifiedAt: null }
}

describe('stagedDrop', () => {
  it('tracks only entries returned by Ferry staging', () => {
    const direct = entry('keep.txt', 'C:\\Temp\\ferry-drop-user-data\\keep.txt')
    const staged = entry('staged.txt', 'C:\\Temp\\ferry-drop-abc123\\staged.txt')

    const resolved = combineOsDropEntries([direct], [staged])

    expect(resolved.entries).toEqual([direct, staged])
    expect(resolved.stagedPaths.has(direct.path)).toBe(false)
    expect(resolved.stagedPaths.has(staged.path)).toBe(true)
  })

  it('cleans a staged item after its move succeeds', async () => {
    const stagedPath = '/tmp/ferry-drop-abc123/report.txt'
    const steps: string[] = []

    const result = await moveAndCleanupStagedDrop(
      stagedPath,
      new Set([stagedPath]),
      async () => { steps.push('move') },
      async (path) => { steps.push(`cleanup:${path}`) }
    )

    expect(steps).toEqual(['move', `cleanup:${stagedPath}`])
    expect(result).toEqual({ cleanupError: null })
  })

  it('does not clean a direct OS path even when its parent resembles a staging root', async () => {
    const directPath = 'C:\\Temp\\ferry-drop-user-data\\keep.txt'
    const move = vi.fn<() => Promise<void>>().mockResolvedValue(undefined)
    const cleanup = vi.fn<(path: string) => Promise<void>>().mockResolvedValue(undefined)

    await moveAndCleanupStagedDrop(directPath, new Set(), move, cleanup)

    expect(move).toHaveBeenCalledOnce()
    expect(cleanup).not.toHaveBeenCalled()
  })

  it('does not clean an item whose destination move fails', async () => {
    const stagedPath = '/tmp/ferry-drop-abc123/report.txt'
    const cleanup = vi.fn<(path: string) => Promise<void>>().mockResolvedValue(undefined)

    await expect(
      moveAndCleanupStagedDrop(
        stagedPath,
        new Set([stagedPath]),
        async () => { throw new Error('destination move failed') },
        cleanup
      )
    ).rejects.toThrow('destination move failed')

    expect(cleanup).not.toHaveBeenCalled()
  })

  it('preserves later staged items when a multi-item move fails partway through', async () => {
    const paths = [
      '/tmp/ferry-drop-abc123/first.txt',
      '/tmp/ferry-drop-abc123/second.txt',
      '/tmp/ferry-drop-abc123/third.txt'
    ]
    const moved: string[] = []
    const cleaned: string[] = []

    await expect((async () => {
      for (const [index, path] of paths.entries()) {
        await moveAndCleanupStagedDrop(
          path,
          new Set(paths),
          async () => {
            if (index === 1) throw new Error('destination denied')
            moved.push(path)
          },
          async (stagedPath) => { cleaned.push(stagedPath) }
        )
      }
    })()).rejects.toThrow('destination denied')

    expect(moved).toEqual([paths[0]])
    expect(cleaned).toEqual([paths[0]])
  })

  it('reports cleanup failure without undoing a successful move', async () => {
    const stagedPath = '/tmp/ferry-drop-abc123/report.txt'
    const failure = new Error('cleanup unavailable')
    const move = vi.fn<() => Promise<void>>().mockResolvedValue(undefined)
    const cleanup = vi.fn<(path: string) => Promise<void>>().mockRejectedValue(failure)

    const result = await moveAndCleanupStagedDrop(stagedPath, new Set([stagedPath]), move, cleanup)

    expect(move).toHaveBeenCalledOnce()
    expect(cleanup).toHaveBeenCalledWith(stagedPath)
    expect(result.cleanupError).toBe(failure)
  })
})
