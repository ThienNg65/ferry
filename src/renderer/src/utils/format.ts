/** Shared human-readable formatters (bytes, durations) used by the Transfers, Activity and Monitor dock tabs. */

export function formatBytes(n: number): string {
  if (n < 1024) {
    return `${n} B`
  }
  if (n < 1024 * 1024) {
    return `${(n / 1024).toFixed(1)} KB`
  }
  if (n < 1024 * 1024 * 1024) {
    return `${(n / 1024 / 1024).toFixed(1)} MB`
  }
  return `${(n / 1024 / 1024 / 1024).toFixed(1)} GB`
}

/** Compact elapsed-time string, e.g. "8s", "2m 05s", "1h 12m". */
export function formatElapsed(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000))
  if (totalSec < 60) {
    return `${totalSec}s`
  }
  const min = Math.floor(totalSec / 60)
  const sec = totalSec % 60
  if (min < 60) {
    return `${min}m ${String(sec).padStart(2, '0')}s`
  }
  const hours = Math.floor(min / 60)
  return `${hours}h ${min % 60}m`
}

/** Coarse uptime string, e.g. "14d 3h", "5h 12m", "43m". */
export function formatUptime(totalSec: number): string {
  const days = Math.floor(totalSec / 86_400)
  const hours = Math.floor((totalSec % 86_400) / 3600)
  const minutes = Math.floor((totalSec % 3600) / 60)
  if (days > 0) {
    return `${days}d ${hours}h`
  }
  if (hours > 0) {
    return `${hours}h ${minutes}m`
  }
  return `${minutes}m`
}
