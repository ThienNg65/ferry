import Store from 'electron-store'
import { randomUUID } from 'crypto'
import type { Bookmark, BookmarkInput } from '../../shared/contract'

interface StoreSchema {
  bookmarks: Bookmark[]
}

/** Persists directory bookmarks to `bookmarks.json` under the OS userData directory — no secrets involved, so unlike SiteStore there's nothing to encrypt. */
export class BookmarkStore {
  private static instance: BookmarkStore | null = null
  private readonly store = new Store<StoreSchema>({ name: 'bookmarks', defaults: { bookmarks: [] } })

  static getInstance(): BookmarkStore {
    if (BookmarkStore.instance === null) {
      BookmarkStore.instance = new BookmarkStore()
    }
    return BookmarkStore.instance
  }

  list(): Bookmark[] {
    return this.store.get('bookmarks')
  }

  create(input: BookmarkInput): Bookmark {
    const bookmark: Bookmark = {
      id: randomUUID(),
      scope: input.scope,
      siteId: input.scope === 'remote' ? input.siteId : undefined,
      path: input.path,
      label: input.label,
      createdAt: new Date().toISOString()
    }
    const bookmarks = this.store.get('bookmarks')
    bookmarks.push(bookmark)
    this.store.set('bookmarks', bookmarks)
    return bookmark
  }

  delete(id: string): void {
    const bookmarks = this.store.get('bookmarks').filter((b) => b.id !== id)
    this.store.set('bookmarks', bookmarks)
  }

  /** Removes every remote bookmark belonging to a site, called when that site itself is deleted so bookmarks never outlive their site. */
  deleteForSite(siteId: string): void {
    const bookmarks = this.store.get('bookmarks').filter((b) => b.siteId !== siteId)
    this.store.set('bookmarks', bookmarks)
  }
}
