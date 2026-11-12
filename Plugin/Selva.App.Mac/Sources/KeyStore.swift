import Foundation
import Security

/// Keys of protected apps, in the user's login keychain under the key's id. An administrator
/// can put one there ahead of time (`Selva --add-key`), and then that user is never asked for it.
enum KeyStore {
    private static let service = "Selva app key"

    static func read(keyId: String) -> String? {
        var query = item(keyId)
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var found: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &found) == errSecSuccess, let data = found as? Data else {
            return nil
        }

        return String(data: data, encoding: .utf8)
    }

    /// A key that can't be stored is asked for again next time; nothing else depends on it.
    @discardableResult
    static func write(keyId: String, key: String) -> Bool {
        let data = Data(key.utf8)
        var added = item(keyId)
        added[kSecValueData as String] = data
        added[kSecAttrLabel as String] = service
        added[kSecAttrComment as String] = "Opens protected Selva apps"
        let status = SecItemAdd(added as CFDictionary, nil)
        if status == errSecDuplicateItem {
            let update = [kSecValueData as String: data] as CFDictionary
            return SecItemUpdate(item(keyId) as CFDictionary, update) == errSecSuccess
        }

        return status == errSecSuccess
    }

    private static func item(_ keyId: String) -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: keyId
        ]
    }
}
