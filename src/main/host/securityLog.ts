import { appendFileSync, mkdirSync, renameSync, statSync } from 'fs'
import * as path from 'path'
import { host } from './host'

const MAX_LOG_BYTES = 1_048_576
const SENSITIVE_KEY_RE = /^(password|passphrase|secret|token|privateKey|secretPassword|secretPassphrase|authorization|cookie|nlToken|nlConnectToken)$/i

export function redactValue(key: string, value: unknown): unknown {
  if (SENSITIVE_KEY_RE.test(key)) {
    return '[REDACTED]'
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactValue('', item))
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = redactValue(k, v)
    }
    return out
  }
  return value
}

/**
 * Appends a structured, secret-redacted JSON line to `<dataDir>/<fileName>`,
 * rotating to `<fileName>.1` when the active file exceeds `MAX_LOG_BYTES`. Never throws.
 */
export function appendRotatingJsonl(fileName: string, entry: Record<string, unknown>): void {
  try {
    const dataDir = host().dataDir
    if (!dataDir) {
      return
    }
    const logPath = path.join(dataDir, fileName)
    mkdirSync(dataDir, { recursive: true })
    try {
      const st = statSync(logPath)
      if (st.size >= MAX_LOG_BYTES) {
        renameSync(logPath, `${logPath}.1`)
      }
    } catch {
      // File does not exist yet or cannot be rotated; append below will create it.
    }
    const sanitized = redactValue('', entry) as Record<string, unknown>
    appendFileSync(logPath, `${JSON.stringify(sanitized)}\n`, { encoding: 'utf8', mode: 0o600 })
  } catch {
    // Logging must never crash or block the caller.
  }
}

/**
 * Appends a structured, secret-redacted security event line to `<dataDir>/security.log`,
 * rotating to `security.log.1` when the active file exceeds 1 MB. Never throws.
 */
export function logSecurityEvent(event: string, details: Record<string, unknown> = {}): void {
  appendRotatingJsonl('security.log', {
    ts: new Date().toISOString(),
    event,
    ...details
  })
}
