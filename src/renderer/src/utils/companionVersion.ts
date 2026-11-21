import type { CompanionReleaseHighlight } from '@shared/contract'

export interface ParsedSemver {
  major: number
  minor: number
  patch: number
  prerelease: string
}

export function parseSemver(raw: string | null | undefined): ParsedSemver | null {
  if (!raw || typeof raw !== 'string') return null
  const match = raw.trim().match(/^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/)
  if (!match) return null
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ?? ''
  }
}

/**
 * Returns > 0 if `a > b`, < 0 if `a < b`, 0 if equal (or unparseable).
 * Stable release beats prerelease of the same major.minor.patch.
 */
export function compareSemver(a: string, b: string): number {
  const pa = parseSemver(a)
  const pb = parseSemver(b)
  if (!pa || !pb) return 0
  if (pa.major !== pb.major) return pa.major - pb.major
  if (pa.minor !== pb.minor) return pa.minor - pb.minor
  if (pa.patch !== pb.patch) return pa.patch - pb.patch
  if (pa.prerelease === pb.prerelease) return 0
  if (!pa.prerelease) return 1
  if (!pb.prerelease) return -1
  return pa.prerelease.localeCompare(pb.prerelease)
}

export type VersionTransition = 'first-run' | 'upgraded' | 'same' | 'downgraded' | 'invalid'

export interface VersionTransitionResult {
  kind: VersionTransition
  shouldAnnounceUpgrade: boolean
  previousVersion: string | null
}

/**
 * Evaluates whether the currently running installed app version represents
 * a genuine upgrade from the last seen version. Never fires on clean install,
 * same-version relaunch, rollback, or already-dismissed versions.
 */
export function evaluateVersionTransition(input: {
  currentVersion: string | null | undefined
  lastSeenVersion: string | null | undefined
  dismissedVersions: readonly string[]
}): VersionTransitionResult {
  const current = input.currentVersion?.trim() ?? ''
  if (!parseSemver(current) || current === '0.0.0') {
    return { kind: 'invalid', shouldAnnounceUpgrade: false, previousVersion: null }
  }

  const lastSeen = input.lastSeenVersion?.trim() ?? ''
  if (!lastSeen || !parseSemver(lastSeen) || lastSeen === '0.0.0') {
    return { kind: 'first-run', shouldAnnounceUpgrade: false, previousVersion: null }
  }

  const cmp = compareSemver(current, lastSeen)
  if (cmp === 0) {
    return { kind: 'same', shouldAnnounceUpgrade: false, previousVersion: lastSeen }
  }
  if (cmp < 0) {
    return { kind: 'downgraded', shouldAnnounceUpgrade: false, previousVersion: lastSeen }
  }

  const alreadyDismissed = input.dismissedVersions.includes(current)
  return {
    kind: 'upgraded',
    shouldAnnounceUpgrade: !alreadyDismissed,
    previousVersion: lastSeen
  }
}

/**
 * Returns published releases strictly newer than `fromVersion` and up to `toVersion`,
 * sorted newest-first. Used for "What changed since my last version?" answers.
 */
export function getReleasesSince(
  releases: readonly CompanionReleaseHighlight[],
  fromVersion: string | null,
  toVersion: string
): CompanionReleaseHighlight[] {
  const toParsed = parseSemver(toVersion)
  if (!toParsed) return []

  const fromParsed = parseSemver(fromVersion)
  const filtered = releases.filter((r) => {
    if (!parseSemver(r.version)) return false
    if (compareSemver(r.version, toVersion) > 0) return false
    if (fromParsed && compareSemver(r.version, fromVersion!) <= 0) return false
    return true
  })

  return [...filtered].sort((a, b) => compareSemver(b.version, a.version))
}
