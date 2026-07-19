import { handle } from './envelope'
import { INVOKE_CHANNELS, type Bookmark, type BookmarkInput } from '../../shared/contract'
import { BookmarkStore } from '../bookmarks/BookmarkStore'

/** Registers CRUD handlers for directory bookmarks. */
export function registerBookmarksHandlers(): void {
  handle<Bookmark[]>(INVOKE_CHANNELS.bookmarksList, () => {
    return BookmarkStore.getInstance().list()
  })

  handle<Bookmark>(INVOKE_CHANNELS.bookmarksCreate, (input) => {
    return BookmarkStore.getInstance().create(input as BookmarkInput)
  })

  handle<void>(INVOKE_CHANNELS.bookmarksDelete, (id) => {
    BookmarkStore.getInstance().delete(id as string)
  })
}
