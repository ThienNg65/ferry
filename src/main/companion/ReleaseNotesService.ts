import { cleanReleaseMarkdownBullet, IGNORED_RELEASE_SECTIONS } from '../../shared/companionMarkdown'
import type { CompanionReleaseHighlight, CompanionReleasesResult } from '../../shared/contract'
import { host } from '../host/host'
import { readJsonWithLimit } from './httpJson'

export const OFFICIAL_RELEASES_API_URL = 'https://api.github.com/repos/ThienNg65/ferry-release/releases?per_page=15'
export const OFFICIAL_RELEASES_WEB_URL = 'https://github.com/ThienNg65/ferry-release/releases'
const ALLOWED_API_ORIGIN = 'https://api.github.com'
const FETCH_TIMEOUT_MS = 6_000
const CACHE_TTL_MS = 15 * 60 * 1000
const MAX_HIGHLIGHTS_PER_RELEASE = 6
const MAX_RELEASE_FEED_BYTES = 1024 * 1024

interface GitHubReleasePayload {
  tag_name?: unknown
  name?: unknown
  body?: unknown
  html_url?: unknown
  published_at?: unknown
  draft?: unknown
  prerelease?: unknown
}

/**
 * Extracts concise, user-facing highlight bullets from a GitHub release body
 * without inventing features or leaking noisy commit hashes / test-only sections.
 */
export function summarizeReleaseBody(body: string, maxItems = MAX_HIGHLIGHTS_PER_RELEASE): string[] {
  const highlights: string[] = []
  let currentSection = ''

  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line) continue

    const headingMatch = line.match(/^#{2,4}\s+(.+)$/)
    if (headingMatch) {
      currentSection = headingMatch[1].trim().toLowerCase()
      continue
    }

    if (IGNORED_RELEASE_SECTIONS.has(currentSection)) {
      continue
    }

    if (/^\*\*full changelog\*\*/i.test(line) || /^full changelog:/i.test(line)) {
      continue
    }

    const bulletMatch = line.match(/^[-*]\s+(.+)$/)
    if (!bulletMatch) continue

    const cleaned = cleanReleaseMarkdownBullet(bulletMatch[1])
    if (!cleaned || cleaned.length < 4) continue
    if (!highlights.includes(cleaned)) {
      highlights.push(cleaned)
    }
    if (highlights.length >= maxItems) break
  }

  return highlights
}

export function normalizeReleaseVersion(tagOrName: string): string {
  const trimmed = tagOrName.trim()
  const match = trimmed.match(/(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)/)
  return match ? match[1] : trimmed.replace(/^ferry-v|^v/i, '')
}

function isTrustedReleaseUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return (
      parsed.protocol === 'https:' &&
      parsed.hostname === 'github.com' &&
      parsed.pathname.startsWith('/ThienNg65/ferry-release/')
    )
  } catch {
    return false
  }
}

export interface ReleaseNotesServiceDeps {
  fetchImpl?: typeof fetch
  now?: () => number
  apiUrl?: string
  appVersion?: () => string
}

export class ReleaseNotesService {
  private static instance: ReleaseNotesService | null = null
  private cached: { result: CompanionReleasesResult; expiresAt: number } | null = null
  private readonly fetchImpl: typeof fetch
  private readonly now: () => number
  private readonly apiUrl: string
  private readonly appVersion: () => string

  constructor(deps: ReleaseNotesServiceDeps = {}) {
    this.fetchImpl = deps.fetchImpl ?? fetch
    this.now = deps.now ?? Date.now
    this.apiUrl = deps.apiUrl ?? OFFICIAL_RELEASES_API_URL
    this.appVersion =
      deps.appVersion ??
      (() => {
        try {
          return host().appVersion || '0.0.0'
        } catch {
          return '0.0.0'
        }
      })
  }

  static getInstance(): ReleaseNotesService {
    if (!ReleaseNotesService.instance) {
      ReleaseNotesService.instance = new ReleaseNotesService()
    }
    return ReleaseNotesService.instance
  }

  clearCache(): void {
    this.cached = null
  }

  async getReleases(forceRefresh = false): Promise<CompanionReleasesResult> {
    const currentNow = this.now()
    if (!forceRefresh && this.cached && currentNow < this.cached.expiresAt) {
      return this.cached.result
    }

    let parsedUrl: URL
    try {
      parsedUrl = new URL(this.apiUrl)
    } catch {
      return {
        releases: [],
        source: 'bundled',
        fetchedAt: null,
        offlineFallback: true,
        error: 'Invalid release feed URL'
      }
    }

    if (parsedUrl.origin !== ALLOWED_API_ORIGIN) {
      return {
        releases: [],
        source: 'bundled',
        fetchedAt: null,
        offlineFallback: true,
        error: 'Untrusted release feed origin'
      }
    }

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)

    try {
      const res = await this.fetchImpl(parsedUrl.toString(), {
        method: 'GET',
        redirect: 'error',
        signal: controller.signal,
        headers: {
          Accept: 'application/vnd.github+json',
          'User-Agent': `Ferry/${this.appVersion()}`
        }
      })

      if (!res.ok) {
        await res.body?.cancel?.().catch(() => {})
        return {
          releases: [],
          source: 'bundled',
          fetchedAt: null,
          offlineFallback: true,
          error: `GitHub releases request returned ${res.status}`
        }
      }

      const raw = await readJsonWithLimit(res, MAX_RELEASE_FEED_BYTES, 'Release feed exceeded size limit')
      if (!Array.isArray(raw)) {
        return {
          releases: [],
          source: 'bundled',
          fetchedAt: null,
          offlineFallback: true,
          error: 'Unexpected release payload format'
        }
      }

      const releases: CompanionReleaseHighlight[] = []
      for (const item of raw as GitHubReleasePayload[]) {
        if (!item || typeof item !== 'object' || item.draft === true || item.prerelease === true) {
          continue
        }
        const tag = typeof item.tag_name === 'string' ? item.tag_name : ''
        const version = normalizeReleaseVersion(tag || (typeof item.name === 'string' ? item.name : ''))
        if (!version) continue
        const title =
          typeof item.name === 'string' && item.name.trim().length > 0 ? item.name.trim() : `Ferry v${version}`
        const body = typeof item.body === 'string' ? item.body : ''
        const htmlUrl =
          typeof item.html_url === 'string' && isTrustedReleaseUrl(item.html_url)
            ? item.html_url
            : OFFICIAL_RELEASES_WEB_URL
        const publishedAt = typeof item.published_at === 'string' ? item.published_at : null

        releases.push({
          version,
          publishedAt,
          title,
          highlights: summarizeReleaseBody(body),
          url: htmlUrl,
          source: 'github'
        })
      }

      const result: CompanionReleasesResult = {
        releases,
        source: 'github',
        fetchedAt: new Date(currentNow).toISOString(),
        offlineFallback: false
      }
      this.cached = { result, expiresAt: currentNow + CACHE_TTL_MS }
      return result
    } catch (err) {
      return {
        releases: [],
        source: 'bundled',
        fetchedAt: null,
        offlineFallback: true,
        error: err instanceof Error ? err.message : 'Unable to reach GitHub releases'
      }
    } finally {
      clearTimeout(timer)
    }
  }
}
