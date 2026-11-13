import { describe, expect, it } from 'vitest'
import { buildKeywordRegex } from './keywordHighlight'
import { extractJsonPayload, parseLogLevel, parseTimestampPrefix, tokenizeLogLine } from './logParser'

describe('logParser', () => {
  it('classifies log levels across plain, structured, and JSON formats', () => {
    expect(parseLogLevel('2026-11-13T10:00:00Z [ERROR] Connection refused')).toBe('error')
    expect(parseLogLevel('{"level":"warn","msg":"slow query"}')).toBe('warn')
    expect(parseLogLevel('level=debug trace_id=123')).toBe('debug')
    expect(parseLogLevel('2026-11-13 10:00:00 INFO Server listening on :3000')).toBe('info')
    expect(parseLogLevel('plain output line')).toBe('default')
    expect(
      parseLogLevel('2026-11-13 07:05:16,436 WARN [InboxEventProcessor] Failed to process inbox batch')
    ).toBe('warn')
    expect(
      parseLogLevel('{"error":{"reason":"for more information see docs"},"status":429}')
    ).toBe('error')
  })

  it('extracts leading timestamps including comma milliseconds', () => {
    const parsed = parseTimestampPrefix('[2026-11-13T10:00:00.123Z] INFO ready')
    expect(parsed.timestamp).toBe('[2026-11-13T10:00:00.123Z]')
    expect(parsed.rest).toBe('INFO ready')

    const log4j = parseTimestampPrefix('2026-11-13 07:05:16,436 WARN [main] Started')
    expect(log4j.timestamp).toBe('2026-11-13 07:05:16,436')
    expect(log4j.rest).toBe('WARN [main] Started')
  })

  it('extracts full-line and trailing JSON payloads without matching bracketed level tags', () => {
    expect(extractJsonPayload('[INFO] plain message')).toBeNull()

    const full = extractJsonPayload('{"level":"error","code":500}')
    expect(full).toEqual({
      prefix: '',
      data: { level: 'error', code: 500 },
      rawJson: '{"level":"error","code":500}'
    })

    const trailing = extractJsonPayload('2026-11-13T10:00:00Z INFO request {"status":502,"ms":41}')
    expect(trailing).toEqual({
      prefix: '2026-11-13T10:00:00Z INFO request',
      data: { status: 502, ms: 41 },
      rawJson: '{"status":502,"ms":41}'
    })
  })

  it('composes timestamp dimming, search matches, and keyword highlights', () => {
    const line = '2026-11-13T10:00:00Z ERROR timeout connecting to db'
    const searchRe = /timeout/gi
    const kwRe = buildKeywordRegex(['db'])

    const result = tokenizeLogLine(line, searchRe, kwRe, 0, 0)
    expect(result.timestamp).toBe('2026-11-13T10:00:00Z')
    expect(result.timestampTokens).toEqual([
      { text: '2026-11-13T10:00:00Z', isMatch: false, isActiveMatch: false, keywordGroup: null }
    ])
    expect(result.restTokens).toEqual([
      { text: 'ERROR ', isMatch: false, isActiveMatch: false, keywordGroup: null },
      { text: 'timeout', isMatch: true, isActiveMatch: true, keywordGroup: null },
      { text: ' connecting to ', isMatch: false, isActiveMatch: false, keywordGroup: null },
      { text: 'db', isMatch: false, isActiveMatch: false, keywordGroup: 0 }
    ])
  })
})
