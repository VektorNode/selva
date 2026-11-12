// swift-tools-version:5.9
import PackageDescription

// Builds the executable only. scripts/plugin/build-mac-app.mjs wraps it into Selva.app with
// Info.plist, the shell page and the icon.
let package = Package(
    name: "SelvaApp",
    platforms: [.macOS(.v12)],
    targets: [
        .executableTarget(name: "Selva", path: "Sources")
    ]
)
