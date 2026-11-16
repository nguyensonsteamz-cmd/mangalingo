import Foundation

/// What the address bar does with what the user typed, and which navigations the Reader accepts.
enum WebNavigationManager {
    enum Resolution {
        case load(URL)
        case invalid(String)
    }

    /// "example.com/page" → https://example.com/page · "http(s)://…" as typed · words → a web search ·
    /// "javascript:", "data:", "file:" … are never loaded.
    static func resolve(_ raw: String) -> Resolution {
        let input = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if input.isEmpty { return .invalid("Hãy nhập địa chỉ trang web.") }

        if let r = input.range(of: "://") {
            let scheme = input[..<r.lowerBound].lowercased()
            guard scheme == "http" || scheme == "https" else { return .invalid("Chỉ hỗ trợ địa chỉ http và https.") }
            guard let url = URL(string: input), let host = url.host, !host.isEmpty else { return .invalid("Địa chỉ không hợp lệ.") }
            return .load(url)
        }

        // a scheme without "//" (javascript:alert(1), data:…, mailto:…) – but "host:8080" is just a port
        if input.range(of: #"^[A-Za-z][A-Za-z0-9+.\-]*:(?!\d+(/|$))"#, options: .regularExpression) != nil {
            return .invalid("Chỉ hỗ trợ địa chỉ http và https.")
        }

        let looksLikeHost = !input.contains(" ") && (input.contains(".") || input.lowercased().hasPrefix("localhost"))
        if looksLikeHost, let url = URL(string: "https://" + input), let host = url.host, !host.isEmpty {
            return .load(url)
        }

        // not an address: search (DuckDuckGo; the typed words are sent there, nothing else)
        var c = URLComponents(string: "https://duckduckgo.com/")
        c?.queryItems = [URLQueryItem(name: "q", value: input)]
        if let url = c?.url { return .load(url) }
        return .invalid("Địa chỉ không hợp lệ.")
    }

    /// Top-level navigations the Reader performs itself.
    static func isWebURL(_ url: URL) -> Bool {
        guard let s = url.scheme?.lowercased() else { return false }
        return s == "http" || s == "https"
    }

    /// Sub-resources and frames may use these as well (about:blank, blob: images…); they are never top-level targets.
    static func isHarmlessScheme(_ url: URL) -> Bool {
        guard let s = url.scheme?.lowercased() else { return false }
        return s == "about" || s == "blob" || s == "data"
    }

    /// A readable message for a failed load.
    static func message(for error: Error) -> String {
        let e = error as NSError
        guard e.domain == NSURLErrorDomain else { return "Không mở được trang: \(e.localizedDescription)" }
        switch e.code {
        case NSURLErrorNotConnectedToInternet, NSURLErrorDataNotAllowed: return "Không có kết nối Internet."
        case NSURLErrorTimedOut: return "Trang phản hồi quá chậm (hết thời gian chờ)."
        case NSURLErrorCannotFindHost, NSURLErrorDNSLookupFailed: return "Không tìm thấy trang web này. Kiểm tra lại địa chỉ."
        case NSURLErrorCannotConnectToHost, NSURLErrorNetworkConnectionLost: return "Không kết nối được tới máy chủ."
        case NSURLErrorSecureConnectionFailed, NSURLErrorServerCertificateUntrusted, NSURLErrorServerCertificateHasBadDate,
             NSURLErrorServerCertificateHasUnknownRoot, NSURLErrorServerCertificateNotYetValid, NSURLErrorClientCertificateRejected:
            return "Kết nối HTTPS không an toàn (chứng chỉ của trang có vấn đề), nên trang đã bị chặn."
        case NSURLErrorAppTransportSecurityRequiresSecureConnection: return "Trang này dùng HTTP không mã hoá nên iOS chặn. Hãy thử địa chỉ https://."
        case NSURLErrorUnsupportedURL, NSURLErrorBadURL: return "Địa chỉ không hợp lệ."
        default: return "Không mở được trang (\(e.code)): \(e.localizedDescription)"
        }
    }
}

struct WebBookmark: Codable, Identifiable, Equatable {
    var id = UUID()
    var title: String
    var url: String
    var added = Date()
}

struct WebHistoryItem: Codable, Identifiable, Equatable {
    var id = UUID()
    var title: String
    var url: String
    var visited = Date()
}

/// Bookmarks and reading history: JSON files in Application Support, on this device only. Only titles and
/// addresses are kept – never page content, cookies or passwords.
final class WebLibrary: ObservableObject {
    static let shared = WebLibrary()

    @Published private(set) var bookmarks: [WebBookmark] = []
    @Published private(set) var history: [WebHistoryItem] = []

    private let dir: URL
    private let maxHistory = 300

    init() {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first ?? FileManager.default.temporaryDirectory
        dir = base.appendingPathComponent("WebReader", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        bookmarks = load("bookmarks.json")
        history = load("history.json")
    }

    private func load<T: Decodable>(_ name: String) -> [T] {
        guard let data = try? Data(contentsOf: dir.appendingPathComponent(name)) else { return [] }
        let d = JSONDecoder()
        d.dateDecodingStrategy = .iso8601
        return (try? d.decode([T].self, from: data)) ?? []
    }

    private func save<T: Encodable>(_ items: [T], _ name: String) {
        let e = JSONEncoder()
        e.dateEncodingStrategy = .iso8601
        if let data = try? e.encode(items) { try? data.write(to: dir.appendingPathComponent(name), options: .atomic) }
    }

    func isBookmarked(_ url: String) -> Bool { bookmarks.contains { $0.url == url } }

    func toggleBookmark(url: String, title: String) {
        if let i = bookmarks.firstIndex(where: { $0.url == url }) {
            bookmarks.remove(at: i)
        } else {
            bookmarks.insert(WebBookmark(title: title.isEmpty ? url : title, url: url), at: 0)
        }
        save(bookmarks, "bookmarks.json")
    }

    func removeBookmarks(at offsets: IndexSet) {
        bookmarks.remove(atOffsets: offsets)
        save(bookmarks, "bookmarks.json")
    }

    func addHistory(url: String, title: String) {
        if history.first?.url == url {
            history[0].title = title.isEmpty ? url : title
        } else {
            history.insert(WebHistoryItem(title: title.isEmpty ? url : title, url: url), at: 0)
            if history.count > maxHistory { history.removeLast(history.count - maxHistory) }
        }
        save(history, "history.json")
    }

    func removeHistory(at offsets: IndexSet) {
        history.remove(atOffsets: offsets)
        save(history, "history.json")
    }

    func clearHistory() {
        history = []
        save(history, "history.json")
    }
}
