import Conf from 'conf'
import { randomUUID } from 'crypto'
import { host } from '../host/host'
import type { Bookmark, BookmarkInput } from '../../shared/contract'

interface StoreSchema {
  bookmarks: Bookmark[]
}

/** Persists directory bookmarks to `bookmarks.json` under the OS userData directory — no secrets involved, so unlike SiteStore there's nothing to encrypt. */
export class BookmarkStore {
  private static instance: BookmarkStore | null = null
  private _store: Conf<StoreSchema> | null = null

  private get store(): Conf<StoreSchema> {
    if (!this._store) {
      this._store = new Conf<StoreSchema>({
        cwd: host().dataDir,
        configName: 'bookmarks',
        defaults: { bookmarks: [] }
      })
    }
    return this._store
  }

  static getInstance(): BookmarkStore {
    if (BookmarkStore.instance === null) {
      BookmarkStore.instance = new BookmarkStore()
    }
    return BookmarkStore.instance
  }

  list(): Bookmark[] {
    const stored = this.store.get('bookmarks')
    return Array.isArray(stored) ? stored : []
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
    const bookmarks = this.list()
    bookmarks.push(bookmark)
    this.store.set('bookmarks', bookmarks)
    return bookmark
  }

  copyEndpointToSite(endpoint: string, siteId: string): Bookmark[] {
    const bookmarks = this.list()
    const paths = new Set(bookmarks.filter((item) => item.scope === 'remote' && item.siteId === siteId).map((item) => item.path))
    const added: Bookmark[] = []
    for (const item of bookmarks) {
      if (item.scope !== 'remote' || item.siteId !== endpoint || paths.has(item.path)) continue
      added.push({ ...item, id: randomUUID(), siteId })
      paths.add(item.path)
    }
    if (added.length > 0) this.store.set('bookmarks', [...bookmarks, ...added])
    return added
  }

  delete(id: string): void {
    const bookmarks = this.list().filter((b) => b.id !== id)
    this.store.set('bookmarks', bookmarks)
  }

  /** Removes every remote bookmark belonging to a site, called when that site itself is deleted so bookmarks never outlive their site. */
  deleteForSite(siteId: string): void {
    const bookmarks = this.store.get('bookmarks').filter((b) => b.siteId !== siteId)
    this.store.set('bookmarks', bookmarks)
  }

  clear(): void {
    this.store.set('bookmarks', [])
  }
}
