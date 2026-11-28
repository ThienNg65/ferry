import Cocoa
import WebKit

/// Finder drops reach the page as File objects without host paths. This subclass reads the dragged
/// file URLs from the pasteboard so the page can resolve a dropped File to its path, and keeps
/// security-scoped access to everything dropped so the sidecar can read it.
final class DropWebView: WKWebView {
  var bookmarks: BookmarkStore?

  private func fileURLs(_ sender: NSDraggingInfo) -> [URL] {
    let options: [NSPasteboard.ReadingOptionKey: Any] = [.urlReadingFileURLsOnly: true]
    return (sender.draggingPasteboard.readObjects(forClasses: [NSURL.self], options: options) as? [URL]) ?? []
  }

  override func draggingEntered(_ sender: NSDraggingInfo) -> NSDragOperation {
    let items: [[String: Any]] = fileURLs(sender).map { url in
      let values = try? url.resourceValues(forKeys: [.fileSizeKey, .contentModificationDateKey, .isDirectoryKey])
      return [
        "name": url.lastPathComponent,
        "path": url.path,
        "size": values?.fileSize ?? -1,
        "mtime": Int(((values?.contentModificationDate ?? .distantPast).timeIntervalSince1970 * 1000).rounded()),
        "isDir": values?.isDirectory ?? false
      ]
    }
    if let data = try? JSONSerialization.data(withJSONObject: items), let json = String(data: data, encoding: .utf8) {
      evaluateJavaScript("window.__ferryNative && window.__ferryNative.setDropFiles(\(json))", completionHandler: nil)
    }
    return super.draggingEntered(sender)
  }

  override func performDragOperation(_ sender: NSDraggingInfo) -> Bool {
    for url in fileURLs(sender) { bookmarks?.remember(url) }
    return super.performDragOperation(sender)
  }
}
