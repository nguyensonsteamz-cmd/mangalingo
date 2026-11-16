import SwiftUI

/// Bookmarks and reading history.
struct WebReaderLibraryView: View {
    @ObservedObject var model: WebReaderViewModel
    @ObservedObject var library: WebLibrary
    @Environment(\.dismiss) private var dismiss
    @State private var tab = 0

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                Picker("", selection: $tab) {
                    Text("Dấu trang").tag(0)
                    Text("Lịch sử").tag(1)
                }
                .pickerStyle(.segmented)
                .padding(12)

                List {
                    if tab == 0 {
                        if library.bookmarks.isEmpty { placeholder("Chưa có dấu trang. Bấm ★ ở thanh dưới khi đang đọc.") }
                        ForEach(library.bookmarks) { item in
                            row(title: item.title, url: item.url)
                        }
                        .onDelete { library.removeBookmarks(at: $0) }
                    } else {
                        if library.history.isEmpty { placeholder("Lịch sử đọc trống.") }
                        ForEach(library.history) { item in
                            row(title: item.title, url: item.url)
                        }
                        .onDelete { library.removeHistory(at: $0) }
                    }
                }
                .listStyle(.plain)
                .scrollContentBackground(.hidden)
            }
            .background(ReaderPalette.background)
            .navigationTitle(tab == 0 ? "Dấu trang" : "Lịch sử")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    if tab == 1 && !library.history.isEmpty {
                        Button("Xoá lịch sử", role: .destructive) { library.clearHistory() }
                    }
                }
                ToolbarItem(placement: .navigationBarTrailing) { Button("Xong") { dismiss() } }
            }
        }
        .preferredColorScheme(.dark)
    }

    private func placeholder(_ text: String) -> some View {
        Text(text)
            .font(.system(size: 14))
            .foregroundColor(ReaderPalette.muted)
            .listRowBackground(Color.clear)
    }

    private func row(title: String, url: String) -> some View {
        Button {
            dismiss()
            model.controller.load(url)
        } label: {
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.system(size: 15, weight: .semibold)).lineLimit(1)
                Text(url).font(.system(size: 12)).foregroundColor(ReaderPalette.muted).lineLimit(1)
            }
        }
        .foregroundColor(.white)
        .listRowBackground(Color.clear)
    }
}

/// Reader settings (stored on this device).
struct WebReaderSettingsView: View {
    @ObservedObject var model: WebReaderViewModel
    @ObservedObject var settings: WebReaderSettings
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Form {
                Section("Tra cứu") {
                    Toggle("Chạm vào từ để tra", isOn: $settings.clickToLookup)
                    Toggle("Chọn chữ để dịch", isOn: $settings.selectToLookup)
                    Toggle("Tự mở cửa sổ dịch", isOn: $settings.autoPopup)
                    if !settings.autoPopup {
                        Text("Khi tắt, một nút “Dịch” nhỏ hiện ra trước, chạm vào mới mở cửa sổ dịch.")
                            .font(.footnote)
                            .foregroundColor(ReaderPalette.muted)
                    }
                }
                Section("Cửa sổ dịch") {
                    Picker("Vị trí", selection: $settings.popupPosition) {
                        ForEach(WebReaderSettings.PopupPosition.allCases) { Text($0.label).tag($0) }
                    }
                    Picker("Kích thước", selection: $settings.popupSize) {
                        ForEach(WebReaderSettings.PopupSize.allCases) { Text($0.label).tag($0) }
                    }
                    .pickerStyle(.segmented)
                    VStack(alignment: .leading) {
                        Text("Cỡ chữ: \(Int(settings.fontSize))")
                        Slider(value: $settings.fontSize, in: 12...22, step: 1)
                    }
                }
                Section("Ngôn ngữ dịch") {
                    LabeledContent("Dịch sang", value: "Tiếng Việt")
                    Text("Hiện chỉ có Anh → Việt (từ điển và gói dịch trên máy đều là Anh → Việt).")
                        .font(.footnote)
                        .foregroundColor(ReaderPalette.muted)
                }
                Section("OCR ảnh truyện") {
                    Toggle("Cho phép quét chữ trong ảnh", isOn: $settings.ocrEnabled)
                    Text("Bấm biểu tượng quét ở thanh dưới, rồi chạm vào ảnh. Chữ được nhận dạng trên máy bằng Apple Vision.")
                        .font(.footnote)
                        .foregroundColor(ReaderPalette.muted)
                }
                Section("Trang chủ") {
                    Text(settings.homeURL).font(.footnote).foregroundColor(ReaderPalette.muted)
                    Button("Đặt trang hiện tại làm trang chủ") {
                        if let url = model.currentURL, WebNavigationManager.isWebURL(url) {
                            settings.homeURL = url.absoluteString
                            model.toast("Đã đặt trang chủ")
                        }
                    }
                }
                Section("Riêng tư") {
                    Text("Trình đọc là chế độ riêng tư: cookie, đăng nhập và bộ nhớ đệm của website bị xoá khi đóng. LingoLens không lưu mật khẩu, không thu thập nội dung trang; chỉ phần chữ bạn chạm hoặc chọn mới được gửi đi dịch.")
                        .font(.footnote)
                        .foregroundColor(ReaderPalette.muted)
                }
            }
            .scrollContentBackground(.hidden)
            .background(ReaderPalette.background)
            .navigationTitle("Cài đặt trình đọc")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .navigationBarTrailing) { Button("Xong") { dismiss() } } }
        }
        .preferredColorScheme(.dark)
    }
}
