import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * `conf` is mocked here with a minimal in-memory implementation mirroring the
 * two methods `BookmarkStore.ts` actually uses (`get`/`set`), keyed by the
 * `configName` option so a fresh `new BookmarkStore()` reads back whatever a
 * previous instance wrote without touching disk.
 */
const disks = new Map<string, Record<string, unknown>>()

vi.mock('conf', () => {
  class FakeConf {
    private readonly name: string
    constructor(opts: { configName: string; defaults: Record<string, unknown> }) {
      this.name = opts.configName
      if (!disks.has(this.name)) {
        disks.set(this.name, { ...opts.defaults })
      }
    }
    get(key: string): unknown {
      // Deep-clone on read/write, mirroring real conf's
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
  return { default: FakeConf }
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

  it('copies only the exact endpoint and preserves existing site bookmarks on repeated promotion', () => {
    const store = BookmarkStore.getInstance()
    const endpoint = 'host:v2:ops@logs.example.com:2222'
    store.create({ scope: 'remote', siteId: endpoint, path: '/logs', label: 'Logs' })
    store.create({ scope: 'remote', siteId: endpoint, path: '/shared', label: 'Shared' })
    store.create({ scope: 'remote', siteId: 'host:v2:ops@logs.example.com:22', path: '/other', label: 'Other' })
    store.create({ scope: 'remote', siteId: 'saved', path: '/shared', label: 'Existing' })

    expect(store.copyEndpointToSite(endpoint, 'saved').map((item) => item.path)).toEqual(['/logs'])
    expect(store.copyEndpointToSite(endpoint, 'saved')).toEqual([])
    expect(store.list().filter((item) => item.siteId === 'saved').map((item) => item.label)).toEqual(['Existing', 'Logs'])
    expect(store.list().filter((item) => item.siteId === endpoint)).toHaveLength(2)
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
