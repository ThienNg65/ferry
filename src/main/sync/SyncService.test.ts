import { describe, expect, it } from 'vitest'
import { computePlan, type TreeItem } from './SyncService'

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

  it('identifies a destination-only top-level directory as a single extra, without listing its descendants separately', () => {
    const plan = computePlan(
      [file('a.txt', 10, 1000)],
      [file('a.txt', 10, 1000), dir('extra-dir'), file('extra-dir/nested.txt', 3, 1000)],
      true
    )
    expect(plan.toDelete).toEqual(['extra-dir'])
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
