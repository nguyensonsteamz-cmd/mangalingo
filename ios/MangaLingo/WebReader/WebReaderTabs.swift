import Foundation
import WebKit

/// One tab of the Reader: its own web view (controller) plus what the tab strip and the saved session need to know.
final class ReaderTab: ObservableObject, Identifiable {
    let id: UUID
    let controller: WebReaderController
    @Published var title: String
    @Published var url: URL?
    /// Where to load this tab when it is first shown after the app was restarted (its web view is created empty).
    var restoreURL: URL?

    init(id: UUID = UUID(), controller: WebReaderController, title: String = "", url: URL? = nil) {
        self.id = id
        self.controller = controller
        self.title = title
        self.url = url
    }

    /// Text shown on the tab chip.
    var label: String {
        if !title.isEmpty { return title }
        if let host = (url ?? restoreURL)?.host { return host }
        return "Tab mới"
    }
}

struct SavedTab: Codable {
    var id: UUID
    var url: String
    var title: String
    var origin: String?
}

struct SavedSession: Codable {
    var tabs: [SavedTab]
    var current: Int
}

/// The open tabs are written to Application Support (titles and addresses only – never page content, cookies or form data), so
/// closing the Reader or the app does not lose the pages being read.
enum ReaderSessionStore {
    private static var file: URL {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first ?? FileManager.default.temporaryDirectory
        let dir = base.appendingPathComponent("WebReader", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir.appendingPathComponent("session.json")
    }

    static func load() -> SavedSession? {
        guard let data = try? Data(contentsOf: file) else { return nil }
        return try? JSONDecoder().decode(SavedSession.self, from: data)
    }

    static func save(_ session: SavedSession) {
        if let data = try? JSONEncoder().encode(session) { try? data.write(to: file, options: .atomic) }
    }
}

/// Which site an address belongs to (the last two labels of the host: "a.b.example.com" → "example.com").
enum SiteName {
    static func of(_ url: URL?) -> String {
        guard let host = url?.host?.lowercased() else { return "" }
        let parts = host.split(separator: ".")
        return parts.suffix(2).joined(separator: ".")
    }

    static func same(_ a: URL?, _ b: URL?) -> Bool {
        let x = of(a)
        return !x.isEmpty && x == of(b)
    }

    /// The same page, ignoring the #fragment (an ad page that keeps adding "#1", "#2" to the address is still one page).
    static func samePage(_ a: URL?, _ b: URL?) -> Bool {
        guard let a = a, let b = b else { return false }
        func strip(_ u: URL) -> String {
            var c = URLComponents(url: u, resolvingAgainstBaseURL: false)
            c?.fragment = nil
            return c?.string ?? u.absoluteString
        }
        return strip(a) == strip(b)
    }
}

/// Blocks the best-known advertising / pop-up networks before they load (WebKit content rules: no page content is read by the
/// app). It is a short list on purpose; the injected script also removes invisible full-screen overlays that catch taps.
enum ReaderAdBlock {
    static let domains = [
        "doubleclick.net", "googlesyndication.com", "googleadservices.com", "adservice.google.com", "popads.net", "popcash.net",
        "propellerads.com", "propellerclick.com", "onclickads.net", "onclkds.com", "exoclick.com", "exosrv.com", "juicyads.com",
        "trafficjunky.com", "adsterra.com", "highperformanceformat.com", "profitablegatecpm.com", "profitablecpmrate.com",
        "mgid.com", "taboola.com", "outbrain.com", "revcontent.com", "adnxs.com", "adform.net", "criteo.com", "pubmatic.com",
        "rubiconproject.com", "openx.net", "adsrvr.org", "ad-maven.com", "admaven.com", "hilltopads.net", "clickadu.com",
        "richpush.co", "notix.io", "evadav.com", "a-ads.com", "monetag.com", "adcash.com", "bidvertiser.com", "yllix.com",
        "zeropark.com", "trafficstars.com", "tsyndicate.com", "popunderjs.com", "go.oclasrv.com", "oclasrv.com",
    ]

    private static var cached: WKContentRuleList?
    private static var compiling = false

    /// Calls `done` on the main queue with the compiled rule list (nil when it could not be compiled; browsing then works unfiltered).
    static func ruleList(_ done: @escaping (WKContentRuleList?) -> Void) {
        if let c = cached {
            done(c)
            return
        }
        let rules: [[String: Any]] = domains.map { d in
            ["trigger": ["url-filter": "^https?://([^/]+\\.)?" + d.replacingOccurrences(of: ".", with: "\\.") + "[:/]", "load-type": ["third-party"]],
             "action": ["type": "block"]]
        }
        guard let data = try? JSONSerialization.data(withJSONObject: rules), let json = String(data: data, encoding: .utf8) else {
            done(nil)
            return
        }
        if compiling { DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { ruleList(done) }; return }
        compiling = true
        WKContentRuleListStore.default().compileContentRuleList(forIdentifier: "lingolens-ads-1", encodedContentRuleList: json) { list, _ in
            DispatchQueue.main.async {
                compiling = false
                cached = list
                done(list)
            }
        }
    }
}
