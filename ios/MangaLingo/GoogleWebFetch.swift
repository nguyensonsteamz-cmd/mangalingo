import Foundation

/// Google Translate (web) requests of the app page, sent by iOS's own networking instead of the page's fetch.
///
/// From the page (served as app://local) a request to Google fails with a bare "Load failed": iOS hides the reply (cross-origin rules,
/// a page paused while the Web Reader covers it…), so the app could not translate nor tell why. Sent from here the request needs no
/// cross-origin permission and the real HTTP status comes back (429 / "Sorry" page = Google limits requests).
///
/// Only the public endpoint translate.googleapis.com/translate_a/single is allowed. The request goes out as THIS app (iOS's default
/// identity for an app): no browser identity is faked, no cookie is sent or kept, and nothing is retried here (the page's gate paces
/// requests and pauses after a block).
enum GoogleWebFetch {
    private static let session: URLSession = {
        let c = URLSessionConfiguration.ephemeral
        c.httpCookieStorage = nil
        c.httpShouldSetCookies = false
        c.urlCache = nil
        c.requestCachePolicy = .reloadIgnoringLocalCacheData
        c.timeoutIntervalForRequest = 12
        return URLSession(configuration: c)
    }()

    static func allowed(_ url: URL) -> Bool {
        url.scheme == "https" && url.host == "translate.googleapis.com" && url.path == "/translate_a/single"
    }

    /// Replies ["status": Int, "url": final URL, "body": String] or ["error": "network" | "timeout" | "forbidden"]. `done` runs on the main queue.
    static func get(_ text: String, done: @escaping ([String: Any]) -> Void) {
        guard let url = URL(string: text), allowed(url) else {
            done(["error": "forbidden"])
            return
        }
        var req = URLRequest(url: url)
        req.httpMethod = "GET"
        session.dataTask(with: req) { data, response, error in
            var out: [String: Any]
            if let http = response as? HTTPURLResponse {
                out = ["status": http.statusCode, "url": http.url?.absoluteString ?? text, "body": String(data: data ?? Data(), encoding: .utf8) ?? ""]
            } else if let e = error as? URLError, e.code == .timedOut {
                out = ["error": "timeout"]
            } else {
                out = ["error": "network"]
            }
            DispatchQueue.main.async { done(out) }
        }.resume()
    }
}
