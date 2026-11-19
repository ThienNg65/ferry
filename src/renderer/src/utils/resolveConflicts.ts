export type ConflictChoice = 'overwrite' | 'skip' | 'newer' | 'rename'

export interface ConflictIntent {
  direction: 'upload' | 'download'
  localPath: string
  remotePath: string
  isDir: boolean
  targetName: string
  sourceModifiedAt: string | null
}

export interface ConflictTarget {
  name: string
  modifiedAt: string | null
}

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

function renameTarget<T extends ConflictIntent>(intent: T, newName: string): T {
  const swap = (p: string): string => p.slice(0, Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\')) + 1) + newName
  return intent.direction === 'upload'
    ? { ...intent, targetName: newName, remotePath: swap(intent.remotePath) }
    : { ...intent, targetName: newName, localPath: swap(intent.localPath) }
}

function isNewer(source: string | null, target: string | null): boolean {
  return source !== null && target !== null && Date.parse(source) > Date.parse(target)
}

export function resolveConflicts<T extends ConflictIntent>(intents: T[], targets: ConflictTarget[], choice: ConflictChoice): T[] {
  const caseInsensitive = intents.some((i) => i.direction === 'download' && i.localPath.includes('\\'))
  const keyOf = (name: string): string => (caseInsensitive ? name.toLowerCase() : name)
  const byName = new Map(targets.map((t) => [keyOf(t.name), t]))
  const taken = new Set([...byName.keys(), ...intents.map((i) => keyOf(i.targetName))])
  const result: T[] = []
  for (const intent of intents) {
    const target = byName.get(keyOf(intent.targetName))
    if (!target || choice === 'overwrite') {
      result.push(intent)
    } else if (choice === 'rename') {
      const name = uniqueName(intent.targetName, taken, intent.isDir, caseInsensitive)
      taken.add(keyOf(name))
      result.push(renameTarget(intent, name))
    } else if (choice === 'newer' && (intent.isDir || isNewer(intent.sourceModifiedAt, target.modifiedAt))) {
      result.push(intent)
    }
  }
  return result
}
