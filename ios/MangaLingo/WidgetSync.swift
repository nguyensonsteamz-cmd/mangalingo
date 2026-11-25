import CryptoKit
import Foundation
import Security
import WidgetKit

/// The GitHub token of the widget sync (write access to ONE repository chosen by the user). iOS Keychain, this device only; the web UI can
/// store and delete it but never read it back.
private enum SyncTokenStore {
    private static let base: [String: Any] = [
        kSecClass as String: kSecClassGenericPassword,
        kSecAttrService as String: "app.mangalingo.widgetsync",
        kSecAttrAccount as String: "github-token",
    ]

    static func get() -> String? {
        var query = base
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var out: AnyObject?
        guard SecItemCopyMatching(query as CFDictionary, &out) == errSecSuccess, let data = out as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    @discardableResult
    static func set(_ token: String) -> Bool {
        remove()
        var query = base
        query[kSecValueData as String] = Data(token.utf8)
        query[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        return SecItemAdd(query as CFDictionary, nil) == errSecSuccess
    }

    static func remove() { SecItemDelete(base as CFDictionary) }
}

/// App side of the home-screen widget: hands the saved words to the widget in two ways and asks WidgetKit to reload.
///  1. an App Group file (only when the signature has an App Group: not with a free Apple ID);
///  2. an encrypted file in a GitHub repository (see Shared/WidgetCloud.swift), which works with any signing.
enum WidgetSync {
    private static let defaults = UserDefaults.standard
    private static let repoKey = "wsync.repo"
    private static let keyKey = "wsync.key"
    private static let lastKey = "wsync.last"
    private static let hashKey = "wsync.hash"
    private static var chain: Task<Void, Never> = Task {}

    // MARK: configuration

    static var code: WidgetSyncCode? {
        guard let repo = defaults.string(forKey: repoKey), let keyText = defaults.string(forKey: keyKey), let key = Data(base64Encoded: keyText), key.count == 32 else { return nil }
        return WidgetSyncCode(repo: repo, key: key)
    }

    /// Connects the sync: repository "owner/name" (PUBLIC) + a GitHub token with Contents read/write on that repository. A random key is
    /// made the first time and kept afterwards (so a code already pasted into the widget keeps working). Returns an error text or nil.
    static func configure(repo: String, token: String) -> String? {
        let r = repo.trimmingCharacters(in: .whitespacesAndNewlines)
        let t = token.trimmingCharacters(in: .whitespacesAndNewlines)
        guard WidgetSyncCode.validRepo(r) else { return WidgetCloudError.badRepo.description }
        guard t.count >= 20 else { return "Token GitHub không hợp lệ." }
        var key: Data? = defaults.string(forKey: keyKey).flatMap { Data(base64Encoded: $0) }
        if key == nil || key?.count != 32 {
            var bytes = [UInt8](repeating: 0, count: 32)
            guard SecRandomCopyBytes(kSecRandomDefault, 32, &bytes) == errSecSuccess else { return "Không tạo được khoá ngẫu nhiên." }
            key = Data(bytes)
        }
        guard let finalKey = key else { return "Không tạo được khoá." }
        guard SyncTokenStore.set(t) else { return "Không lưu được token vào Keychain." }
        defaults.set(r, forKey: repoKey)
        defaults.set(finalKey.base64EncodedString(), forKey: keyKey)
        defaults.removeObject(forKey: hashKey) // force a first upload
        return nil
    }

    static func disconnect() {
        SyncTokenStore.remove()
        for k in [repoKey, keyKey, lastKey, hashKey] { defaults.removeObject(forKey: k) }
    }

    // MARK: writing

    private static func parse(_ words: [[String: Any]]) -> [WidgetWord] {
        words.compactMap { d -> WidgetWord? in
            guard let w = d["w"] as? String, !w.isEmpty else { return nil }
            return WidgetWord(w: w, ipa: d["ipa"] as? String, vi: d["vi"] as? String ?? "", p: d["p"] as? String)
        }
    }

    private static func fingerprint(_ words: [WidgetWord]) -> String {
        let text = words.map { "\($0.w)\u{1}\($0.ipa ?? "")\u{1}\($0.vi)\u{1}\($0.p ?? "")" }.joined(separator: "\u{2}")
        return SHA256.hash(data: Data(text.utf8)).map { String(format: "%02x", $0) }.joined()
    }

    /// Writes the words for the widget and reports what happened: ["ok": App Group file written, "cloud": "off" | "ok" | an error text].
    static func write(words: [[String: Any]], order: String? = nil) async -> [String: Any] {
        let parsed = parse(words)
        let snapshot = WidgetSnapshot(words: parsed, updated: Date().timeIntervalSince1970, order: order)
        let groupOK = WidgetShared.write(snapshot)
        var cloud = "off"
        if let code = code, let token = SyncTokenStore.get() {
            let hash = fingerprint(parsed) + "|" + (order ?? "")
            if defaults.string(forKey: hashKey) == hash {
                cloud = "ok" // the same list as last time: nothing to upload
            } else {
                do {
                    try await WidgetCloud.push(snapshot, code: code, token: token)
                    defaults.set(hash, forKey: hashKey)
                    cloud = "ok"
                } catch {
                    cloud = (error as? WidgetCloudError)?.description ?? "Không đẩy được lên GitHub: \(error.localizedDescription)"
                }
            }
            let f = DateFormatter()
            f.dateFormat = "HH:mm dd/MM"
            defaults.set(cloud == "ok" ? "Đã đồng bộ lúc \(f.string(from: Date()))" : cloud, forKey: lastKey)
        }
        WidgetCenter.shared.reloadAllTimelines()
        return ["ok": groupOK, "cloud": cloud]
    }

    /// Calls are serialised (two uploads at once would fight over the file version). `done` runs on the main queue.
    static func writeSerial(words: [[String: Any]], order: String? = nil, done: @escaping ([String: Any]) -> Void) {
        let previous = chain
        chain = Task {
            _ = await previous.value
            let result = await write(words: words, order: order)
            DispatchQueue.main.async { done(result) }
        }
    }

    static func status() -> [String: Any] {
        let container = WidgetShared.container()
        var out: [String: Any] = [
            "ok": container != nil,
            "group": container?.id ?? "",
            "count": WidgetShared.read()?.words.count ?? 0,
            "text": WidgetShared.diagnostics(),
            "cloud": false,
        ]
        if let c = code {
            out["cloud"] = true
            out["repo"] = c.repo
            out["code"] = c.string
            out["last"] = defaults.string(forKey: lastKey) ?? "Chưa đồng bộ"
        }
        out["github"] = GitHubLogin.isConfigured
        return out
    }

    /// status() plus what the system knows about the widgets on the Home Screen: how many there are and whether one of them holds OUR sync
    /// code (so the app can tell the user the paste worked). iOS 17+.
    static func statusAsync(done: @escaping ([String: Any]) -> Void) {
        var out = status()
        out["widgets"] = 0
        out["linked"] = false
        guard #available(iOS 17.0, *), let mine = code else {
            done(out)
            return
        }
        WidgetCenter.shared.getCurrentConfigurations { result in
            var count = 0
            var linked = false
            if case .success(let infos) = result {
                for info in infos where info.kind == "LingoLensWord" {
                    count += 1
                    if let intent = info.widgetConfigurationIntent(of: WordConfigIntent.self), WidgetSyncCode.parse(intent.code) == mine { linked = true }
                }
            }
            out["widgets"] = count
            out["linked"] = linked
            DispatchQueue.main.async { done(out) }
        }
    }
}
