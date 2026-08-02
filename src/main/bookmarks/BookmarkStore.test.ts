import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * `electron-store` is a real npm CJS package, externalized by vitest — its
 * own internal `require('electron')` call is NOT intercepted by
 * `vi.mock('electron', ...)` (confirmed empirically against AppSettingsStore:
 * it silently fell through to `env-paths` and wrote real, ever-growing JSON
 * files under `%APPDATA%\electron-store-nodejs\Config\`). So `electron-store`
 * itself is mocked here with a minimal in-memory implementation mirroring
 * the two methods `BookmarkStore.ts` actually uses (`get`/`set`), keyed by
 * the `name` option so a fresh `new BookmarkStore()` reads back whatever a
 * previous instance wrote — exercising the same persistence-round-trip
 * behavior without touching disk.
 */
const disks = new Map<string, Record<string, unknown>>()

vi.mock('electron-store', () => {
  class FakeStore {
    private readonly name: string
    constructor(opts: { name: string; defaults: Record<string, unknown> }) {
      this.name = opts.name
      if (!disks.has(this.name)) {
        disks.set(this.name, { ...opts.defaults })
      }
    }
    get(key: string): unknown {
      // Deep-clone on read/write, mirroring real electron-store/conf's
      // read-from-disk semantics — matters because BookmarkStore.create()/
      // delete()/deleteForSite() all read the array, mutate/rebuild it, then
      // `.set()` it back; a shared reference here would mask bugs a real
      // disk-backed store wouldn't.
      return JSON.parse(JSON.stringify(disks.get(this.name)![key]))
    }
    set(key: string, value: unknown): void {
      disks.get(this.name)![key] = JSON.parse(JSON.stringify(value))
    }
  }
  return { default: FakeStore }
})

const { BookmarkStore } = await import('./BookmarkStore')

describe('BookmarkStore', () => {
  beforeEach(() => {
    disks.clear()
  })

  it('starts empty', () => {
    expect(new BookmarkStore().list()).toEqual([])
  })

  it('creates a local bookmark with a generated id and timestamp, and no siteId even if one was supplied', () => {
    const store = new BookmarkStore()
    const bookmark = store.create({ scope: 'local', siteId: 'should-be-dropped', path: 'C:\\Users\\me', label: 'Home' })

    expect(bookmark.id).toEqual(expect.any(String))
    expect(bookmark.createdAt).toEqual(expect.any(String))
    expect(bookmark.scope).toBe('local')
    expect(bookmark.siteId).toBeUndefined()
    expect(bookmark.path).toBe('C:\\Users\\me')
    expect(bookmark.label).toBe('Home')
  })

  it('creates a remote bookmark and keeps its siteId', () => {
    const store = new BookmarkStore()
    const bookmark = store.create({ scope: 'remote', siteId: 'site-1', path: '/var/www', label: 'Web root' })
    expect(bookmark.siteId).toBe('site-1')
  })

  it('assigns distinct ids to successive bookmarks', () => {
    const store = new BookmarkStore()
    const a = store.create({ scope: 'local', path: '/a', label: 'A' })
    const b = store.create({ scope: 'local', path: '/b', label: 'B' })
    expect(a.id).not.toBe(b.id)
  })

  it('round-trips created bookmarks through a fresh instance (same underlying store)', () => {
    const store = new BookmarkStore()
    store.create({ scope: 'local', path: '/a', label: 'A' })
    store.create({ scope: 'remote', siteId: 'site-1', path: '/b', label: 'B' })

    const reloaded = new BookmarkStore().list()
    expect(reloaded).toHaveLength(2)
    expect(reloaded.map((b) => b.label).sort()).toEqual(['A', 'B'])
  })

  it('deletes a bookmark by id, leaving the others untouched', () => {
    const store = new BookmarkStore()
    const a = store.create({ scope: 'local', path: '/a', label: 'A' })
    const b = store.create({ scope: 'local', path: '/b', label: 'B' })

    store.delete(a.id)

    const remaining = store.list()
    expect(remaining).toHaveLength(1)
    expect(remaining[0].id).toBe(b.id)
  })

  it('deleting an unknown id is a no-op', () => {
    const store = new BookmarkStore()
    store.create({ scope: 'local', path: '/a', label: 'A' })
    store.delete('does-not-exist')
    expect(store.list()).toHaveLength(1)
  })

  it('deleteForSite removes only remote bookmarks for that site, leaving local and other sites bookmarks alone', () => {
    const store = new BookmarkStore()
    const local = store.create({ scope: 'local', path: '/a', label: 'Local' })
    store.create({ scope: 'remote', siteId: 'site-1', path: '/b', label: 'Site1 bookmark' })
    const otherSite = store.create({ scope: 'remote', siteId: 'site-2', path: '/c', label: 'Site2 bookmark' })

    store.deleteForSite('site-1')

    const remaining = store.list()
    expect(remaining.map((b) => b.id).sort()).toEqual([local.id, otherSite.id].sort())
  })
})
