import AppIntents
import Foundation

/// Shortcuts action “Quét ảnh với LingoLens”: receives an image (e.g. from “Take Screenshot”),
/// opens LingoLens and shows it on the scan screen. Used with the iPhone's AssistiveTouch button:
/// AssistiveTouch → Shortcut [Take Screenshot → Quét ảnh với LingoLens].
struct ScanScreenshotIntent: AppIntent {
    static var title: LocalizedStringResource = "Quét ảnh với LingoLens"
    static var description = IntentDescription("Mở LingoLens với ảnh (ví dụ ảnh chụp màn hình) để chọn vùng, quét chữ và tra nghĩa.")
    static var openAppWhenRun: Bool = true

    @Parameter(title: "Ảnh", supportedTypeIdentifiers: ["public.image"])
    var image: IntentFile

    @MainActor
    func perform() async throws -> some IntentResult {
        try PendingScan.save(image.data)
        NotificationCenter.default.post(name: .mlNewScan, object: nil)
        return .result()
    }
}
