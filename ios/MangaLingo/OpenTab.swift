import Foundation

extension Notification.Name {
    /// The app was asked to show one of its tabs (posted on the main thread), e.g. by tapping the home-screen widget.
    static let mlOpenTab = Notification.Name("MangaLingoOpenTab")
}

/// `lingolens://vocab` (the widget's tap target) opens the vocabulary notebook. The request is kept until the web page is ready, so
/// it also works when the tap launched the app from scratch.
enum OpenTab {
    static var pending: String?

    static func handle(_ url: URL) {
        guard url.scheme == "lingolens", let tab = url.host, ["home", "lookup", "vocab", "settings"].contains(tab) else { return }
        pending = tab
        NotificationCenter.default.post(name: .mlOpenTab, object: nil)
    }

    /// JavaScript that switches the web UI to the pending tab (and forgets it), or nil.
    static func takeScript() -> String? {
        guard let tab = pending else { return nil }
        pending = nil
        return "(function(){ if (location.hash === '#\(tab)') location.hash = '#home'; location.hash = '#\(tab)'; })();"
    }
}
