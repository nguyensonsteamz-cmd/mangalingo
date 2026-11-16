import Foundation
import Security

/// Secure storage of the translation API key: the iOS Keychain, this device only, readable only while the phone is
/// unlocked (kSecAttrAccessibleWhenUnlockedThisDeviceOnly: not in backups, not migrated to another device).
/// Never UserDefaults, never a file.
enum KeychainStore {
    private static let service = "app.mangalingo.secrets"
    /// The only secret that exists; the web UI cannot use the Keychain for anything else.
    private static let allowed: Set<String> = ["translate-api-key"]

    private static func query(_ name: String) -> [String: Any] {
        [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: name]
    }

    static func get(_ name: String) -> String? {
        guard allowed.contains(name) else { return nil }
        var q = query(name)
        q[kSecReturnData as String] = true
        q[kSecMatchLimit as String] = kSecMatchLimitOne
        var out: AnyObject?
        guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess, let data = out as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    @discardableResult
    static func set(_ name: String, _ value: String) -> Bool {
        guard allowed.contains(name) else { return false }
        remove(name)
        var q = query(name)
        q[kSecValueData as String] = Data(value.utf8)
        q[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
        return SecItemAdd(q as CFDictionary, nil) == errSecSuccess
    }

    static func remove(_ name: String) {
        guard allowed.contains(name) else { return }
        SecItemDelete(query(name) as CFDictionary)
    }
}
