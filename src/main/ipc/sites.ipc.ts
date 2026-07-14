import { handle } from './envelope'
import { INVOKE_CHANNELS, type ImportedSessionCandidate, type Site, type SiteInput } from '../../shared/contract'
import { SiteStore } from '../sites/SiteStore'
import { scanImportCandidates } from '../sites/SessionImporter'

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
  })

  handle<Site>(INVOKE_CHANNELS.sitesDuplicate, (id) => {
    return SiteStore.getInstance().duplicate(id as string)
  })

  handle<ImportedSessionCandidate[]>(INVOKE_CHANNELS.sitesImportScan, () => {
    return scanImportCandidates()
  })
}
