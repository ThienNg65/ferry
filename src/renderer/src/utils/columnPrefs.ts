export type ColumnKey = 'size' | 'modified' | 'permissions'

export interface ColumnPrefs {
  hidden: ColumnKey[]
  widths: Record<ColumnKey, number>
}

export const COLUMN_KEYS: ColumnKey[] = ['size', 'modified', 'permissions']
export const DEFAULT_COLUMN_WIDTHS: Record<ColumnKey, number> = { size: 80, modified: 128, permissions: 144 }
export const MIN_COLUMN_PX = 48
export const MAX_COLUMN_PX = 320

export function clampColumnWidth(px: number): number {
  return Math.max(MIN_COLUMN_PX, Math.min(MAX_COLUMN_PX, Math.round(px)))
}

export function defaultColumnPrefs(): ColumnPrefs {
  return { hidden: [], widths: { ...DEFAULT_COLUMN_WIDTHS } }
}

export function parseColumnPrefs(raw: string | null): ColumnPrefs {
  const prefs = defaultColumnPrefs()
  if (!raw) {
    return prefs
  }
  try {
    const data = JSON.parse(raw) as Partial<ColumnPrefs>
    if (Array.isArray(data.hidden)) {
      prefs.hidden = data.hidden.filter((k): k is ColumnKey => COLUMN_KEYS.includes(k as ColumnKey))
    }
    for (const key of COLUMN_KEYS) {
      const width = data.widths?.[key]
      if (typeof width === 'number' && Number.isFinite(width)) {
        prefs.widths[key] = clampColumnWidth(width)
      }
    }
  } catch {
    return defaultColumnPrefs()
  }
  return prefs
}
