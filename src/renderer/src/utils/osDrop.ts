import { MAX_STAGE_DROP_DEPTH, MAX_STAGE_DROP_ENTRIES } from '@shared/contract'

export interface MinimalFsEntry {
  isFile: boolean
  isDirectory: boolean
  name: string
  file?: (success: (file: File) => void, error?: (err: unknown) => void) => void
  createReader?: () => {
    readEntries: (success: (entries: MinimalFsEntry[]) => void, error?: (err: unknown) => void) => void
  }
}

export interface CollectedDropEntry {
  relativePath: string
  isDir: boolean
  file?: File
  modifiedAt?: string
}

export interface DropCollectionState {
  entryCount: number
  totalBytes: number
}

/** Counts one staged file or directory before reading more of the OS drop tree. */
export function recordCollectedDropEntry(state: DropCollectionState, directoryDepth: number): void {
  if (directoryDepth > MAX_STAGE_DROP_DEPTH) {
    throw new Error(
      `Dropped folder nesting exceeds the ${MAX_STAGE_DROP_DEPTH}-level staging limit. Use the Local pane for larger transfers.`
    )
  }
  if (state.entryCount >= MAX_STAGE_DROP_ENTRIES) {
    throw new Error(
      `Dropped selection exceeds the ${MAX_STAGE_DROP_ENTRIES}-item staging limit. Use the Local pane for larger transfers.`
    )
  }
  state.entryCount += 1
}

/** Collects a WebKit file-system entry while enforcing limits before descending or reading file data. */
export async function collectDroppedEntry(
  fsEntry: MinimalFsEntry,
  relativePath: string,
  out: CollectedDropEntry[],
  state: DropCollectionState,
  pathDepth = 1
): Promise<void> {
  const isFile = fsEntry.isFile && typeof fsEntry.file === 'function'
  const isDirectory = fsEntry.isDirectory && typeof fsEntry.createReader === 'function'
  if (!isFile && !isDirectory) {
    return
  }

  recordCollectedDropEntry(state, isDirectory ? pathDepth : pathDepth - 1)

  if (isFile) {
    const file = await new Promise<File>((resolve, reject) => {
      fsEntry.file!(resolve, reject)
    })
    state.totalBytes += file.size
    out.push({
      relativePath,
      isDir: false,
      file,
      modifiedAt: new Date(file.lastModified).toISOString()
    })
    return
  }

  out.push({ relativePath, isDir: true })
  const reader = fsEntry.createReader!()
  while (true) {
    const batch = await new Promise<MinimalFsEntry[]>((resolve, reject) => {
      reader.readEntries(resolve, reject)
    })
    if (batch.length === 0) {
      break
    }
    for (const child of batch) {
      await collectDroppedEntry(child, `${relativePath}/${child.name}`, out, state, pathDepth + 1)
    }
  }
}
