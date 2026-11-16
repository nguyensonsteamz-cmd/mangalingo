import Combine
import SwiftUI

/// Presents / dismisses the Reader above the app (the React UI keeps running underneath it – the Reader's
/// look-ups are answered by that page). The Reader's session (its tabs and their web views) lives as long as the
/// app: closing the Reader only hides it, so opening it again shows the same pages.
final class ReaderPresenter: ObservableObject {
    static let shared = ReaderPresenter()
    @Published var isPresented = false

    lazy var model: WebReaderViewModel = {
        let m = WebReaderViewModel()
        m.onClose = { [weak self] in self?.dismiss() }
        return m
    }()

    func present(_ url: URL?) {
        if let url = url { model.openTab(url, activate: true) } else { model.ensureCurrentLoaded() }
        isPresented = true
    }

    func dismiss() {
        model.pauseAll()
        model.saveNow()
        isPresented = false
    }
}

/// State of the Reader session: the tabs, the current tab's address bar / progress / errors, toolbar toggles.
final class WebReaderViewModel: ObservableObject {
    struct ReaderError: Equatable {
        var message: String
        var url: String?
    }

    struct ToastAction {
        var title: String
        var run: () -> Void
    }

    static let maxTabs = 10

    @Published var tabs: [ReaderTab] = []
    @Published var currentIndex = 0
    @Published var addressText = ""
    @Published var progress = 0.0
    @Published var isLoading = false
    @Published var canGoBack = false
    @Published var canGoForward = false
    @Published var title = ""
    @Published var currentURL: URL?
    @Published var error: ReaderError?
    @Published var hasSelection = false
    @Published var toastText: String?
    @Published var toastAction: ToastAction?
    @Published var showLibrary = false
    @Published var showSettings = false
    @Published var showTabs = false
    @Published var isEditingAddress = false
    /// "drag a rectangle" mode: scan a region / add a bubble the scan missed
    @Published var regionMode = false {
        didSet { controller.setRegionMode(regionMode) }
    }
    @Published var sidebarOpen = false
    /// "pick an image" mode of the OCR
    @Published var ocrMode = false {
        didSet { controller.setOCRMode(ocrMode) }
    }

    /// The extension's sidebar in a second web view (created on first use).
    let sidebar = ReaderSidebar()
    let settings = WebReaderSettings.shared
    let library = WebLibrary.shared
    var onClose: (() -> Void)?
    private var bag = Set<AnyCancellable>()
    private var toastTask: DispatchWorkItem?
    private var saveTask: DispatchWorkItem?

    var current: ReaderTab { tabs[min(max(currentIndex, 0), tabs.count - 1)] }
    var controller: WebReaderController { current.controller }

    init() {
        if let saved = ReaderSessionStore.load(), !saved.tabs.isEmpty {
            for s in saved.tabs.prefix(Self.maxTabs) {
                let tab = makeTab(id: s.id)
                tab.restoreURL = URL(string: s.url)
                tab.title = s.title
                tab.controller.originURL = s.origin.flatMap { URL(string: $0) }
                tabs.append(tab)
            }
            currentIndex = min(max(saved.current, 0), tabs.count - 1)
        } else {
            tabs = [makeTab()]
        }
        // changes in the Reader settings reach the page at once
        settings.objectWillChange
            .debounce(for: .milliseconds(80), scheduler: DispatchQueue.main)
            .sink { [weak self] _ in
                guard let self = self else { return }
                for t in self.tabs where t.controller.isLoaded { t.controller.pushSettings() }
                if !self.settings.ocrEnabled && self.ocrMode { self.ocrMode = false }
            }
            .store(in: &bag)
        ensureCurrentLoaded()
        syncPublished()
    }

    private func makeTab(id: UUID = UUID()) -> ReaderTab {
        let controller = WebReaderController()
        let tab = ReaderTab(id: id, controller: controller)
        controller.model = self
        return tab
    }

    // MARK: tabs

    /// Loads the current tab if it has not been loaded yet (a tab restored after a restart is created empty).
    func ensureCurrentLoaded() {
        let t = current
        guard !t.controller.isLoaded else { return }
        t.controller.isLoaded = true
        if let url = t.restoreURL ?? t.url {
            t.controller.load(url.absoluteString)
        } else {
            t.controller.load(settings.homeURL)
        }
    }

    func openTab(_ url: URL?, activate: Bool) {
        if tabs.count >= Self.maxTabs {
            toast("Tối đa \(Self.maxTabs) tab. Hãy đóng bớt tab.")
            if let url = url { controller.load(url.absoluteString) }
            return
        }
        let tab = makeTab()
        tab.controller.isLoaded = true
        tabs.append(tab)
        if activate { select(tabs.count - 1) }
        if let url = url { tab.controller.load(url.absoluteString) } else { tab.controller.load(settings.homeURL) }
        scheduleSave()
    }

    func select(_ index: Int) {
        guard tabs.indices.contains(index) else { return }
        current.controller.hidePopup()
        currentIndex = index
        ensureCurrentLoaded()
        syncPublished()
        scheduleSave()
    }

    func closeTab(at index: Int) {
        guard tabs.indices.contains(index) else { return }
        let gone = tabs.remove(at: index)
        gone.controller.teardown()
        if tabs.isEmpty {
            tabs = [makeTab()]
            currentIndex = 0
        } else if index < currentIndex || currentIndex >= tabs.count {
            currentIndex = max(0, min(currentIndex - 1, tabs.count - 1))
        }
        ensureCurrentLoaded()
        syncPublished()
        scheduleSave()
    }

    func closeCurrentTab() { closeTab(at: currentIndex) }

    func pauseAll() {
        for t in tabs { t.controller.pauseMedia() }
    }

    // MARK: state shown by the toolbar (always the current tab's)

    /// A web view changed (progress, title, address…): update its tab, and the toolbar when it is the current one.
    func controllerDidChange(_ c: WebReaderController) {
        guard let tab = tabs.first(where: { $0.controller === c }) else { return }
        let url = c.web.url
        if tab.url != url { tab.url = url }
        let title = c.web.title ?? ""
        if tab.title != title && !title.isEmpty { tab.title = title }
        if tab.id == current.id { syncPublished() }
        scheduleSave()
    }

    func syncPublished() {
        let c = controller
        let w = c.web
        progress = w.estimatedProgress
        isLoading = w.isLoading
        canGoBack = c.canGoBackSmart
        canGoForward = w.canGoForward
        title = w.title ?? ""
        currentURL = w.url
        error = c.error
        hasSelection = c.hasSelection
        if !isEditingAddress { addressText = w.url?.absoluteString ?? "" }
    }

    // MARK: persistence

    func scheduleSave() {
        saveTask?.cancel()
        let work = DispatchWorkItem { [weak self] in self?.saveNow() }
        saveTask = work
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.8, execute: work)
    }

    func saveNow() {
        let saved = tabs.map { t in
            SavedTab(id: t.id, url: (t.controller.web.url ?? t.restoreURL ?? t.url)?.absoluteString ?? "", title: t.title, origin: t.controller.originURL?.absoluteString)
        }
        ReaderSessionStore.save(SavedSession(tabs: saved, current: currentIndex))
    }

    // MARK: toolbar actions

    var isBookmarked: Bool {
        guard let url = currentURL?.absoluteString else { return false }
        return library.isBookmarked(url)
    }

    func toggleBookmark() {
        guard let url = currentURL, WebNavigationManager.isWebURL(url) else {
            toast("Hãy mở một trang web trước khi đánh dấu.")
            return
        }
        library.toggleBookmark(url: url.absoluteString, title: title)
        objectWillChange.send()
        toast(library.isBookmarked(url.absoluteString) ? "Đã thêm dấu trang" : "Đã bỏ dấu trang")
    }

    func toggleOCR() {
        if !settings.ocrEnabled {
            toast("OCR đang tắt trong Cài đặt của trình đọc.")
            return
        }
        ocrMode.toggle()
    }

    // MARK: scans and sidebar

    func startRegion() {
        guard settings.ocrEnabled else { toast("OCR đang tắt trong Cài đặt của trình đọc."); return }
        ocrMode = false
        regionMode = true
    }

    func scanScreen() {
        guard settings.ocrEnabled else { toast("OCR đang tắt trong Cài đặt của trình đọc."); return }
        ocrMode = false
        regionMode = false
        controller.scanScreen()
    }

    func scanAllImages() {
        guard settings.ocrEnabled else { toast("OCR đang tắt trong Cài đặt của trình đọc."); return }
        ocrMode = false
        regionMode = false
        controller.scanAllImages()
    }

    func toggleSidebar() {
        sidebarOpen.toggle()
        if sidebarOpen { sidebar.ensureLoaded() }
    }

    func openNotes() {
        sidebarOpen = true
        sidebar.ensureLoaded()
        sidebar.showTab("notes")
    }

    private func source(of c: WebReaderController) -> [String: Any] {
        ["url": c.web.url?.absoluteString ?? "", "title": c.web.title ?? ""]
    }

    /// "Chi tiết" in the in-page popup: the sidebar opens with that text.
    func showInSidebar(text: String, context: String, from c: WebReaderController) {
        sidebarOpen = true
        sidebar.push(["type": "lookup", "text": text, "context": context, "source": source(of: c)])
    }

    /// Bubbles read on the page: the sidebar lists them (Dịch tab) so each can be analysed.
    func bubblesFound(_ blocks: [[String: Any]], fresh: Bool, from c: WebReaderController) {
        let all = c.addBubbles(blocks, fresh: fresh)
        let result: [String: Any] = [
            "key": "reader-\(Int(Date().timeIntervalSince1970))",
            "blocks": all,
            "text": all.compactMap { $0["text"] as? String }.joined(separator: "\n\n"),
            "meanConfidence": 90,
            "lang": "eng",
            "acquisition": "visible-capture",
            "partial": false,
            "durationMs": 0,
            "fromCache": false,
            "createdAt": Int(Date().timeIntervalSince1970 * 1000),
        ]
        sidebar.push(["type": "ocr", "result": result, "source": source(of: c)])
    }

    func translateSelection() {
        if hasSelection { controller.translateSelection() } else { toast("Hãy chọn từ, câu hoặc đoạn tiếng Anh trước.") }
    }

    func toast(_ text: String, action: ToastAction? = nil) {
        toastTask?.cancel()
        toastText = text
        toastAction = action
        let work = DispatchWorkItem { [weak self] in
            self?.toastText = nil
            self?.toastAction = nil
        }
        toastTask = work
        DispatchQueue.main.asyncAfter(deadline: .now() + (action == nil ? 2.4 : 7), execute: work)
    }

    func close() { onClose?() }
}
