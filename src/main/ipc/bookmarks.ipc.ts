import { handle } from './envelope'
import { requireEnum, requireNonEmptyString, requireObject } from './validation'
import { INVOKE_CHANNELS, type Bookmark, type BookmarkInput } from '../../shared/contract'
import { BookmarkStore } from '../bookmarks/BookmarkStore'

/** Registers CRUD handlers for directory bookmarks. */
export function registerBookmarksHandlers(): void {
  handle<Bookmark[]>(INVOKE_CHANNELS.bookmarksList, () => {
    return BookmarkStore.getInstance().list()
  })

  handle<Bookmark>(INVOKE_CHANNELS.bookmarksCreate, (input) => {
    const obj = requireObject(input, INVOKE_CHANNELS.bookmarksCreate)
    const scope = requireEnum(obj.scope ?? obj.side, ['local', 'remote'] as const, 'scope', INVOKE_CHANNELS.bookmarksCreate)
    const label = requireNonEmptyString(obj.label, 'label', INVOKE_CHANNELS.bookmarksCreate)
    const path = requireNonEmptyString(obj.path, 'path', INVOKE_CHANNELS.bookmarksCreate)
    const normalized: BookmarkInput = {
      scope,
      label,
      path,
      ...(typeof obj.siteId === 'string' && obj.siteId.trim() ? { siteId: obj.siteId.trim() } : {})
    }
    return BookmarkStore.getInstance().create(normalized)
  })

  handle<void>(INVOKE_CHANNELS.bookmarksDelete, (id) => {
    BookmarkStore.getInstance().delete(requireNonEmptyString(id, 'id', INVOKE_CHANNELS.bookmarksDelete))
  })
}
