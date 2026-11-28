import { readFile, stat, writeFile } from 'fs/promises'
import { host } from '../host/host'
import { handle } from './envelope'
import { optionalString, requireNonEmptyString, requireObject, validateSiteInput } from './validation'
import { INVOKE_CHANNELS, type ExportSshConfigResult, type ImportedSessionCandidate, type Site, type SiteInput } from '../../shared/contract'
import { SshError } from '../ssh/errors'
import { SiteStore } from '../sites/SiteStore'
import { scanImportCandidates } from '../sites/SessionImporter'
import { parseSitesBackup } from '../sites/sitesBackup'
import { formatSitesAsSshConfig } from '../sites/sshConfigExporter'
import { decryptVaultPayload, encryptVaultPayload, type FerryVaultSnippet } from '../sites/vaultCrypto'
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

  handle<ImportedSessionCandidate[]>(INVOKE_CHANNELS.sitesImportScan, (sshConfigPath?: unknown) => {
    return scanImportCandidates(typeof sshConfigPath === 'string' && sshConfigPath.length > 0 ? sshConfigPath : undefined)
  })

  handle<string>(INVOKE_CHANNELS.sitesExport, () => {
    return SiteStore.getInstance().exportSites()
  })

  handle<ExportSshConfigResult>(INVOKE_CHANNELS.sitesExportSshConfig, (req?: unknown) => {
    const channel = INVOKE_CHANNELS.sitesExportSshConfig
    let siteIds: Set<string> | null = null
    let includeHeader = true

    if (req !== undefined && req !== null) {
      const obj = requireObject(req, channel)
      if (obj.siteIds !== undefined) {
        if (!Array.isArray(obj.siteIds)) {
          throw new SshError('VALIDATION', `${channel}: "siteIds" must be an array of site IDs`)
        }
        const ids = new Set<string>()
        for (const entry of obj.siteIds) {
          ids.add(requireNonEmptyString(entry, 'siteIds[]', channel))
        }
        siteIds = ids
      }
      if (obj.includeHeader !== undefined) {
        if (typeof obj.includeHeader !== 'boolean') {
          throw new SshError('VALIDATION', `${channel}: "includeHeader" must be a boolean`)
        }
        includeHeader = obj.includeHeader
      }
    }

    const allSites = SiteStore.getInstance().list()
    const targetSites = siteIds === null ? allSites : allSites.filter((s) => siteIds.has(s.id))
    return formatSitesAsSshConfig(targetSites, { includeHeader })
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

  handle<{ filePath: string; siteCount: number; snippetCount: number } | null>(
    INVOKE_CHANNELS.sitesExportVault,
    async (req) => {
      const channel = INVOKE_CHANNELS.sitesExportVault
      const obj = requireObject(req, channel)
      const passphrase = requireNonEmptyString(obj.passphrase, 'passphrase', channel)
      const filePath = requireNonEmptyString(obj.filePath, 'filePath', channel)

      const store = SiteStore.getInstance()
      const sites: SiteInput[] = store.list().map((site) => {
        const secrets = store.getDecryptedSecrets(site.id)
        const jumpHosts = store.getDecryptedJumpHosts(site.id)
        const proxy = store.getDecryptedProxy(site.id)
        return {
          name: site.name,
          host: site.host,
          port: site.port,
          username: site.username,
          authMethod: site.authMethod,
          privateKeyPath: site.privateKeyPath,
          agentPath: site.agentPath,
          remoteInitialPath: site.remoteInitialPath,
          localInitialPath: site.localInitialPath,
          group: site.group,
          environment: site.environment,
          proxyMode: site.proxyMode,
          ...(secrets.password ? { password: secrets.password } : {}),
          ...(secrets.passphrase ? { passphrase: secrets.passphrase } : {}),
          ...(jumpHosts.length > 0 ? { jumpHosts } : {}),
          ...(site.proxyMode === 'custom' && proxy ? { proxy } : {})
        }
      })

      const customSnippets: FerryVaultSnippet[] = Array.isArray(obj.customSnippets)
        ? (obj.customSnippets as FerryVaultSnippet[]).slice(0, 100)
        : []
      const encrypted = await encryptVaultPayload(
        { exportedAt: new Date().toISOString(), sites, customSnippets },
        passphrase
      )
      await writeFile(filePath, encrypted, { encoding: 'utf8', mode: 0o600 })
      return { filePath, siteCount: sites.length, snippetCount: customSnippets.length }
    }
  )

  handle<{ imported: number; skipped: number; customSnippets: FerryVaultSnippet[] } | null>(
    INVOKE_CHANNELS.sitesImportVault,
    async (req) => {
      const channel = INVOKE_CHANNELS.sitesImportVault
      const obj = requireObject(req, channel)
      const passphrase = requireNonEmptyString(obj.passphrase, 'passphrase', channel)
      const explicitPath = optionalString(obj.filePath, 'filePath', channel)
      const filePath =
        explicitPath ||
        (await host().pickOpenFile({
          filters: [{ name: 'Ferry Encrypted Vault', extensions: ['ferryvault'] }]
        }))
      if (!filePath) return null

      const MAX_VAULT_BYTES = 10 * 1024 * 1024
      const fileStats = await stat(filePath)
      if (fileStats.size > MAX_VAULT_BYTES) {
        throw new SshError('VALIDATION', 'Vault file exceeds the 10 MB limit')
      }
      const payload = await decryptVaultPayload(await readFile(filePath, 'utf8'), passphrase)
      const store = SiteStore.getInstance()
      const key = (h: string, p: number, u: string): string => `${h.toLowerCase()}:${p}:${u.toLowerCase()}`
      const existing = new Set(store.list().map((s) => key(s.host, s.port, s.username)))
      const toCreate: SiteInput[] = []
      for (const input of payload.sites) {
        const k = key(input.host, input.port, input.username)
        if (existing.has(k)) continue
        existing.add(k)
        toCreate.push(input)
      }
      const created = store.createMany(toCreate)
      return {
        imported: created.length,
        skipped: payload.sites.length - created.length,
        customSnippets: payload.customSnippets ?? []
      }
    }
  )
}
