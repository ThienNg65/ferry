import type { FileEntry } from '@shared/contract'

export interface SelectionResult {
  selected: Set<string>
  anchor: string | null
}

/** Plain click — selects exactly one entry and becomes the new range anchor. */
export function selectOnly(path: string): SelectionResult {
  return { selected: new Set([path]), anchor: path }
}

/** Ctrl/Cmd+click — adds or removes one entry from the existing selection. */
export function toggleSelect(selected: Set<string>, path: string): SelectionResult {
  const next = new Set(selected)
  if (next.has(path)) {
    next.delete(path)
  } else {
    next.add(path)
  }
  return { selected: next, anchor: path }
}

/** Shift+click — selects every entry between the current anchor and `path`, inclusive. */
export function selectRange(entries: FileEntry[], anchor: string | null, path: string): SelectionResult {
  const paths = entries.map((e) => e.path)
  const anchorPath = anchor ?? path
  const anchorIndex = paths.indexOf(anchorPath)
  const targetIndex = paths.indexOf(path)
  if (anchorIndex === -1 || targetIndex === -1) {
    return selectOnly(path)
  }
  const [lo, hi] = anchorIndex <= targetIndex ? [anchorIndex, targetIndex] : [targetIndex, anchorIndex]
  return { selected: new Set(paths.slice(lo, hi + 1)), anchor: anchorPath }
}

/** Ctrl/Cmd+A — selects every entry in the current listing. */
export function selectAll(entries: FileEntry[]): SelectionResult {
  return { selected: new Set(entries.map((e) => e.path)), anchor: null }
}
