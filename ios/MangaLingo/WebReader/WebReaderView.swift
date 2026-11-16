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

struct ReaderWebView: UIViewRepresentable {
    let web: WKWebView
    func makeUIView(context: Context) -> WKWebView { web }
    func updateUIView(_ uiView: WKWebView, context: Context) {}
}

/// The in-app browser: address bar, page, bottom toolbar. Looking words up happens inside the page itself
/// (popup drawn by the injected script), so the Reader never has to leave this screen.
struct WebReaderView: View {
    @StateObject private var model: WebReaderViewModel
    @ObservedObject private var library = WebLibrary.shared
    @ObservedObject private var settings = WebReaderSettings.shared
    @Environment(\.scenePhase) private var scenePhase
    @FocusState private var addressFocused: Bool

    init(startURL: URL?, onClose: @escaping () -> Void) {
        _model = StateObject(wrappedValue: WebReaderViewModel(startURL: startURL, onClose: onClose))
    }

    var body: some View {
        ZStack {
            ReaderPalette.background.ignoresSafeArea()
            VStack(spacing: 0) {
                topBar
                progressBar
                ZStack {
                    ReaderWebView(web: model.controller.web)
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
        .onChange(of: scenePhase) { phase in
            // the app went to the background: stop video / audio of the page
            if phase != .active { model.controller.pauseMedia() }
        }
        .onDisappear { model.controller.teardown() }
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
            .accessibilityLabel("Đóng trình đọc")

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
            barButton(model.isBookmarked ? "star.fill" : "star", label: "Dấu trang", tint: model.isBookmarked ? Color.yellow : nil) { model.toggleBookmark() }
            barButton("character.bubble", label: "Dịch phần đã chọn", tint: model.hasSelection ? ReaderPalette.accent : nil) { model.translateSelection() }
            barButton("text.viewfinder", label: "Quét chữ trong ảnh", tint: model.ocrMode ? Color.orange : nil, filled: model.ocrMode) { model.toggleOCR() }
            barButton("books.vertical", label: "Dấu trang và lịch sử") { model.showLibrary = true }
            barButton("gearshape", label: "Cài đặt trình đọc") { model.showSettings = true }
        }
        .padding(.horizontal, 6)
        .padding(.top, 6)
        .padding(.bottom, 2)
        .background(ReaderPalette.background)
        .overlay(alignment: .top) { Rectangle().fill(Color.white.opacity(0.07)).frame(height: 1) }
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
            Text(text)
                .font(.system(size: 13.5, weight: .semibold))
                .foregroundColor(.white)
                .padding(.horizontal, 14)
                .padding(.vertical, 9)
                .background(Capsule().fill(ReaderPalette.surface))
                .overlay(Capsule().stroke(Color.white.opacity(0.12), lineWidth: 1))
                .padding(.bottom, 16)
                .transition(.opacity)
        }
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
