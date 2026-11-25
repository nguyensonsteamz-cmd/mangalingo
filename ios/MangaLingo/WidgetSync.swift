import Foundation
import WidgetKit

/// App side of the home-screen widget: writes the saved words (sent by the web UI) where the widget can read them and asks WidgetKit to
/// reload. See Shared/WidgetShared.swift.
enum WidgetSync {
    static func write(words: [[String: Any]]) -> Bool {
        let parsed: [WidgetWord] = words.compactMap { d in
            guard let w = d["w"] as? String, !w.isEmpty else { return nil }
            return WidgetWord(w: w, ipa: d["ipa"] as? String, vi: d["vi"] as? String ?? "", ex: d["ex"] as? String)
        }
        let ok = WidgetShared.write(WidgetSnapshot(words: parsed, updated: Date().timeIntervalSince1970))
        WidgetCenter.shared.reloadAllTimelines()
        return ok
    }

    static func status() -> [String: Any] {
        let container = WidgetShared.container()
        return [
            "ok": container != nil,
            "group": container?.id ?? "",
            "count": WidgetShared.read()?.words.count ?? 0,
            "text": WidgetShared.diagnostics(),
        ]
    }
}
