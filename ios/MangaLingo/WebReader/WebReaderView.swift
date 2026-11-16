import SwiftUI
import WebKit

/// Dark palette shared with the LingoLens app (the web UI uses the same colours).
enum ReaderPalette {
    static let background = Color(red: 16 / 255, green: 18 / 255, blue: 24 / 255)
    static let surface = Color(red: 30 / 255, green: 34 / 255, blue: 44 / 255)
    static let accent = Color(red: 124 / 255, green: 156 / 255, blue: 255 / 255)
    static let accentFill = Color(red: 52 / 255, green: 81 / 255, blue: 209 / 255)
    static let muted = Color(red: 154 / 255, green: 164 / 255, blue: 184 / 255)
}

/// Shows the current tab's web view (the tabs own their web views, so switching tabs swaps the view inside this container).
struct ReaderWebHost: UIViewRepresentable {
    let web: WKWebView

    func makeUIView(context: Context) -> UIView {
        let v = UIView()
        v.backgroundColor = .clear
        return v
    }

    func updateUIView(_ container: UIView, context: Context) {
        guard web.superview !== container else { return }
        container.subviews.forEach { $0.removeFromSuperview() }
        web.translatesAutoresizingMaskIntoConstraints = false
        container.addSubview(web)
        NSLayoutConstraint.activate([
            web.leadingAnchor.constraint(equalTo: container.leadingAnchor),
            web.trailingAnchor.constraint(equalTo: container.trailingAnchor),
            web.topAnchor.constraint(equalTo: container.topAnchor),
            web.bottomAnchor.constraint(equalTo: container.bottomAnchor),
        ])
    }
}

/// The in-app browser: address bar, tab strip, page, bottom toolbar. Looking words up happens inside the page itself
/// (popup drawn by the injected script), so the Reader never has to leave this screen. The tabs live in the session
/// (ReaderPresenter): closing the Reader and opening it again shows the same pages.
struct WebReaderView: View {
    @ObservedObject var model: WebReaderViewModel
    @ObservedObject private var library = WebLibrary.shared
    @ObservedObject private var settings = WebReaderSettings.shared
    @Environment(\.scenePhase) private var scenePhase
    @FocusState private var addressFocused: Bool

    var body: some View {
        ZStack {
            ReaderPalette.background.ignoresSafeArea()
            VStack(spacing: 0) {
                topBar
                tabStrip
                progressBar
                ZStack {
                    ReaderWebHost(web: model.controller.web)
                        .id(model.current.id)
                    if let error = model.error { errorView(error) }
                }
                .overlay(alignment: .bottom) { toast }
                bottomBar
            }
        }
        .preferredColorScheme(.dark)
        .sheet(isPresented: $model.showLibrary) {
            WebReaderLibraryView(model: model, library: library)
        }
        .sheet(isPresented: $model.showSettings) {
            WebReaderSettingsView(model: model, settings: settings)
        }
        .sheet(isPresented: $model.showTabs) {
            WebReaderTabsView(model: model)
        }
        .onChange(of: scenePhase) { phase in
            // the app went to the background: stop video / audio of the pages and remember the tabs
            if phase != .active {
                model.pauseAll()
                model.saveNow()
            }
        }
    }

    // MARK: top bar

    private var topBar: some View {
        HStack(spacing: 10) {
            Button { model.close() } label: {
                Image(systemName: "xmark")
                    .font(.system(size: 15, weight: .bold))
                    .frame(width: 34, height: 34)
                    .background(Circle().fill(ReaderPalette.surface))
            }
            .accessibilityLabel("Đóng trình đọc (các tab được giữ lại)")

            HStack(spacing: 6) {
                Image(systemName: isSecure ? "lock.fill" : "globe")
                    .font(.system(size: 12))
                    .foregroundColor(isSecure ? Color.green.opacity(0.85) : ReaderPalette.muted)
                TextField("Nhập địa chỉ hoặc từ khoá", text: $model.addressText)
                    .focused($addressFocused)
                    .keyboardType(.URL)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .submitLabel(.go)
                    .font(.system(size: 15))
                    .onSubmit {
                        addressFocused = false
                        model.controller.load(model.addressText)
                    }
                    .onChange(of: addressFocused) { focused in
                        model.isEditingAddress = focused
                        if !focused { model.addressText = model.currentURL?.absoluteString ?? model.addressText }
                    }
                if addressFocused && !model.addressText.isEmpty {
                    Button { model.addressText = "" } label: {
                        Image(systemName: "xmark.circle.fill").foregroundColor(ReaderPalette.muted)
                    }
                }
            }
            .padding(.horizontal, 12)
            .frame(height: 38)
            .background(Capsule().fill(ReaderPalette.surface))
            .overlay(Capsule().stroke(Color.white.opacity(0.08), lineWidth: 1))

            Button {
                if model.isLoading { model.controller.stop() } else { model.controller.reload() }
            } label: {
                Image(systemName: model.isLoading ? "xmark" : "arrow.clockwise")
                    .font(.system(size: 15, weight: .semibold))
                    .frame(width: 34, height: 34)
            }
            .accessibilityLabel(model.isLoading ? "Dừng tải" : "Tải lại")
        }
        .foregroundColor(.white)
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
    }

    private var isSecure: Bool { model.currentURL?.scheme?.lowercased() == "https" }

    // MARK: tab strip

    private var tabStrip: some View {
        ScrollViewReader { proxy in
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 6) {
                    ForEach(Array(model.tabs.enumerated()), id: \.element.id) { index, tab in
                        tabChip(tab, index: index)
                            .id(tab.id)
                    }
                    Button { model.openTab(nil, activate: true) } label: {
                        Image(systemName: "plus")
                            .font(.system(size: 14, weight: .bold))
                            .frame(width: 32, height: 30)
                            .background(Capsule().fill(ReaderPalette.surface))
                    }
                    .accessibilityLabel("Mở tab mới")
                }
                .padding(.horizontal, 12)
            }
            .onChange(of: model.currentIndex) { _ in
                withAnimation { proxy.scrollTo(model.current.id, anchor: .center) }
            }
        }
        .frame(height: 36)
        .foregroundColor(.white)
    }

    private func tabChip(_ tab: ReaderTab, index: Int) -> some View {
        let selected = index == model.currentIndex
        return HStack(spacing: 4) {
            Button { model.select(index) } label: {
                Text(tab.label)
                    .font(.system(size: 13, weight: selected ? .semibold : .regular))
                    .lineLimit(1)
                    .frame(maxWidth: 130, alignment: .leading)
            }
            Button { model.closeTab(at: index) } label: {
                Image(systemName: "xmark")
                    .font(.system(size: 10, weight: .bold))
                    .frame(width: 18, height: 18)
                    .foregroundColor(selected ? .white : ReaderPalette.muted)
            }
            .accessibilityLabel("Đóng tab")
        }
        .padding(.leading, 12)
        .padding(.trailing, 6)
        .frame(height: 30)
        .background(Capsule().fill(selected ? ReaderPalette.accentFill.opacity(0.55) : ReaderPalette.surface))
        .overlay(Capsule().stroke(selected ? ReaderPalette.accent.opacity(0.7) : Color.white.opacity(0.06), lineWidth: 1))
    }

    private var progressBar: some View {
        GeometryReader { geo in
            Rectangle()
                .fill(ReaderPalette.accent)
                .frame(width: geo.size.width * CGFloat(model.progress), height: 2)
                .opacity(model.isLoading ? 1 : 0)
                .animation(.easeOut(duration: 0.2), value: model.progress)
        }
        .frame(height: 2)
    }

    // MARK: bottom bar

    private var bottomBar: some View {
        HStack(spacing: 0) {
            barButton("chevron.left", label: "Quay lại", enabled: model.canGoBack) { model.controller.goBack() }
            barButton("chevron.right", label: "Tiến tới", enabled: model.canGoForward) { model.controller.goForward() }
            tabsButton
            barButton("character.bubble", label: "Dịch phần đã chọn", tint: model.hasSelection ? ReaderPalette.accent : nil) { model.translateSelection() }
            barButton("text.viewfinder", label: "Quét chữ trong ảnh", tint: model.ocrMode ? Color.orange : nil, filled: model.ocrMode) { model.toggleOCR() }
            moreMenu
        }
        .padding(.horizontal, 6)
        .padding(.top, 6)
        .padding(.bottom, 2)
        .background(ReaderPalette.background)
        .overlay(alignment: .top) { Rectangle().fill(Color.white.opacity(0.07)).frame(height: 1) }
    }

    private var tabsButton: some View {
        Button { model.showTabs = true } label: {
            ZStack {
                RoundedRectangle(cornerRadius: 5).stroke(Color.white, lineWidth: 1.6).frame(width: 21, height: 21)
                Text("\(model.tabs.count)").font(.system(size: 11, weight: .bold))
            }
            .frame(maxWidth: .infinity, minHeight: 44)
        }
        .foregroundColor(.white)
        .accessibilityLabel("Các tab (\(model.tabs.count))")
    }

    private var moreMenu: some View {
        Menu {
            Button { model.toggleBookmark() } label: {
                Label(model.isBookmarked ? "Bỏ dấu trang" : "Thêm dấu trang", systemImage: model.isBookmarked ? "star.fill" : "star")
            }
            Button { model.showLibrary = true } label: { Label("Dấu trang và lịch sử", systemImage: "books.vertical") }
            Button { model.controller.backToOrigin() } label: { Label("Về trang đang đọc", systemImage: "arrow.uturn.backward") }
            Button { model.controller.home() } label: { Label("Trang chủ", systemImage: "house") }
            Button { model.closeCurrentTab() } label: { Label("Đóng tab này", systemImage: "xmark.square") }
            Button { model.showSettings = true } label: { Label("Cài đặt trình đọc", systemImage: "gearshape") }
        } label: {
            Image(systemName: "ellipsis.circle")
                .font(.system(size: 19, weight: .medium))
                .frame(maxWidth: .infinity, minHeight: 44)
        }
        .foregroundColor(.white)
        .accessibilityLabel("Thêm")
    }

    private func barButton(_ symbol: String, label: String, enabled: Bool = true, tint: Color? = nil, filled: Bool = false, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(.system(size: 19, weight: .medium))
                .frame(maxWidth: .infinity, minHeight: 44)
                .background(
                    RoundedRectangle(cornerRadius: 12).fill(filled ? (tint ?? ReaderPalette.accent).opacity(0.22) : Color.clear).padding(.horizontal, 4)
                )
        }
        .foregroundColor(tint ?? (enabled ? .white : ReaderPalette.muted.opacity(0.45)))
        .disabled(!enabled)
        .accessibilityLabel(label)
    }

    // MARK: overlays

    private func errorView(_ error: WebReaderViewModel.ReaderError) -> some View {
        VStack(spacing: 14) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 34))
                .foregroundColor(.orange)
            Text("Không mở được trang")
                .font(.system(size: 18, weight: .bold))
            Text(error.message)
                .font(.system(size: 14))
                .foregroundColor(ReaderPalette.muted)
                .multilineTextAlignment(.center)
            if let url = error.url {
                Text(url)
                    .font(.system(size: 11))
                    .foregroundColor(ReaderPalette.muted.opacity(0.7))
                    .lineLimit(2)
            }
            HStack(spacing: 10) {
                Button("Thử lại") {
                    if let url = error.url { model.controller.load(url) } else { model.controller.home() }
                }
                .buttonStyle(ReaderButtonStyle(primary: true))
                Button("Trang chủ") { model.controller.home() }
                    .buttonStyle(ReaderButtonStyle(primary: false))
            }
        }
        .foregroundColor(.white)
        .padding(24)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(ReaderPalette.background)
    }

    @ViewBuilder private var toast: some View {
        if let text = model.toastText {
            HStack(spacing: 10) {
                Text(text)
                    .font(.system(size: 13.5, weight: .semibold))
                    .foregroundColor(.white)
                if let action = model.toastAction {
                    Button(action.title) {
                        action.run()
                        model.toastText = nil
                        model.toastAction = nil
                    }
                    .font(.system(size: 13.5, weight: .bold))
                    .foregroundColor(ReaderPalette.accent)
                }
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 9)
            .background(Capsule().fill(ReaderPalette.surface))
            .overlay(Capsule().stroke(Color.white.opacity(0.12), lineWidth: 1))
            .padding(.bottom, 16)
            .transition(.opacity)
        }
    }
}

/// All open tabs as a list (title + address), with close buttons and "new tab".
struct WebReaderTabsView: View {
    @ObservedObject var model: WebReaderViewModel
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List {
                ForEach(Array(model.tabs.enumerated()), id: \.element.id) { index, tab in
                    Button {
                        model.select(index)
                        dismiss()
                    } label: {
                        HStack {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(tab.label).font(.system(size: 15, weight: .semibold)).lineLimit(1)
                                Text((tab.url ?? tab.restoreURL)?.absoluteString ?? "").font(.system(size: 12)).foregroundColor(ReaderPalette.muted).lineLimit(1)
                            }
                            Spacer()
                            if index == model.currentIndex { Image(systemName: "checkmark").foregroundColor(ReaderPalette.accent) }
                        }
                    }
                    .foregroundColor(.white)
                    .listRowBackground(Color.clear)
                }
                .onDelete { offsets in
                    for i in offsets.sorted(by: >) { model.closeTab(at: i) }
                }
            }
            .listStyle(.plain)
            .scrollContentBackground(.hidden)
            .background(ReaderPalette.background)
            .navigationTitle("Các tab (\(model.tabs.count))")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button("Tab mới") {
                        model.openTab(nil, activate: true)
                        dismiss()
                    }
                }
                ToolbarItem(placement: .navigationBarTrailing) { Button("Xong") { dismiss() } }
            }
        }
        .preferredColorScheme(.dark)
    }
}

struct ReaderButtonStyle: ButtonStyle {
    let primary: Bool
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 15, weight: .semibold))
            .padding(.horizontal, 18)
            .padding(.vertical, 9)
            .background(Capsule().fill(primary ? ReaderPalette.accentFill : ReaderPalette.surface))
            .opacity(configuration.isPressed ? 0.75 : 1)
    }
}
