import Foundation

/// What the app remembers between runs besides its window's place, which AppKit keeps.
enum AppSettings {
    private static let recentKey = "RecentFiles"
    private static let maxRecent = 8

    /// Most recent first, only files that still exist.
    static var existingRecent: [String] {
        (UserDefaults.standard.stringArray(forKey: recentKey) ?? [])
            .filter { FileManager.default.fileExists(atPath: $0) }
    }

    static func rememberRecent(_ path: String) {
        let recent = UserDefaults.standard.stringArray(forKey: recentKey) ?? []
        UserDefaults.standard.set(Array(([path] + recent.filter { $0 != path }).prefix(maxRecent)), forKey: recentKey)
    }
}
