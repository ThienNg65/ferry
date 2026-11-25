import { appendRotatingJsonl } from './securityLog'

export type AppLogLevel = 'info' | 'warn' | 'error'

/**
 * Appends a structured, secret-redacted operational log line to `<dataDir>/app.log`,
 * rotating at 1 MB via `appendRotatingJsonl`. Never throws.
 */
export function logAppEvent(
  level: AppLogLevel,
  event: string,
  details: Record<string, unknown> = {}
): void {
  appendRotatingJsonl('app.log', {
    ts: new Date().toISOString(),
    level,
    event,
    ...details
  })
}
