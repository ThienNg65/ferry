import { dialog, BrowserWindow } from 'electron'
import { readFile } from 'fs/promises'
import { handle } from './envelope'
import { INVOKE_CHANNELS, type ImportedSessionCandidate, type Site, type SiteInput } from '../../shared/contract'
import { SiteStore } from '../sites/SiteStore'
import { scanImportCandidates } from '../sites/SessionImporter'
import { parseSitesBackup } from '../sites/sitesBackup'
import { BookmarkStore } from '../bookmarks/BookmarkStore'

/** Registers CRUD handlers for saved connection profiles. */
export function registerSitesHandlers(): void {
  handle<Site[]>(INVOKE_CHANNELS.sitesList, () => {
    return SiteStore.getInstance().list()
  })

  handle<Site>(INVOKE_CHANNELS.sitesCreate, (input) => {
    return SiteStore.getInstance().create(input as SiteInput)
  })

  handle<Site>(INVOKE_CHANNELS.sitesUpdate, (id, input) => {
    return SiteStore.getInstance().update(id as string, input as SiteInput)
  })

  handle<void>(INVOKE_CHANNELS.sitesDelete, (id) => {
    SiteStore.getInstance().delete(id as string)
    BookmarkStore.getInstance().deleteForSite(id as string)
  })

  handle<Site>(INVOKE_CHANNELS.sitesDuplicate, (id) => {
    return SiteStore.getInstance().duplicate(id as string)
  })

  handle<ImportedSessionCandidate[]>(INVOKE_CHANNELS.sitesImportScan, () => {
    return scanImportCandidates()
  })

  handle<string>(INVOKE_CHANNELS.sitesExport, () => {
    return SiteStore.getInstance().exportSites()
  })

  handle<{ imported: number; skipped: number } | null>(INVOKE_CHANNELS.sitesImportJson, async () => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    const options = { properties: ['openFile' as const], filters: [{ name: 'Ferry sites backup', extensions: ['json'] }] }
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    if (result.canceled || result.filePaths.length === 0) {
      return null
    }
    const incoming = parseSitesBackup(await readFile(result.filePaths[0], 'utf-8'))
    const store = SiteStore.getInstance()
    const key = (host: string, port: number, username: string): string => `${host.toLowerCase()}:${port}:${username.toLowerCase()}`
    const existing = new Set(store.list().map((s) => key(s.host, s.port, s.username)))
    let imported = 0
    for (const input of incoming) {
      const k = key(input.host, input.port, input.username)
      if (existing.has(k)) {
        continue
      }
      store.create(input)
      existing.add(k)
      imported += 1
    }
    return { imported, skipped: incoming.length - imported }
  })
}
