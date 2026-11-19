import { writeFileSync } from 'fs'
import { mkdtemp, mkdir, rm, writeFile, readFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SessionManager } from '../ssh/SessionManager'
import type { RemoteShell } from '../ssh/RemoteShell'
import type { SyncOptions } from '../../shared/contract'
import { computeDiff, computePlan, previewSync, runSync, type TreeItem } from './SyncService'

function file(relPath: string, size: number, mtimeMs?: number): TreeItem {
  return { relPath, isDir: false, size, mtimeMs }
}

function dir(relPath: string): TreeItem {
  return { relPath, isDir: true, size: 0 }
}

describe('computePlan', () => {
  it('transfers a file missing from the destination', () => {
    const plan = computePlan([file('a.txt', 10, 1000)], [], false)
    expect(plan.toTransfer).toEqual([{ relPath: 'a.txt', size: 10 }])
    expect(plan.totalBytes).toBe(10)
  })

  it('does not transfer a file that is identical on both sides', () => {
    const plan = computePlan([file('a.txt', 10, 1000)], [file('a.txt', 10, 1000)], false)
    expect(plan.toTransfer).toEqual([])
  })

  it('transfers a file whose size differs, even with identical mtime', () => {
    const plan = computePlan([file('a.txt', 20, 1000)], [file('a.txt', 10, 1000)], false)
    expect(plan.toTransfer).toEqual([{ relPath: 'a.txt', size: 20 }])
  })

  it('transfers a file whose source mtime is newer than the destination beyond the tolerance window', () => {
    const plan = computePlan([file('a.txt', 10, 10_000)], [file('a.txt', 10, 1000)], false)
    expect(plan.toTransfer).toEqual([{ relPath: 'a.txt', size: 10 }])
  })

  it('does NOT transfer when the source is only marginally newer (within the 2s tolerance — SFTP whole-second mtime vs. local ms-precision)', () => {
    const plan = computePlan([file('a.txt', 10, 2500)], [file('a.txt', 10, 1000)], false)
    expect(plan.toTransfer).toEqual([])
  })

  it('never overwrites when the destination is newer than the source, regardless of tolerance', () => {
    const plan = computePlan([file('a.txt', 10, 1000)], [file('a.txt', 10, 999_999)], false)
    expect(plan.toTransfer).toEqual([])
  })

  it('ignores directory entries when diffing files', () => {
    const plan = computePlan([dir('sub'), file('sub/a.txt', 5, 1000)], [dir('sub')], false)
    expect(plan.toTransfer).toEqual([{ relPath: 'sub/a.txt', size: 5 }])
  })

  it('produces no deletions when deleteExtras is false, even if the destination has extras', () => {
    const plan = computePlan([file('a.txt', 10, 1000)], [file('a.txt', 10, 1000), file('extra.txt', 3, 1000)], false)
    expect(plan.toDelete).toEqual([])
  })

  it('identifies a destination-only top-level file as an extra when deleteExtras is true', () => {
    const plan = computePlan([file('a.txt', 10, 1000)], [file('a.txt', 10, 1000), file('extra.txt', 3, 1000)], true)
    expect(plan.toDelete).toEqual(['extra.txt'])
  })

  it('lists every deletion under a destination-only top-level directory', () => {
    const plan = computePlan(
      [file('a.txt', 10, 1000)],
      [file('a.txt', 10, 1000), dir('extra-dir'), file('extra-dir/nested.txt', 3, 1000)],
      true
    )
    expect(plan.toDelete).toEqual(['extra-dir', 'extra-dir/nested.txt'])
  })

  it('does not flag a destination entry as an extra if its top-level name exists anywhere in the source, even if the specific file differs', () => {
    const plan = computePlan(
      [dir('shared'), file('shared/only-in-source.txt', 1, 1000)],
      [dir('shared'), file('shared/only-in-dest.txt', 1, 1000)],
      true
    )
    expect(plan.toDelete).toEqual([])
  })
})

describe('computeDiff', () => {
  it('classifies every status and ignores directories', () => {
    const rows = computeDiff(
      [dir('d'), file('same.txt', 5, 1000), file('l.txt', 5, 1000), file('ln.txt', 5, 10_000), file('rn.txt', 5, 1000), file('sz.txt', 6, 1000)],
      [file('same.txt', 5, 1500), file('r.txt', 5, 1000), file('ln.txt', 5, 1000), file('rn.txt', 5, 10_000), file('sz.txt', 5, 1000)]
    )
    expect(Object.fromEntries(rows.map((r) => [r.relPath, r.status]))).toEqual({
      'same.txt': 'same',
      'l.txt': 'localOnly',
      'r.txt': 'remoteOnly',
      'ln.txt': 'localNewer',
      'rn.txt': 'remoteNewer',
      'sz.txt': 'sizeDiff'
    })
    expect(rows.map((r) => r.relPath)).toEqual([...rows.map((r) => r.relPath)].sort((a, b) => a.localeCompare(b)))
  })

  it('treats equal sizes with unknown mtimes as the same', () => {
    expect(computeDiff([file('a', 1)], [file('a', 1)])[0].status).toBe('same')
  })
})

describe('runSync approval and recovery', () => {
  let localPath: string
  let options: SyncOptions
  const remoteTree = vi.fn<() => Promise<TreeItem[]>>()

  beforeEach(async () => {
    localPath = await mkdtemp(join(tmpdir(), 'ferry-sync-'))
    options = { sessionId: 'connected-session', localPath, remotePath: '/remote', direction: 'pull', deleteExtras: true }
    remoteTree.mockResolvedValue([])
    vi.spyOn(SessionManager.getInstance(), 'shell').mockReturnValue({
      readdirRecursive: remoteTree
    } as unknown as RemoteShell)
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    await rm(localPath, { recursive: true, force: true })
  })

  it('requires new approval when a zero-deletion preview becomes destructive', async () => {
    const approved = await previewSync(options)
    await writeFile(join(localPath, 'new.txt'), 'keep')
    await expect(runSync(options, approved, {
      signal: new AbortController().signal,
      reportProgress: vi.fn()
    })).rejects.toThrow(/folders changed.*0 destination item/)
    expect(await readFile(join(localPath, 'new.txt'), 'utf8')).toBe('keep')
  })

  it('requires new approval when a child arrives under a reviewed top-level extra', async () => {
    await mkdir(join(localPath, 'extra'))
    await writeFile(join(localPath, 'extra', 'reviewed.txt'), 'reviewed')
    const approved = await previewSync(options)
    await writeFile(join(localPath, 'extra', 'new.txt'), 'unreviewed')
    await expect(runSync(options, approved, {
      signal: new AbortController().signal,
      reportProgress: vi.fn()
    })).rejects.toThrow('Preview again')
    expect(await readFile(join(localPath, 'extra', 'reviewed.txt'), 'utf8')).toBe('reviewed')
    expect(await readFile(join(localPath, 'extra', 'new.txt'), 'utf8')).toBe('unreviewed')
  })

  it('stops after cancellation and reports the number of confirmed deletions', async () => {
    await mkdir(join(localPath, 'extra'))
    await writeFile(join(localPath, 'extra', 'reviewed.txt'), 'reviewed')
    const approved = await previewSync(options)
    const controller = new AbortController()
    await expect(runSync(options, approved, {
      signal: controller.signal,
      reportProgress: () => controller.abort()
    })).rejects.toMatchObject({
      code: 'CANCELLED',
      message: expect.stringContaining(`Confirmed deletions\n${join(localPath, 'extra', 'reviewed.txt')}`)
    })
    expect((await previewSync(options)).toDelete).toEqual(['extra'])
  })

  it('leaves a newly arrived child alone after execution starts', async () => {
    await mkdir(join(localPath, 'extra'))
    await writeFile(join(localPath, 'extra', 'reviewed.txt'), 'reviewed')
    const approved = await previewSync(options)
    const laterFile = join(localPath, 'extra', 'new.txt')
    await expect(runSync(options, approved, {
      signal: new AbortController().signal,
      reportProgress: () => writeFileSync(laterFile, 'unreviewed')
    })).rejects.toThrow(/Could not confirm deletion.*1 destination item/)
    expect(await readFile(laterFile, 'utf8')).toBe('unreviewed')
  })
})
