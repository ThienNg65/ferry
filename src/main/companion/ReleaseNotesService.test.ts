import { describe, expect, it, vi } from 'vitest'
import { ReleaseNotesService, normalizeReleaseVersion, summarizeReleaseBody } from './ReleaseNotesService'

describe('ReleaseNotesService', () => {
  it('normalizes ferry release tag names cleanly', () => {
    expect(normalizeReleaseVersion('ferry-v1.3.1')).toBe('1.3.1')
    expect(normalizeReleaseVersion('v1.4.0-beta.1')).toBe('1.4.0-beta.1')
  })

  it('extracts user-facing highlights and strips commit hashes and test sections', () => {
    const body = [
      '### Features',
      '* **companion:** add Ferry Companion dock assistant ([#78](https://github.com/ThienNg65/ferry/issues/78)) ([abcdef1](https://github.com/ThienNg65/ferry/commit/abcdef1))',
      '### Bug Fixes',
      '* restore Site Management on tab close ([1234567](https://github.com/ThienNg65/ferry/commit/1234567))',
      '### Tests',
      '* add flaky test coverage ([7654321](https://github.com/ThienNg65/ferry/commit/7654321))',
      '**Full Changelog**: https://github.com/ThienNg65/ferry-release/compare/v1.3.0...v1.3.1'
    ].join('\n')

    expect(summarizeReleaseBody(body)).toEqual([
      'companion: add Ferry Companion dock assistant',
      'restore Site Management on tab close'
    ])
  })

  it('rejects untrusted feed origins without calling fetch', async () => {
    const fetchImpl = vi.fn()
    const svc = new ReleaseNotesService({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      apiUrl: 'https://evil.example.com/releases'
    })
    const res = await svc.getReleases()
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(res.offlineFallback).toBe(true)
    expect(res.releases).toEqual([])
  })

  it('fetches, filters drafts/prereleases, and caches GitHub releases', async () => {
    let nowMs = 1_000_000
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => [
        {
          tag_name: 'ferry-v1.3.1',
          name: 'Ferry 1.3.1',
          body: '### Bug Fixes\n* fix tab close restore',
          html_url: 'https://github.com/ThienNg65/ferry-release/releases/tag/ferry-v1.3.1',
          published_at: '2026-11-21T00:00:00Z',
          draft: false,
          prerelease: false
        },
        {
          tag_name: 'ferry-v1.4.0-rc.1',
          name: 'RC',
          body: '- prerelease',
          draft: false,
          prerelease: true
        }
      ]
    })

    const svc = new ReleaseNotesService({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      now: () => nowMs,
      appVersion: () => '1.3.1'
    })

    const first = await svc.getReleases()
    expect(first.offlineFallback).toBe(false)
    expect(first.source).toBe('github')
    expect(first.releases).toHaveLength(1)
    expect(first.releases[0].version).toBe('1.3.1')
    expect(first.releases[0].highlights).toEqual(['fix tab close restore'])

    // Cached within 15 minutes
    nowMs += 60_000
    const second = await svc.getReleases()
    expect(second.releases).toHaveLength(1)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('falls back gracefully when offline and enforces redirect error + repo URL allowlist', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('ENOTFOUND'))
    const svc = new ReleaseNotesService({ fetchImpl: fetchImpl as unknown as typeof fetch })
    const res = await svc.getReleases()
    expect(res.offlineFallback).toBe(true)
    expect(res.source).toBe('bundled')
    expect(res.error).toContain('ENOTFOUND')
    expect(fetchImpl.mock.calls[0]?.[1]).toMatchObject({ redirect: 'error' })

    const evilUrlFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [
        {
          tag_name: 'v1.3.1',
          name: 'Ferry v1.3.1',
          body: '- item',
          html_url: 'https://github.com/evil/other-repo/releases/tag/v1.3.1',
          draft: false,
          prerelease: false
        }
      ]
    })
    const svc2 = new ReleaseNotesService({ fetchImpl: evilUrlFetch as unknown as typeof fetch })
    const res2 = await svc2.getReleases()
    expect(res2.releases[0].url).toBe('https://github.com/ThienNg65/ferry-release/releases')
  })
})
