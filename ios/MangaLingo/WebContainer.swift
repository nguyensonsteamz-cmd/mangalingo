import SwiftUI
import UniformTypeIdentifiers
import WebKit

/// WKWebView showing the bundled web UI through the app:// scheme (so fetch() of the dictionary
/// files and localStorage work like on a normal origin). External links open in Safari.
struct WebContainer: UIViewRepresentable {
    static let background = UIColor(red: 16 / 255, green: 18 / 255, blue: 24 / 255, alpha: 1)

    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.setURLSchemeHandler(BundleSchemeHandler(), forURLScheme: "app")
        config.websiteDataStore = .default() // vocabulary + settings persist between launches
        let platform = WKUserScript(source: "window.MangaLingoPlatform = 'ios';", injectionTime: .atDocumentStart, forMainFrameOnly: true)
        config.userContentController.addUserScript(platform)

        let web = WKWebView(frame: .zero, configuration: config)
        web.isOpaque = false
        web.backgroundColor = Self.background
        web.scrollView.backgroundColor = Self.background
        web.navigationDelegate = context.coordinator
        if #available(iOS 16.4, *) { web.isInspectable = true }
        if let url = URL(string: "app://local/index.html#home") { web.load(URLRequest(url: url)) }
        return web
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {}

    final class Coordinator: NSObject, WKNavigationDelegate {
        func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            if let url = navigationAction.request.url, let scheme = url.scheme, scheme != "app", scheme != "about" {
                UIApplication.shared.open(url)
                decisionHandler(.cancel)
                return
            }
            decisionHandler(.allow)
        }
    }
}

/// Serves files from the bundle's "web" folder for app://local/<path> (never outside that folder).
final class BundleSchemeHandler: NSObject, WKURLSchemeHandler {
    private let root: URL = (Bundle.main.resourceURL ?? Bundle.main.bundleURL).appendingPathComponent("web", isDirectory: true).standardizedFileURL

    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        guard let url = task.request.url else { return }
        var path = url.path
        if path.isEmpty || path == "/" { path = "/index.html" }
        let file = root.appendingPathComponent(String(path.dropFirst())).standardizedFileURL
        guard file.path.hasPrefix(root.path), let data = try? Data(contentsOf: file) else {
            if let r = HTTPURLResponse(url: url, statusCode: 404, httpVersion: "HTTP/1.1", headerFields: ["Content-Type": "text/plain"]) {
                task.didReceive(r)
                task.didReceive(Data("not found".utf8))
            }
            task.didFinish()
            return
        }
        let mime = UTType(filenameExtension: file.pathExtension)?.preferredMIMEType ?? "application/octet-stream"
        let headers = ["Content-Type": mime, "Content-Length": String(data.count), "Access-Control-Allow-Origin": "*", "Cache-Control": "no-cache"]
        if let r = HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: headers) {
            task.didReceive(r)
        }
        task.didReceive(data)
        task.didFinish()
    }

    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {}
}
