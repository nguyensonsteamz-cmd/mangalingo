import UIKit
import WebKit

/// Owns the Reader's WKWebView: navigation, the injected script (its own content world), progress / error
/// state for the UI, OCR of a picked image, and the way back from a look-up to the popup in the page.
final class WebReaderController: NSObject, WKNavigationDelegate, WKUIDelegate {
    /// The site's own JavaScript cannot see or break the script that lives in this world.
    static let world = WKContentWorld.world(name: "mlreader")

    let web: WKWebView
    weak var model: WebReaderViewModel?

    private let settings: WebReaderSettings
    private let library: WebLibrary
    private let bridge = WebContentBridge()
    private let overlay = WebTranslationOverlay()
    private var observers: [NSKeyValueObservation] = []
    private var tornDown = false

    init(settings: WebReaderSettings = .shared, library: WebLibrary = .shared) {
        self.settings = settings
        self.library = library

        let config = WKWebViewConfiguration()
        // Private browsing: nothing a site stores (cookies, logins, caches) outlives the Reader, and it can never
        // touch the app's own data (the vocabulary notebook lives in the default store of the other web view).
        config.websiteDataStore = WKWebsiteDataStore.nonPersistent()
        config.allowsInlineMediaPlayback = true
        let controllerUC = config.userContentController
        controllerUC.addUserScript(WKUserScript(source: ReaderScript.source, injectionTime: .atDocumentEnd, forMainFrameOnly: true, in: WebReaderController.world))

        web = WKWebView(frame: .zero, configuration: config)
        super.init()

        bridge.controller = self
        overlay.controller = self
        controllerUC.add(bridge, contentWorld: WebReaderController.world, name: "mlr")

        web.navigationDelegate = self
        web.uiDelegate = self
        web.allowsBackForwardNavigationGestures = true
        web.isOpaque = false
        web.backgroundColor = UIColor(red: 16 / 255, green: 18 / 255, blue: 24 / 255, alpha: 1)
        web.scrollView.backgroundColor = web.backgroundColor
        if #available(iOS 16.4, *) { web.isInspectable = true }
        observe()
    }

    deinit { teardown() }

    /// Releases the web view's handlers (WebKit keeps them alive otherwise) and stops everything.
    func teardown() {
        if tornDown { return }
        tornDown = true
        observers.removeAll()
        web.stopLoading()
        web.configuration.userContentController.removeScriptMessageHandler(forName: "mlr", contentWorld: WebReaderController.world)
        web.configuration.userContentController.removeAllUserScripts()
        web.navigationDelegate = nil
        web.uiDelegate = nil
    }

    // MARK: state → view model

    private func observe() {
        observers.append(web.observe(\.estimatedProgress, options: [.new]) { [weak self] w, _ in
            DispatchQueue.main.async { self?.model?.progress = w.estimatedProgress }
        })
        observers.append(web.observe(\.isLoading, options: [.new]) { [weak self] w, _ in
            DispatchQueue.main.async { self?.model?.isLoading = w.isLoading }
        })
        observers.append(web.observe(\.canGoBack, options: [.new]) { [weak self] w, _ in
            DispatchQueue.main.async { self?.model?.canGoBack = w.canGoBack }
        })
        observers.append(web.observe(\.canGoForward, options: [.new]) { [weak self] w, _ in
            DispatchQueue.main.async { self?.model?.canGoForward = w.canGoForward }
        })
        observers.append(web.observe(\.title, options: [.new]) { [weak self] w, _ in
            DispatchQueue.main.async { self?.model?.title = w.title ?? "" }
        })
        observers.append(web.observe(\.url, options: [.new]) { [weak self] w, _ in
            DispatchQueue.main.async {
                guard let model = self?.model else { return }
                model.currentURL = w.url
                if !model.isEditingAddress { model.addressText = w.url?.absoluteString ?? "" }
            }
        })
    }

    // MARK: actions

    func load(_ input: String) {
        switch WebNavigationManager.resolve(input) {
        case .load(let url):
            model?.error = nil
            web.load(URLRequest(url: url, cachePolicy: .useProtocolCachePolicy, timeoutInterval: 30))
        case .invalid(let message):
            model?.error = WebReaderViewModel.ReaderError(message: message, url: nil)
        }
    }

    func goBack() { if web.canGoBack { web.goBack() } }
    func goForward() { if web.canGoForward { web.goForward() } }
    func reload() {
        if web.url != nil { web.reload() } else if let m = model?.error?.url { load(m) } else { load(settings.homeURL) }
    }
    func stop() { web.stopLoading() }
    func home() { load(settings.homeURL) }
    func pauseMedia() { web.pauseAllMediaPlayback(completionHandler: nil) }

    // MARK: calls into the page

    private func evalReader(_ js: String) {
        web.evaluateJavaScript(js, in: nil, in: WebReaderController.world) { _ in }
    }

    func pushSettings() {
        evalReader("window.__mlr && window.__mlr.configure(\(JS.literal(settings.jsConfig)));")
    }
    func setOCRMode(_ on: Bool) { evalReader("window.__mlr && window.__mlr.ocrMode(\(on ? "true" : "false"));") }
    func translateSelection() { evalReader("window.__mlr && window.__mlr.translateSelection();") }
    func hidePopup() { evalReader("window.__mlr && window.__mlr.hide();") }

    func show(_ payload: [String: Any]) {
        evalReader("window.__mlr && window.__mlr.show(\(JS.literal(payload)));")
    }
    func saved(id: Int, ok: Bool, message: String) {
        evalReader("window.__mlr && window.__mlr.saved(\(id), \(ok ? "true" : "false"), \(JS.literal(message)));")
    }

    // MARK: messages from the page

    func handle(type: String, body: [String: Any]) {
        switch type {
        case "ready":
            pushSettings()
            if model?.ocrMode == true { setOCRMode(true) }
        case "lookup":
            guard let id = body["id"] as? Int, let text = body["text"] as? String else { return }
            overlay.lookup(id: id, text: text, context: body["context"] as? String ?? text, mode: body["mode"] as? String ?? "word")
        case "save":
            guard let id = body["id"] as? Int, let word = body["word"] as? String else { return }
            overlay.save(id: id, word: word, context: body["context"] as? String ?? "", url: web.url?.absoluteString ?? "", title: web.title ?? "")
        case "details":
            let text = body["text"] as? String ?? ""
            let context = body["context"] as? String ?? ""
            model?.close()
            // the Reader slides away first, then the app page opens the look-up screen with this text
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.45) {
                MainWebHub.shared.call("openDetails", ["text": text, "context": context]) { _ in }
            }
        case "speak":
            if let text = body["text"] as? String { Speaker.shared.speak(text, rate: 1) }
        case "selection":
            model?.hasSelection = (body["has"] as? Bool) ?? false
        case "ocrImage":
            handleOCR(body)
        case "ocrCancel":
            model?.ocrMode = false
        default:
            break
        }
    }

    // MARK: OCR of a picked image

    /// The page sent either the pixels (same-origin image) or just the address (image from another site): in the
    /// second case the app downloads it with the page's cookies and referer (a CDN may require them).
    private func handleOCR(_ body: [String: Any]) {
        guard let id = body["id"] as? Int else { return }
        let src = body["src"] as? String ?? ""

        func fail(_ message: String) {
            evalReader("window.__mlr && window.__mlr.ocrResult(\(JS.literal(["id": id, "error": message])));")
        }
        func recognize(_ data: Data) {
            DispatchQueue.global(qos: .userInitiated).async {
                do {
                    let lines = try TextRecognizer.recognize(data, region: nil)
                    DispatchQueue.main.async {
                        // same grouping / filtering of speech bubbles as the scan screen
                        MainWebHub.shared.call("ocrBlocks", lines) { [weak self] result in
                            switch result {
                            case .success(let blocks):
                                self?.evalReader("window.__mlr && window.__mlr.ocrResult(\(JS.literal(["id": id, "blocks": blocks])));")
                            case .failure(let error):
                                fail("Không nhóm được chữ: \(error.localizedDescription)")
                            }
                        }
                    }
                } catch {
                    DispatchQueue.main.async { fail("Không nhận dạng được chữ trong ảnh này.") }
                }
            }
        }

        if let dataUrl = body["dataUrl"] as? String, let comma = dataUrl.firstIndex(of: ","),
           let data = Data(base64Encoded: String(dataUrl[dataUrl.index(after: comma)...])) {
            recognize(data)
            return
        }
        guard let url = URL(string: src, relativeTo: web.url)?.absoluteURL, WebNavigationManager.isWebURL(url) else {
            fail("Không lấy được ảnh này.")
            return
        }
        download(url) { data in
            if let data = data { recognize(data) } else { fail("Không tải được ảnh (trang không cho tải ảnh ngoài trình duyệt).") }
        }
    }

    private func download(_ url: URL, completion: @escaping (Data?) -> Void) {
        web.configuration.websiteDataStore.httpCookieStore.getAllCookies { [weak self] cookies in
            var request = URLRequest(url: url, timeoutInterval: 25)
            let host = url.host ?? ""
            let mine = cookies.filter { c in
                let d = c.domain.hasPrefix(".") ? String(c.domain.dropFirst()) : c.domain
                return host == d || host.hasSuffix("." + d)
            }
            for (k, v) in HTTPCookie.requestHeaderFields(with: mine) { request.setValue(v, forHTTPHeaderField: k) }
            if let page = self?.web.url { request.setValue(page.absoluteString, forHTTPHeaderField: "Referer") }
            URLSession.shared.dataTask(with: request) { data, response, _ in
                let ok = (response as? HTTPURLResponse).map { (200..<300).contains($0.statusCode) } ?? false
                let small = (data?.count ?? 0) < 20_000_000
                DispatchQueue.main.async { completion(ok && small ? data : nil) }
            }.resume()
        }
    }

    // MARK: WKNavigationDelegate

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url else {
            decisionHandler(.cancel)
            return
        }
        if navigationAction.targetFrame?.isMainFrame ?? true {
            // top-level: only http(s) (and about:blank); javascript:, file:, tel:, app schemes … stay out of the Reader
            if WebNavigationManager.isWebURL(url) || url.absoluteString == "about:blank" {
                decisionHandler(.allow)
            } else {
                model?.toast("Liên kết \"\(url.scheme ?? "?")\" đã bị chặn trong trình đọc.")
                decisionHandler(.cancel)
            }
        } else {
            decisionHandler(.allow)
        }
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationResponse: WKNavigationResponse, decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
        if !navigationResponse.canShowMIMEType && navigationResponse.isForMainFrame {
            model?.toast("Trình đọc không hiển thị được loại tệp này.")
            decisionHandler(.cancel)
        } else {
            decisionHandler(.allow)
        }
    }

    func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
        model?.error = nil
        model?.hasSelection = false
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        guard let url = webView.url, WebNavigationManager.isWebURL(url) else { return }
        library.addHistory(url: url.absoluteString, title: webView.title ?? "")
        pushSettings()
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { failLoad(error) }
    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { failLoad(error) }

    private func failLoad(_ error: Error) {
        let e = error as NSError
        if e.domain == NSURLErrorDomain && e.code == NSURLErrorCancelled { return } // the user tapped stop / started another page
        if e.domain == "WebKitErrorDomain" && e.code == 102 { return } // frame load interrupted (a download / a redirect)
        let failing = (e.userInfo[NSURLErrorFailingURLStringErrorKey] as? String) ?? web.url?.absoluteString
        model?.error = WebReaderViewModel.ReaderError(message: WebNavigationManager.message(for: error), url: failing)
    }

    /// iOS may stop the page's process to free memory: reload instead of leaving a blank view.
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        webView.reload()
    }

    // MARK: WKUIDelegate

    /// target="_blank" and window.open: stay in this Reader (never jump to Safari).
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if navigationAction.targetFrame == nil, let url = navigationAction.request.url, WebNavigationManager.isWebURL(url) {
            webView.load(navigationAction.request)
        }
        return nil
    }
}
