import Foundation
import SwiftUI

/// Reader preferences (UserDefaults, this device only). `jsConfig` is what the injected script receives.
final class WebReaderSettings: ObservableObject {
    static let shared = WebReaderSettings()

    enum PopupPosition: String, CaseIterable, Identifiable {
        case auto, above, below
        var id: String { rawValue }
        var label: String {
            switch self {
            case .auto: return "Tự động"
            case .above: return "Phía trên"
            case .below: return "Phía dưới"
            }
        }
    }

    enum PopupSize: String, CaseIterable, Identifiable {
        case small, medium, large
        var id: String { rawValue }
        var label: String {
            switch self {
            case .small: return "Nhỏ"
            case .medium: return "Vừa"
            case .large: return "Lớn"
            }
        }
    }

    /// Look of the Reader's own screens and of the translation popup on the page.
    enum Theme: String, CaseIterable, Identifiable {
        case system, light, dark
        var id: String { rawValue }
        var label: String {
            switch self {
            case .system: return "Theo máy"
            case .light: return "Sáng"
            case .dark: return "Tối"
            }
        }
    }

    private let defaults = UserDefaults.standard

    /// Tap an English word to look it up.
    @Published var clickToLookup: Bool { didSet { defaults.set(clickToLookup, forKey: "wr.click") } }
    /// Select text (word, sentence, paragraph) to translate it.
    @Published var selectToLookup: Bool { didSet { defaults.set(selectToLookup, forKey: "wr.select") } }
    /// Off: a small "Dịch" chip appears first and the popup opens only when it is tapped.
    @Published var autoPopup: Bool { didSet { defaults.set(autoPopup, forKey: "wr.auto") } }
    @Published var popupPosition: PopupPosition { didSet { defaults.set(popupPosition.rawValue, forKey: "wr.pos") } }
    @Published var popupSize: PopupSize { didSet { defaults.set(popupSize.rawValue, forKey: "wr.size") } }
    @Published var fontSize: Double { didSet { defaults.set(fontSize, forKey: "wr.font") } }
    @Published var ocrEnabled: Bool { didSet { defaults.set(ocrEnabled, forKey: "wr.ocr") } }
    /// Block known ad networks, pop-up windows opened by scripts, and invisible full-screen overlays that catch taps.
    @Published var blockAds: Bool { didSet { defaults.set(blockAds, forKey: "wr.ads") } }
    @Published var theme: Theme { didSet { defaults.set(theme.rawValue, forKey: "wr.theme") } }
    /// Set by the Reader screen while the theme is "Theo máy".
    @Published var systemLight = false
    /// Features that can be switched off: the floating tools button, the bottom quick bar (region scan + quick look-up), the speaker button
    /// of the popup, opening the sidebar by itself after a whole-screen scan.
    @Published var showTools: Bool { didSet { defaults.set(showTools, forKey: "wr.tools") } }
    @Published var showQuickBar: Bool { didSet { defaults.set(showQuickBar, forKey: "wr.quick") } }
    @Published var popupSpeaker: Bool { didSet { defaults.set(popupSpeaker, forKey: "wr.speaker") } }
    @Published var autoOpenSidebar: Bool { didSet { defaults.set(autoOpenSidebar, forKey: "wr.autosb") } }
    /// Translation target. Only Vietnamese is available (the on-device pack and the dictionaries are English → Vietnamese).
    @Published var targetLanguage: String { didSet { defaults.set(targetLanguage, forKey: "wr.lang") } }
    @Published var homeURL: String { didSet { defaults.set(homeURL, forKey: "wr.home") } }
    /// The app's theme, sent by the app page (Cài đặt → Giao diện): light or dark and its colours as "r g b" (bg, surface, elevated, text,
    /// muted, border, accent, accentFg). While it is known the Reader (bars, tools, popup on the page) uses it, so both look the same.
    @Published var appPalette: [String: String]? { didSet { defaults.set(appPalette, forKey: "wr.appPalette") } }

    /// From the app page. Only well-formed colours are kept; nothing changes when the theme is the same as before.
    func applyAppTheme(_ body: [String: Any]) {
        var p: [String: String] = [:]
        for k in ["bg", "surface", "elevated", "text", "muted", "border", "accent", "accentFg"] {
            if let v = body[k] as? String, v.range(of: #"^\d{1,3} \d{1,3} \d{1,3}$"#, options: .regularExpression) != nil { p[k] = v }
        }
        guard p.count == 8 else { return }
        p["light"] = (body["light"] as? Bool) == true ? "1" : "0"
        if p != appPalette { appPalette = p }
    }

    init() {
        defaults.register(defaults: [
            "wr.click": true, "wr.select": true, "wr.auto": true, "wr.pos": "auto", "wr.size": "medium",
            "wr.theme": "system", "wr.tools": true, "wr.quick": true, "wr.speaker": true, "wr.autosb": true,
            "wr.font": 15.0, "wr.ocr": true, "wr.ads": true, "wr.lang": "vi", "wr.home": "https://duckduckgo.com/",
        ])
        clickToLookup = defaults.bool(forKey: "wr.click")
        selectToLookup = defaults.bool(forKey: "wr.select")
        autoPopup = defaults.bool(forKey: "wr.auto")
        popupPosition = PopupPosition(rawValue: defaults.string(forKey: "wr.pos") ?? "") ?? .auto
        popupSize = PopupSize(rawValue: defaults.string(forKey: "wr.size") ?? "") ?? .medium
        fontSize = min(22, max(12, defaults.double(forKey: "wr.font")))
        ocrEnabled = defaults.bool(forKey: "wr.ocr")
        theme = Theme(rawValue: defaults.string(forKey: "wr.theme") ?? "") ?? .system
        showTools = defaults.bool(forKey: "wr.tools")
        showQuickBar = defaults.bool(forKey: "wr.quick")
        popupSpeaker = defaults.bool(forKey: "wr.speaker")
        autoOpenSidebar = defaults.bool(forKey: "wr.autosb")
        blockAds = defaults.bool(forKey: "wr.ads")
        targetLanguage = defaults.string(forKey: "wr.lang") ?? "vi"
        homeURL = defaults.string(forKey: "wr.home") ?? "https://duckduckgo.com/"
        appPalette = defaults.dictionary(forKey: "wr.appPalette") as? [String: String]
    }

    var isLight: Bool {
        if let p = appPalette { return p["light"] == "1" }
        return theme == .light || (theme == .system && systemLight)
    }
    /// nil = follow the phone
    var scheme: ColorScheme? {
        if appPalette != nil { return isLight ? .light : .dark }
        switch theme {
        case .system: return nil
        case .light: return .light
        case .dark: return .dark
        }
    }

    /// Sent to `window.__mlr.configure(...)` in the page.
    var jsConfig: [String: Any] {
        [
            "clickToLookup": clickToLookup,
            "selectToLookup": selectToLookup,
            "autoPopup": autoPopup,
            "popupPosition": popupPosition.rawValue,
            "popupSize": popupSize.rawValue,
            "fontSize": fontSize,
            "ocrEnabled": ocrEnabled,
            "blockAds": blockAds,
            "theme": isLight ? "light" : "dark",
            "speaker": popupSpeaker,
            "palette": appPalette.map { p in p.filter { $0.key != "light" } as Any } ?? NSNull(),
        ]
    }
}
