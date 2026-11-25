import type { FileEntry } from '@shared/contract'

export interface ResolvedOsDropEntries {
  entries: FileEntry[]
  stagedPaths: ReadonlySet<string>
}

export interface StagedDropMoveResult {
  cleanupError: unknown | null
}

/** Keeps direct OS paths separate from paths created by Ferry's staging flow. */
export function combineOsDropEntries(
  directEntries: readonly FileEntry[],
  stagedEntries: readonly FileEntry[]
): ResolvedOsDropEntries {
  return {
    entries: [...directEntries, ...stagedEntries],
    stagedPaths: new Set(stagedEntries.map((entry) => entry.path))
  }
}

/** Cleans a staged item only after its destination move succeeds. */
export async function moveAndCleanupStagedDrop(
  entryPath: string,
  stagedPaths: ReadonlySet<string>,
  move: () => Promise<void>,
  cleanup: (path: string) => Promise<void>
): Promise<StagedDropMoveResult> {
  await move()
  if (!stagedPaths.has(entryPath)) {
    return { cleanupError: null }
  }

  try {
    await cleanup(entryPath)
    return { cleanupError: null }
  } catch (error) {
    return { cleanupError: error }
  }
}
