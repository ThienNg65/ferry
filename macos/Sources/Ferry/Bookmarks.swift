import Foundation

/// Remembers user-selected files and folders across launches with app-scoped security-scoped
/// bookmarks. Access is opened in the parent process; the sidecar child inherits it.
final class BookmarkStore {
  private let file: URL
  private var entries: [String: Data] = [:]
  private var active: [String: URL] = [:]
  private let lock = NSLock()

  init(directory: URL) {
    file = directory.appendingPathComponent("fs-access.json")
    if let data = try? Data(contentsOf: file),
       let raw = try? JSONSerialization.jsonObject(with: data) as? [String: String] {
      for (path, b64) in raw { if let d = Data(base64Encoded: b64) { entries[path] = d } }
    }
  }

  /// Resolves every saved bookmark and starts access. Returns the paths that are usable again.
  @discardableResult
  func restoreAll() -> [String] {
    lock.lock(); defer { lock.unlock() }
    var restored: [String] = []
    var changed = false
    for (path, data) in entries {
      var stale = false
      guard let url = try? URL(resolvingBookmarkData: data, options: .withSecurityScope,
                               relativeTo: nil, bookmarkDataIsStale: &stale) else {
        entries[path] = nil; changed = true; continue
      }
      if url.startAccessingSecurityScopedResource() { active[url.path] = url; restored.append(url.path) }
      if stale, let fresh = try? url.bookmarkData(options: .withSecurityScope) { entries[path] = fresh; changed = true }
    }
    if changed { persist() }
    return restored
  }

  /// Call with a URL returned by an open or save panel: keeps access for this run and for later launches.
  func remember(_ url: URL) {
    lock.lock(); defer { lock.unlock() }
    let path = url.path
    if active[path] == nil, url.startAccessingSecurityScopedResource() { active[path] = url }
    if let data = try? url.bookmarkData(options: .withSecurityScope) {
      entries[path] = data
      persist()
    }
  }

  private func persist() {
    let raw = entries.mapValues { $0.base64EncodedString() }
    if let data = try? JSONSerialization.data(withJSONObject: raw) {
      try? data.write(to: file, options: .atomic)
    }
  }

  func stopAll() {
    lock.lock(); defer { lock.unlock() }
    for url in active.values { url.stopAccessingSecurityScopedResource() }
    active.removeAll()
  }
}
