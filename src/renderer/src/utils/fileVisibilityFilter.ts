import type { FileEntry } from '@shared/contract'

export interface FileVisibilityFilter {
  include: string[]
  exclude: string[]
}

export interface PatternSuggestion {
  pattern: string
  label: string
}

export interface PaneEntriesResult {
  entries: FileEntry[]
  totalFiles: number
  visibleFiles: number
  visibilityActive: boolean
  searchActive: boolean
}

export function emptyVisibilityFilter(): FileVisibilityFilter {
  return { include: [], exclude: [] }
}

/** Splits multi-line text into trimmed, non-empty, order-preserving unique glob patterns. */
export function parsePatternLines(raw: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || seen.has(trimmed)) continue
    seen.add(trimmed)
    out.push(trimmed)
  }
  return out
}

export function formatPatternLines(patterns: string[]): string {
  return patterns.join('\n')
}

export function appendUniquePattern(patterns: string[], pattern: string): string[] {
  const trimmed = pattern.trim()
  if (!trimmed || patterns.includes(trimmed)) {
    return [...patterns]
  }
  return [...patterns, trimmed]
}

export function hasActiveVisibilityFilter(filter?: FileVisibilityFilter | null): boolean {
  return Boolean(filter && (filter.include.length > 0 || filter.exclude.length > 0))
}

/** Compiles a case-sensitive filename glob (`*` = any chars, `?` = one char) into an anchored RegExp. */
export function compileGlob(pattern: string): RegExp {
  let regexBody = ''
  for (const ch of pattern) {
    if (ch === '*') {
      regexBody += '.*'
    } else if (ch === '?') {
      regexBody += '.'
    } else if ('\\^$.|+()[]{}'.includes(ch)) {
      regexBody += `\\${ch}`
    } else {
      regexBody += ch
    }
  }
  return new RegExp(`^${regexBody}$`)
}

/**
 * Returns a predicate for `FileEntry` visibility:
 * - Directories (`isDir`) are always visible.
 * - `include` patterns are OR'ed; `exclude` patterns are OR'ed; excludes win.
 */
export function createVisibilityMatcher(filter?: FileVisibilityFilter | null): (entry: FileEntry) => boolean {
  const includeRegexes = (filter?.include ?? []).filter(Boolean).map(compileGlob)
  const excludeRegexes = (filter?.exclude ?? []).filter(Boolean).map(compileGlob)
  if (includeRegexes.length === 0 && excludeRegexes.length === 0) {
    return () => true
  }
  return (entry: FileEntry): boolean => {
    if (entry.isDir) return true
    if (includeRegexes.length > 0 && !includeRegexes.some((re) => re.test(entry.name))) {
      return false
    }
    if (excludeRegexes.some((re) => re.test(entry.name))) {
      return false
    }
    return true
  }
}

const COMPOUND_EXT_RE = /(\.(?:tar\.(?:gz|bz2|xz|zst)|log\.gz))$/

/**
 * Suggests up to 3 glob patterns from an example filename (or path) so users
 * unfamiliar with `*` / `?` syntax can filter rotated logs, backups, or extensions.
 */
export function suggestPatternsFromFilename(input: string): PatternSuggestion[] {
  const trimmed = input.trim()
  if (!trimmed) return []

  const segments = trimmed.split(/[/\\]+/).filter(Boolean)
  const name = segments[segments.length - 1] ?? ''
  if (!name) return []

  const suggestions: PatternSuggestion[] = []
  const seen = new Set<string>()
  const add = (pattern: string, label: string): void => {
    if (!pattern || seen.has(pattern) || suggestions.length >= 3) return
    seen.add(pattern)
    suggestions.push({ pattern, label })
  }

  // 1. Hyphenated dates like YYYY-MM-DD (e.g. service.log.2026-06-17)
  const hyphenDateMatch = /\d{4}-\d{2}-\d{2}/.exec(name)
  if (hyphenDateMatch) {
    const maskedExact = name.replace(/\d{4}-\d{2}-\d{2}/g, '????-??-??')
    const extBeforeDate = name.slice(0, hyphenDateMatch.index).match(/(\.[A-Za-z0-9_-]+\.)$/)
    if (extBeforeDate) {
      add(`*${extBeforeDate[1]}????-??-??${name.slice(hyphenDateMatch.index + 10)}`, 'Any file with this dated rotation')
    }
    add(maskedExact, 'This filename with any date')
  }

  // 2. Trailing numeric rotation suffix (e.g. access.log.1, app.log.12)
  const numericSuffix = /^(.+\.[A-Za-z0-9_-]+)\.\d+$/.exec(name)
  if (numericSuffix) {
    const stem = numericSuffix[1]
    const dotIdx = stem.lastIndexOf('.')
    if (dotIdx > 0) {
      add(`*${stem.slice(dotIdx)}.*`, 'Any numbered rotation')
    }
    add(`${stem}.*`, 'This filename rotation')
  }

  // 3. Compact 8-digit date or timestamp (e.g. backup_20260617.tar.gz)
  const compactDateMatch = /\d{8,14}/.exec(name)
  if (compactDateMatch && !hyphenDateMatch) {
    const replacement = compactDateMatch[0].length === 8 ? '????????' : '*'
    add(name.replace(/\d{8,14}/, replacement), 'Any timestamped match')
  }

  // 4. Compound or simple extension (e.g. *.tar.gz, *.log)
  const compound = COMPOUND_EXT_RE.exec(name)
  if (compound) {
    add(`*${compound[1]}`, `All ${compound[1]} files`)
  } else {
    const lastDot = name.lastIndexOf('.')
    if (lastDot > 0 && lastDot < name.length - 1) {
      const ext = name.slice(lastDot)
      add(`*${ext}`, `All ${ext} files`)
    }
  }

  // 5. Exact basename fallback (useful for dotfiles / extensionless files like Makefile)
  add(name, 'Exact filename')

  return suggestions
}

/**
 * Applies `showHidden`, optional `visibilityFilter`, and `searchQuery` independently
 * while computing file-only visible/total counts against the hidden-files baseline.
 */
export function composePaneEntries(
  entries: FileEntry[],
  options: {
    showHidden: boolean
    visibilityFilter?: FileVisibilityFilter | null
    searchQuery?: string
  }
): PaneEntriesResult {
  const baseline = options.showHidden ? entries : entries.filter((e) => !e.name.startsWith('.'))
  const totalFiles = baseline.reduce((count, e) => count + (e.isDir ? 0 : 1), 0)

  const visibilityActive = hasActiveVisibilityFilter(options.visibilityFilter)
  const needle = (options.searchQuery ?? '').trim().toLowerCase()
  const searchActive = needle.length > 0
  const matcher = visibilityActive ? createVisibilityMatcher(options.visibilityFilter) : null

  const filtered =
    !matcher && !searchActive
      ? baseline
      : baseline.filter((entry) => {
          if (matcher && !matcher(entry)) return false
          if (searchActive && !entry.name.toLowerCase().includes(needle)) return false
          return true
        })

  const visibleFiles = filtered.reduce((count, e) => count + (e.isDir ? 0 : 1), 0)
  return {
    entries: filtered,
    totalFiles,
    visibleFiles,
    visibilityActive,
    searchActive
  }
}
