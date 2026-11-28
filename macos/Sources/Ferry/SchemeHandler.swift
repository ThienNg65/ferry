import Foundation
import WebKit

/// Serves the renderer bundle from `ferry://app/` so the page never loads from `file://`.
final class AppSchemeHandler: NSObject, WKURLSchemeHandler {
  private let root: URL
  init(root: URL) { self.root = root.standardizedFileURL }

  private static let mime: [String: String] = [
    "html": "text/html", "js": "text/javascript", "mjs": "text/javascript", "css": "text/css",
    "json": "application/json", "svg": "image/svg+xml", "png": "image/png", "jpg": "image/jpeg",
    "woff": "font/woff", "woff2": "font/woff2", "ttf": "font/ttf", "wasm": "application/wasm",
    "ico": "image/x-icon", "map": "application/json"
  ]

  func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
    guard let url = task.request.url else { task.didFailWithError(URLError(.badURL)); return }
    var path = url.path
    if path.isEmpty || path == "/" { path = "/index.html" }
    let file = root.appendingPathComponent(String(path.dropFirst())).standardizedFileURL
    guard file.path.hasPrefix(root.path + "/"), let data = try? Data(contentsOf: file) else {
      let response = HTTPURLResponse(url: url, statusCode: 404, httpVersion: nil, headerFields: nil)!
      task.didReceive(response); task.didFinish(); return
    }
    let type = Self.mime[file.pathExtension.lowercased()] ?? "application/octet-stream"
    let response = HTTPURLResponse(
      url: url, statusCode: 200, httpVersion: nil,
      headerFields: ["Content-Type": type, "Content-Length": String(data.count)])!
    task.didReceive(response); task.didReceive(data); task.didFinish()
  }

  func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {}
}
