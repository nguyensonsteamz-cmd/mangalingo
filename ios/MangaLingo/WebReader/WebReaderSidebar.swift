import SwiftUI
import WebKit

/// The extension's sidebar inside the Reader: a second web view of the app's own page (route #reader-sidebar) that shows only the
/// sidebar UI (Dịch / Từ vựng / Ngữ pháp / Ngữ cảnh / Đã lưu / Ghi chú). It shares the app's storage, so words and notes saved here
/// are the same as everywhere else. Content is pushed from the Reader (a look-up, or the bubbles read on the page).
final class ReaderSidebar {
    private(set) var web: WKWebView?
    private let coordinator = WebContainer.Coordinator()

    /// Creates the web view on first use (loading the dictionary only when the sidebar is really opened).
    @discardableResult
    func ensureLoaded() -> WKWebView {
        if let w = web { return w }
        let w = WebContainer.makeWebView(coordinator: coordinator, route: "index.html#reader-sidebar", isMain: false)
        web = w
        return w
    }

    /// Delivers a payload ({type: "lookup" | "ocr", …}) once the page has installed its receiver (it needs a moment after loading).
    func push(_ payload: [String: Any], attempt: Int = 0) {
        let w = ensureLoaded()
        let js = "(function(p){ if (!window.__mlSidebar) return false; window.__mlSidebar(p); return true; })(\(JS.literal(payload)))"
        w.evaluateJavaScript(js) { [weak self] result, _ in
            if (result as? Bool) == true || attempt >= 30 { return }
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) { self?.push(payload, attempt: attempt + 1) }
        }
    }

    func showTab(_ tab: String, attempt: Int = 0) {
        let w = ensureLoaded()
        let js = "(function(t){ if (!window.__mlSidebarTab) return false; window.__mlSidebarTab(t); return true; })(\(JS.literal(tab)))"
        w.evaluateJavaScript(js) { [weak self] result, _ in
            if (result as? Bool) == true || attempt >= 30 { return }
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) { self?.showTab(tab, attempt: attempt + 1) }
        }
    }
}

/// The sidebar panel: slides in from the right over the page, with a title bar and a close button.
struct ReaderSidebarPanel: View {
    @ObservedObject var model: WebReaderViewModel

    var body: some View {
        GeometryReader { geo in
            let width = min(430, geo.size.width * 0.9)
            ZStack(alignment: .trailing) {
                Color.black.opacity(0.35)
                    .ignoresSafeArea()
                    .onTapGesture { model.sidebarOpen = false }
                VStack(spacing: 0) {
                    HStack {
                        Text("Thanh bên")
                            .font(.system(size: 16, weight: .bold))
                        Spacer()
                        Button { model.sidebarOpen = false } label: {
                            Image(systemName: "xmark")
                                .font(.system(size: 14, weight: .bold))
                                .frame(width: 32, height: 32)
                                .background(Circle().fill(ReaderPalette.surface))
                        }
                        .accessibilityLabel("Đóng thanh bên")
                    }
                    .foregroundColor(.white)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 8)
                    ReaderWebHost(web: model.sidebar.ensureLoaded())
                }
                .frame(width: width)
                .background(ReaderPalette.background)
                .overlay(alignment: .leading) { Rectangle().fill(Color.white.opacity(0.1)).frame(width: 1) }
                .transition(.move(edge: .trailing))
            }
        }
    }
}

/// The "touch" tools: a column of buttons docked to a screen edge. Closed, only a small arrow tab shows; drag the tab up / down to
/// move it, or across the middle of the screen to dock it on the other side.
struct ReaderToolsDrawer: View {
    @ObservedObject var model: WebReaderViewModel
    @AppStorage("wr.toolsY") private var yFraction = 0.4
    @AppStorage("wr.toolsRight") private var onRight = true
    @State private var open = false
    @State private var dragY: CGFloat?

    private struct Tool: Identifiable {
        let id: String
        let symbol: String
        let label: String
        var active = false
        let run: () -> Void
    }

    private var tools: [Tool] {
        [
            Tool(id: "sel", symbol: "character.bubble", label: "Dịch chọn", active: model.hasSelection) { model.translateSelection() },
            Tool(id: "img", symbol: "photo", label: "Quét ảnh", active: model.ocrMode) { model.toggleOCR() },
            Tool(id: "region", symbol: "rectangle.dashed", label: "Quét vùng", active: model.regionMode) { model.startRegion() },
            Tool(id: "screen", symbol: "text.viewfinder", label: "Màn hình") { model.scanScreen() },
            Tool(id: "all", symbol: "photo.stack", label: "Mọi ảnh") { model.scanAllImages() },
            Tool(id: "side", symbol: "sidebar.right", label: "Thanh bên", active: model.sidebarOpen) { model.toggleSidebar() },
            Tool(id: "notes", symbol: "note.text", label: "Ghi chú") { model.openNotes() },
            Tool(id: "mark", symbol: model.isBookmarked ? "star.fill" : "star", label: "Dấu trang", active: model.isBookmarked) { model.toggleBookmark() },
        ]
    }

    private let tileW: CGFloat = 62
    private let tileH: CGFloat = 58
    private let tabW: CGFloat = 26

    var body: some View {
        GeometryReader { geo in
            let items = tools
            let panelH = CGFloat(items.count) * tileH + 12
            let panelW = tileW + 12
            let center = dragY ?? CGFloat(yFraction) * geo.size.height
            let top = min(max(8, center - panelH / 2), max(8, geo.size.height - panelH - 8))
            HStack(spacing: 0) {
                if !onRight { panel(items, width: panelW, height: panelH) }
                handle(height: panelH, in: geo.size)
                if onRight { panel(items, width: panelW, height: panelH) }
            }
            .frame(height: panelH)
            .background(RoundedRectangle(cornerRadius: 20).fill(ReaderPalette.surface.opacity(0.96)))
            .overlay(RoundedRectangle(cornerRadius: 20).stroke(Color.white.opacity(0.1), lineWidth: 1))
            .offset(x: open ? 0 : (onRight ? panelW : -panelW))
            .position(x: onRight ? geo.size.width - (tabW + panelW) / 2 + (open ? 0 : 0) : (tabW + panelW) / 2, y: top + panelH / 2)
            .animation(dragY == nil ? .spring(response: 0.35, dampingFraction: 0.85) : nil, value: open)
        }
        .coordinateSpace(name: "readerTools")
        .allowsHitTesting(!model.sidebarOpen)
    }

    private func panel(_ items: [Tool], width: CGFloat, height: CGFloat) -> some View {
        VStack(spacing: 0) {
            ForEach(items) { t in
                Button {
                    open = false
                    t.run()
                } label: {
                    VStack(spacing: 3) {
                        Image(systemName: t.symbol).font(.system(size: 19, weight: .medium))
                        Text(t.label).font(.system(size: 10.5, weight: .semibold)).lineLimit(1)
                    }
                    .frame(width: tileW, height: tileH - 2)
                    .background(RoundedRectangle(cornerRadius: 14).fill(t.active ? ReaderPalette.accentFill.opacity(0.5) : Color.clear))
                }
                .foregroundColor(.white)
                .accessibilityLabel(t.label)
            }
        }
        .frame(width: width, height: height)
    }

    private func handle(height: CGFloat, in size: CGSize) -> some View {
        Image(systemName: (open == onRight) ? "chevron.right" : "chevron.left")
            .font(.system(size: 14, weight: .bold))
            .foregroundColor(ReaderPalette.muted)
            .frame(width: tabW, height: height)
            .contentShape(Rectangle())
            .gesture(
                DragGesture(minimumDistance: 0, coordinateSpace: .named("readerTools"))
                    .onChanged { v in
                        if abs(v.translation.height) > 8 || abs(v.translation.width) > 8 { dragY = v.location.y }
                    }
                    .onEnded { v in
                        if dragY == nil {
                            open.toggle()
                        } else {
                            yFraction = Double(min(0.85, max(0.1, v.location.y / max(1, size.height))))
                            onRight = v.location.x > size.width / 2
                            dragY = nil
                        }
                    }
            )
            .accessibilityLabel(open ? "Đóng công cụ" : "Mở công cụ")
    }
}
