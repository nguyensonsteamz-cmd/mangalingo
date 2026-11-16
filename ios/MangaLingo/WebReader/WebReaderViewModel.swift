import Combine
import SwiftUI

/// Presents / dismisses the Reader above the app (the React UI keeps running underneath it – the Reader's
/// look-ups are answered by that page).
final class ReaderPresenter: ObservableObject {
    static let shared = ReaderPresenter()
    @Published var isPresented = false
    var startURL: URL?

    func present(_ url: URL?) {
        startURL = url
        isPresented = true
    }
}

/// State of one Reader session (address bar, progress, errors, toolbar toggles) + the WebReaderController.
final class WebReaderViewModel: ObservableObject {
    struct ReaderError: Equatable {
        var message: String
        var url: String?
    }

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
    @Published var showLibrary = false
    @Published var showSettings = false
    @Published var isEditingAddress = false
    /// "pick an image" mode of the OCR
    @Published var ocrMode = false {
        didSet { controller.setOCRMode(ocrMode) }
    }

    let controller: WebReaderController
    let settings = WebReaderSettings.shared
    let library = WebLibrary.shared
    private let onClose: () -> Void
    private var bag = Set<AnyCancellable>()
    private var toastTask: DispatchWorkItem?

    init(startURL: URL?, onClose: @escaping () -> Void) {
        controller = WebReaderController()
        self.onClose = onClose
        controller.model = self
        // changes in the Reader settings reach the page at once
        settings.objectWillChange
            .debounce(for: .milliseconds(80), scheduler: DispatchQueue.main)
            .sink { [weak self] _ in
                guard let self = self else { return }
                self.controller.pushSettings()
                if !self.settings.ocrEnabled && self.ocrMode { self.ocrMode = false }
            }
            .store(in: &bag)
        if let url = startURL {
            controller.load(url.absoluteString)
        } else {
            controller.load(settings.homeURL)
        }
    }

    deinit { controller.teardown() }

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

    func translateSelection() {
        if hasSelection { controller.translateSelection() } else { toast("Hãy chọn từ, câu hoặc đoạn tiếng Anh trước.") }
    }

    func toast(_ text: String) {
        toastTask?.cancel()
        toastText = text
        let work = DispatchWorkItem { [weak self] in self?.toastText = nil }
        toastTask = work
        DispatchQueue.main.asyncAfter(deadline: .now() + 2.4, execute: work)
    }

    func close() {
        controller.teardown()
        onClose()
    }
}
