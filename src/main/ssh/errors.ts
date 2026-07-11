import type { IpcErrorCode } from '../../shared/contract'

/**
 * Typed error for every failure originating in the SSH core.
 *
 * Carries an {@link IpcErrorCode} so the IPC layer can forward a stable code to
 * the renderer instead of an opaque string, and a `transient` flag the retry
 * wrapper uses to decide whether an operation is worth re-attempting.
 */
export class SshError extends Error {
  /** Stable, machine-readable code mirrored across the IPC boundary. */
  public readonly code: IpcErrorCode
  /** True when the failure is likely temporary (network blip, channel reset). */
  public readonly transient: boolean

  /**
   * @param code      - stable error code
   * @param message   - human-readable description
   * @param transient - whether a retry might succeed
   */
  constructor(code: IpcErrorCode, message: string, transient = false) {
    super(message)
    this.name = 'SshError'
    this.code = code
    this.transient = transient
  }
}

/** Substrings that mark a low-level error as a transient connection problem. */
const TRANSIENT_MARKERS = [
  'ECONNRESET',
  'ETIMEDOUT',
  'ECONNREFUSED',
  'EPIPE',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'Timed out while waiting',
  'Channel open failure',
  'read ECONNRESET',
  'connection lost'
]

/**
 * Classifies an arbitrary error as transient (worth retrying) or not.
 *
 * @param e - any caught value
 */
export function isTransient(e: unknown): boolean {
  if (e instanceof SshError) {
    return e.transient
  }
  const message = e instanceof Error ? e.message : String(e)
  return TRANSIENT_MARKERS.some((marker) => message.includes(marker))
}
