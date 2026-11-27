/**
 * Generates a collision-free name (`stem (1).ext`, `stem (2).ext`, ...) given a
 * `taken` set (lowercased keys when `caseInsensitive` is true). Does not mutate `taken`.
 */
export function uniqueName(name: string, taken: Set<string>, isDir: boolean, caseInsensitive = false): string {
  const dot = name.lastIndexOf('.')
  const stem = !isDir && dot > 0 ? name.slice(0, dot) : name
  const ext = !isDir && dot > 0 ? name.slice(dot) : ''
  const hasName = (candidate: string): boolean => taken.has(caseInsensitive ? candidate.toLowerCase() : candidate)
  let i = 1
  let candidate = `${stem} (${i})${ext}`
  while (hasName(candidate)) {
    i += 1
    candidate = `${stem} (${i})${ext}`
  }
  return candidate
}

/**
 * Picks a collision-free filename in `taken` and reserves it in-place.
 * Returns `baseName` unchanged when unused, or `uniqueName(...)` on collision.
 */
export function pickUniqueName(
  baseName: string,
  isDir: boolean,
  taken: Set<string>,
  caseInsensitive = false
): string {
  const keyOf = (name: string): string => (caseInsensitive ? name.toLowerCase() : name)
  const chosen = taken.has(keyOf(baseName))
    ? uniqueName(baseName, taken, isDir, caseInsensitive)
    : baseName
  taken.add(keyOf(chosen))
  return chosen
}
