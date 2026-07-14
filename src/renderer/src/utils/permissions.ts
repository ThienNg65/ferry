/** rwx bits for one of owner/group/other, parsed from a single octal digit (0-7). */
export interface Triplet {
  read: boolean
  write: boolean
  execute: boolean
}

/** The three owner/group/other triplets that make up a mode — the shape the chmod dialog edits directly. */
export interface ModeTriplets {
  owner: Triplet
  group: Triplet
  other: Triplet
}

function parseTriplet(digit: number): Triplet {
  return {
    read: (digit & 0b100) !== 0,
    write: (digit & 0b010) !== 0,
    execute: (digit & 0b001) !== 0
  }
}

function tripletToDigit(t: Triplet): number {
  return (t.read ? 0b100 : 0) | (t.write ? 0b010 : 0) | (t.execute ? 0b001 : 0)
}

function tripletToRwx(t: Triplet): string {
  return `${t.read ? 'r' : '-'}${t.write ? 'w' : '-'}${t.execute ? 'x' : '-'}`
}

/** Parses the last 3 digits of an octal mode string into editable owner/group/other triplets. */
export function parseMode(octal: string): ModeTriplets {
  const digits = octal.slice(-3).padStart(3, '0')
  return {
    owner: parseTriplet(Number(digits[0])),
    group: parseTriplet(Number(digits[1])),
    other: parseTriplet(Number(digits[2]))
  }
}

/** Inverse of {@link parseMode} — formats triplets back into a 3-digit octal string (e.g. "755") for chmod. */
export function formatMode(triplets: ModeTriplets): string {
  return [triplets.owner, triplets.group, triplets.other].map(tripletToDigit).join('')
}

/**
 * Formats the last 3 digits of a 4-digit octal mode string (e.g. "0755") as
 * the classic Unix `rwxr-xr-x` 9-character notation covering owner/group/other.
 * The leading (setuid/setgid/sticky) digit is not surfaced — a known v1 simplification.
 */
export function toTechnical(octal: string): string {
  const digits = octal.slice(-3)
  return digits
    .split('')
    .map((d) => tripletToRwx(parseTriplet(Number(d))))
    .join('')
}

/**
 * A single, compact human phrase summarizing the OWNER's access — explicitly
 * scoped to the owner (not the connected SSH user's own effective access,
 * which can differ on a shared server) so it can't be read as a personalized
 * permission claim. The full technical string is meant to be shown alongside
 * (e.g. in a tooltip) for anyone who needs the group/other bits too.
 */
export function toFriendlyLabel(octal: string): string {
  const ownerDigit = Number(octal.slice(-3, -2))
  const owner = parseTriplet(ownerDigit)
  const parts: string[] = []
  if (owner.read) parts.push('Read')
  if (owner.write) parts.push('Write')
  if (owner.execute) parts.push('Execute')
  if (parts.length === 0) {
    return 'No access'
  }
  if (parts.length === 1) {
    return `${parts[0]} only`
  }
  return parts.slice(0, -1).join(', ') + ' & ' + parts[parts.length - 1]
}
