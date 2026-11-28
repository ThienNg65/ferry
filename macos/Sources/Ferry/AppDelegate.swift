import Cocoa
import WebKit

final class AppDelegate: NSObject, NSApplicationDelegate {
  private var window: NSWindow!
  private var webView: DropWebView!
  private let sidecar = Sidecar()
  private var bridge: Bridge!
  private var bookmarks: BookmarkStore!
  private var restored: [String] = []

  func applicationDidFinishLaunching(_ notification: Notification) {
    guard let res = ResourceLocator.resolve() else { fail("Ferry resources are missing."); return }
    guard let key = MasterKey.load() else { fail("Could not open the Ferry key in the Keychain."); return }

    let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
      .appendingPathComponent("Ferry")
    try? FileManager.default.createDirectory(at: support, withIntermediateDirectories: true)

    bookmarks = BookmarkStore(directory: support)
    restored = bookmarks.restoreAll()
    bridge = Bridge(sidecar: sidecar, bookmarks: bookmarks)
    let config = WKWebViewConfiguration()
    config.userContentController.add(bridge, name: "ferry")
    config.setURLSchemeHandler(AppSchemeHandler(root: res.rendererDir), forURLScheme: "ferry")
    webView = DropWebView(frame: NSRect(x: 0, y: 0, width: 1280, height: 800), configuration: config)
    webView.bookmarks = bookmarks
    if #available(macOS 13.3, *) { webView.isInspectable = ProcessInfo.processInfo.environment["FERRY_OUT"] != nil }
    window = NSWindow(contentRect: webView.frame, styleMask: [.titled, .closable, .miniaturizable, .resizable],
                      backing: .buffered, defer: false)
    window.title = "Ferry"
    window.contentView = webView
    window.center()
    bridge.webView = webView
    bridge.window = window

    do {
      try sidecar.start(node: res.nodeBinary, script: res.sidecarScript, dataDir: support.path, key: key)
    } catch {
      fail("Could not start the Ferry sidecar: \(error.localizedDescription)"); return
    }
    webView.load(URLRequest(url: URL(string: "ferry://app/index.html")!))
    window.makeKeyAndOrderFront(nil)
    NSApp.activate(ignoringOtherApps: true)
    if ProcessInfo.processInfo.environment["FERRY_SELFTEST"] != nil {
      let env = ProcessInfo.processInfo.environment
      let dir = env["FERRY_SELFTEST_LIST"] ?? support.path
      let f = dir + "/file1.txt"
      var msg = "PARENT restored=\(restored)"
      do { let d = try Data(contentsOf: URL(fileURLWithPath: f)); msg += " read=\(d.count)" } catch { msg += " readError=\(error)" }
      msg += " ls=\((try? FileManager.default.contentsOfDirectory(atPath: dir).count) ?? -1)"
      FileHandle.standardError.write(Data((msg + "\n").utf8))
      runSelfTest(defaultListPath: support.path, openPath: env["FERRY_SELFTEST_OPEN_PATH"])
    }
  }

  /// Development aid: report what the page rendered and whether sidecar RPC answers.
  private func runSelfTest(defaultListPath: String, openPath: String?) {
    FileHandle.standardError.write(Data("SELFTEST armed\n".utf8))
    DispatchQueue.main.asyncAfter(deadline: .now() + 5) { [self] in
      FileHandle.standardError.write(Data("SELFTEST fire\n".utf8))
      let env = ProcessInfo.processInfo.environment
      let pick = env["FERRY_SELFTEST_PICK"] != nil
      let list = env["FERRY_SELFTEST_LIST"] ?? defaultListPath
      let openPathTest = openPath.map { path in
        "try { r.openPath = await window.api.invoke('edit:openLocal', \(String(reflecting: path))) } catch (e) { r.openPathError = String(e) }"
      } ?? ""
      let js = """
      return (async () => {
        const r = { api: typeof window.api, text: document.body.innerText.slice(0, 120) }
        let path = \(String(reflecting: list))
        if (\(pick)) {
          const picked = await window.api.invoke('dialog:pickFolder')
          r.picked = JSON.stringify(picked)
          path = picked?.data ?? picked
        }
        try { r.list = JSON.stringify(await window.api.invoke('fs:local:list', path)).slice(0, 200) } catch (e) { r.listError = String(e) }
        try { r.update = JSON.stringify(await window.api.invoke('update:getStatus')).slice(0, 200) } catch (e) { r.updateError = String(e) }
        \(openPathTest)
        return JSON.stringify(r)
      })()
      """
      let custom = env["FERRY_SELFTEST_JS"]
      webView.callAsyncJavaScript(custom ?? js, in: nil, in: .page) { result in
        FileHandle.standardError.write(Data("SELFTEST \(result)\n".utf8))
      }
    }
  }

  private func fail(_ message: String) {
    let alert = NSAlert()
    alert.messageText = "Ferry cannot start"
    alert.informativeText = message
    alert.runModal()
    NSApp.terminate(nil)
  }

  func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }
  func applicationWillTerminate(_ notification: Notification) {
    sidecar.shutdown()
    bookmarks.stopAll()
  }
}
