import Foundation

/// Locates the renderer, sidecar bundle and Node binary. Inside a packaged app they live in
/// `Contents/Resources`; for development `FERRY_OUT` points at the repo's `out/` directory.
struct ResourceLocator {
  let rendererDir: URL
  let sidecarScript: URL
  let nodeBinary: URL

  static func resolve() -> ResourceLocator? {
    let fm = FileManager.default
    if let out = ProcessInfo.processInfo.environment["FERRY_OUT"] {
      let base = URL(fileURLWithPath: out)
      let node = ProcessInfo.processInfo.environment["FERRY_NODE"].map { URL(fileURLWithPath: $0) }
        ?? URL(fileURLWithPath: "/usr/local/bin/node")
      return ResourceLocator(
        rendererDir: base.appendingPathComponent("renderer"),
        sidecarScript: base.appendingPathComponent("sidecar/index.cjs"),
        nodeBinary: node)
    }
    guard let res = Bundle.main.resourceURL else { return nil }
    let loc = ResourceLocator(
      rendererDir: res.appendingPathComponent("renderer"),
      sidecarScript: res.appendingPathComponent("sidecar.cjs"),
      nodeBinary: res.appendingPathComponent("node"))
    return fm.fileExists(atPath: loc.sidecarScript.path) ? loc : nil
  }
}
