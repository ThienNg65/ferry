import Conf from 'conf'
import { copyFileSync, existsSync } from 'fs'
import * as path from 'path'
import { logAppEvent } from './appLog'

export interface SafeConfOptions<T extends Record<string, unknown>> {
  cwd: string
  configName: string
  defaults: T
  schemaVersion?: number
  migrate?: (store: Conf<T>, fromVersion: number) => void
}

/**
 * Opens a `Conf` store, logging corrupt JSON failures without modifying the
 * original file on disk, and running versioned migrations with a pre-migration
 * `.bak.json` snapshot.
 */
export function openSafeConf<T extends Record<string, unknown>>(opts: SafeConfOptions<T>): Conf<T> {
  const filePath = path.join(opts.cwd, `${opts.configName}.json`)
  const existedBeforeOpen = existsSync(filePath)
  // Strip schemaVersion from Conf defaults so Conf doesn't stamp it onto legacy
  // files before we inspect the on-disk version and run migrations.
  const { schemaVersion: _ignored, ...confDefaults } = opts.defaults as Record<string, unknown>
  let store: Conf<T>
  try {
    store = new Conf<T>({ cwd: opts.cwd, configName: opts.configName, defaults: confDefaults as T })
  } catch (err) {
    logAppEvent('error', 'store.corrupt_json', {
      configName: opts.configName,
      filePath,
      message: err instanceof Error ? err.message : String(err)
    })
    throw err
  }

  if (opts.schemaVersion !== undefined) {
    if (!existedBeforeOpen) {
      store.set('schemaVersion' as keyof T, opts.schemaVersion as T[keyof T])
    } else {
      let rawVersion: unknown
      try {
        rawVersion = store.get('schemaVersion' as keyof T)
      } catch {
        rawVersion = undefined
      }
      const fromVersion = typeof rawVersion === 'number' && Number.isInteger(rawVersion) ? rawVersion : 0
      if (fromVersion < opts.schemaVersion) {
        const bakPath = path.join(opts.cwd, `${opts.configName}.v${fromVersion}.bak.json`)
        try {
          copyFileSync(filePath, bakPath)
        } catch (err) {
          logAppEvent('warn', 'store.migration_backup_failed', {
            configName: opts.configName,
            message: err instanceof Error ? err.message : String(err)
          })
        }
        opts.migrate?.(store, fromVersion)
        store.set('schemaVersion' as keyof T, opts.schemaVersion as T[keyof T])
      }
    }
  }

  return store
}
