import UIKit
import WebKit

/// JSON helpers for building JavaScript calls (strings are escaped by JSONSerialization, never concatenated).
enum JS {
    static func literal(_ value: Any) -> String {
        guard JSONSerialization.isValidJSONObject([value]),
              let data = try? JSONSerialization.data(withJSONObject: [value]),
              let s = String(data: data, encoding: .utf8) else { return "null" }
        return String(s.dropFirst().dropLast()) // strip the wrapping [ ]
    }
}

/// The app's own web page (the React UI under the Reader) owns the dictionary, the translation engines, the
/// usage meter / quota protection and the vocabulary notebook. The Reader never has an engine of its own: it
/// asks that page through `window.__mlReader` (see src/mobile/reader-bridge.ts), so every translation goes
/// through the same guarded path as everywhere else in the app.
final class MainWebHub {
    static let shared = MainWebHub()
    weak var web: WKWebView?

    enum HubError: LocalizedError {
        case notReady
        var errorDescription: String? { "Công cụ dịch của ứng dụng chưa sẵn sàng." }
    }

    /// Calls `window.__mlReader[function](argument)` in the app page and returns its (awaited) result.
    func call(_ function: String, _ argument: Any, completion: @escaping (Result<Any, Error>) -> Void) {
        guard let web = web else {
            completion(.failure(HubError.notReady))
            return
        }
        let body = "if (!window.__mlReader) { throw new Error('Cầu nối dịch chưa sẵn sàng'); } return await window.__mlReader[fn](arg);"
        web.callAsyncJavaScript(body, arguments: ["fn": function, "arg": argument], in: nil, in: .page, completionHandler: completion)
    }
}

/// Messages from the injected script (`webkit.messageHandlers.mlr`, content world "mlreader").
final class WebContentBridge: NSObject, WKScriptMessageHandler {
    weak var controller: WebReaderController?

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any], let type = body["t"] as? String else { return }
        controller?.handle(type: type, body: body)
    }
}

/// Look-ups requested from the page: forwards the text to the shared engine and gives the answer back to the
/// popup that the injected script draws next to the selection.
final class WebTranslationOverlay {
    weak var controller: WebReaderController?

    func lookup(id: Int, text: String, context: String, mode: String) {
        let request: [String: Any] = ["text": text, "context": context, "mode": mode]
        MainWebHub.shared.call("lookup", request) { [weak self] result in
            var payload: [String: Any]
            switch result {
            case .success(let value):
                payload = (value as? [String: Any]) ?? ["title": text, "error": "Không có kết quả."]
            case .failure(let error):
                payload = ["title": text, "error": "Không dịch được: \(error.localizedDescription)"]
            }
            payload["id"] = id
            self?.controller?.show(payload)
        }
    }

    func save(id: Int, word: String, context: String, url: String, title: String) {
        let request: [String: Any] = ["word": word, "context": context, "url": url, "title": title]
        MainWebHub.shared.call("save", request) { [weak self] result in
            switch result {
            case .success(let value):
                let r = value as? [String: Any]
                self?.controller?.saved(id: id, ok: (r?["ok"] as? Bool) ?? false, message: r?["message"] as? String ?? "")
            case .failure(let error):
                self?.controller?.saved(id: id, ok: false, message: error.localizedDescription)
            }
        }
    }
}
