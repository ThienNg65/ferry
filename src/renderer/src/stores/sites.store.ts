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
}

export const useSitesStore = defineStore('sites', {
  state: (): SitesState => ({
    sites: [],
    loading: false
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
    async fetchSites(): Promise<void> {
      this.loading = true
      try {
        this.sites = await invoke<Site[]>(INVOKE_CHANNELS.sitesList)
      } finally {
        this.loading = false
      }
    },

    async createSite(input: SiteInput): Promise<void> {
      await invoke<Site>(INVOKE_CHANNELS.sitesCreate, withNameFallback(input))
      await this.fetchSites()
    },

    /** Same as {@link createSite} but skips the refetch — for batch imports that refetch once at the end. */
    async createSiteWithoutRefetch(input: SiteInput): Promise<void> {
      await invoke<Site>(INVOKE_CHANNELS.sitesCreate, withNameFallback(input))
    },

    async updateSite(id: string, input: SiteInput): Promise<void> {
      await invoke<Site>(INVOKE_CHANNELS.sitesUpdate, id, withNameFallback(input))
      await this.fetchSites()
    },

    async deleteSite(id: string): Promise<void> {
      await invoke<void>(INVOKE_CHANNELS.sitesDelete, id)
      this.sites = this.sites.filter((s) => s.id !== id)
    },

    /** Deletes multiple sites (e.g. cleaning up duplicate imports) in parallel — independent deletes, no shared state between them. */
    async deleteSites(ids: string[]): Promise<void> {
      await Promise.all(ids.map((id) => invoke<void>(INVOKE_CHANNELS.sitesDelete, id)))
      const removed = new Set(ids)
      this.sites = this.sites.filter((s) => !removed.has(s.id))
    },

    async duplicateSite(id: string): Promise<void> {
      await invoke<Site>(INVOKE_CHANNELS.sitesDuplicate, id)
      await this.fetchSites()
    },

    /** Scans WinSCP/PuTTY's saved sessions (Windows only) — read-only, does not create anything. */
    async scanImportCandidates(): Promise<ImportedSessionCandidate[]> {
      return invoke<ImportedSessionCandidate[]>(INVOKE_CHANNELS.sitesImportScan)
    }
  }
})
