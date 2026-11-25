import Foundation

/// One word shown by the home-screen widget.
struct WidgetWord: Codable, Hashable {
    var w: String
    var ipa: String?
    var vi: String
    var ex: String?
}

struct WidgetSnapshot: Codable {
    var words: [WidgetWord]
    /// seconds since 1970 of the last write by the app
    var updated: Double
}

/// Code shared by the app and the widget extension: the saved words travel from the app to the widget through a JSON file in an
/// App Group container.
///
/// The group id is NOT hard-coded: when an app is sideloaded the signing tool may rename the bundle id (and the group with it), so
/// the groups this bundle was really signed with are read from its embedded provisioning profile first. `diagnostics()` says what was
/// found; this is a test build to learn whether App Groups work with a free Apple ID.
enum WidgetShared {
    static let fileName = "widget-words.json"
    static let preferredGroup = "group.app.mangalingo.ios"

    /// Bundle id of the host app (the widget's id ends with ".widget").
    static var hostBundleID: String {
        let id = Bundle.main.bundleIdentifier ?? "app.mangalingo.ios"
        if Bundle.main.bundleURL.pathExtension == "appex", let dot = id.lastIndex(of: ".") { return String(id[..<dot]) }
        return id
    }

    /// App groups listed in the provisioning profile embedded in this bundle (empty for an unsigned or simulator build).
    static func provisionGroups() -> [String] {
        guard let path = Bundle.main.path(forResource: "embedded", ofType: "mobileprovision"),
              let data = FileManager.default.contents(atPath: path),
              let text = String(data: data, encoding: .isoLatin1),
              let start = text.range(of: "<?xml"),
              let end = text.range(of: "</plist>", range: start.lowerBound..<text.endIndex)
        else { return [] }
        let xml = String(text[start.lowerBound..<end.upperBound])
        guard let plist = try? PropertyListSerialization.propertyList(from: Data(xml.utf8), options: [], format: nil) as? [String: Any],
              let entitlements = plist["Entitlements"] as? [String: Any],
              let groups = entitlements["com.apple.security.application-groups"] as? [String]
        else { return [] }
        return groups
    }

    /// Names of the entitlements the provisioning profile grants this bundle (for the report: shows what a free Apple ID allows).
    static func provisionEntitlementKeys() -> [String] {
        guard let path = Bundle.main.path(forResource: "embedded", ofType: "mobileprovision"),
              let data = FileManager.default.contents(atPath: path),
              let text = String(data: data, encoding: .isoLatin1),
              let start = text.range(of: "<?xml"),
              let end = text.range(of: "</plist>", range: start.lowerBound..<text.endIndex),
              let plist = try? PropertyListSerialization.propertyList(from: Data(String(text[start.lowerBound..<end.upperBound]).utf8), options: [], format: nil) as? [String: Any],
              let entitlements = plist["Entitlements"] as? [String: Any]
        else { return [] }
        return entitlements.keys.map { $0.replacingOccurrences(of: "com.apple.", with: "") }.sorted()
    }

    /// Every group id worth trying, most likely first.
    static func candidateGroups() -> [String] {
        var out: [String] = []
        for g in provisionGroups() + ["group." + hostBundleID, preferredGroup] where !out.contains(g) { out.append(g) }
        return out
    }

    /// The first group container this process may use (nil when the signature carries no usable App Group).
    static func container() -> (id: String, url: URL)? {
        for id in candidateGroups() {
            if let url = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: id) { return (id, url) }
        }
        return nil
    }

    static func read() -> WidgetSnapshot? {
        guard let c = container(), let data = try? Data(contentsOf: c.url.appendingPathComponent(fileName)) else { return nil }
        return try? JSONDecoder().decode(WidgetSnapshot.self, from: data)
    }

    @discardableResult
    static func write(_ snapshot: WidgetSnapshot) -> Bool {
        guard let c = container(), let data = try? JSONEncoder().encode(snapshot) else { return false }
        return (try? data.write(to: c.url.appendingPathComponent(fileName), options: .atomic)) != nil
    }

    /// "word | ipa | meaning | example" per entry; entries are separated by a line break or by "¶" (the widget's paste field may be a single line).
    static func parsePasted(_ text: String) -> [WidgetWord] {
        text.split(whereSeparator: { $0.isNewline || $0 == "¶" }).compactMap { line -> WidgetWord? in
            let parts = line.split(separator: "|", omittingEmptySubsequences: false).map { $0.trimmingCharacters(in: .whitespaces) }
            guard let w = parts.first, !w.isEmpty else { return nil }
            func at(_ i: Int) -> String? { i < parts.count && !parts[i].isEmpty ? parts[i] : nil }
            if parts.count == 1 { return WidgetWord(w: w, ipa: nil, vi: "", ex: nil) }
            if parts.count == 2 { return WidgetWord(w: w, ipa: nil, vi: parts[1], ex: nil) }
            return WidgetWord(w: w, ipa: at(1), vi: parts[2], ex: at(3))
        }
    }

    /// Plain-text report of what this process can see (shown in the app and, when there is no data, in the widget).
    static func diagnostics() -> String {
        var lines: [String] = []
        lines.append("Gói: \(Bundle.main.bundleIdentifier ?? "?")")
        let signed = provisionGroups()
        lines.append("Nhóm trong chữ ký: " + (signed.isEmpty ? "không có" : signed.joined(separator: ", ")))
        let keys = provisionEntitlementKeys()
        if !keys.isEmpty { lines.append("Quyền được cấp: " + keys.joined(separator: ", ")) }
        if let c = container() {
            lines.append("App Group: DÙNG ĐƯỢC (\(c.id))")
            if let snap = read() {
                let f = DateFormatter()
                f.dateFormat = "HH:mm dd/MM"
                lines.append("Dữ liệu: \(snap.words.count) từ, ghi lúc \(f.string(from: Date(timeIntervalSince1970: snap.updated)))")
            } else {
                lines.append("Dữ liệu: chưa có (mở app để ghi)")
            }
        } else {
            lines.append("App Group: KHÔNG dùng được")
        }
        return lines.joined(separator: "\n")
    }
}
