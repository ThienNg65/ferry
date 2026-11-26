import { readFile, stat } from 'fs/promises'
import { host } from '../host/host'
import { handle } from './envelope'
import { requireNonEmptyString, validateSiteInput } from './validation'
import { INVOKE_CHANNELS, type ImportedSessionCandidate, type Site, type SiteInput } from '../../shared/contract'
import { SshError } from '../ssh/errors'
import { SiteStore } from '../sites/SiteStore'
import { scanImportCandidates } from '../sites/SessionImporter'
import { parseSitesBackup } from '../sites/sitesBackup'
import { AppSettingsStore } from '../app/AppSettingsStore'
import { BookmarkStore } from '../bookmarks/BookmarkStore'

/** Registers CRUD handlers for saved connection profiles. */
export function registerSitesHandlers(): void {
  handle<Site[]>(INVOKE_CHANNELS.sitesList, () => {
    return SiteStore.getInstance().list()
  })

  handle<Site>(INVOKE_CHANNELS.sitesCreate, (input) => {
    return SiteStore.getInstance().create(validateSiteInput(input, INVOKE_CHANNELS.sitesCreate))
  })

  handle<Site>(INVOKE_CHANNELS.sitesUpdate, (id, input) => {
    return SiteStore.getInstance().update(
      requireNonEmptyString(id, 'id', INVOKE_CHANNELS.sitesUpdate),
      validateSiteInput(input, INVOKE_CHANNELS.sitesUpdate)
    )
  })

  handle<void>(INVOKE_CHANNELS.sitesDelete, (id) => {
    const siteId = requireNonEmptyString(id, 'id', INVOKE_CHANNELS.sitesDelete)
    SiteStore.getInstance().delete(siteId)
    BookmarkStore.getInstance().deleteForSite(siteId)
    AppSettingsStore.getInstance().removeOpenTabSiteId(siteId)
  })

  handle<Site>(INVOKE_CHANNELS.sitesDuplicate, (id) => {
    return SiteStore.getInstance().duplicate(requireNonEmptyString(id, 'id', INVOKE_CHANNELS.sitesDuplicate))
  })

  handle<ImportedSessionCandidate[]>(INVOKE_CHANNELS.sitesImportScan, () => {
    return scanImportCandidates()
  })

  handle<string>(INVOKE_CHANNELS.sitesExport, () => {
    return SiteStore.getInstance().exportSites()
  })

  handle<{ imported: number; skipped: number } | null>(INVOKE_CHANNELS.sitesImportJson, async (filePathArg?: unknown) => {
    const filePath =
      typeof filePathArg === 'string' && filePathArg.length > 0
        ? filePathArg
        : await host().pickOpenFile({ filters: [{ name: 'Ferry sites backup', extensions: ['json'] }] })
    if (!filePath) {
      return null
    }
    const MAX_BACKUP_BYTES = 5 * 1024 * 1024
    const fileStats = await stat(filePath)
    if (fileStats.size > MAX_BACKUP_BYTES) {
      throw new SshError('VALIDATION', 'Sites backup file exceeds the 5 MB limit')
    }
    const incoming = parseSitesBackup(await readFile(filePath, 'utf-8'))
    const store = SiteStore.getInstance()
    const key = (host: string, port: number, username: string): string => `${host.toLowerCase()}:${port}:${username.toLowerCase()}`
    const existing = new Set(store.list().map((s) => key(s.host, s.port, s.username)))
    const toCreate: SiteInput[] = []
    for (const input of incoming) {
      const k = key(input.host, input.port, input.username)
      if (existing.has(k)) {
        continue
      }
      existing.add(k)
      toCreate.push(input)
    }
    const created = store.createMany(toCreate)
    return { imported: created.length, skipped: incoming.length - created.length }
  })
}
