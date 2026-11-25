import { describe, expect, it } from 'vitest'
import type { CompanionReleaseHighlight } from '@shared/contract'
import { answerCompanionQuery, diagnoseErrorText } from './companionEngine'

const SAMPLE_RELEASES: CompanionReleaseHighlight[] = [
  {
    version: '1.3.1',
    publishedAt: '2026-11-21',
    title: 'Ferry v1.3.1',
    highlights: ['Restore Site Management after closing tabs'],
    url: 'https://github.com/ThienNg65/ferry-release/releases/tag/ferry-v1.3.1',
    source: 'github'
  },
  {
    version: '1.3.0',
    publishedAt: '2026-11-20',
    title: 'Ferry v1.3.0',
    highlights: ['WinGet community package support'],
    url: 'https://github.com/ThienNg65/ferry-release/releases/tag/ferry-v1.3.0',
    source: 'github'
  }
]

describe('companionEngine', () => {
  it('answers What is new using actual release metadata', () => {
    const reply = answerCompanionQuery("What's new?", {
      currentVersion: '1.3.1',
      previousVersion: '1.3.0',
      releases: SAMPLE_RELEASES,
      offlineFallback: false,
      isConnected: true
    })
    expect(reply.releaseCard?.version).toBe('1.3.1')
    expect(reply.releaseCard?.highlights).toContain('Restore Site Management after closing tabs')
  })

  it('answers What changed since my last version using version diff', () => {
    const reply = answerCompanionQuery('What changed since my previous version?', {
      currentVersion: '1.3.1',
      previousVersion: '1.2.3',
      releases: SAMPLE_RELEASES,
      offlineFallback: false,
      isConnected: false
    })
    expect(reply.releaseCard?.title).toContain('v1.2.3')
    expect(reply.releaseCard?.highlights.some((h) => h.includes('1.3.1'))).toBe(true)
    expect(reply.releaseCard?.highlights.some((h) => h.includes('1.3.0'))).toBe(true)
  })

  it('offers safe in-app actions for feature help and honest fallback for unknown queries', () => {
    const filterReply = answerCompanionQuery('How do I use file filters?', {
      currentVersion: '1.3.1',
      previousVersion: null,
      releases: SAMPLE_RELEASES,
      offlineFallback: false,
      isConnected: true
    })
    expect(filterReply.actions?.some((a) => a.id === 'open-file-filters')).toBe(true)

    const unknownReply = answerCompanionQuery('Write me a poem about dolphins', {
      currentVersion: '1.3.1',
      previousVersion: null,
      releases: SAMPLE_RELEASES,
      offlineFallback: false,
      isConnected: false
    })
    expect(unknownReply.text.toLowerCase()).toContain('not sure')
    expect(unknownReply.isFallback).toBe(true)
    expect(unknownReply.actions?.length).toBeGreaterThanOrEqual(3)
  })

  it('classifies common SFTP/SSH error patterns into targeted checklists', () => {
    expect(diagnoseErrorText('EACCES: permission denied')).toContain('permissions')
    expect(diagnoseErrorText('Permission denied (publickey).')).toContain('SSH key mismatch')
    expect(diagnoseErrorText('ENOSPC: no space left on device')).toContain('disk')
    expect(diagnoseErrorText('Host key fingerprint mismatch')).toContain('Trusted SSH Hosts')
  })

  it('routes transfer error queries ahead of snippet/bug/filter branches and handles sync warnings', () => {
    const baseCtx = {
      currentVersion: '1.3.1',
      previousVersion: null,
      releases: SAMPLE_RELEASES,
      offlineFallback: false,
      isConnected: true
    }
    expect(answerCompanionQuery('My transfer failed with EACCES: permission denied', baseCtx).text).toContain('permissions')
    expect(answerCompanionQuery('My transfer failed with broken pipe', baseCtx).text).toContain('network drop')
    expect(answerCompanionQuery('Review this folder sync pre-flight warning (push)', baseCtx).text).toContain('mirror mode')
  })

  it('returns risk-badged Command Cards for plain-English shell command requests', () => {
    const reply = answerCompanionQuery('Command to check disk usage', {
      currentVersion: '1.3.1',
      previousVersion: null,
      releases: SAMPLE_RELEASES,
      offlineFallback: false,
      isConnected: true
    })
    expect(reply.commandCards?.some((c) => c.command === 'df -h' && c.risk === 'read_only')).toBe(true)
  })
})
