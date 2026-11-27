import { describe, expect, it } from 'vitest'
import type { CompanionReleaseHighlight } from '@shared/contract'
import { compareSemver, evaluateVersionTransition, getReleasesSince } from './companionVersion'

describe('companionVersion', () => {
  it('compares semver strings including prereleases', () => {
    expect(compareSemver('1.3.1', '1.3.0')).toBeGreaterThan(0)
    expect(compareSemver('1.3.0', '1.3.0')).toBe(0)
    expect(compareSemver('1.2.9', '1.3.0')).toBeLessThan(0)
    expect(compareSemver('1.3.0', '1.3.0-beta.1')).toBeGreaterThan(0)
    // SemVer 11.4: numeric identifiers compare numerically, numeric < alphanumeric, shorter set < longer
    expect(compareSemver('1.3.0-beta.10', '1.3.0-beta.2')).toBeGreaterThan(0)
    expect(compareSemver('1.3.0-alpha.1', '1.3.0-alpha.beta')).toBeLessThan(0)
    expect(compareSemver('1.3.0-alpha', '1.3.0-alpha.1')).toBeLessThan(0)
    expect(compareSemver('1.3.0-rc.1', '1.3.0-beta.11')).toBeGreaterThan(0)
  })

  it('classifies clean install as first-run without upgrade announcement', () => {
    const res = evaluateVersionTransition({
      currentVersion: '1.3.1',
      lastSeenVersion: null,
      dismissedVersions: []
    })
    expect(res.kind).toBe('first-run')
    expect(res.shouldAnnounceUpgrade).toBe(false)
  })

  it('announces once on genuine upgrade and respects dismissal', () => {
    const upgraded = evaluateVersionTransition({
      currentVersion: '1.3.1',
      lastSeenVersion: '1.3.0',
      dismissedVersions: []
    })
    expect(upgraded).toEqual({
      kind: 'upgraded',
      shouldAnnounceUpgrade: true,
      previousVersion: '1.3.0'
    })

    const dismissed = evaluateVersionTransition({
      currentVersion: '1.3.1',
      lastSeenVersion: '1.3.0',
      dismissedVersions: ['1.3.1']
    })
    expect(dismissed.shouldAnnounceUpgrade).toBe(false)
  })

  it('does not announce on same-version relaunch or rollback', () => {
    expect(
      evaluateVersionTransition({ currentVersion: '1.3.1', lastSeenVersion: '1.3.1', dismissedVersions: [] })
    ).toMatchObject({ kind: 'same', shouldAnnounceUpgrade: false })

    expect(
      evaluateVersionTransition({ currentVersion: '1.3.0', lastSeenVersion: '1.3.1', dismissedVersions: [] })
    ).toMatchObject({ kind: 'downgraded', shouldAnnounceUpgrade: false })
  })

  it('filters releases strictly between fromVersion and toVersion', () => {
    const releases: CompanionReleaseHighlight[] = [
      { version: '1.4.0', publishedAt: null, title: 'v1.4.0', highlights: ['future'], url: '', source: 'github' },
      { version: '1.3.1', publishedAt: null, title: 'v1.3.1', highlights: ['b'], url: '', source: 'github' },
      { version: '1.3.0', publishedAt: null, title: 'v1.3.0', highlights: ['a'], url: '', source: 'github' },
      { version: '1.2.3', publishedAt: null, title: 'v1.2.3', highlights: ['old'], url: '', source: 'github' }
    ]
    const diff = getReleasesSince(releases, '1.2.3', '1.3.1')
    expect(diff.map((r) => r.version)).toEqual(['1.3.1', '1.3.0'])
  })
})
