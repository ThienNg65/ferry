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

const ERROR_REGEX =
  /(?:^|\s|\[)(?:FATAL|CRITICAL|CRIT|EMERG|EMERGENCY|ERROR|ERR|SEVERE|EXCEPTION|FAILED|FAIL)(?:\b|\]|:)/i
const ERROR_STRUCTURED_REGEX = /(?:^|\s)level=["']?(?:fatal|error|err|critical)["']?/i
const ERROR_JSON_REGEX = /"level"\s*:\s*(?:"(?:fatal|error|err|critical)"|50|60)/i
const ERROR_STACK_REGEX =
  /^\s*(?:at\s+[\w$./]+|Caused by:|Traceback \(most recent call last\):|File\s+".*",\s+line\s+\d+|[A-Za-z0-9_.]*(?:Error|Exception):)/

const WARN_REGEX = /(?:^|\s|\[)(?:WARN|WARNING|WRN)(?:\b|\]|:)/i
const WARN_STRUCTURED_REGEX = /(?:^|\s)level=["']?(?:warn|warning)["']?/i
const WARN_JSON_REGEX = /"level"\s*:\s*(?:"(?:warn|warning)"|40)/i
const NOTICE_PREFIX_REGEX = /^⚠\s/

const INFO_REGEX = /(?:^|\s|\[)(?:INFO|INF|INFORMATION|NOTICE|STATUS)(?:\b|\]|:)/i
const INFO_STRUCTURED_REGEX = /(?:^|\s)level=["']?(?:info|notice)["']?/i
const INFO_JSON_REGEX = /"level"\s*:\s*(?:"(?:info|notice)"|30)/i

const DEBUG_REGEX = /(?:^|\s|\[)(?:DEBUG|DBG|TRACE|TRC|VERBOSE|FINE|FINER|FINEST)(?:\b|\]|:)/i
const DEBUG_STRUCTURED_REGEX = /(?:^|\s)level=["']?(?:debug|trace|verbose)["']?/i
const DEBUG_JSON_REGEX = /"level"\s*:\s*(?:"(?:debug|trace|verbose)"|10|20)/i

/**
 * Classifies a raw log line into a LogLevel.
 * Prioritizes errors, then warnings, debug, info, or default.
 */
export function parseLogLevel(line: string): LogLevel {
  if (
    ERROR_REGEX.test(line) ||
    ERROR_STRUCTURED_REGEX.test(line) ||
    ERROR_JSON_REGEX.test(line) ||
    ERROR_STACK_REGEX.test(line)
  ) {
    return 'error'
  }
  if (
    WARN_REGEX.test(line) ||
    WARN_STRUCTURED_REGEX.test(line) ||
    WARN_JSON_REGEX.test(line) ||
    NOTICE_PREFIX_REGEX.test(line)
  ) {
    return 'warn'
  }
  if (
    DEBUG_REGEX.test(line) ||
    DEBUG_STRUCTURED_REGEX.test(line) ||
    DEBUG_JSON_REGEX.test(line)
  ) {
    return 'debug'
  }
  if (
    INFO_REGEX.test(line) ||
    INFO_STRUCTURED_REGEX.test(line) ||
    INFO_JSON_REGEX.test(line)
  ) {
    return 'info'
  }
  return 'default'
}

/**
 * Returns Tailwind CSS styling classes associated with a LogLevel.
 */
export function getLogLevelStyles(level: LogLevel): LogLevelStyles {
  switch (level) {
    case 'error':
      return {
        borderClass: 'border-l-2 border-rose-500',
        bgClass: 'bg-rose-500/10 dark:bg-rose-500/10',
        textClass: 'text-rose-600 dark:text-rose-400',
        badgeClass: 'bg-rose-500/20 text-rose-600 dark:text-rose-400 font-bold',
        badgeText: 'ERR'
      }
    case 'warn':
      return {
        borderClass: 'border-l-2 border-amber-500',
        bgClass: 'bg-amber-500/10 dark:bg-amber-500/10',
        textClass: 'text-amber-600 dark:text-amber-400',
        badgeClass: 'bg-amber-500/20 text-amber-700 dark:text-amber-300 font-bold',
        badgeText: 'WRN'
      }
    case 'info':
      return {
        borderClass: 'border-l-2 border-transparent',
        bgClass: '',
        textClass: 'text-default',
        badgeClass: 'bg-sky-500/15 text-sky-600 dark:text-sky-400 font-medium',
        badgeText: 'INF'
      }
    case 'debug':
      return {
        borderClass: 'border-l-2 border-transparent',
        bgClass: '',
        textClass: 'text-dimmed opacity-75',
        badgeClass: 'bg-neutral-500/15 text-dimmed font-medium',
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
