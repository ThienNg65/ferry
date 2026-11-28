import Cocoa
import WebKit

/// Answers the renderer's native calls (window, dialogs, clipboard) and relays sidecar traffic.
final class Bridge: NSObject, WKScriptMessageHandler {
  weak var webView: WKWebView?
  weak var window: NSWindow?
  let sidecar: Sidecar
  let bookmarks: BookmarkStore

  init(sidecar: Sidecar, bookmarks: BookmarkStore) {
    self.sidecar = sidecar
    self.bookmarks = bookmarks
    super.init()
    sidecar.onMessage = { [weak self] object, line in self?.forward(object, line) }
  }

  // MARK: sidecar -> renderer

  private func forward(_ object: [String: Any], _ line: Data) {
    if object["id"] != nil, object["result"] != nil {
      emit("rpc_reply", json: line)
    } else if let channel = object["event"] as? String {
      let detail: [String: Any] = ["channel": channel, "payload": object["payload"] ?? NSNull()]
      if let data = try? JSONSerialization.data(withJSONObject: detail) { emit("rpc_event", json: data) }
    }
  }

  func emit(_ event: String, json: Data) {
    let body = String(data: json, encoding: .utf8) ?? "null"
    webView?.evaluateJavaScript("window.__ferryNative&&window.__ferryNative.emit(\(literal(event)),\(body))", completionHandler: nil)
  }

  private func literal(_ s: String) -> String {
    let data = try? JSONSerialization.data(withJSONObject: [s])
    let text = data.flatMap { String(data: $0, encoding: .utf8) } ?? "[\"\"]"
    return String(text.dropFirst().dropLast())
  }

  // MARK: renderer -> native

  func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
    guard let body = message.body as? [String: Any],
          let id = body["id"] as? Int, let op = body["op"] as? String else { return }
    let args = body["args"] as? [String: Any] ?? [:]
    handle(op, args) { [weak self] result, error in self?.reply(id, result, error) }
  }

  private func reply(_ id: Int, _ result: Any?, _ error: String?) {
    let payload: Any = result ?? NSNull()
    let json = (try? JSONSerialization.data(withJSONObject: [payload], options: [])).flatMap { String(data: $0, encoding: .utf8) } ?? "[null]"
    let value = String(json.dropFirst().dropLast())
    let err = error.map { literal($0) } ?? "undefined"
    webView?.evaluateJavaScript("window.__ferryNative&&window.__ferryNative.reply(\(id),\(value),\(err))", completionHandler: nil)
  }

  private func handle(_ op: String, _ args: [String: Any], _ done: @escaping (Any?, String?) -> Void) {
    let win = window
    switch op {
    case "init":
      done(nil, nil)
      DispatchQueue.main.async { [weak self] in self?.emit("sidecar:ready", json: Data("{}".utf8)) }
    case "stats":
      done(["loaded": ["js.ferry.sidecar"], "connected": sidecar.isRunning ? ["js.ferry.sidecar"] : []], nil)
    case "sidecar":
      guard let event = args["event"] as? String else { return done(nil, "bad event") }
      let data = args["data"] as? [String: Any] ?? [:]
      if event == "rpc_invoke", let rid = data["id"] {
        sidecar.send(["id": rid, "channel": data["channel"] ?? "", "args": data["args"] ?? []])
      } else if event == "rpc_send" {
        sidecar.send(["type": "send", "channel": data["channel"] ?? "", "payload": data["payload"] ?? NSNull()])
      }
      done(nil, nil)
    case "window.minimize": win?.miniaturize(nil); done(nil, nil)
    case "window.isMinimized": done(win?.isMiniaturized ?? false, nil)
    case "window.maximize": if win?.isZoomed == false { win?.zoom(nil) }; done(nil, nil)
    case "window.unmaximize": if win?.isZoomed == true { win?.zoom(nil) }; done(nil, nil)
    case "window.isMaximized": done(win?.isZoomed ?? false, nil)
    case "window.setFullScreen": if win?.styleMask.contains(.fullScreen) == false { win?.toggleFullScreen(nil) }; done(nil, nil)
    case "window.exitFullScreen": if win?.styleMask.contains(.fullScreen) == true { win?.toggleFullScreen(nil) }; done(nil, nil)
    case "window.isFullScreen": done(win?.styleMask.contains(.fullScreen) ?? false, nil)
    case "window.show": win?.makeKeyAndOrderFront(nil); NSApp.activate(ignoringOtherApps: true); done(nil, nil)
    case "window.setTitle": win?.title = (args["title"] as? String) ?? "Ferry"; done(nil, nil)
    case "window.getPosition":
      let f = win?.frame ?? .zero
      done(["x": Int(f.origin.x), "y": Int(f.origin.y)], nil)
    case "window.getSize":
      let f = win?.frame ?? .zero
      done(["width": Int(f.width), "height": Int(f.height)], nil)
    case "window.setSize":
      if var f = win?.frame {
        if let w = args["width"] as? Double { f.size.width = w }
        if let h = args["height"] as? Double { f.size.height = h }
        win?.setFrame(f, display: true)
      }
      done(nil, nil)
    case "window.move":
      if let x = args["x"] as? Double, let y = args["y"] as? Double { win?.setFrameOrigin(NSPoint(x: x, y: y)) }
      done(nil, nil)
    case "app.exit": NSApp.terminate(nil); done(nil, nil)
    case "dialog.open": Dialogs.open(args, folders: false, window: win, store: bookmarks) { done($0, nil) }
    case "dialog.folder": Dialogs.open(args, folders: true, window: win, store: bookmarks) { done($0.first ?? "", nil) }
    case "dialog.save": Dialogs.save(args, window: win, store: bookmarks) { done($0, nil) }
    case "clipboard.readText": done(NSPasteboard.general.string(forType: .string) ?? "", nil)
    case "openExternal":
      guard let rawURL = args["url"] as? String,
            let components = URLComponents(string: rawURL),
            components.scheme?.lowercased() == "https",
            let host = components.host, !host.isEmpty,
            let url = components.url else {
        done(nil, "Only absolute HTTPS URLs can be opened")
        return
      }
      guard NSWorkspace.shared.open(url) else {
        done(nil, "Could not open the external URL")
        return
      }
      done(nil, nil)
    case "path.get":
      let dir = FileManager.default.urls(for: .downloadsDirectory, in: .userDomainMask).first?.path ?? ""
      done(dir, nil)
    case "log": done(nil, nil)
    default: done(nil, "Unknown native op: \(op)")
    }
  }
}

enum Dialogs {
  static func open(_ args: [String: Any], folders: Bool, window: NSWindow?, store: BookmarkStore, _ done: @escaping ([String]) -> Void) {
    let panel = NSOpenPanel()
    panel.title = (args["title"] as? String) ?? ""
    panel.canChooseDirectories = folders
    panel.canChooseFiles = !folders
    panel.allowsMultipleSelection = (args["multiSelections"] as? Bool) ?? false
    if let path = args["defaultPath"] as? String, !path.isEmpty { panel.directoryURL = URL(fileURLWithPath: path) }
    let finish: (NSApplication.ModalResponse) -> Void = { response in
      guard response == .OK else { return done([]) }
      panel.urls.forEach(store.remember)
      done(panel.urls.map { $0.path })
    }
    if let window { panel.beginSheetModal(for: window, completionHandler: finish) } else { finish(panel.runModal()) }
  }

  static func save(_ args: [String: Any], window: NSWindow?, store: BookmarkStore, _ done: @escaping (String) -> Void) {
    let panel = NSSavePanel()
    panel.title = (args["title"] as? String) ?? ""
    if let path = args["defaultPath"] as? String, !path.isEmpty {
      let url = URL(fileURLWithPath: path)
      panel.directoryURL = url.deletingLastPathComponent()
      panel.nameFieldStringValue = url.lastPathComponent
    }
    let finish: (NSApplication.ModalResponse) -> Void = { response in
      guard response == .OK, let url = panel.url else { return done("") }
      store.remember(url)
      done(url.path)
    }
    if let window { panel.beginSheetModal(for: window, completionHandler: finish) } else { finish(panel.runModal()) }
  }
}
