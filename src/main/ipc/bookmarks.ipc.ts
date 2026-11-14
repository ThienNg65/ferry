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
    requireEnum(obj.side, ['local', 'remote'] as const, 'side', INVOKE_CHANNELS.bookmarksCreate)
    requireNonEmptyString(obj.label, 'label', INVOKE_CHANNELS.bookmarksCreate)
    requireNonEmptyString(obj.path, 'path', INVOKE_CHANNELS.bookmarksCreate)
    return BookmarkStore.getInstance().create(obj as unknown as BookmarkInput)
  })

  handle<void>(INVOKE_CHANNELS.bookmarksDelete, (id) => {
    BookmarkStore.getInstance().delete(requireNonEmptyString(id, 'id', INVOKE_CHANNELS.bookmarksDelete))
  })
}
