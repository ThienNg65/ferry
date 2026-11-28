import Foundation

/// Runs the Node sidecar over stdio. Replies and pushed events are delivered line by line.
final class Sidecar {
  private let process = Process()
  private let stdin = Pipe()
  private let stdout = Pipe()
  private var buffer = Data()
  private let queue = DispatchQueue(label: "js.ferry.sidecar")
  private(set) var isRunning = false
  /// Called on the main queue with each decoded JSON line.
  var onMessage: (([String: Any], Data) -> Void)?

  func start(node: URL, script: URL, dataDir: String, key: Data) throws {
    process.executableURL = node
    process.arguments = [script.path]
    process.standardInput = stdin
    process.standardOutput = stdout
    process.standardError = FileHandle.nullDevice
    var env = ProcessInfo.processInfo.environment
    env["FERRY_PACKAGED"] = "1"
    // The native shell is only shipped through the Mac App Store, which owns updates.
    env["FERRY_DISTRIBUTION"] = "mas"
    // The sandbox home is the empty app container; start the local pane somewhere useful.
    if let downloads = FileManager.default.urls(for: .downloadsDirectory, in: .userDomainMask).first {
      env["FERRY_DEFAULT_LOCAL_DIR"] = downloads.path
    }
    process.environment = env
    stdout.fileHandleForReading.readabilityHandler = { [weak self] handle in
      let chunk = handle.availableData
      guard let self, !chunk.isEmpty else { return }
      self.queue.async { self.consume(chunk) }
    }
    process.terminationHandler = { [weak self] _ in self?.isRunning = false }
    try process.run()
    isRunning = true
    send(["type": "init", "key": key.base64EncodedString(), "dataDir": dataDir])
  }

  func send(_ object: [String: Any]) {
    guard let data = try? JSONSerialization.data(withJSONObject: object) else { return }
    queue.async { [stdin] in
      try? stdin.fileHandleForWriting.write(contentsOf: data + Data([10]))
    }
  }

  func shutdown() {
    send(["type": "shutdown"])
  }

  private func consume(_ chunk: Data) {
    buffer.append(chunk)
    while let newline = buffer.firstIndex(of: 10) {
      let line = buffer.subdata(in: buffer.startIndex..<newline)
      buffer.removeSubrange(buffer.startIndex...newline)
      guard !line.isEmpty,
            let object = try? JSONSerialization.jsonObject(with: line) as? [String: Any] else { continue }
      DispatchQueue.main.async { [weak self] in self?.onMessage?(object, line) }
    }
  }
}
