// swift-tools-version:5.9
import PackageDescription

let package = Package(
  name: "Ferry",
  platforms: [.macOS(.v12)],
  targets: [
    .executableTarget(name: "Ferry", path: "Sources/Ferry")
  ]
)
