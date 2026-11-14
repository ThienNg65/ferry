import { defineStore } from 'pinia'
import { INVOKE_CHANNELS } from '@shared/contract'
import type { Bookmark, BookmarkInput } from '@shared/contract'
import { invoke } from '../api'

interface BookmarksState {
  bookmarks: Bookmark[]
  loaded: boolean
  inFlightFetch: Promise<void> | null
}

export const useBookmarksStore = defineStore('bookmarks', {
  state: (): BookmarksState => ({
    bookmarks: [],
    loaded: false,
    inFlightFetch: null
  }),

  getters: {
    localBookmarks(state): Bookmark[] {
      return state.bookmarks.filter((b) => b.scope === 'local')
    },
    /** Remote bookmarks belonging to a specific saved site — quick-connect sessions have no siteId, so they never match. */
    forSite(state): (siteId: string) => Bookmark[] {
      return (siteId: string) => state.bookmarks.filter((b) => b.scope === 'remote' && b.siteId === siteId)
    }
  },

  actions: {
    async fetch(): Promise<void> {
      if (this.inFlightFetch) {
        return this.inFlightFetch
      }
      this.inFlightFetch = (async () => {
        try {
          this.bookmarks = await invoke<Bookmark[]>(INVOKE_CHANNELS.bookmarksList)
          this.loaded = true
        } finally {
          this.inFlightFetch = null
        }
      })()
      return this.inFlightFetch
    },

    async ensureLoaded(): Promise<void> {
      if (!this.loaded) {
        await this.fetch()
      }
    },

    async create(input: BookmarkInput): Promise<void> {
      const bookmark = await invoke<Bookmark>(INVOKE_CHANNELS.bookmarksCreate, input)
      this.bookmarks.push(bookmark)
    },

    async remove(id: string): Promise<void> {
      await invoke<void>(INVOKE_CHANNELS.bookmarksDelete, id)
      this.bookmarks = this.bookmarks.filter((b) => b.id !== id)
    },

    reset(): void {
      this.bookmarks = []
      this.loaded = false
    }
  }
})
