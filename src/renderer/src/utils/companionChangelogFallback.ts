import type { CompanionReleaseHighlight } from '@shared/contract'
import changelogRaw from '../../../../CHANGELOG.md?raw'

export const OFFICIAL_RELEASES_URL = 'https://github.com/ThienNg65/ferry-release/releases'
const IGNORED_SECTIONS = new Set(['tests', 'test', 'build system', 'ci', 'chores', 'chore'])

function cleanBullet(raw: string): string {
  return raw
    .replace(/\s*\(\[[0-9a-f]{7,40}\]\([^)]+\)\)/gi, '')
    .replace(/\s*\(\[#\d+\]\([^)]+\)\)/g, '')
    .replace(/,\s*closes\s+\[#\d+\]\([^)]+\)/gi, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/^\*+|\*+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Parses Keep-a-Changelog / release-please markdown into structured highlights
 * for 100% offline fallback when GitHub releases cannot be reached.
 */
export function parseChangelogReleases(markdown: string, maxReleases = 10): CompanionReleaseHighlight[] {
  const releases: CompanionReleaseHighlight[] = []
  let current: CompanionReleaseHighlight | null = null
  let currentSection = ''

  for (const rawLine of markdown.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line) continue

    const versionMatch = line.match(/^##\s+\[?v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\]?(?:\([^)]+\))?\s*(?:\((\d{4}-\d{2}-\d{2})\))?/)
    if (versionMatch) {
      if (current) {
        releases.push(current)
        if (releases.length >= maxReleases) return releases
      }
      const version = versionMatch[1]
      const date = versionMatch[2] ?? null
      current = {
        version,
        publishedAt: date,
        title: `Ferry v${version}`,
        highlights: [],
        url: `${OFFICIAL_RELEASES_URL}/tag/ferry-v${version}`,
        source: 'bundled'
      }
      currentSection = ''
      continue
    }

    if (/^##\s+Unreleased/i.test(line)) {
      current = null
      currentSection = ''
      continue
    }

    if (!current) continue

    const sectionMatch = line.match(/^###\s+(.+)$/)
    if (sectionMatch) {
      currentSection = sectionMatch[1].trim().toLowerCase()
      continue
    }

    if (IGNORED_SECTIONS.has(currentSection)) continue

    const bulletMatch = line.match(/^[-*]\s+(.+)$/)
    if (!bulletMatch || current.highlights.length >= 6) continue

    const cleaned = cleanBullet(bulletMatch[1])
    if (cleaned.length >= 4 && !current.highlights.includes(cleaned)) {
      current.highlights.push(cleaned)
    }
  }

  if (current && releases.length < maxReleases) {
    releases.push(current)
  }

  return releases
}

let cachedBundled: CompanionReleaseHighlight[] | null = null

export function getBundledChangelogReleases(): CompanionReleaseHighlight[] {
  if (!cachedBundled) {
    cachedBundled = parseChangelogReleases(changelogRaw)
  }
  return cachedBundled
}
