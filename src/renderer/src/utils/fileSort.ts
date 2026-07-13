import type { FileEntry } from '@shared/contract'

export type SortColumn = 'name' | 'size' | 'modified'
export type SortDirection = 'asc' | 'desc'

/** Directories always sort before files; within each group, entries compare by the active column/direction. */
export function compareEntries(column: SortColumn, direction: SortDirection): (a: FileEntry, b: FileEntry) => number {
  const sign = direction === 'asc' ? 1 : -1
  return (a, b) => {
    if (a.isDir !== b.isDir) {
      return a.isDir ? -1 : 1
    }
    switch (column) {
      case 'size':
        return sign * (a.size - b.size)
      case 'modified': {
        const aTime = a.modifiedAt ? new Date(a.modifiedAt).getTime() : 0
        const bTime = b.modifiedAt ? new Date(b.modifiedAt).getTime() : 0
        return sign * (aTime - bTime)
      }
      case 'name':
      default:
        return sign * a.name.localeCompare(b.name)
    }
  }
}
