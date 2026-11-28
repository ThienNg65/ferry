import Cocoa
import WebKit

final class AppDelegate: NSObject, NSApplicationDelegate {
  private var window: NSWindow!
  private var webView: WKWebView!
  private let sidecar = Sidecar()
  private var bridge: Bridge!

  func applicationDidFinishLaunching(_ notification: Notification) {
    guard let res = ResourceLocator.resolve() else { fail("Ferry resources are missing."); return }
    guard let key = MasterKey.load() else { fail("Could not open the Ferry key in the Keychain."); return }

    let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
      .appendingPathComponent("Ferry")
    try? FileManager.default.createDirectory(at: support, withIntermediateDirectories: true)

    bridge = Bridge(sidecar: sidecar)
    let config = WKWebViewConfiguration()
    config.userContentController.add(bridge, name: "ferry")
    config.setURLSchemeHandler(AppSchemeHandler(root: res.rendererDir), forURLScheme: "ferry")
    webView = WKWebView(frame: NSRect(x: 0, y: 0, width: 1280, height: 800), configuration: config)
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
    if ProcessInfo.processInfo.environment["FERRY_SELFTEST"] != nil { runSelfTest() }
  }

  /// Development aid: report what the page rendered and whether sidecar RPC answers.
  private func runSelfTest() {
    FileHandle.standardError.write(Data("SELFTEST armed\n".utf8))
    DispatchQueue.main.asyncAfter(deadline: .now() + 5) { [self] in
      FileHandle.standardError.write(Data("SELFTEST fire\n".utf8))
      let js = """
      return (async () => {
        const r = { api: typeof window.api, text: document.body.innerText.slice(0, 200) }
        try { r.invoke = JSON.stringify(await window.api.invoke('fs:local:list', '/tmp')).slice(0, 160) } catch (e) { r.invokeError = String(e) }
        return JSON.stringify(r)
      })()
      """
      webView.callAsyncJavaScript(js, in: nil, in: .page) { result in
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
  func applicationWillTerminate(_ notification: Notification) { sidecar.shutdown() }
}
