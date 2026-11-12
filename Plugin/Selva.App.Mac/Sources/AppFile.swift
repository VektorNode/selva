import Foundation
import UniformTypeIdentifiers

/// What a Selva app file says about itself without its key: enough for the title, the icon
/// and the key prompt. The format is the header of `Plugin/Selva.App/Format/AppFile.cs`; only
/// the plug-in reads the definition.
struct AppFileInfo {
    var name = ""
    var iconPng: Data?
    var encrypted = false

    /// Hex of the key id; empty unless `encrypted`.
    var keyId = ""
}

enum AppFile {
    static let fileExtension = "slvx"

    /// What the app opens: its own files, and Grasshopper definitions with a Selva UI.
    static let openableTypes = [fileExtension, "gh", "ghx"].compactMap { UTType(filenameExtension: $0) }

    private static let magic = Data("SLVX".utf8)
    private static let version: UInt8 = 1
    private static let encryptedFlag: UInt8 = 0x1
    private static let headerLength = 6
    private static let saltLength = 16
    private static let keyIdLength = 8
    private static let damaged = AppFileRefusal(message: "This Selva app file is damaged. Ask for a new copy.")

    /// Reads the first bytes of a file only: enough to tell an app file from a definition.
    static func hasMagic(path: String) -> Bool {
        guard let file = FileHandle(forReadingAtPath: path) else {
            return false
        }

        defer { try? file.close() }
        return (try? file.read(upToCount: magic.count)) == magic
    }

    /// The failure is why the file can't be read, for the user.
    static func read(_ bytes: Data) -> Result<AppFileInfo, AppFileRefusal> {
        let bytes = [UInt8](bytes)
        guard bytes.count >= headerLength, Data(bytes[0..<4]) == magic else {
            return .failure(AppFileRefusal(message: "This isn't a Selva app file."))
        }

        guard bytes[4] == version else {
            return .failure(AppFileRefusal(message: "This app was made with a newer Selva. Update Selva to open it."))
        }

        var info = AppFileInfo()
        info.encrypted = bytes[5] & encryptedFlag != 0
        var hasKdf = false
        var offset = headerLength
        while offset < bytes.count {
            guard bytes.count - offset >= 8 else {
                return .failure(damaged)
            }

            let tag = String(decoding: bytes[offset..<offset + 4], as: UTF8.self)
            let length = Int(bytes[offset + 4]) | Int(bytes[offset + 5]) << 8
                | Int(bytes[offset + 6]) << 16 | Int(bytes[offset + 7]) << 24
            let start = offset + 8
            guard length <= bytes.count - start else {
                return .failure(damaged)
            }

            let end = start + length
            switch tag {
            case "NAME":
                info.name = String(decoding: bytes[start..<end], as: UTF8.self)

            case "ICON":
                info.iconPng = Data(bytes[start..<end])

            case "KDF ":
                guard length == 4 + saltLength + keyIdLength else {
                    return .failure(damaged)
                }

                info.keyId = AppFileKey.hex(bytes[(end - keyIdLength)..<end])
                hasKdf = true

            case "DEFN":
                // Always last: its kind byte, then the definition.
                guard length >= 1, end == bytes.count, bytes[start] <= 1, !info.encrypted || hasKdf else {
                    return .failure(damaged)
                }

                return .success(info)

            default:
                break
            }

            offset = end
        }

        return .failure(damaged)
    }
}

struct AppFileRefusal: Error {
    let message: String
}
