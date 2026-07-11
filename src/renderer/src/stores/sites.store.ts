import { defineStore } from 'pinia'
import { INVOKE_CHANNELS } from '@shared/contract'
import type { Site, SiteInput } from '@shared/contract'
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

    async updateSite(id: string, input: SiteInput): Promise<void> {
      await invoke<Site>(INVOKE_CHANNELS.sitesUpdate, id, withNameFallback(input))
      await this.fetchSites()
    },

    async deleteSite(id: string): Promise<void> {
      await invoke<void>(INVOKE_CHANNELS.sitesDelete, id)
      this.sites = this.sites.filter((s) => s.id !== id)
    }
  }
})
