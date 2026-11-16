import SwiftUI
import UniformTypeIdentifiers
import WebKit

/// WKWebView showing the bundled web UI through the app:// scheme (so fetch() of the dictionary
/// files and localStorage work like on a normal origin). External links open in Safari.
/// Bridge `window.webkit.messageHandlers.ml` (promise-based):
///   {cmd: "pendingScan"}                 → {stamp} of the latest image from the Shortcuts action
///   {cmd: "ocr", image: base64, region?} → Apple Vision lines for that image
///   {cmd: "setIcon", name?}             → switches the app icon (alternate icons)
///   {cmd: "translate", text}            → {text} Vietnamese translation (Apple Translation, iOS 18+)
///   {cmd: "translateBatch", texts}      → {texts} several at once (see Translator.swift)
///   {cmd: "openReader", url?}           → opens the Web Reader (WebReader/) above the app
struct WebContainer: UIViewRepresentable {
    static let background = UIColor(red: 16 / 255, green: 18 / 255, blue: 24 / 255, alpha: 1)

    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.setURLSchemeHandler(BundleSchemeHandler(), forURLScheme: "app")
        config.websiteDataStore = .default() // vocabulary + settings persist between launches
        let platform = WKUserScript(source: "window.MangaLingoPlatform = 'ios';", injectionTime: .atDocumentStart, forMainFrameOnly: true)
        config.userContentController.addUserScript(platform)
        config.userContentController.addScriptMessageHandler(context.coordinator, contentWorld: .page, name: "ml")

        let web = WKWebView(frame: .zero, configuration: config)
        web.isOpaque = false
        web.backgroundColor = Self.background
        web.scrollView.backgroundColor = Self.background
        web.scrollView.contentInsetAdjustmentBehavior = .never // the page handles the safe areas (viewport-fit=cover)
        web.navigationDelegate = context.coordinator
        if #available(iOS 16.4, *) { web.isInspectable = true }
        context.coordinator.web = web
        MainWebHub.shared.web = web // the Web Reader asks this page's engine to translate
        if let url = URL(string: "app://local/index.html#home") { web.load(URLRequest(url: url)) }
        return web
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {}

    final class Coordinator: NSObject, WKNavigationDelegate, WKScriptMessageHandlerWithReply {
        weak var web: WKWebView?
        private var observer: NSObjectProtocol?

        override init() {
            super.init()
            // The Shortcuts action delivered a new screenshot → show the scan screen.
            observer = NotificationCenter.default.addObserver(forName: .mlNewScan, object: nil, queue: .main) { [weak self] _ in
                self?.web?.evaluateJavaScript("window.__mlNewScan && window.__mlNewScan(\(PendingScan.stamp));", completionHandler: nil)
            }
        }

        deinit {
            if let observer { NotificationCenter.default.removeObserver(observer) }
        }

        /// iOS may stop the page's process to free memory: reload it (same URL = same tab) instead
        /// of leaving a blank screen.
        func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
            webView.reload()
        }

        func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            if let url = navigationAction.request.url, let scheme = url.scheme, scheme != "app", scheme != "about", scheme != "blob", scheme != "data" {
                UIApplication.shared.open(url)
                decisionHandler(.cancel)
                return
            }
            decisionHandler(.allow)
        }

        func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage, replyHandler: @escaping (Any?, String?) -> Void) {
            guard let body = message.body as? [String: Any], let cmd = body["cmd"] as? String else {
                replyHandler(nil, "bad message")
                return
            }
            switch cmd {
            case "pendingScan":
                replyHandler(["stamp": PendingScan.stamp], nil)
            case "voiceInfo":
                replyHandler(Speaker.shared.voiceInfo(), nil)
            case "speak":
                Speaker.shared.speak(body["text"] as? String ?? "", rate: body["rate"] as? Double ?? 1)
                replyHandler(true, nil)
            case "copy":
                // "Sao chép": the system pasteboard (the web clipboard API is not available on app://)
                UIPasteboard.general.string = body["text"] as? String ?? ""
                replyHandler(true, nil)
            case "setIcon":
                // logo chosen in Settings → Giao diện; nil = the default icon (lens)
                let name = body["name"] as? String
                guard UIApplication.shared.supportsAlternateIcons, UIApplication.shared.alternateIconName != name else {
                    replyHandler(true, nil)
                    return
                }
                UIApplication.shared.setAlternateIconName(name) { error in
                    replyHandler(error == nil, error?.localizedDescription)
                }
            case "translate":
                // Apple Translation (iOS 18+), English → Vietnamese, on the device
                guard TranslationQueue.isAvailable, let text = body["text"] as? String, !text.isEmpty else {
                    replyHandler(nil, "unavailable")
                    return
                }
                TranslationQueue.queue(for: body["pair"]).enqueue(.translate([text]) { result, error in
                    let first = (result as? [String])?.first
                    replyHandler(first.map { ["text": $0] }, error)
                })
            case "translateBatch":
                // every bubble of a page in one request (one session, one model load)
                guard TranslationQueue.isAvailable, let texts = body["texts"] as? [String], !texts.isEmpty else {
                    replyHandler(nil, "unavailable")
                    return
                }
                TranslationQueue.queue(for: body["pair"]).enqueue(.translate(texts) { result, error in
                    replyHandler((result as? [String]).map { ["texts": $0] }, error)
                })
            case "openReader":
                // the in-app Web Reader (optionally with an address); this page keeps running underneath and answers its look-ups
                let address = (body["url"] as? String).flatMap { URL(string: $0) }
                DispatchQueue.main.async { ReaderPresenter.shared.present(address) }
                replyHandler(true, nil)
            // ---- Smart Setup: Keychain, Google sign-in (ASWebAuthenticationSession + PKCE), Safari for Console links
            case "secretGet":
                if let value = KeychainStore.get(body["name"] as? String ?? "") {
                    replyHandler(["value": value], nil)
                } else {
                    replyHandler(["value": NSNull()], nil)
                }
            case "secretSet":
                replyHandler(KeychainStore.set(body["name"] as? String ?? "", body["value"] as? String ?? ""), nil)
            case "secretRemove":
                KeychainStore.remove(body["name"] as? String ?? "")
                replyHandler(true, nil)
            case "oauthConfigured":
                replyHandler(["configured": GoogleOAuth.isConfigured], nil)
            case "oauthStart":
                DispatchQueue.main.async {
                    GoogleOAuth.shared.start(scopes: body["scopes"] as? [String] ?? []) { result in
                        switch result {
                        case .success(let token): replyHandler(token, nil)
                        case .failure(let error): replyHandler(nil, error.localizedDescription)
                        }
                    }
                }
            case "oauthRevoke":
                if let token = body["token"] as? String { GoogleOAuth.shared.revoke(token) }
                replyHandler(true, nil)
            case "openUrl":
                DispatchQueue.main.async { SafariPresenter.present(body["url"] as? String ?? "") }
                replyHandler(true, nil)
            case "mtStatus":
                TranslationQueue.queue(for: body["pair"]).status { replyHandler(["status": $0], nil) }
            case "mtPrepare":
                guard TranslationQueue.isAvailable else {
                    replyHandler(nil, "unavailable")
                    return
                }
                TranslationQueue.queue(for: body["pair"]).enqueue(.prepare { ok, error in replyHandler(ok, error) })
            case "ocr":
                guard let b64 = body["image"] as? String, let data = Data(base64Encoded: b64) else {
                    replyHandler(nil, "Không đọc được ảnh.")
                    return
                }
                var region: CGRect?
                if let r = body["region"] as? [String: Any], let x = r["x"] as? Double, let y = r["y"] as? Double, let w = r["w"] as? Double, let h = r["h"] as? Double {
                    region = CGRect(x: x, y: y, width: w, height: h)
                }
                DispatchQueue.global(qos: .userInitiated).async {
                    do {
                        let lines = try TextRecognizer.recognize(data, region: region)
                        DispatchQueue.main.async { replyHandler(["lines": lines], nil) }
                    } catch {
                        DispatchQueue.main.async { replyHandler(nil, "Không nhận dạng được chữ trong ảnh này.") }
                    }
                }
            default:
                replyHandler(nil, "unknown command \(cmd)")
            }
        }
    }
}

/// Serves files from the bundle's "web" folder for app://local/<path> (never outside that folder),
/// plus app://local/__scan/latest = the image delivered by the Shortcuts action.
final class BundleSchemeHandler: NSObject, WKURLSchemeHandler {
    private let root: URL = (Bundle.main.resourceURL ?? Bundle.main.bundleURL).appendingPathComponent("web", isDirectory: true).standardizedFileURL

    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        guard let url = task.request.url else { return }
        var path = url.path
        if path.isEmpty || path == "/" { path = "/index.html" }

        if path == "/__scan/latest" {
            if let data = PendingScan.load() {
                respond(task, url, data, PendingScan.mime(of: data))
            } else {
                notFound(task, url)
            }
            return
        }

        let file = root.appendingPathComponent(String(path.dropFirst())).standardizedFileURL
        guard file.path.hasPrefix(root.path), let data = try? Data(contentsOf: file) else {
            notFound(task, url)
            return
        }
        respond(task, url, data, UTType(filenameExtension: file.pathExtension)?.preferredMIMEType ?? "application/octet-stream")
    }

    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {}

    private func respond(_ task: WKURLSchemeTask, _ url: URL, _ data: Data, _ mime: String) {
        let headers = ["Content-Type": mime, "Content-Length": String(data.count), "Access-Control-Allow-Origin": "*", "Cache-Control": "no-cache"]
        if let r = HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: headers) { task.didReceive(r) }
        task.didReceive(data)
        task.didFinish()
    }

    private func notFound(_ task: WKURLSchemeTask, _ url: URL) {
        if let r = HTTPURLResponse(url: url, statusCode: 404, httpVersion: "HTTP/1.1", headerFields: ["Content-Type": "text/plain"]) {
            task.didReceive(r)
            task.didReceive(Data("not found".utf8))
        }
        task.didFinish()
    }
}
