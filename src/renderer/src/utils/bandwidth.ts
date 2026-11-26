export type BandwidthUnit = 'KB/s' | 'MB/s'

export interface BandwidthPreset {
  label: string
  limitKBps: number | null
}

export const BANDWIDTH_UNIT_OPTIONS: { label: string; value: BandwidthUnit }[] = [
  { label: 'KB/s', value: 'KB/s' },
  { label: 'MB/s', value: 'MB/s' }
]

export const BANDWIDTH_PRESETS: readonly BandwidthPreset[] = [
  { label: 'Unlimited', limitKBps: null },
  { label: '256 KB/s', limitKBps: 256 },
  { label: '512 KB/s', limitKBps: 512 },
  { label: '1 MB/s', limitKBps: 1024 },
  { label: '5 MB/s', limitKBps: 5120 },
  { label: '10 MB/s', limitKBps: 10240 },
  { label: '25 MB/s', limitKBps: 25600 }
]

function formatTrimmedDecimal(value: number, maxDecimals = 2): string {
  return Number(value.toFixed(maxDecimals)).toString()
}

/** Formats a stored KB/s cap (`null` or `<= 0` = Unlimited) for compact UI labels. */
export function formatBandwidthCap(limitKBps: number | null | undefined): string {
  if (limitKBps === null || limitKBps === undefined || !Number.isFinite(limitKBps) || limitKBps <= 0) {
    return 'Unlimited'
  }
  if (limitKBps >= 1024) {
    return `${formatTrimmedDecimal(limitKBps / 1024)} MB/s`
  }
  return `${Math.round(limitKBps)} KB/s`
}

/**
 * Splits a stored KB/s limit into a display value and unit.
 * Uses `MB/s` only when the 2-decimal representation round-trips back to the exact KB/s cap,
 * so custom caps like `1025 KB/s` are preserved without silent rounding on unrelated saves.
 */
export function splitBandwidthLimit(limitKBps: number | null | undefined): { value: number; unit: BandwidthUnit } {
  if (limitKBps === null || limitKBps === undefined || !Number.isFinite(limitKBps) || limitKBps <= 0) {
    return { value: 1, unit: 'MB/s' }
  }
  const roundedKBps = Math.round(limitKBps)
  if (roundedKBps >= 1024) {
    const mb = Number((roundedKBps / 1024).toFixed(2))
    if (Math.round(mb * 1024) === roundedKBps) {
      return { value: mb, unit: 'MB/s' }
    }
  }
  return { value: roundedKBps, unit: 'KB/s' }
}

/** Converts a numeric input value when the user toggles between `KB/s` and `MB/s`. */
export function convertBandwidthValue(value: number, from: BandwidthUnit, to: BandwidthUnit): number {
  if (from === to || !Number.isFinite(value) || value <= 0) {
    return value
  }
  if (from === 'KB/s' && to === 'MB/s') {
    return Number((value / 1024).toFixed(2))
  }
  return Math.round(value * 1024)
}

/**
 * Converts a UI numeric input and unit into the IPC KB/s contract:
 * - `0` -> `null` (Unlimited, removing throttling overhead completely)
 * - positive value -> positive integer KB/s (minimum 1 KB/s)
 * - negative / NaN / Infinity -> `undefined` (invalid)
 */
export function toBandwidthKBps(value: number, unit: BandwidthUnit): number | null | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return undefined
  }
  if (value === 0) {
    return null
  }
  const rawKBps = unit === 'MB/s' ? value * 1024 : value
  const rounded = Math.round(rawKBps)
  if (rounded < 1) {
    return undefined
  }
  return rounded
}
