import Foundation

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
    /// Translation target. Only Vietnamese is available (the on-device pack and the dictionaries are English → Vietnamese).
    @Published var targetLanguage: String { didSet { defaults.set(targetLanguage, forKey: "wr.lang") } }
    @Published var homeURL: String { didSet { defaults.set(homeURL, forKey: "wr.home") } }

    init() {
        defaults.register(defaults: [
            "wr.click": true, "wr.select": true, "wr.auto": true, "wr.pos": "auto", "wr.size": "medium",
            "wr.font": 15.0, "wr.ocr": true, "wr.ads": true, "wr.lang": "vi", "wr.home": "https://duckduckgo.com/",
        ])
        clickToLookup = defaults.bool(forKey: "wr.click")
        selectToLookup = defaults.bool(forKey: "wr.select")
        autoPopup = defaults.bool(forKey: "wr.auto")
        popupPosition = PopupPosition(rawValue: defaults.string(forKey: "wr.pos") ?? "") ?? .auto
        popupSize = PopupSize(rawValue: defaults.string(forKey: "wr.size") ?? "") ?? .medium
        fontSize = min(22, max(12, defaults.double(forKey: "wr.font")))
        ocrEnabled = defaults.bool(forKey: "wr.ocr")
        blockAds = defaults.bool(forKey: "wr.ads")
        targetLanguage = defaults.string(forKey: "wr.lang") ?? "vi"
        homeURL = defaults.string(forKey: "wr.home") ?? "https://duckduckgo.com/"
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
        ]
    }
}
