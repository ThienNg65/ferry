import { describe, expect, it } from 'vitest'
import { MAX_STAGE_DROP_DEPTH, MAX_STAGE_DROP_ENTRIES } from '@shared/contract'
import { collectDroppedEntry, recordCollectedDropEntry, type CollectedDropEntry, type MinimalFsEntry } from './osDrop'

function fileEntry(name: string): MinimalFsEntry {
  const file = { size: 1, lastModified: 0 } as File
  return {
    isFile: true,
    isDirectory: false,
    name,
    file: (success) => success(file)
  }
}

function directoryEntry(name: string, children: MinimalFsEntry[], onRead?: () => void): MinimalFsEntry {
  return {
    isFile: false,
    isDirectory: true,
    name,
    createReader: () => {
      let returnedBatch = false
      return {
        readEntries: (success) => {
          onRead?.()
          if (returnedBatch) {
            success([])
            return
          }
          returnedBatch = true
          success(children)
        }
      }
    }
  }
}

function nestedDirectoryTree(depth: number): MinimalFsEntry {
  let entry = directoryEntry(`level-${depth}`, [])
  for (let current = depth - 1; current >= 1; current--) {
    entry = directoryEntry(`level-${current}`, [entry])
  }
  return entry
}

describe('OS drop entry collection limits', () => {
  it('collects exactly the shared entry limit', async () => {
    const children = Array.from({ length: MAX_STAGE_DROP_ENTRIES - 1 }, (_, index) => fileEntry(`file-${index}.txt`))
    const collected: CollectedDropEntry[] = []
    const state = { entryCount: 0, totalBytes: 0 }

    await collectDroppedEntry(directoryEntry('root', children), 'root', collected, state)

    expect(state.entryCount).toBe(MAX_STAGE_DROP_ENTRIES)
    expect(collected).toHaveLength(MAX_STAGE_DROP_ENTRIES)
    expect(state.totalBytes).toBe(MAX_STAGE_DROP_ENTRIES - 1)
  })

  it('stops reading the directory as soon as the next entry would exceed the limit', async () => {
    const children = Array.from({ length: MAX_STAGE_DROP_ENTRIES }, (_, index) => fileEntry(`file-${index}.txt`))
    const collected: CollectedDropEntry[] = []
    const state = { entryCount: 0, totalBytes: 0 }
    let readCalls = 0

    await expect(
      collectDroppedEntry(directoryEntry('root', children, () => readCalls++), 'root', collected, state)
    ).rejects.toThrow(new RegExp(`${MAX_STAGE_DROP_ENTRIES}-item staging limit`))

    expect(readCalls).toBe(1)
    expect(state.entryCount).toBe(MAX_STAGE_DROP_ENTRIES)
    expect(collected).toHaveLength(MAX_STAGE_DROP_ENTRIES)
  })

  it('accepts the maximum directory depth and rejects one level beyond it', async () => {
    const acceptedState = { entryCount: 0, totalBytes: 0 }
    const acceptedEntries: CollectedDropEntry[] = []
    await collectDroppedEntry(
      nestedDirectoryTree(MAX_STAGE_DROP_DEPTH),
      'level-1',
      acceptedEntries,
      acceptedState
    )
    expect(acceptedState.entryCount).toBe(MAX_STAGE_DROP_DEPTH)
    expect(acceptedEntries).toHaveLength(MAX_STAGE_DROP_DEPTH)

    const rejectedState = { entryCount: 0, totalBytes: 0 }
    const rejectedEntries: CollectedDropEntry[] = []
    await expect(
      collectDroppedEntry(
        nestedDirectoryTree(MAX_STAGE_DROP_DEPTH + 1),
        'level-1',
        rejectedEntries,
        rejectedState
      )
    ).rejects.toThrow(new RegExp(`${MAX_STAGE_DROP_DEPTH}-level staging limit`))
    expect(rejectedState.entryCount).toBe(MAX_STAGE_DROP_DEPTH)
    expect(rejectedEntries).toHaveLength(MAX_STAGE_DROP_DEPTH)
  })

  it('counts top-level files without WebKit entry metadata', () => {
    const state = { entryCount: 0, totalBytes: 0 }
    for (let index = 0; index < MAX_STAGE_DROP_ENTRIES; index++) {
      recordCollectedDropEntry(state, 0)
    }
    expect(() => recordCollectedDropEntry(state, 0)).toThrow(
      new RegExp(`${MAX_STAGE_DROP_ENTRIES}-item staging limit`)
    )
  })
})
