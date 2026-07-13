/**
 * Archive-extension recognition shared by the renderer (gating the "Extract
 * here" button, computing the extraction target folder name) and the main
 * process (choosing the right extraction command). Deliberately excludes
 * .7z/.rar — those tools aren't reliably present on remote Linux hosts and
 * would need their own error-handling design.
 */

export type ArchiveKind = 'zip' | 'tar' | 'targz' | 'tarbz2'

// Longer/compound suffixes must precede shorter ones they'd otherwise be
// mistaken for (e.g. `.tar.gz` before bare `.tar`) — order matters.
const ARCHIVE_SUFFIXES: { suffix: string; kind: ArchiveKind }[] = [
  { suffix: '.tar.gz', kind: 'targz' },
  { suffix: '.tgz', kind: 'targz' },
  { suffix: '.tar.bz2', kind: 'tarbz2' },
  { suffix: '.tbz2', kind: 'tarbz2' },
  { suffix: '.tar', kind: 'tar' },
  { suffix: '.zip', kind: 'zip' },
  // .jar/.war/.ear are Java's standard zip-format archive extensions —
  // `unzip -qo` extracts them identically to a plain .zip.
  { suffix: '.jar', kind: 'zip' },
  { suffix: '.war', kind: 'zip' },
  { suffix: '.ear', kind: 'zip' }
]

function matchSuffix(name: string): { suffix: string; kind: ArchiveKind } | undefined {
  const lower = name.toLowerCase()
  return ARCHIVE_SUFFIXES.find((s) => lower.endsWith(s.suffix))
}

export function archiveKind(name: string): ArchiveKind | null {
  return matchSuffix(name)?.kind ?? null
}

export function isArchive(name: string): boolean {
  return archiveKind(name) !== null
}

/** Strips the recognized archive suffix, e.g. `report.tar.gz` -> `report` — used to name the extraction target folder. */
export function archiveBaseName(name: string): string {
  const match = matchSuffix(name)
  return match ? name.slice(0, name.length - match.suffix.length) : name
}
