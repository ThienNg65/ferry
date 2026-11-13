import { splitByKeywords } from './keywordHighlight'

export type LogLevel = 'error' | 'warn' | 'info' | 'debug' | 'default'

export interface LogLevelStyles {
  borderClass: string
  bgClass: string
  textClass: string
  badgeClass: string
  badgeText: string
}

export interface LineMatchChunk {
  text: string
  isMatch: boolean
  isActiveMatch: boolean
}

const TIMESTAMP_REGEX =
  /^(\[?(?:\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:[.,]\d+)?(?:Z|[+-]\d{2}:?\d{2})?|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}(?:[.,]\d+)?|\d{2}\/(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\/\d{4}:\d{2}:\d{2}:\d{2}(?:\s+[+-]\d{4})?|\d{2}:\d{2}:\d{2}(?:[.,]\d+)?)\]?)\s*/i

/**
 * Extracts a leading timestamp from a log line if present.
 */
export function parseTimestampPrefix(line: string): { timestamp: string | null; rest: string } {
  const match = TIMESTAMP_REGEX.exec(line)
  if (match) {
    return {
      timestamp: match[1],
      rest: line.slice(match[0].length)
    }
  }
  return {
    timestamp: null,
    rest: line
  }
}

const LEADING_ERROR_REGEX = /^\[?(?:FATAL|CRITICAL|CRIT|EMERG|EMERGENCY|ERROR|ERR|SEVERE)\]?(?:\b|\]|:)/i
const LEADING_WARN_REGEX = /^\[?(?:WARN|WARNING|WRN)\]?(?:\b|\]|:)/i
const LEADING_INFO_REGEX = /^\[?(?:INFO|INF|NOTICE)\]?(?:\b|\]|:)/i
const LEADING_DEBUG_REGEX = /^\[?(?:DEBUG|DBG|TRACE|TRC|VERBOSE|FINE|FINER|FINEST)\]?(?:\b|\]|:)/i

const ERROR_REGEX =
  /(?:^|\s|\[)(?:FATAL|CRITICAL|CRIT|EMERG|EMERGENCY|ERROR|ERR|SEVERE|EXCEPTION|FAILED|FAIL)(?:\b|\]|:)/i
const ERROR_STRUCTURED_REGEX = /(?:^|\s)level=["']?(?:fatal|error|err|critical)["']?/i
const ERROR_JSON_REGEX = /"level"\s*:\s*(?:"(?:fatal|error|err|critical)"|50|60)/i
const ERROR_JSON_KEY_REGEX = /^\s*\{\s*"error"\s*:/
const ERROR_STACK_REGEX =
  /^\s*(?:at\s+[\w$./]+|Caused by:|Traceback \(most recent call last\):|File\s+".*",\s+line\s+\d+|[A-Za-z0-9_.]*(?:Error|Exception):)/

const WARN_REGEX = /(?:^|\s|\[)(?:WARN|WARNING|WRN)(?:\b|\]|:)/i
const WARN_STRUCTURED_REGEX = /(?:^|\s)level=["']?(?:warn|warning)["']?/i
const WARN_JSON_REGEX = /"level"\s*:\s*(?:"(?:warn|warning)"|40)/i
const NOTICE_PREFIX_REGEX = /^⚠\s/

const INFO_REGEX = /(?:^|\s|\[)(?:INFO|INF|NOTICE)(?:\b|\]|:)/i
const INFO_STRUCTURED_REGEX = /(?:^|\s)level=["']?(?:info|notice)["']?/i
const INFO_JSON_REGEX = /"level"\s*:\s*(?:"(?:info|notice)"|30)/i

const DEBUG_REGEX = /(?:^|\s|\[)(?:DEBUG|DBG|TRACE|TRC|VERBOSE|FINE|FINER|FINEST)(?:\b|\]|:)/i
const DEBUG_STRUCTURED_REGEX = /(?:^|\s)level=["']?(?:debug|trace|verbose)["']?/i
const DEBUG_JSON_REGEX = /"level"\s*:\s*(?:"(?:debug|trace|verbose)"|10|20)/i

/**
 * Classifies a raw log line into a LogLevel.
 * Authoritative level tokens (structured fields, JSON level, or leading token after timestamp)
 * take precedence over heuristic keywords in the message body.
 */
export function parseLogLevel(line: string): LogLevel {
  // 1. Authoritative structured / JSON level fields
  if (ERROR_STRUCTURED_REGEX.test(line) || ERROR_JSON_REGEX.test(line)) return 'error'
  if (WARN_STRUCTURED_REGEX.test(line) || WARN_JSON_REGEX.test(line) || NOTICE_PREFIX_REGEX.test(line)) return 'warn'
  if (DEBUG_STRUCTURED_REGEX.test(line) || DEBUG_JSON_REGEX.test(line)) return 'debug'
  if (INFO_STRUCTURED_REGEX.test(line) || INFO_JSON_REGEX.test(line)) return 'info'

  // 2. Authoritative leading level token after optional timestamp (e.g. "2026-11-13 07:05:16,436 WARN ...")
  const { rest } = parseTimestampPrefix(line)
  if (LEADING_ERROR_REGEX.test(rest)) return 'error'
  if (LEADING_WARN_REGEX.test(rest)) return 'warn'
  if (LEADING_DEBUG_REGEX.test(rest)) return 'debug'
  if (LEADING_INFO_REGEX.test(rest)) return 'info'

  // 3. JSON error payload without an explicit "level" field
  if (ERROR_JSON_KEY_REGEX.test(line)) return 'error'
  if (line.trimStart().startsWith('{')) return 'default'

  // 4. Fallback heuristics for unstructured lines and stack traces
  if (ERROR_REGEX.test(line) || ERROR_STACK_REGEX.test(line)) return 'error'
  if (WARN_REGEX.test(line)) return 'warn'
  if (DEBUG_REGEX.test(line)) return 'debug'
  if (INFO_REGEX.test(line)) return 'info'
  return 'default'
}

/**
 * Returns Tailwind CSS styling classes associated with a LogLevel.
 * All colors tuned for WCAG 2.2 AA (>= 4.5:1) contrast against light & dark backgrounds.
 */
export function getLogLevelStyles(level: LogLevel): LogLevelStyles {
  switch (level) {
    case 'error':
      return {
        borderClass: 'border-l-2 border-rose-500 dark:border-rose-400',
        bgClass: 'bg-rose-500/10 dark:bg-rose-500/15',
        textClass: 'text-rose-700 dark:text-rose-300 font-medium',
        badgeClass: 'bg-rose-500/15 text-rose-700 dark:text-rose-300 ring-1 ring-rose-500/25 font-bold',
        badgeText: 'ERR'
      }
    case 'warn':
      return {
        borderClass: 'border-l-2 border-amber-500 dark:border-amber-400',
        bgClass: 'bg-amber-500/10 dark:bg-amber-500/15',
        textClass: 'text-amber-800 dark:text-amber-300',
        badgeClass: 'bg-amber-500/15 text-amber-800 dark:text-amber-300 ring-1 ring-amber-500/25 font-bold',
        badgeText: 'WRN'
      }
    case 'info':
      return {
        borderClass: 'border-l-2 border-transparent',
        bgClass: '',
        textClass: 'text-default',
        badgeClass: 'bg-sky-500/15 text-sky-700 dark:text-sky-300 ring-1 ring-sky-500/25 font-medium',
        badgeText: 'INF'
      }
    case 'debug':
      return {
        borderClass: 'border-l-2 border-transparent',
        bgClass: '',
        textClass: 'text-neutral-500 dark:text-neutral-400 font-normal',
        badgeClass: 'bg-neutral-500/15 text-neutral-600 dark:text-neutral-400 ring-1 ring-neutral-500/25 font-medium',
        badgeText: 'DBG'
      }
    default:
      return {
        borderClass: 'border-l-2 border-transparent',
        bgClass: '',
        textClass: 'text-default',
        badgeClass: '',
        badgeText: ''
      }
  }
}

/**
 * Splits a line into chunks of matching and non-matching text based on a search RegExp.
 * Distinguishes whether a match is the globally active match.
 */
export function splitLineMatches(
  line: string,
  regex: RegExp | null,
  lineGlobalMatchStart = -1,
  activeGlobalMatchIndex = -1
): LineMatchChunk[] {
  if (!regex || !line) {
    return [{ text: line, isMatch: false, isActiveMatch: false }]
  }

  // Clone regex with 'g' flag to ensure global iteration without altering original
  let flags = regex.flags
  if (!flags.includes('g')) {
    flags += 'g'
  }
  const re = new RegExp(regex.source, flags)

  const chunks: LineMatchChunk[] = []
  let lastIndex = 0
  let matchCount = 0
  let match: RegExpExecArray | null

  while ((match = re.exec(line)) !== null) {
    // Avoid infinite loops with zero-length matches
    if (match[0].length === 0) {
      re.lastIndex++
      continue
    }

    if (match.index > lastIndex) {
      chunks.push({
        text: line.slice(lastIndex, match.index),
        isMatch: false,
        isActiveMatch: false
      })
    }

    const currentMatchIndex = lineGlobalMatchStart + matchCount
    const isActive = lineGlobalMatchStart >= 0 && currentMatchIndex === activeGlobalMatchIndex

    chunks.push({
      text: match[0],
      isMatch: true,
      isActiveMatch: isActive
    })

    matchCount++
    lastIndex = match.index + match[0].length
  }

  if (lastIndex < line.length) {
    chunks.push({
      text: line.slice(lastIndex),
      isMatch: false,
      isActiveMatch: false
    })
  }

  return chunks.length > 0 ? chunks : [{ text: line, isMatch: false, isActiveMatch: false }]
}

export interface ExtractedJsonPayload {
  prefix: string
  data: unknown
  rawJson: string
}

/**
 * Detects and parses a JSON object/array payload at the start of a line or as a trailing suffix.
 */
export function extractJsonPayload(line: string): ExtractedJsonPayload | null {
  const trimmed = line.trimEnd()
  if (!trimmed) return null

  const braceIdx = trimmed.indexOf('{')
  const bracketIdx = trimmed.indexOf('[')
  const candidates: number[] = []
  if (braceIdx !== -1) candidates.push(braceIdx)
  // Only treat '[' as JSON array if it's at the start (after optional whitespace) or follows ': ' / '= '
  if (
    bracketIdx !== -1 &&
    (trimmed.slice(0, bracketIdx).trim() === '' || /[:=]\s*$/.test(trimmed.slice(0, bracketIdx)))
  ) {
    candidates.push(bracketIdx)
  }
  candidates.sort((a, b) => a - b)

  for (const idx of candidates) {
    const rawJson = trimmed.slice(idx)
    if (rawJson.length < 2) continue
    try {
      const data: unknown = JSON.parse(rawJson)
      if (data !== null && typeof data === 'object') {
        return {
          prefix: trimmed.slice(0, idx).trimEnd(),
          data,
          rawJson
        }
      }
    } catch {
      // Not valid JSON from this index; try next candidate
    }
  }
  return null
}

export interface LogTextToken {
  text: string
  isMatch: boolean
  isActiveMatch: boolean
  keywordGroup: number | null
}

export interface TokenizedLogLine {
  timestamp: string | null
  timestampTokens: LogTextToken[]
  restTokens: LogTextToken[]
}

interface MatchRange {
  start: number
  end: number
  isActive: boolean
}

function findMatchRanges(
  line: string,
  regex: RegExp | null,
  lineGlobalMatchStart: number,
  activeGlobalMatchIndex: number
): MatchRange[] {
  if (!regex || !line) return []
  const flags = regex.flags.includes('g') ? regex.flags : `${regex.flags}g`
  const re = new RegExp(regex.source, flags)
  const ranges: MatchRange[] = []
  let matchCount = 0
  let match: RegExpExecArray | null
  while ((match = re.exec(line)) !== null) {
    if (match[0].length === 0) {
      re.lastIndex++
      continue
    }
    ranges.push({
      start: match.index,
      end: match.index + match[0].length,
      isActive: lineGlobalMatchStart >= 0 && lineGlobalMatchStart + matchCount === activeGlobalMatchIndex
    })
    matchCount++
  }
  return ranges
}

function tokenizeSlice(
  line: string,
  sliceStart: number,
  sliceEnd: number,
  ranges: MatchRange[],
  keywordRegex: RegExp | null
): LogTextToken[] {
  if (sliceEnd <= sliceStart) return []
  const tokens: LogTextToken[] = []
  let cursor = sliceStart

  const pushPlain = (text: string): void => {
    if (!text) return
    for (const kw of splitByKeywords(text, keywordRegex)) {
      tokens.push({
        text: kw.text,
        isMatch: false,
        isActiveMatch: false,
        keywordGroup: kw.group
      })
    }
  }

  for (const r of ranges) {
    if (r.end <= cursor) continue
    if (r.start >= sliceEnd) break
    const matchStart = Math.max(r.start, cursor)
    const matchEnd = Math.min(r.end, sliceEnd)
    if (matchStart > cursor) {
      pushPlain(line.slice(cursor, matchStart))
    }
    tokens.push({
      text: line.slice(matchStart, matchEnd),
      isMatch: true,
      isActiveMatch: r.isActive,
      keywordGroup: null
    })
    cursor = matchEnd
  }

  if (cursor < sliceEnd) {
    pushPlain(line.slice(cursor, sliceEnd))
  }
  return tokens
}

/**
 * Tokenizes a log line into timestamp and body tokens, composing search matches and keyword highlights.
 */
export function tokenizeLogLine(
  line: string,
  searchRegex: RegExp | null,
  keywordRegex: RegExp | null,
  lineGlobalMatchStart = -1,
  activeGlobalMatchIndex = -1
): TokenizedLogLine {
  const { timestamp, rest } = parseTimestampPrefix(line)
  const ranges = findMatchRanges(line, searchRegex, lineGlobalMatchStart, activeGlobalMatchIndex)
  const tsEnd = timestamp ? line.indexOf(timestamp) + timestamp.length : 0
  const restStart = line.length - rest.length

  return {
    timestamp,
    timestampTokens: timestamp ? tokenizeSlice(line, 0, tsEnd, ranges, null) : [],
    restTokens: tokenizeSlice(line, restStart, line.length, ranges, keywordRegex)
  }
}
