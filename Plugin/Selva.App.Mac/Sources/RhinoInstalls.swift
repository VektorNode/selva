import AppKit

/// One Rhino on this Mac, and where Selva goes for it.
struct RhinoInstall {
    /// The package folder's name for this Rhino: "8.0" or "9.0".
    let version: String

    let appURL: URL

    /// Selva's folder among this Rhino's packages, as the package manager leaves it.
    var selvaFolder: URL { RhinoInstalls.packagesRoot.appendingPathComponent(version).appendingPathComponent("Selva") }

    var hasSelva: Bool { FileManager.default.fileExists(atPath: selvaFolder.path) }
}

enum RhinoInstalls {
    /// Newest first.
    static let versions = ["9.0", "8.0"]

    /// `defaults write dev.selva.app Rhino 8.0` pins the app to one Rhino, for testing.
    static let pinnedVersionKey = "Rhino"

    static var packagesRoot: URL {
        FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Application Support/McNeel/Rhinoceros/packages")
    }

    static func find() -> [RhinoInstall] {
        let pinned = UserDefaults.standard.string(forKey: pinnedVersionKey)
        return versions.compactMap { version in
            guard pinned == nil || pinned == version,
                  let major = version.split(separator: ".").first,
                  let url = NSWorkspace.shared.urlForApplication(withBundleIdentifier: "com.mcneel.rhinoceros.\(major)")
            else { return nil }
            return RhinoInstall(version: version, appURL: url)
        }
    }
}
