import { describe, expect, it } from 'vitest'
import { getLogLevelStyles, parseLogLevel, parseTimestampPrefix, splitLineMatches } from './logParser'

describe('parseTimestampPrefix', () => {
  it('extracts ISO 8601 timestamps', () => {
    const res = parseTimestampPrefix('2026-11-09 18:38:49.123 [INFO] worker started')
    expect(res.timestamp).toBe('2026-11-09 18:38:49.123')
    expect(res.rest).toBe('[INFO] worker started')
  })

  it('extracts bracketed ISO timestamps', () => {
    const res = parseTimestampPrefix('[2026-11-09T18:38:49Z] error occurred')
    expect(res.timestamp).toBe('[2026-11-09T18:38:49Z]')
    expect(res.rest).toBe('error occurred')
  })

  it('extracts syslog-style timestamps', () => {
    const res = parseTimestampPrefix('Nov  9 18:38:49 myserver kernel: eth0 up')
    expect(res.timestamp).toBe('Nov  9 18:38:49')
    expect(res.rest).toBe('myserver kernel: eth0 up')
  })

  it('extracts time-only prefixes', () => {
    const res = parseTimestampPrefix('18:38:49.102 task done')
    expect(res.timestamp).toBe('18:38:49.102')
    expect(res.rest).toBe('task done')
  })

  it('returns null timestamp when no timestamp prefix exists', () => {
    const res = parseTimestampPrefix('hello world without time')
    expect(res.timestamp).toBeNull()
    expect(res.rest).toBe('hello world without time')
  })
})

describe('parseLogLevel', () => {
  it('detects standard bracketed log levels', () => {
    expect(parseLogLevel('[ERROR] Something failed')).toBe('error')
    expect(parseLogLevel('[WARN] Memory high')).toBe('warn')
    expect(parseLogLevel('[INFO] Server started')).toBe('info')
    expect(parseLogLevel('[DEBUG] Payload dump')).toBe('debug')
  })

  it('detects colon-separated and plain log levels', () => {
    expect(parseLogLevel('ERROR: unable to connect to db')).toBe('error')
    expect(parseLogLevel('WARNING: deprecated API called')).toBe('warn')
    expect(parseLogLevel('INFO: worker 2 spawned')).toBe('info')
    expect(parseLogLevel('DEBUG: cache miss key=123')).toBe('debug')
  })

  it('detects structured log lines with key=value', () => {
    expect(parseLogLevel('time=123 level=error msg="failed"')).toBe('error')
    expect(parseLogLevel('time=123 level=warn msg="slow"')).toBe('warn')
    expect(parseLogLevel('time=123 level=info msg="ok"')).toBe('info')
    expect(parseLogLevel('time=123 level=debug msg="verbose"')).toBe('debug')
  })

  it('detects JSON formatted log lines', () => {
    expect(parseLogLevel('{"level":"error","message":"disk full"}')).toBe('error')
    expect(parseLogLevel('{"level": 50, "msg": "fatal crash"}')).toBe('error')
    expect(parseLogLevel('{"level":"warn","message":"rate limit"}')).toBe('warn')
    expect(parseLogLevel('{"level": 40, "msg": "slow query"}')).toBe('warn')
    expect(parseLogLevel('{"level":"info","message":"request received"}')).toBe('info')
    expect(parseLogLevel('{"level":"debug","message":"parsing headers"}')).toBe('debug')
  })

  it('detects stack traces and exceptions as error', () => {
    expect(parseLogLevel('  at Object.<anonymous> (/app/index.js:12:3)')).toBe('error')
    expect(parseLogLevel('\tat com.example.service.User.login(User.java:45)')).toBe('error')
    expect(parseLogLevel('Caused by: java.io.IOException: Broken pipe')).toBe('error')
    expect(parseLogLevel('Traceback (most recent call last):')).toBe('error')
    expect(parseLogLevel('  File "/app/main.py", line 12, in <module>')).toBe('error')
    expect(parseLogLevel('NullPointerException: object is null')).toBe('error')
  })

  it('detects internal SSH / Ferry notice lines as warn', () => {
    expect(parseLogLevel('⚠ tail: cannot open file')).toBe('warn')
    expect(parseLogLevel('⚠ connection dropped')).toBe('warn')
  })

  it('defaults to "default" for unstructured lines', () => {
    expect(parseLogLevel('hello world')).toBe('default')
    expect(parseLogLevel('127.0.0.1 - - [09/Nov/2026:14:16:01 +0000] "GET / HTTP/1.1" 200 123')).toBe('default')
  })
})

describe('getLogLevelStyles', () => {
  it('returns valid styles for each level', () => {
    const errorStyles = getLogLevelStyles('error')
    expect(errorStyles.borderClass).toContain('border-rose-500')
    expect(errorStyles.badgeText).toBe('ERR')

    const warnStyles = getLogLevelStyles('warn')
    expect(warnStyles.borderClass).toContain('border-amber-500')
    expect(warnStyles.badgeText).toBe('WRN')

    const infoStyles = getLogLevelStyles('info')
    expect(infoStyles.badgeText).toBe('INF')

    const debugStyles = getLogLevelStyles('debug')
    expect(debugStyles.badgeText).toBe('DBG')

    const defaultStyles = getLogLevelStyles('default')
    expect(defaultStyles.badgeText).toBe('')
  })
})

describe('splitLineMatches', () => {
  it('returns whole line when regex is null or empty', () => {
    const chunks = splitLineMatches('hello world', null)
    expect(chunks).toEqual([{ text: 'hello world', isMatch: false, isActiveMatch: false }])
  })

  it('splits line into matches and non-matches', () => {
    const chunks = splitLineMatches('foo bar foo', /foo/gi)
    expect(chunks).toHaveLength(3)
    expect(chunks[0]).toEqual({ text: 'foo', isMatch: true, isActiveMatch: false })
    expect(chunks[1]).toEqual({ text: ' bar ', isMatch: false, isActiveMatch: false })
    expect(chunks[2]).toEqual({ text: 'foo', isMatch: true, isActiveMatch: false })
  })

  it('correctly marks the active global match', () => {
    // If this line has 2 matches, starting at global match index 5
    // match 0 -> global index 5
    // match 1 -> global index 6
    // Suppose activeGlobalMatchIndex is 6
    const chunks = splitLineMatches('cat and cat', /cat/g, 5, 6)
    expect(chunks).toHaveLength(3)
    expect(chunks[0]).toEqual({ text: 'cat', isMatch: true, isActiveMatch: false })
    expect(chunks[1]).toEqual({ text: ' and ', isMatch: false, isActiveMatch: false })
    expect(chunks[2]).toEqual({ text: 'cat', isMatch: true, isActiveMatch: true })
  })

  it('handles regex with case sensitivity', () => {
    const chunks = splitLineMatches('Error and error', /Error/g)
    expect(chunks).toHaveLength(2)
    expect(chunks[0]).toEqual({ text: 'Error', isMatch: true, isActiveMatch: false })
    expect(chunks[1]).toEqual({ text: ' and error', isMatch: false, isActiveMatch: false })
  })
})
