import { defineStore } from 'pinia'
import { INVOKE_CHANNELS } from '@shared/contract'
import type { ImportedSessionCandidate, Site, SiteInput } from '@shared/contract'
import { invoke } from '../api'

/** Defaults the site name to the hostname when the user leaves it blank. */
function withNameFallback(input: SiteInput): SiteInput {
  const name = input.name.trim()
  return name ? input : { ...input, name: input.host }
}

interface SitesState {
  sites: Site[]
  loading: boolean
  error: string | null
  inFlightFetch: Promise<void> | null
}

export const useSitesStore = defineStore('sites', {
  state: (): SitesState => ({
    sites: [],
    loading: false,
    error: null,
    inFlightFetch: null
  }),

  getters: {
    /** Distinct group names in use, sorted — feeds the "Group" field's datalist suggestions. */
    groupNames(state): string[] {
      const names = new Set<string>()
      for (const site of state.sites) {
        if (site.group) {
          names.add(site.group)
        }
      }
      return Array.from(names).sort((a, b) => a.localeCompare(b))
    }
  },

  actions: {
    async fetchSites(force = false): Promise<void> {
      if (this.inFlightFetch) {
        if (!force) {
          return this.inFlightFetch
        }
        await this.inFlightFetch.catch(() => {})
      }
      this.loading = true
      this.error = null
      this.inFlightFetch = (async () => {
        try {
          this.sites = await invoke<Site[]>(INVOKE_CHANNELS.sitesList)
        } catch (e) {
          this.error = e instanceof Error ? e.message : String(e)
        } finally {
          this.loading = false
          this.inFlightFetch = null
        }
      })()
      return this.inFlightFetch
    },

    async createSite(input: SiteInput): Promise<Site> {
      const site = await invoke<Site>(INVOKE_CHANNELS.sitesCreate, withNameFallback(input))
      await this.fetchSites(true)
      return site
    },

    /** Same as {@link createSite} but skips the refetch — for batch imports that refetch once at the end. */
    async createSiteWithoutRefetch(input: SiteInput): Promise<void> {
      await invoke<Site>(INVOKE_CHANNELS.sitesCreate, withNameFallback(input))
    },

    async updateSite(id: string, input: SiteInput): Promise<Site> {
      const site = await invoke<Site>(INVOKE_CHANNELS.sitesUpdate, id, withNameFallback(input))
      await this.fetchSites(true)
      return site
    },

    async deleteSite(id: string): Promise<void> {
      await invoke<void>(INVOKE_CHANNELS.sitesDelete, id)
      this.sites = this.sites.filter((s) => s.id !== id)
    },

    /** Deletes multiple sites (e.g. cleaning up duplicate imports) in parallel — independent deletes, no shared state between them. */
    async deleteSites(ids: string[]): Promise<void> {
      const results = await Promise.allSettled(ids.map((id) => invoke<void>(INVOKE_CHANNELS.sitesDelete, id)))
      const removed = new Set<string>()
      let firstError: unknown = null
      results.forEach((res, idx) => {
        if (res.status === 'fulfilled') {
          removed.add(ids[idx])
        } else if (firstError === null) {
          firstError = res.reason
        }
      })
      if (removed.size > 0) {
        this.sites = this.sites.filter((s) => !removed.has(s.id))
      }
      if (firstError !== null) {
        throw firstError
      }
    },

    async duplicateSite(id: string): Promise<void> {
      await invoke<Site>(INVOKE_CHANNELS.sitesDuplicate, id)
      await this.fetchSites(true)
    },

    /** Scans WinSCP/PuTTY's saved sessions (Windows only) — read-only, does not create anything. */
    async scanImportCandidates(sshConfigPath?: string): Promise<ImportedSessionCandidate[]> {
      return invoke<ImportedSessionCandidate[]>(INVOKE_CHANNELS.sitesImportScan, sshConfigPath)
    }
  }
})
