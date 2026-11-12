import CommonCrypto
import Foundation

/// The key id of `Plugin/Selva.App/Format/AppFileKey.cs`: names a key without revealing it, and
/// is identical for every file protected with the same key. Slow on purpose.
enum AppFileKey {
    private static let iterations: UInt32 = 210_000
    private static let idLength = 8

    // Fixed: the id has to come out the same on every machine and for every file.
    private static let idSalt = [UInt8]("selva-app-key-id/1".utf8)

    /// PBKDF2-HMAC-SHA256 of the key, as lower-case hex.
    static func idOf(_ key: String) -> String {
        let password = [UInt8](key.utf8)
        var id = [UInt8](repeating: 0, count: idLength)
        password.withUnsafeBufferPointer { bytes in
            bytes.withMemoryRebound(to: CChar.self) { chars in
                _ = CCKeyDerivationPBKDF(CCPBKDFAlgorithm(kCCPBKDF2), chars.baseAddress, password.count,
                                         idSalt, idSalt.count, CCPseudoRandomAlgorithm(kCCPRFHmacAlgSHA256),
                                         iterations, &id, idLength)
            }
        }
        return hex(id)
    }

    static func hex<Bytes: Sequence>(_ bytes: Bytes) -> String where Bytes.Element == UInt8 {
        bytes.map { String(format: "%02x", $0) }.joined()
    }
}
