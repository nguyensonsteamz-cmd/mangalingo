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
                    .foregroundColor(ReaderPalette.text)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 8)
                    ReaderWebHost(web: model.sidebar.ensureLoaded())
                }
                .frame(width: width)
                .background(ReaderPalette.background)
                .overlay(alignment: .leading) { Rectangle().fill(ReaderPalette.line(0.1)).frame(width: 1) }
                .transition(.move(edge: .trailing))
            }
        }
    }
}

/// The "touch" tools: a round arrow button that can be dragged anywhere and settles against the left or the right edge (at any height).
/// Tapping it opens a column of tools right next to it (below the button, or above it when there is no room); the column scrolls
/// when the screen is too short for all of it.
struct ReaderToolsDrawer: View {
    @ObservedObject var model: WebReaderViewModel
    @AppStorage("wr.toolsY") private var yFraction = 0.4
    @AppStorage("wr.toolsRight") private var onRight = true
    @ObservedObject private var settings = WebReaderSettings.shared
    @State private var open = false
    @State private var dragPoint: CGPoint?

    private struct Tool: Identifiable {
        let id: String
        let symbol: String
        let label: String
        var active = false
        let run: () -> Void
    }

    private var tools: [Tool] {
        [
            Tool(id: "type", symbol: "character.cursor.ibeam", label: "Dịch", active: settings.showQuickBar && !model.hudHidden) { model.toggleQuickTranslate() },
            Tool(id: "img", symbol: "photo", label: "Quét ảnh", active: model.ocrMode) { model.toggleOCR() },
            Tool(id: "region", symbol: "rectangle.dashed", label: "Quét vùng", active: model.regionMode) { model.startRegion() },
            Tool(id: "screen", symbol: "text.viewfinder", label: "Màn hình") { model.scanScreen() },
            Tool(id: "all", symbol: "photo.stack", label: "Mọi ảnh") { model.scanAllImages() },
            Tool(id: "hud", symbol: model.hudHidden ? "eye" : "eye.slash", label: model.hudHidden ? "Hiện giao diện" : "Ẩn giao diện", active: model.hudHidden) { model.hudHidden.toggle() },
            Tool(id: "side", symbol: "sidebar.right", label: "Thanh bên", active: model.sidebarOpen) { model.toggleSidebar() },
            Tool(id: "notes", symbol: "book", label: "Sổ từ") { model.openNotes() },
            Tool(id: "mark", symbol: model.isBookmarked ? "star.fill" : "star", label: "Dấu trang", active: model.isBookmarked) { model.toggleBookmark() },
        ]
    }

    private let tileW: CGFloat = 76
    private let tileH: CGFloat = 70
    private let handleSize: CGFloat = 38
    private let margin: CGFloat = 6
    private let gap: CGFloat = 8

    var body: some View {
        GeometryReader { geo in
            let size = geo.size
            let items = tools
            let panelW = tileW + 12
            let fullH = CGFloat(items.count) * tileH + 12
            let panelH = max(tileH + 12, min(fullH, size.height - handleSize - 2 * margin - gap))
            // the button: where the finger is while dragging, otherwise against its edge at the saved height
            let restX = onRight ? size.width - handleSize / 2 - margin : handleSize / 2 + margin
            let hx = dragPoint?.x ?? restX
            let rawY = dragPoint?.y ?? CGFloat(yFraction) * size.height
            let hy = min(max(handleSize / 2 + margin, rawY), max(handleSize / 2 + margin, size.height - handleSize / 2 - margin))
            // the column opens on the side of the button that has room
            let spaceBelow = size.height - (hy + handleSize / 2) - margin
            let below = spaceBelow >= panelH + gap || hy < size.height / 2
            let rawPanelY = below ? hy + handleSize / 2 + gap + panelH / 2 : hy - handleSize / 2 - gap - panelH / 2
            let panelY = min(max(margin + panelH / 2, rawPanelY), size.height - margin - panelH / 2)
            let panelX = onRight ? size.width - margin - panelW / 2 : margin + panelW / 2

            ZStack {
                if open {
                    panel(items, width: panelW, height: panelH, fullHeight: fullH)
                        .position(x: panelX, y: panelY)
                        .transition(.opacity.combined(with: .scale(scale: 0.92)))
                }
                handle(size: size)
                    .position(x: hx, y: hy)
            }
            .frame(width: size.width, height: size.height)
            .animation(dragPoint == nil ? .spring(response: 0.32, dampingFraction: 0.85) : nil, value: open)
            .animation(dragPoint == nil ? .spring(response: 0.32, dampingFraction: 0.85) : nil, value: onRight)
        }
        .coordinateSpace(name: "readerTools")
        .allowsHitTesting(!model.sidebarOpen)
    }

    private func panel(_ items: [Tool], width: CGFloat, height: CGFloat, fullHeight: CGFloat) -> some View {
        ScrollView(.vertical, showsIndicators: false) {
            VStack(spacing: 0) {
                ForEach(items) { t in
                    Button {
                        open = false
                        t.run()
                    } label: {
                        VStack(spacing: 3) {
                            Image(systemName: t.symbol).font(.system(size: 23, weight: .medium))
                            Text(t.label).font(.system(size: 12, weight: .semibold)).lineLimit(1)
                        }
                        .frame(width: tileW, height: tileH - 2)
                        .background(RoundedRectangle(cornerRadius: 14).fill(t.active ? ReaderPalette.accentFill.opacity(0.5) : Color.clear))
                    }
                    .foregroundColor(ReaderPalette.text)
                    .accessibilityLabel(t.label)
                }
            }
            .padding(.vertical, 6)
        }
        .frame(width: width, height: height)
        .background(RoundedRectangle(cornerRadius: 20).fill(ReaderPalette.surface.opacity(0.97)))
        .overlay(RoundedRectangle(cornerRadius: 20).stroke(ReaderPalette.line(0.12), lineWidth: 1))
    }

    private func handle(size: CGSize) -> some View {
        Image(systemName: open ? "xmark" : (onRight ? "chevron.left" : "chevron.right"))
            .font(.system(size: 14, weight: .bold))
            .foregroundColor(Color.white.opacity(0.78))
            .frame(width: handleSize, height: handleSize)
            .background(Circle().fill(Color(red: 0.07, green: 0.08, blue: 0.11).opacity(0.9)))
            .overlay(Circle().stroke(Color.white.opacity(0.16), lineWidth: 1))
            .shadow(color: Color.black.opacity(0.35), radius: 4, x: 0, y: 1)
            .contentShape(Circle())
            .onTapGesture { open.toggle() }
            .gesture(
                DragGesture(minimumDistance: 6, coordinateSpace: .named("readerTools"))
                    .onChanged { v in dragPoint = v.location }
                    .onEnded { v in
                        yFraction = Double(min(0.95, max(0.05, v.location.y / max(1, size.height))))
                        onRight = v.location.x > size.width / 2
                        dragPoint = nil
                    }
            )
            .accessibilityLabel(open ? "Đóng công cụ" : "Mở công cụ")
    }
}
