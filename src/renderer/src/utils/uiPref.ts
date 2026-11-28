import { INVOKE_CHANNELS } from '@shared/contract'
import { invoke } from '../api'

export const MAX_UI_PREF_LENGTH = 4096

export function readStored(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

const dirtyUiPrefs = new Set<string>()

export function isDirtyUiPref(key: string): boolean {
  return dirtyUiPrefs.has(key)
}

export function clearDirtyUiPrefs(): void {
  dirtyUiPrefs.clear()
}

export function writeStored(key: string, value: string): void {
  dirtyUiPrefs.add(key)
  try {
    localStorage.setItem(key, value)
  } catch {}
  if (typeof window !== 'undefined' && window.api) {
    void invoke<void>(INVOKE_CHANNELS.settingsSetUiPref, { key, value }).catch(() => {})
  }
}

export function migrateLegacyPref(legacyKey: string, key: string): void {
  const legacy = readStored(legacyKey)
  if (legacy === null) return
  if (readStored(key) === null) writeStored(key, legacy)
  try {
    localStorage.removeItem(legacyKey)
  } catch {
    return
  }
}
