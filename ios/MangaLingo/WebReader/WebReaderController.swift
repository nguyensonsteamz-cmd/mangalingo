import UIKit
import WebKit

/// Owns the Reader's WKWebView: navigation, the injected script (its own content world), progress / error
/// state for the UI, OCR of a picked image, and the way back from a look-up to the popup in the page.
final class WebReaderController: NSObject, WKNavigationDelegate, WKUIDelegate {
    /// The site's own JavaScript cannot see or break the script that lives in this world.
    static let world = WKContentWorld.world(name: "mlreader")

    let web: WKWebView
    weak var model: WebReaderViewModel?

    /// Per-tab state (the toolbar shows the current tab's).
    var error: WebReaderViewModel.ReaderError?
    var hasSelection = false
    /// The tab's web view has been given an address (a tab restored after a restart is created empty and loaded when first shown).
    var isLoaded = false
    /// The last page the user deliberately opened here (typed address, bookmark, same-site link). "Back to the page I was reading" returns to it.
    var originURL: URL?
    /// The next navigation is one the user asked for (set before load / same-site link taps; consumed when the page finishes).
    private var userNavPending = false
    /// Set when the page moved to another site; shown as a "go back" notice once the new page has loaded.
    private var crossSiteNotice: String?
    private var selfInitiated = false
    /// The address was typed / chosen from a list: the page it ends on (after redirects) is the page being read.
    private var typedLoad = false
    /// Bubbles read on the current page (a region scan adds to them; a new page or a fresh scan starts over).
    private var bubbles: [[String: Any]] = []

    /// Adds bubbles reported by the page and returns the whole list in the shape the sidebar expects.
    func addBubbles(_ blocks: [[String: Any]], fresh: Bool) -> [[String: Any]] {
        if fresh { bubbles = [] }
        for b in blocks {
            guard let text = b["text"] as? String else { continue }
            let n = (b["n"] as? Int) ?? (bubbles.count + 1)
            let box = (b["box"] as? [String: Any]) ?? ["x": 0, "y": 0, "w": 1, "h": 1]
            bubbles.removeAll { ($0["n"] as? Int) == n }
            bubbles.append(["id": "b\(n)", "n": n, "text": text, "confidence": 90, "box": box, "lines": [Any]()])
        }
        bubbles.sort { ($0["n"] as? Int ?? 0) < ($1["n"] as? Int ?? 0) }
        return bubbles
    }

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
        // pop-ups and hidden ads must not take over the tab: window.open is handled in createWebViewWith (new tab / blocked)
        config.preferences.javaScriptCanOpenWindowsAutomatically = false
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
        if settings.blockAds {
            ReaderAdBlock.ruleList { [weak self] list in
                guard let self = self, !self.tornDown, let list = list else { return }
                self.web.configuration.userContentController.add(list)
            }
        }
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
        func notify(_ me: WebReaderController?) {
            DispatchQueue.main.async { if let me = me { me.model?.controllerDidChange(me) } }
        }
        observers.append(web.observe(\.estimatedProgress, options: [.new]) { [weak self] _, _ in notify(self) })
        observers.append(web.observe(\.isLoading, options: [.new]) { [weak self] _, _ in notify(self) })
        observers.append(web.observe(\.canGoBack, options: [.new]) { [weak self] _, _ in notify(self) })
        observers.append(web.observe(\.canGoForward, options: [.new]) { [weak self] _, _ in notify(self) })
        observers.append(web.observe(\.title, options: [.new]) { [weak self] _, _ in notify(self) })
        observers.append(web.observe(\.url, options: [.new]) { [weak self] _, _ in notify(self) })
    }

    private func changed() { model?.controllerDidChange(self) }

    // MARK: actions

    func load(_ input: String) {
        switch WebNavigationManager.resolve(input) {
        case .load(let url):
            isLoaded = true
            error = nil
            selfInitiated = true
            userNavPending = true
            typedLoad = true
            web.load(URLRequest(url: url, cachePolicy: .useProtocolCachePolicy, timeoutInterval: 30))
            changed()
        case .invalid(let message):
            error = WebReaderViewModel.ReaderError(message: message, url: nil)
            changed()
        }
    }

    /// Back is enabled when there is an earlier page, or when the tab was taken to another page than the one the user was reading.
    var canGoBackSmart: Bool {
        if web.canGoBack { return true }
        if let o = originURL, !SiteName.samePage(o, web.url) { return true }
        return false
    }

    /// Back that cannot be trapped: entries that are the same page as the current one (an ad page that keeps pushing the same address)
    /// are skipped; with no earlier page it returns to the page the user was reading.
    func goBack() {
        let here = web.url
        if let target = web.backForwardList.backList.reversed().first(where: { !SiteName.samePage($0.url, here) }) {
            web.go(to: target)
            return
        }
        backToOrigin()
    }

    /// "Back to the page I was reading": jumps to the last page the user opened on purpose (before a redirect / ad took the tab).
    func backToOrigin() {
        guard let o = originURL, !SiteName.samePage(o, web.url) else {
            if web.canGoBack { web.goBack() }
            return
        }
        if let item = web.backForwardList.backList.last(where: { SiteName.samePage($0.url, o) }) {
            web.go(to: item)
        } else {
            selfInitiated = true
            web.load(URLRequest(url: o))
        }
    }

    func goForward() { if web.canGoForward { web.goForward() } }
    func reload() {
        if web.url != nil { web.reload() } else if let m = error?.url { load(m) } else { load(settings.homeURL) }
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
    func setRegionMode(_ on: Bool) { evalReader("window.__mlr && window.__mlr.regionMode(\(on ? "true" : "false"));") }
    func scanScreen() { evalReader("window.__mlr && window.__mlr.scanScreen();") }
    func scanAllImages() { evalReader("window.__mlr && window.__mlr.scanAllImages();") }
    func translateSelection() { evalReader("window.__mlr && window.__mlr.translateSelection();") }
    /// Quick look-up of typed text: the page's script shows the answer as a sheet from the bottom edge.
    func lookupText(_ text: String) { evalReader("window.__mlr && window.__mlr.lookupText(\(JS.literal(text)));") }
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
            // "Chi tiết": the Reader stays open and its sidebar shows the full look-up (Dịch / Từ vựng / Ngữ pháp / Ngữ cảnh / Đã lưu / Ghi chú)
            let text = body["text"] as? String ?? ""
            let context = body["context"] as? String ?? ""
            model?.showInSidebar(text: text, context: context, from: self)
        case "ocrRegion":
            handleRegion(body)
        case "regionDone":
            model?.regionMode = false
        case "ocrBubbles":
            if let blocks = body["blocks"] as? [[String: Any]] { model?.bubblesFound(blocks, fresh: (body["fresh"] as? Bool) ?? false, from: self) }
        case "speak":
            if let text = body["text"] as? String { Speaker.shared.speak(text, rate: 1) }
        case "selection":
            hasSelection = (body["has"] as? Bool) ?? false
            if model?.current.controller === self { model?.hasSelection = hasSelection }
        case "ocrImage":
            handleOCR(body)
        case "ocrCancel":
            model?.ocrMode = false
        default:
            break
        }
    }

    // MARK: OCR of a region / the visible screen

    /// The page asked to read a rectangle (viewport points): the app takes a snapshot of just that area and reads it.
    private func handleRegion(_ body: [String: Any]) {
        guard let id = body["id"] as? Int, let r = body["rect"] as? [String: Any],
              let x = (r["x"] as? NSNumber)?.doubleValue, let y = (r["y"] as? NSNumber)?.doubleValue,
              let w = (r["w"] as? NSNumber)?.doubleValue, let h = (r["h"] as? NSNumber)?.doubleValue else { return }
        let rect = CGRect(x: x, y: y, width: w, height: h).intersection(web.bounds)
        guard !rect.isNull, rect.width >= 8, rect.height >= 8 else {
            ocrFail(id, "Vùng quá nhỏ để quét.")
            return
        }
        let config = WKSnapshotConfiguration()
        config.rect = rect
        config.afterScreenUpdates = true
        // the notices drawn by the page are hidden while the scan runs: give the page a moment to repaint without them, and tell the user
        // with a native notice (it is not part of the page, so it never ends up in the snapshot)
        model?.toast("Đang nhận dạng chữ…")
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) { [weak self] in
            guard let self = self else { return }
            self.takeRegionSnapshot(id: id, config: config)
        }
    }

    private func takeRegionSnapshot(id: Int, config: WKSnapshotConfiguration) {
        web.takeSnapshot(with: config) { [weak self] image, _ in
            guard let self = self, let data = image?.pngData() else {
                self?.ocrFail(id, "Không chụp được vùng này.")
                return
            }
            self.runOCR(id: id, data: data)
        }
    }

    private func ocrFail(_ id: Int, _ message: String) {
        evalReader("window.__mlr && window.__mlr.ocrResult(\(JS.literal(["id": id, "error": message])));")
    }

    /// Apple Vision reads the image; the app page groups the lines into speech bubbles (same as the scan screen); the page draws them.
    private func runOCR(id: Int, data: Data) {
        DispatchQueue.global(qos: .userInitiated).async {
            do {
                let lines = try TextRecognizer.recognize(data, region: nil)
                DispatchQueue.main.async {
                    MainWebHub.shared.call("ocrBlocks", lines) { [weak self] result in
                        switch result {
                        case .success(let blocks):
                            self?.evalReader("window.__mlr && window.__mlr.ocrResult(\(JS.literal(["id": id, "blocks": blocks])));")
                        case .failure(let error):
                            self?.ocrFail(id, "Không nhóm được chữ: \(error.localizedDescription)")
                        }
                    }
                }
            } catch {
                DispatchQueue.main.async { self.ocrFail(id, "Không nhận dạng được chữ trong ảnh này.") }
            }
        }
    }

    // MARK: OCR of a picked image

    /// The page sent either the pixels (same-origin image) or just the address (image from another site): in the
    /// second case the app downloads it with the page's cookies and referer (a CDN may require them).
    private func handleOCR(_ body: [String: Any]) {
        guard let id = body["id"] as? Int else { return }
        let src = body["src"] as? String ?? ""

        func fail(_ message: String) { ocrFail(id, message) }
        func recognize(_ data: Data) { runOCR(id: id, data: data) }

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
                noteNavigation(navigationAction, to: url)
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

    /// Decides what a top-level navigation means for "the page the user is reading": the user's own loads and same-site links move it; a
    /// move to ANOTHER site (a redirect, a script, a tapped hidden ad) leaves it where it was and shows a one-tap way back.
    private func noteNavigation(_ action: WKNavigationAction, to url: URL) {
        if selfInitiated {
            selfInitiated = false
            return
        }
        guard WebNavigationManager.isWebURL(url) else { return }
        switch action.navigationType {
        case .backForward, .reload:
            return
        case .linkActivated, .formSubmitted:
            if SiteName.same(web.url, url) || web.url == nil { userNavPending = true } else { crossSiteNotice = url.host ?? "trang khác" }
        default:
            // .other: redirects, location changes from scripts
            if let here = web.url, !SiteName.same(here, url), action.sourceFrame.isMainFrame { crossSiteNotice = url.host ?? "trang khác" }
        }
    }

    func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
        bubbles = []
        error = nil
        hasSelection = false
        changed()
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        guard let url = webView.url, WebNavigationManager.isWebURL(url) else { return }
        library.addHistory(url: url.absoluteString, title: webView.title ?? "")
        pushSettings()
        if typedLoad {
            typedLoad = false
            crossSiteNotice = nil
            originURL = url
        } else if let host = crossSiteNotice {
            crossSiteNotice = nil
            if originURL != nil && model?.current.controller === self {
                model?.toast("Trang vừa chuyển sang \(host).", action: .init(title: "Quay lại trang đang đọc") { [weak self] in self?.backToOrigin() })
            }
        } else if userNavPending {
            originURL = url
        }
        userNavPending = false
        changed()
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { failLoad(error) }
    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { failLoad(error) }

    private func failLoad(_ error: Error) {
        let e = error as NSError
        if e.domain == NSURLErrorDomain && e.code == NSURLErrorCancelled { return } // the user tapped stop / started another page
        if e.domain == "WebKitErrorDomain" && e.code == 102 { return } // frame load interrupted (a download / a redirect)
        let failing = (e.userInfo[NSURLErrorFailingURLStringErrorKey] as? String) ?? web.url?.absoluteString
        self.error = WebReaderViewModel.ReaderError(message: WebNavigationManager.message(for: error), url: failing)
        changed()
    }

    /// iOS may stop the page's process to free memory: reload instead of leaving a blank view.
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        webView.reload()
    }

    // MARK: WKUIDelegate

    /// target="_blank" and window.open. A link the user tapped opens in a NEW TAB (the page they were reading stays as it is).
    /// A pop-up opened by a script (what hidden ads do when they catch a tap) is blocked, with a notice that can still open it.
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        guard navigationAction.targetFrame == nil, let url = navigationAction.request.url, WebNavigationManager.isWebURL(url) else { return nil }
        if navigationAction.navigationType == .linkActivated {
            model?.openTab(url, activate: true)
        } else if settings.blockAds {
            model?.toast("Đã chặn quảng cáo", action: .init(title: "Vẫn mở") { [weak self] in self?.model?.openTab(url, activate: true) })
        } else {
            model?.openTab(url, activate: true)
        }
        return nil
    }
}
