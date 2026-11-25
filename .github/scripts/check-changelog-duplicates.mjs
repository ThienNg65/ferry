import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Extracts release sections (`## [version]...`) from a Keep a Changelog / Release Please file.
 */
export function parseReleaseSections(markdown) {
  const lines = markdown.split(/\r?\n/)
  const sections = []
  let current = null

  for (const line of lines) {
    const headingMatch = line.match(/^##\s+\[([^\]]+)\]/)
    if (headingMatch) {
      if (current) sections.push(current)
      current = { version: headingMatch[1], lines: [] }
      continue
    }
    if (/^##\s+/.test(line)) {
      if (current) {
        sections.push(current)
        current = null
      }
      continue
    }
    if (current) current.lines.push(line)
  }
  if (current) sections.push(current)
  return sections
}

/**
 * Normalizes a Release Please bullet line for duplicate detection:
 * strips leading bullet/scope, trailing PR/commit links, and punctuation.
 */
export function normalizeEntrySubject(line) {
  let text = line.replace(/^\s*[-*]\s+/, '').trim()
  text = text.replace(/^\*\*[^*]+:\*\*\s*/, '')
  text = text.replace(/\s*\(\[#\d+\]\([^)]+\)\)/g, '')
  text = text.replace(/\s*\(\[[0-9a-f]{7,40}\]\([^)]+\)\)\s*$/i, '')
  return text.toLowerCase().replace(/[^a-z0-9\s]+/g, ' ').replace(/\s+/g, ' ').trim()
}

export function extractPrNumbers(line) {
  const matches = [...line.matchAll(/\[#(\d+)\]\([^)]+\)/g)]
  return matches.map(m => m[1])
}

/**
 * Detects duplicate changelog entries within each release section (or only the latest section).
 */
export function findDuplicateChangelogEntries(markdown, { latestOnly = true } = {}) {
  const sections = parseReleaseSections(markdown)
  const targetSections = latestOnly ? sections.slice(0, 1) : sections
  const duplicates = []

  for (const section of targetSections) {
    const seenSubjects = new Map()
    const seenPrs = new Map()

    for (const rawLine of section.lines) {
      if (!/^\s*[-*]\s+/.test(rawLine)) continue
      const normalized = normalizeEntrySubject(rawLine)
      if (!normalized) continue

      if (seenSubjects.has(normalized)) {
        duplicates.push({
          version: section.version,
          reason: 'duplicate-subject',
          first: seenSubjects.get(normalized),
          duplicate: rawLine.trim()
        })
        continue
      }
      seenSubjects.set(normalized, rawLine.trim())

      for (const pr of extractPrNumbers(rawLine)) {
        if (seenPrs.has(pr)) {
          duplicates.push({
            version: section.version,
            reason: `duplicate-pr-#${pr}`,
            first: seenPrs.get(pr),
            duplicate: rawLine.trim()
          })
          break
        }
        seenPrs.set(pr, rawLine.trim())
      }
    }
  }

  return duplicates
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))
if (isMain) {
  const latestOnly = !process.argv.includes('--all')
  const changelogPath = resolve(process.cwd(), 'CHANGELOG.md')
  const content = readFileSync(changelogPath, 'utf8')
  const duplicates = findDuplicateChangelogEntries(content, { latestOnly })

  if (duplicates.length > 0) {
    console.error(`Found ${duplicates.length} duplicate changelog entry(ies):`)
    for (const dup of duplicates) {
      console.error(`- [${dup.version}] (${dup.reason}): ${dup.duplicate}`)
    }
    process.exit(1)
  }

  console.log(`Changelog duplicate check passed (${latestOnly ? 'latest release section' : 'all release sections'}).`)
}
