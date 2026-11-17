import { defineStore } from 'pinia'
import {
  appendUniquePattern,
  emptyVisibilityFilter,
  hasActiveVisibilityFilter,
  type FileVisibilityFilter
} from '../utils/fileVisibilityFilter'

const STORAGE_PREFIX = 'ferry:visibilityFilter:'

function isPersistentKey(key: string): boolean {
  return key.startsWith('site:') || key.startsWith('host:')
}

function normalizePatternArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const item of value) {
    if (typeof item !== 'string') continue
    const trimmed = item.trim()
    if (!trimmed || seen.has(trimmed)) continue
    seen.add(trimmed)
    out.push(trimmed)
  }
  return out
}

function normalizeFilter(filter: Partial<FileVisibilityFilter> | null | undefined): FileVisibilityFilter {
  return {
    include: normalizePatternArray(filter?.include),
    exclude: normalizePatternArray(filter?.exclude)
  }
}

function readStoredFilter(key: string): FileVisibilityFilter | null {
  if (!isPersistentKey(key)) return null
  try {
    if (typeof localStorage === 'undefined') return null
    const raw = localStorage.getItem(`${STORAGE_PREFIX}${key}`)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<FileVisibilityFilter>
    if (!parsed || typeof parsed !== 'object') return null
    return normalizeFilter(parsed)
  } catch {
    return null
  }
}

function writeStoredFilter(key: string, filter: FileVisibilityFilter): void {
  if (!isPersistentKey(key)) return
  try {
    if (typeof localStorage === 'undefined') return
    if (!hasActiveVisibilityFilter(filter)) {
      localStorage.removeItem(`${STORAGE_PREFIX}${key}`)
      return
    }
    localStorage.setItem(`${STORAGE_PREFIX}${key}`, JSON.stringify(filter))
  } catch {
    // Ignore unavailable or full localStorage errors.
  }
}

/** Resolves a stable per-connection filter key (`site:<id>`, `host:<username@host>`, or ephemeral `session:<id>`). */
export function resolveConnectionFilterKey(tab: {
  siteId: string | null
  hostLabel: string | null
  sessionId: string | null
}): string | null {
  if (tab.siteId) return `site:${tab.siteId}`
  if (tab.hostLabel) return `host:${tab.hostLabel}`
  if (tab.sessionId) return `session:${tab.sessionId}`
  return null
}

interface FileFiltersState {
  byKey: Record<string, FileVisibilityFilter>
}

export const useFileFiltersStore = defineStore('fileFilters', {
  state: (): FileFiltersState => ({
    byKey: {}
  }),

  actions: {
    getFilter(key: string | null): FileVisibilityFilter {
      if (!key) return emptyVisibilityFilter()
      if (!this.byKey[key]) {
        const stored = readStoredFilter(key)
        if (stored && hasActiveVisibilityFilter(stored)) {
          this.byKey[key] = stored
        }
      }
      return this.byKey[key] ?? emptyVisibilityFilter()
    },

    setFilter(key: string | null, filter: FileVisibilityFilter): void {
      if (!key) return
      const normalized = normalizeFilter(filter)
      if (!hasActiveVisibilityFilter(normalized)) {
        delete this.byKey[key]
      } else {
        this.byKey[key] = normalized
      }
      writeStoredFilter(key, normalized)
    },

    addPattern(key: string | null, mode: 'include' | 'exclude', pattern: string): void {
      if (!key) return
      const current = this.getFilter(key)
      const next: FileVisibilityFilter = {
        include: mode === 'include' ? appendUniquePattern(current.include, pattern) : [...current.include],
        exclude: mode === 'exclude' ? appendUniquePattern(current.exclude, pattern) : [...current.exclude]
      }
      this.setFilter(key, next)
    },

    clearFilter(key: string | null): void {
      if (!key) return
      delete this.byKey[key]
      writeStoredFilter(key, emptyVisibilityFilter())
    },

    /** Copies Quick Connect filter rules to a newly promoted saved site if that site has no filter yet. */
    migrateConnectionFilter(fromKey: string, toKey: string): void {
      if (!fromKey || !toKey || fromKey === toKey) return
      const existingTarget = this.getFilter(toKey)
      if (hasActiveVisibilityFilter(existingTarget)) return
      const source = this.getFilter(fromKey)
      if (!hasActiveVisibilityFilter(source)) return
      this.setFilter(toKey, source)
    },

    clearEphemeralSession(sessionId: string): void {
      delete this.byKey[`session:${sessionId}`]
    }
  }
})
